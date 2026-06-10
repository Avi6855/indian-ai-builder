const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const OpenAIModule = require("openai");
const OpenAI = OpenAIModule.default ?? OpenAIModule;

async function main() {
  const baseUrl = (process.env.OPENROUTER_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://openrouter.ai/api/v1"
  ).trim();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in .env.local");
  }

  const model = (process.env.AI_MODEL || "").trim();
  if (!model) {
    throw new Error("Missing AI_MODEL in .env.local");
  }

  const modelsRes = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!modelsRes.ok) {
    const text = await modelsRes.text().catch(() => "");
    throw new Error(`Key check failed: HTTP ${modelsRes.status} ${text}`);
  }

  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Return ONLY valid JSON: {\"ok\":true}" }],
      temperature: 0,
      max_tokens: 50,
    });
    const choice = r.choices?.[0];
    const msg = choice?.message;
    const out = msg?.content ?? "";
    const toolCalls = msg?.tool_calls ?? null;
    const reasoning = msg?.reasoning ?? msg?.reasoning_content ?? null;
    const refusal = msg?.refusal ?? null;
    console.log(
      JSON.stringify({
        key: "ok",
        model,
        finish_reason: choice?.finish_reason ?? null,
        role: msg?.role ?? null,
        message_keys: msg ? Object.keys(msg) : null,
        has_tool_calls: Array.isArray(toolCalls) && toolCalls.length > 0,
        has_reasoning: typeof reasoning === "string" && reasoning.length > 0,
        has_refusal: typeof refusal === "string" && refusal.length > 0,
        has_content: typeof out === "string" && out.length > 0,
        content_preview: out.slice(0, 200),
      })
    );
  } catch (err) {
    const e = err || {};
    const status = e.status ?? e.code ?? null;
    const message = e.message ?? "Unknown error";
    const raw = e.error?.metadata?.raw ?? null;
    console.log(JSON.stringify({ key: "ok", model, status, message, raw }));
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
