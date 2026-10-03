export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const DEFAULT_GEMMA_MODEL = "gemma3:1b";

export type OllamaRole = "system" | "user" | "assistant";

export type OllamaMessage = {
  role: OllamaRole;
  content: string;
};

export type OllamaConfig = {
  host: string;
  model: string;
};

export type OllamaErrorCode =
  | "unavailable"
  | "model_missing"
  | "empty"
  | "bad_response";

export class OllamaError extends Error {
  readonly code: OllamaErrorCode;

  constructor(code: OllamaErrorCode, message: string) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
  }
}

export function resolveOllamaConfig(
  env: Record<string, string | undefined> = process.env,
): OllamaConfig {
  const host = (env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST).replace(/\/$/, "");
  const model = env.OLLAMA_MODEL || DEFAULT_GEMMA_MODEL;
  return { host, model };
}

export function buildChatRequest(
  messages: OllamaMessage[],
  config: OllamaConfig,
): { url: string; body: Record<string, unknown> } {
  return {
    url: `${config.host}/api/chat`,
    body: {
      model: config.model,
      messages,
      stream: false,
      options: { temperature: 0.7 },
    },
  };
}

export function parseChatResponse(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    throw new OllamaError(
      "bad_response",
      "Ollama returned something that is not a chat payload.",
    );
  }

  const message = (payload as { message?: { content?: unknown } }).message;
  const content =
    typeof message?.content === "string" ? message.content.trim() : "";

  if (!content) {
    throw new OllamaError(
      "empty",
      "Gemma returned an empty reply. Nothing was invented in its place.",
    );
  }

  return content;
}

export function classifyOllamaFailure(
  status: number,
  bodyText: string,
  model: string,
): OllamaError {
  const lower = bodyText.toLowerCase();
  if (
    status === 404 ||
    lower.includes("not found") ||
    lower.includes("try pulling")
  ) {
    return new OllamaError(
      "model_missing",
      `Ollama is running, but ${model} is not installed. Pull it with: ollama pull ${model}`,
    );
  }

  return new OllamaError(
    "unavailable",
    `Ollama rejected the request (${status}). ${bodyText.slice(0, 200)}`,
  );
}

export function modelIsInstalled(wanted: string, names: string[]): boolean {
  const [wantedModel, wantedTag] = wanted.split(":");

  return names.some((name) => {
    if (name === wanted || name.startsWith(`${wanted}-`)) {
      return true;
    }

    const [nameModel, nameTag] = name.split(":");
    if (nameModel !== wantedModel) {
      return false;
    }
    if (!wantedTag) {
      return true;
    }
    return nameTag === wantedTag || Boolean(nameTag?.startsWith(`${wantedTag}-`));
  });
}

type FetchLike = typeof fetch;

export async function chatWithGemma(
  messages: OllamaMessage[],
  config: OllamaConfig = resolveOllamaConfig(),
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const { url, body } = buildChatRequest(messages, config);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OllamaError(
      "unavailable",
      `Could not reach Ollama at ${config.host}. Start it locally, then run: ollama pull ${config.model}. This app will not invent a practice transcript.`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw classifyOllamaFailure(response.status, text, config.model);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new OllamaError("bad_response", "Ollama returned a non-JSON body.");
  }

  return parseChatResponse(payload);
}

export type OllamaProbe = {
  ok: boolean;
  host: string;
  model: string;
  installedModels: string[];
  error?: string;
};

export async function probeOllama(
  config: OllamaConfig = resolveOllamaConfig(),
  fetchFn: FetchLike = fetch,
): Promise<OllamaProbe> {
  try {
    const response = await fetchFn(`${config.host}/api/tags`, { method: "GET" });
    if (!response.ok) {
      return {
        ok: false,
        host: config.host,
        model: config.model,
        installedModels: [],
        error: `Ollama answered with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    const installedModels = Array.isArray(payload.models)
      ? payload.models
          .map((item) => item.name)
          .filter((name): name is string => typeof name === "string")
      : [];

    const installed = modelIsInstalled(config.model, installedModels);
    return {
      ok: installed,
      host: config.host,
      model: config.model,
      installedModels,
      error: installed
        ? undefined
        : `${config.model} is not on this machine. Run: ollama pull ${config.model}`,
    };
  } catch {
    return {
      ok: false,
      host: config.host,
      model: config.model,
      installedModels: [],
      error: `Ollama is not reachable at ${config.host}.`,
    };
  }
}
