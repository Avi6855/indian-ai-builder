import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/prisma";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import { aj } from "@/lib/arcjet";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL_ID = "openai/gpt-oss-20b:free";

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/^['"`]+|['"`]+$/g, "");
}

function parseCsv(value: string | undefined): string[] {
  const v = normalizeEnvValue(value);
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function getModelCandidates(): string[] {
  const primary = normalizeEnvValue(process.env.AI_MODEL);
  const fallbacks = parseCsv(process.env.AI_MODEL_FALLBACKS);
  return unique([primary, ...fallbacks, DEFAULT_MODEL_ID].filter(Boolean)) as string[];
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isSwitchModelStatus(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 402 || status === 403 || status === 404;
}

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function getOpenAIClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY.");

  return new OpenAI({
    baseURL:
      normalizeEnvValue(process.env.OPENROUTER_BASE_URL) ||
      normalizeEnvValue(process.env.OPENAI_BASE_URL) ||
      DEFAULT_OPENROUTER_BASE_URL,
    apiKey,
  });
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

// ─── Extract short label from a Gemini thought chunk ─────────────────────────
// Gemini thoughts often start with a bold heading like **Verify Config**
// We extract that. If no bold heading, take the first sentence only.

function extractThoughtLabel(text: string): string | null {
  // Try to grab **bold heading** at the start
  const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
  if (boldMatch) return boldMatch[1].trim();

  // Fall back to first sentence (up to first . or \n), capped at 60 chars
  const sentence = text.split(/[.\n]/)[0].trim();
  if (sentence.length >= 8 && sentence.length <= 80) return sentence;

  return null;
}

// ─── npm validation ───────────────────────────────────────────────────────────

async function validateDependencies(
  deps: Record<string, string>
): Promise<Record<string, string>> {
  const valid: Record<string, string> = {};
  await Promise.all(
    Object.entries(deps).map(async ([pkg, version]) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) valid[pkg] = version;
      } catch {
        // silently skip hallucinated packages
      }
    })
  );
  return valid;
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

RULES:
1. Always respond with a valid JSON object — no markdown fences, no extra text.
2. The JSON must match this exact shape:
{
  "assistantMessage": "<brief explanation of what you built/changed>",
  "title": "<short 2-4 word title for the app, e.g. 'Todo List App'>",
  "files": {
    "/App.js": { "code": "<full file content>" },
    "/components/SomeComponent.js": { "code": "<full file content>" }
  },
  "dependencies": {
    "some-package": "latest"
  }
}
3. Use React (functional components + hooks). Do NOT use TypeScript in generated files.
4. Use Tailwind CSS for all styling. Do not use CSS modules or inline styles unless absolutely necessary.
5. The entry point must always be /App.js and must export a default component.
6. All imports must reference files you include in "files" or packages in "dependencies".
7. Do not include react, react-dom, or tailwindcss in "dependencies" — they are always available.
8. When modifying existing code, include ALL files (both changed and unchanged) in "files".
9. Keep code clean, readable, and production-quality.
10. If the user attaches an image, use it as a design reference and match the layout/style as closely as possible.`;

// ─── OpenAI messages builder ──────────────────────────────────────────────────

function buildMessages(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "assistant" : "user";

    if (msg.role === "user") {
      let text = msg.content;

      if (msg.imageUrl) {
        text = `[The user has attached an image. Use this URL directly in the generated app where relevant (as img src, background-image, etc.): ${msg.imageUrl}]\n\n${text}`;
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        text +=
          "\n\nCurrent project files for context:\n" +
          JSON.stringify(fileData, null, 2);
      }

      return { role, content: text };
    }

    return { role, content: msg.content };
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  // ── Arcjet: rate limit, prompt injection, sensitive info ──────────────────
  // detectPromptInjectionMessage requires the actual user text to inspect.

  const arcjetReq = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });

  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const decision = await aj.protect(arcjetReq, {
    requested: 1,
    userId: clerkId,
    detectPromptInjectionMessage: lastUserMessage,
  });

  if (decision.isDenied()) {
    return Response.json(
      { message: decision.reason?.type ?? "Request blocked" },
      { status: 429 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: userId, clerkId },
    select: { id: true, credits: true },
  });

  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
  // Lifetime Pro Plan: Bypass credit checks
  // if (user.credits < CREDIT_COST_PER_GENERATION) {
  //   return Response.json({ message: "Insufficient credits" }, { status: 402 });
  // }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };

      const totalTimeoutMs =
        Number(normalizeEnvValue(process.env.AI_MAX_SECONDS) ?? "180") * 1000;
      const idleTimeoutMs =
        Number(normalizeEnvValue(process.env.AI_MAX_IDLE_SECONDS) ?? "25") * 1000;
      const startedAt = Date.now();

      const heartbeat = setInterval(() => {
        enqueue(sseEvent("status", { message: "Generating…" }));
      }, 15000);

      try {
        const aiMessages = buildMessages(messages, fileData);
        const openai = getOpenAIClient();

        const models = getModelCandidates();
        let openAiStream: AsyncIterable<unknown> | null = null;
        let streamAbort: AbortController | null = null;
        let lastError: unknown;
        let usedModel: string | null = null;

        for (const model of models) {
          enqueue(sseEvent("status", { message: `Using ${model}…` }));

          const modes = [true, false] as const;
          for (const useResponseFormat of modes) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                streamAbort?.abort();
                streamAbort = new AbortController();

                openAiStream = await openai.chat.completions.create(
                  {
                    model,
                    messages: [
                      { role: "system", content: SYSTEM_PROMPT },
                      // @ts-ignore
                      ...aiMessages,
                    ],
                    temperature: 0.7,
                    ...(useResponseFormat
                      ? { response_format: { type: "json_object" as const } }
                      : {}),
                    stream: true,
                  },
                  {
                    signal: streamAbort.signal,
                    timeout: totalTimeoutMs,
                  }
                );
                usedModel = model;
                break;
              } catch (err) {
                lastError = err;
                const e = err as { status?: number; message?: string };
                const status = e?.status;
                if (isSwitchModelStatus(status)) break;
                if (!isRetryableStatus(status)) break;
                const waitMs = 800 * Math.pow(2, attempt);
                enqueue(
                  sseEvent("status", {
                    message: `Rate limited, retrying in ${Math.round(waitMs / 1000)}s…`,
                  })
                );
                await delay(waitMs);
              }
            }

            if (openAiStream) break;
          }

          if (openAiStream) break;
          enqueue(sseEvent("status", { message: `Switching model…` }));
        }

        if (!openAiStream) {
          throw lastError ?? new Error("Unable to start AI generation.");
        }

        let accumulated = ""; // final JSON output
        let lastEmitTime = 0; // throttle thought emissions

        const iter = (openAiStream as any)[Symbol.asyncIterator]();
        while (true) {
          if (Date.now() - startedAt > totalTimeoutMs) {
            streamAbort?.abort();
            throw new Error("AI generation timed out.");
          }

          const next = iter.next();
          const res = await Promise.race([
            next,
            delay(idleTimeoutMs).then(() => ({ timeout: true as const })),
          ]);

          if ("timeout" in res) {
            streamAbort?.abort();
            throw new Error("AI stream stalled (no tokens received).");
          }

          if (res.done) break;

          const delta = res.value?.choices?.[0]?.delta;
          if (!delta) continue;

          // Some OpenRouter models send reasoning in 'reasoning_content'
          // @ts-ignore
          const reasoning = delta.reasoning_content;
          if (reasoning) {
            const now = Date.now();
            if (now - lastEmitTime > 600) {
              const label = extractThoughtLabel(reasoning);
              if (label) {
                enqueue(sseEvent("status", { message: label }));
                lastEmitTime = now;
              }
            }
          }

          if (delta.content) {
             // For models that embed reasoning inside <think> tags in the regular content
             // we could try to extract it, but for simplicity we'll just pass content along
             accumulated += delta.content;
          }
        }

        // ── Parse the complete JSON response ──────────────────────────────────

        let parsed: {
          assistantMessage: string;
          title?: string;
          files: Record<string, { code: string }>;
          dependencies: Record<string, string>;
        };

        try {
          parsed = JSON.parse(accumulated);
        } catch {
          const start = accumulated.indexOf("{");
          const end = accumulated.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            try {
              parsed = JSON.parse(accumulated.slice(start, end + 1));
            } catch {
              enqueue(
                sseEvent("error", {
                  message: "AI returned invalid JSON. Please try again.",
                })
              );
              return;
            }
          } else {
            enqueue(
              sseEvent("error", {
                message: "AI returned invalid JSON. Please try again.",
              })
            );
            return;
          }
        }

        const {
          assistantMessage,
          title: aiTitle,
          files,
          dependencies,
        } = parsed;

        if (!files || typeof files !== "object") {
          enqueue(
            sseEvent("error", {
              message: "AI response missing files. Please try again.",
            })
          );
          return;
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(dependencies ?? {});
        const newFileData: FileData = {
          files,
          dependencies: validatedDeps,
          title: aiTitle,
        };

        // ── Upsert workspace + deduct credit (single transaction) ──────────────

        enqueue(sseEvent("status", { message: "Saving…" }));

        const lastUserMessage = messages[messages.length - 1];
        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: assistantMessage },
        ];

        const [workspace] = await db.$transaction([
          workspaceId
            ? db.workspace.update({
                where: { id: workspaceId, userId },
                data: {
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              })
            : db.workspace.create({
                data: {
                  userId,
                  title: aiTitle ?? lastUserMessage.content.slice(0, 80),
                  messages: updatedMessages as never,
                  fileData: newFileData as never,
                },
              }),
          db.user.update({
            where: { id: userId },
            data: { credits: { decrement: CREDIT_COST_PER_GENERATION } },
          }),
        ]);

        const updatedUser = await db.user.findUnique({
          where: { id: userId },
          select: { credits: true },
        });

        // ── Emit final result ──────────────────────────────────────────────────

        enqueue(
          sseEvent("done", {
            workspaceId: workspace.id,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          })
        );
      } catch (err) {
        const e = err as { status?: number; message?: string };
        // @ts-ignore
        const providerRaw = normalizeEnvValue(e?.error?.metadata?.raw);
        console.error("[gen-ai-code] stream error", {
          status: e?.status,
          message: e?.message ?? "Unknown error",
        });
        const status = e?.status;
        enqueue(
          sseEvent("error", {
            message:
              status === 429
                ? "The AI provider is rate-limiting requests right now. Please retry, or set AI_MODEL to another OpenRouter model (or set AI_MODEL_FALLBACKS)."
                : status === 404 || status === 402 || status === 403
                ? providerRaw ||
                  "Selected model is not available. Please change AI_MODEL or set AI_MODEL_FALLBACKS."
                : e?.message === "AI generation timed out."
                ? "AI generation timed out. Try a smaller prompt or switch to a faster model."
                : e?.message === "AI stream stalled (no tokens received)."
                ? "AI stream stalled. Please retry or switch to a different model."
                : "Something went wrong. Please try again.",
          })
        );
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 300; // for vercel - 300s on Fluid
