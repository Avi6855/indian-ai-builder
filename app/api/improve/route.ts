import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import type { FileData } from "@/types/workspace";

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

function isRetryableAgentError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (isRetryableStatus(e?.status)) return true;
  const msg = (e?.message ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("rate-limit");
}

function isSwitchModelAgentError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (isSwitchModelStatus(e?.status)) return true;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    msg.includes("unavailable for free") ||
    msg.includes("not available") ||
    msg.includes("not found")
  );
}

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { message: "Missing OPENROUTER_API_KEY in environment." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { userId, workspaceId, userRequest, fileData } = body as {
    userId: string;
    workspaceId: string;
    userRequest: string; // what the user wants improved
    fileData: FileData;
  };

  // ── Auth + credit check ────────────────────────────────────────────────────

  const user = await db.user.findUnique({
    where: { id: userId, clerkId },
    select: { id: true, credits: true, plan: true },
  });

  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  // Lifetime Pro Plan: Bypass plan and credit checks
  // if (user.plan !== "pro")
  //   return Response.json({ message: "Upgrade required" }, { status: 403 });

  // if (user.credits < CREDIT_COST_PER_GENERATION)
  //   return Response.json({ message: "Insufficient credits" }, { status: 402 });

  // ── Build the agent ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      // Accumulate file patches as the agent calls update_file
      const baseFiles: Record<string, { code: string }> = { ...fileData.files };
      let patchedFiles: Record<string, { code: string }> = { ...baseFiles };
      let finalSummary = "";

      // ── Tool 1: update_file ──────────────────────────────────────────────
      // The agent calls this once per file it wants to change.
      // We immediately emit a file_patch SSE event so Sandpack
      // updates live in the browser as each file is patched.

      const updateFileTool = createTool({
        name: "update_file",
        description:
          "Update or rewrite a file in the React sandbox. Call once per file you need to change.",
        inputSchema: z.object({
          path: z
            .string()
            .describe("File path exactly as it appears, e.g. /App.js"),
          code: z.string().describe("Complete new contents of the file"),
          reason: z
            .string()
            .describe("One sentence explaining what you changed and why"),
        }),
        async execute({ path, code, reason }) {
          patchedFiles[path] = { code };
          // Emit live patch — client applies it to Sandpack immediately
          enqueue(sseEvent("file_patch", { path, code, reason }));
          return `Updated ${path}: ${reason}`;
        },
      });

      // ── Tool 2: done_improving ───────────────────────────────────────────
      // Agent calls this when all files are updated.
      // lifecycle.completesRun: true tells the Cline SDK loop to stop
      // immediately after this tool runs instead of continuing iterations.

      const doneImprovingTool = createTool({
        name: "done_improving",
        description:
          "Call this when you have finished making all improvements.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe(
              "A short friendly summary of all the improvements you made (1-3 sentences)"
            ),
        }),
        lifecycle: { completesRun: true },
        async execute({ summary }) {
          finalSummary = summary;
          return "Done.";
        },
      });

      // ── Serialize current files for context ──────────────────────────────
      // We give the agent all current files as context in the system prompt
      // so it knows exactly what it's working with.

      const fileContext = Object.entries(fileData.files)
        .map(([path, { code }]) => `// ${path}\n${code}`)
        .join("\n\n---\n\n");

      const baseUrl =
        normalizeEnvValue(process.env.OPENROUTER_BASE_URL) ||
        normalizeEnvValue(process.env.OPENAI_BASE_URL) ||
        DEFAULT_OPENROUTER_BASE_URL;
      const models = getModelCandidates();
      let runError: unknown;
      let result: Awaited<ReturnType<Agent["run"]>> | null = null;

      for (const modelId of models) {
        enqueue(sseEvent("status", { message: `Using ${modelId}…` }));
        result = null;
        patchedFiles = { ...baseFiles };
        finalSummary = "";

        const agent = new Agent({
          providerId: "openai",
          modelId,
          apiKey: process.env.OPENROUTER_API_KEY!,
          baseUrl,
          maxIterations: 8,
          systemPrompt: `You are an expert React developer improving a live browser preview app.

The app uses React (functional components), Tailwind CSS for styling, and runs in Sandpack.
You CANNOT use TypeScript, CSS modules, or real npm install — only what's already available.
Available packages: react, react-dom, tailwindcss (CDN), lucide-react, recharts, react-router-dom, framer-motion, date-fns, zod, react-hook-form.

Here are the current files:

${fileContext}

WORKFLOW:
1. Understand what the user wants improved.
2. Identify which files need to change.
3. Call update_file for each file that needs changes (always include the COMPLETE file, not just the diff).
4. Once all files are updated, call done_improving with a short summary.

RULES:
- Always write complete file contents — never partial snippets.
- Keep all existing functionality unless asked to remove it.
- The entry point is always /App.js with a default export.
- All imports must reference files you've updated or packages in the available list above.`,
          tools: [updateFileTool, doneImprovingTool],
          toolPolicies: {
            update_file: { autoApprove: true },
            done_improving: { autoApprove: true },
          },
        });

      try {
        // ── Stream agent reasoning to chat panel ─────────────────────────
        // assistant-text-delta fires as the agent types its reasoning.
        // We emit these as "thinking" events — shown in the chat panel
        // as a live streaming message so users see the agent working.

        agent.subscribe((event) => {
          if (event.type === "assistant-text-delta" && event.text) {
            enqueue(sseEvent("thinking", { text: event.text }));
          }

          // This fires reliably every time a tool is called
          if (event.type === "tool-started") {
            const name = event.toolCall?.toolName;
            if (name === "update_file") {
              const path =
                (event.toolCall?.input as { path?: string })?.path ?? "a file";
              enqueue(
                sseEvent("thinking", { text: `\n\nUpdating \`${path}\`…` })
              );
            } else if (name === "done_improving") {
              enqueue(
                sseEvent("thinking", { text: "\n\nFinalizing improvements…" })
              );
            }
          }
        });

        // ── Run the agent ─────────────────────────────────────────────────
        enqueue(sseEvent("status", { message: "Cline agent starting…" }));

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await agent.run(userRequest);
            if (result.status === "failed") {
              throw new Error(result.error?.message ?? "Agent run failed");
            }
            break;
          } catch (err) {
            runError = err;
            if (!isRetryableAgentError(err) || attempt === 1) throw err;
            const waitMs = 1200 * Math.pow(2, attempt);
            enqueue(
              sseEvent("status", {
                message: `Rate limited, retrying in ${Math.round(waitMs / 1000)}s…`,
              })
            );
            await delay(waitMs);
          }
        }

        if (!result || result.status === "failed") {
          throw runError ?? new Error("Agent run failed");
        }

        // ── Deduct credit + save to DB ────────────────────────────────────

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: fileData.dependencies,
          title: fileData.title,
        };

        await db.$transaction([
          db.workspace.update({
            where: { id: workspaceId, userId },
            data: { fileData: newFileData as never },
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

        // ── Final done event ──────────────────────────────────────────────

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || result.outputText,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          })
        );
        controller.close();
        return;
      } catch (err) {
        runError = err;
        const e = err as { status?: number; message?: string };
        console.error("[improve] error", {
          status: e?.status,
          message: e?.message ?? "Unknown error",
        });
        if (isSwitchModelAgentError(err) || isRetryableAgentError(err)) {
          enqueue(sseEvent("status", { message: "Switching model…" }));
          continue;
        }
        enqueue(
          sseEvent("error", {
            message:
              err instanceof Error ? err.message : "Something went wrong.",
          })
        );
        controller.close();
        return;
      }
      }

      enqueue(
        sseEvent("error", {
          message:
            "AI provider is rate-limiting requests. Please retry, or set AI_MODEL / AI_MODEL_FALLBACKS to a different OpenRouter model.",
        })
      );
      controller.close();
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
