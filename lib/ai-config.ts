export const NARA_BASE_URL = "https://router.bynara.id/v1";
export const NARA_API_KEY =
  "sk-nry--IMCiBlJzABleGnYGyobWctdjJMCmW7sEBQ5EUXlvSA";
export const NARA_MODELS = [
  "laguna-s-2.1",
  "nemotron-3.5-lightning-free",
  "agnes-2.5-flash",
];

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/^['"`]+|['"`]+$/g, "");
  return v.length > 0 ? v : undefined;
}

export function getAiBaseUrl(): string {
  return normalizeEnvValue(process.env.NARA_BASE_URL) ?? NARA_BASE_URL;
}

export function getAiApiKey(): string {
  return normalizeEnvValue(process.env.NARA_API_KEY) ?? NARA_API_KEY;
}

export function getAiModelCandidates(): string[] {
  const envModels = normalizeEnvValue(process.env.NARA_MODELS);
  const models = envModels
    ? envModels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [...NARA_MODELS];
  return [...new Set(models)];
}
