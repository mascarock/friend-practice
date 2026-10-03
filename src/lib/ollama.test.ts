import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMMA_MODEL,
  DEFAULT_OLLAMA_HOST,
  OllamaError,
  buildChatRequest,
  chatWithGemma,
  classifyOllamaFailure,
  modelIsInstalled,
  parseChatResponse,
  probeOllama,
  resolveOllamaConfig,
} from "@/lib/ollama";

describe("ollama request helpers", () => {
  it("reads host and model from the environment", () => {
    expect(resolveOllamaConfig({})).toEqual({
      host: DEFAULT_OLLAMA_HOST,
      model: DEFAULT_GEMMA_MODEL,
    });
    expect(
      resolveOllamaConfig({
        OLLAMA_HOST: "http://localhost:11434/",
        OLLAMA_MODEL: "gemma3:1b",
      }),
    ).toEqual({
      host: "http://localhost:11434",
      model: "gemma3:1b",
    });
  });

  it("builds a non-streaming Gemma chat request", () => {
    const request = buildChatRequest(
      [{ role: "user", content: "hello" }],
      { host: "http://127.0.0.1:11434", model: "gemma3:1b" },
    );

    expect(request.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(request.body).toMatchObject({
      model: "gemma3:1b",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("parses a Gemma chat payload and refuses empty content", () => {
    expect(
      parseChatResponse({ message: { role: "assistant", content: "  hi  " } }),
    ).toBe("hi");
    expect(() => parseChatResponse({ message: { content: "   " } })).toThrow(
      OllamaError,
    );
    expect(() => parseChatResponse(null)).toThrow(/not a chat payload/);
  });

  it("classifies a missing-model response", () => {
    const error = classifyOllamaFailure(
      404,
      'model "gemma3:1b" not found, try pulling it first',
      "gemma3:1b",
    );
    expect(error.code).toBe("model_missing");
    expect(error.message).toContain("ollama pull gemma3:1b");
  });

  it("matches installed Ollama tags for the requested Gemma build", () => {
    expect(modelIsInstalled("gemma3:1b", ["gemma3:1b"])).toBe(true);
    expect(modelIsInstalled("gemma3:1b", ["gemma3:1b-instruct"])).toBe(true);
    expect(modelIsInstalled("gemma3:1b", ["llama3.2:1b"])).toBe(false);
  });
});

describe("ollama network wrappers", () => {
  it("calls /api/chat and returns the model text", async function () {
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:11434/api/chat");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemma3:1b");
      expect(body.stream).toBe(false);
      return new Response(
        JSON.stringify({ message: { content: "Try a 30-second update." } }),
        { status: 200 },
      );
    };

    await expect(
      chatWithGemma(
        [{ role: "user", content: "start" }],
        { host: "http://127.0.0.1:11434", model: "gemma3:1b" },
        fetchFn as typeof fetch,
      ),
    ).resolves.toBe("Try a 30-second update.");
  });

  it("does not invent a transcript when Ollama is unreachable", async function () {
    const fetchFn = async () => {
      throw new Error("connect ECONNREFUSED");
    };

    await expect(
      chatWithGemma(
        [{ role: "user", content: "start" }],
        { host: "http://127.0.0.1:11434", model: "gemma3:1b" },
        fetchFn as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("will not invent"),
    });
  });

  it("probes /api/tags without claiming the model is present", async function () {
    const fetchFn = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({ models: [{ name: "llama3.2:1b" }] }), {
        status: 200,
      });
    };

    const probe = await probeOllama(
      { host: "http://127.0.0.1:11434", model: "gemma3:1b" },
      fetchFn as typeof fetch,
    );
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("ollama pull gemma3:1b");
  });
});
