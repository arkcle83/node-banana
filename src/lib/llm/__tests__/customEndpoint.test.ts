import { describe, it, expect } from "vitest";
import { customChatCompletionsUrl } from "../customEndpoint";

describe("customChatCompletionsUrl", () => {
  it("appends /chat/completions to the base URL", () => {
    expect(customChatCompletionsUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1/chat/completions");
    expect(customChatCompletionsUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(customChatCompletionsUrl("  http://localhost:1234  ")).toBe("http://localhost:1234/chat/completions");
  });

  it("accepts a full chat completions URL", () => {
    expect(customChatCompletionsUrl("http://localhost:8000/v1/chat/completions")).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("rejects empty, malformed and non-http URLs", () => {
    expect(() => customChatCompletionsUrl("")).toThrow("not configured");
    expect(() => customChatCompletionsUrl(null)).toThrow("not configured");
    expect(() => customChatCompletionsUrl("not a url")).toThrow("Invalid base URL");
    expect(() => customChatCompletionsUrl("ftp://host/v1")).toThrow("http:// or https://");
  });
});
