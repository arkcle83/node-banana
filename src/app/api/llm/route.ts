import { NextRequest, NextResponse } from "next/server";
import { fetchWithRetry, retryTransient } from "@/lib/providers/retry";
import { GoogleGenAI } from "@google/genai";
import { LLMGenerateRequest, LLMGenerateResponse } from "@/types";
import { CUSTOM_LLM_PROVIDER, resolveLLMModel } from "@/lib/llm/catalog";
import { customChatCompletionsUrl } from "@/lib/llm/customEndpoint";
import { logger } from "@/utils/logger";

export const maxDuration = 60; // 1 minute timeout

// Generate a unique request ID for tracking
function generateRequestId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function generateWithGoogle(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  // User-provided key takes precedence over env variable
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'GEMINI_API_KEY not configured', { requestId });
    throw new Error("GEMINI_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = model;

  logger.info('api.llm', 'Calling Google AI API', {
    requestId,
    model: modelId,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build multimodal content if images are provided
  let contents: string | Array<{ inlineData: { mimeType: string; data: string } } | { text: string }>;
  if (images && images.length > 0) {
    contents = [
      ...images.map((img) => {
        // Extract base64 data and mime type from data URL
        const matches = img.match(/^data:(.+?);base64,(.+)$/);
        if (matches) {
          return {
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          };
        }
        // Fallback: assume PNG if no data URL prefix
        return {
          inlineData: {
            mimeType: "image/png",
            data: img,
          },
        };
      }),
      { text: prompt },
    ];
  } else {
    contents = prompt;
  }

  const startTime = Date.now();
  const response = await retryTransient(() => ai.models.generateContent({
    model: modelId,
    contents,
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  }), { label: `Gemini ${modelId}` });
  const duration = Date.now() - startTime;

  // Use the convenient .text property that concatenates all text parts
  const text = response.text;
  if (!text) {
    logger.error('api.error', 'No text in Google AI response', { requestId });
    throw new Error("No text in Google AI response");
  }

  logger.info('api.llm', 'Google AI API response received', {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAICompatibleTarget {
  /** Shown in logs and error messages. */
  label: string;
  url: string;
  /** Null sends no Authorization header (a local server with no key). */
  apiKey: string | null;
}

async function generateWithOpenAICompatible(
  target: OpenAICompatibleTarget,
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string
): Promise<string> {
  const { label, url, apiKey } = target;

  logger.info('api.llm', `Calling ${label} API`, {
    requestId,
    model,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build content array for vision if images are provided
  let content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  if (images && images.length > 0) {
    content = [
      { type: "text", text: prompt },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: img },
      })),
    ];
  } else {
    content = prompt;
  }

  const startTime = Date.now();
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey && { "Authorization": `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = typeof error.error === "string" ? error.error : error.error?.message;
    logger.error('api.error', `${label} API request failed`, {
      requestId,
      status: response.status,
      error: message,
    });
    throw new Error(message || `${label} API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    logger.error('api.error', `No text in ${label} response`, { requestId });
    throw new Error(`No text in ${label} response`);
  }

  logger.info('api.llm', `${label} API response received`, {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

async function generateWithOpenAI(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  // User-provided key takes precedence over env variable
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'OPENAI_API_KEY not configured', { requestId });
    throw new Error("OPENAI_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  return generateWithOpenAICompatible(
    { label: "OpenAI", url: `${OPENAI_BASE_URL}/chat/completions`, apiKey },
    prompt, model, temperature, maxTokens, images, requestId
  );
}

async function generateWithCustom(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  baseUrl?: string | null,
  userApiKey?: string | null
): Promise<string> {
  // The key is optional: local servers (Ollama, LM Studio) take none.
  const url = customChatCompletionsUrl(baseUrl);
  return generateWithOpenAICompatible(
    { label: "OpenAI-compatible endpoint", url, apiKey: userApiKey || null },
    prompt, model, temperature, maxTokens, images, requestId
  );
}

async function generateWithAnthropic(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  images?: string[],
  requestId?: string,
  userApiKey?: string | null
): Promise<string> {
  const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error('api.error', 'ANTHROPIC_API_KEY not configured', { requestId });
    throw new Error("ANTHROPIC_API_KEY not configured. Add it to .env.local or configure in Settings.");
  }

  const modelId = model;

  logger.info('api.llm', 'Calling Anthropic API', {
    requestId,
    model: modelId,
    temperature,
    maxTokens,
    imageCount: images?.length || 0,
    promptLength: prompt.length,
  });

  // Build content blocks
  const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

  if (images && images.length > 0) {
    for (const img of images) {
      const matches = img.match(/^data:(.+?);base64,(.+)$/);
      if (matches) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: matches[1], data: matches[2] },
        });
      } else {
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: img },
        });
      }
    }
  }

  content.push({ type: "text", text: prompt });

  const startTime = Date.now();
  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content }],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    logger.error('api.error', 'Anthropic API request failed', {
      requestId,
      status: response.status,
      error: error.error?.message,
    });
    throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;

  if (!text) {
    logger.error('api.error', 'No text in Anthropic response', { requestId });
    throw new Error("No text in Anthropic response");
  }

  logger.info('api.llm', 'Anthropic API response received', {
    requestId,
    duration,
    responseLength: text.length,
  });

  return text;
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    // Get user-provided API keys from headers (override env variables)
    const geminiApiKey = request.headers.get("X-Gemini-API-Key");
    const openaiApiKey = request.headers.get("X-OpenAI-API-Key");
    const anthropicApiKey = request.headers.get("X-Anthropic-API-Key");
    const customBaseUrl = request.headers.get("X-Custom-LLM-Base-URL");
    const customApiKey = request.headers.get("X-Custom-LLM-API-Key");

    const body: LLMGenerateRequest = await request.json();
    const {
      prompt,
      images,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 1024
    } = body;

    logger.info('api.llm', 'LLM generation request received', {
      requestId,
      provider,
      model,
      temperature,
      maxTokens,
      hasImages: !!(images && images.length > 0),
      imageCount: images?.length || 0,
      prompt,
    });

    if (!prompt) {
      logger.warn('api.llm', 'LLM request validation failed: missing prompt', { requestId });
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (provider !== "google" && provider !== "openai" && provider !== "anthropic" && provider !== CUSTOM_LLM_PROVIDER) {
      logger.warn('api.llm', 'Unknown provider requested', { requestId, provider });
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: `Unknown provider: ${provider}` },
        { status: 400 }
      );
    }

    // Only ids the catalogue knows run; a retired id is moved to its replacement.
    const resolved = resolveLLMModel(provider, model);
    if (!resolved) {
      logger.warn('api.llm', 'Unknown model requested', { requestId, provider, model });
      return NextResponse.json<LLMGenerateResponse>(
        {
          success: false,
          error: provider === CUSTOM_LLM_PROVIDER
            ? "Model name is required for an OpenAI-compatible endpoint"
            : `Unknown model "${model}" for provider ${provider}`,
        },
        { status: 400 }
      );
    }
    if (resolved.substitution) {
      logger.warn('api.llm', 'Retired model replaced', { requestId, from: resolved.substitution.from, to: resolved.id });
    }

    let text: string;

    if (provider === "google") {
      text = await generateWithGoogle(prompt, resolved.apiId, temperature, maxTokens, images, requestId, geminiApiKey);
    } else if (provider === "openai") {
      text = await generateWithOpenAI(prompt, resolved.apiId, temperature, maxTokens, images, requestId, openaiApiKey);
    } else if (provider === CUSTOM_LLM_PROVIDER) {
      text = await generateWithCustom(prompt, resolved.apiId, temperature, maxTokens, images, requestId, customBaseUrl, customApiKey);
    } else {
      text = await generateWithAnthropic(prompt, resolved.apiId, temperature, maxTokens, images, requestId, anthropicApiKey);
    }

    logger.info('api.llm', 'LLM generation successful', {
      requestId,
      responseLength: text.length,
    });

    return NextResponse.json<LLMGenerateResponse>({
      success: true,
      text,
      model: resolved.id,
      ...(resolved.substitution && { note: resolved.substitution.note }),
    });
  } catch (error) {
    logger.error('api.error', 'LLM generation error', { requestId }, error instanceof Error ? error : undefined);

    // Handle rate limiting
    if (error instanceof Error && error.message.includes("429")) {
      return NextResponse.json<LLMGenerateResponse>(
        { success: false, error: "Rate limit reached. Please wait and try again." },
        { status: 429 }
      );
    }

    return NextResponse.json<LLMGenerateResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "LLM generation failed",
      },
      { status: 500 }
    );
  }
}
