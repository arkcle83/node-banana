/**
 * The user's OpenAI-compatible endpoint (the LLM node's "custom" provider).
 * Lives outside the route file because a Next.js route may export only its
 * HTTP handlers and config.
 */

/**
 * The chat completions URL for a user-entered base URL. Accepts the usual
 * spellings (`http://localhost:11434/v1`, a trailing slash, or the full
 * `/chat/completions` path) and only http(s) endpoints.
 */
export function customChatCompletionsUrl(baseUrl: string | null | undefined): string {
  const raw = (baseUrl ?? "").trim();
  if (!raw) {
    throw new Error("OpenAI-compatible endpoint not configured. Set its base URL in Settings → Providers.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid base URL "${raw}". Use something like http://localhost:11434/v1.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The base URL of an OpenAI-compatible endpoint must start with http:// or https://.");
  }
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}
