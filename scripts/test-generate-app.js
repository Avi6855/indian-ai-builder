const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const OpenAIModule = require("openai");
const OpenAI = OpenAIModule.default ?? OpenAIModule;

const SYSTEM_PROMPT = `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

RULES:
1. Always respond with a valid JSON object — no markdown fences, no extra text.
2. The JSON must match this exact shape:
{
  "assistantMessage": "<brief explanation of what you built/changed>",
  "title": "<short 2-4 word title for the app, e.g. 'Todo List App'>",
  "files": {
    "/App.js": { "code": "<full file content>" }
  },
  "dependencies": {}
}
3. Use React (functional components + hooks). Do NOT use TypeScript in generated files.
4. Use Tailwind CSS for all styling. Do not use CSS modules or inline styles unless absolutely necessary.
5. The entry point must always be /App.js and must export a default component.`;

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = (process.env.OPENROUTER_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://openrouter.ai/api/v1"
  ).trim();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  const model = (process.env.AI_MODEL || "").trim();
  if (!model) throw new Error("Missing AI_MODEL");

  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  const userPrompt =
    "Build a simple todo app with add, toggle complete, and delete. Use Tailwind for styling.";

  let content = "";
  try {
    const r = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      },
      { timeout: 120000 }
    );
    content = r.choices?.[0]?.message?.content ?? "";
  } catch {
    const r = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      },
      { timeout: 120000 }
    );
    content = r.choices?.[0]?.message?.content ?? "";
  }

  const parsed = extractJson(content);
  const ok =
    parsed &&
    typeof parsed === "object" &&
    parsed.files &&
    typeof parsed.files === "object" &&
    parsed.files["/App.js"] &&
    typeof parsed.files["/App.js"].code === "string" &&
    parsed.files["/App.js"].code.includes("export default");

  console.log(
    JSON.stringify({
      model,
      ok: Boolean(ok),
      title: parsed?.title ?? null,
      fileCount: parsed?.files ? Object.keys(parsed.files).length : 0,
      appJsChars: parsed?.files?.["/App.js"]?.code?.length ?? 0,
    })
  );

  if (!ok) process.exit(2);
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      status: e?.status ?? null,
      message: e?.message ?? null,
      raw: e?.error?.metadata?.raw ?? null,
    })
  );
  process.exit(1);
});
