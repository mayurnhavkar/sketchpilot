import { spawn } from "node:child_process";
import os from "node:os";

const TIMEOUT_MS = 180_000;

const withTimeout = (signal) => AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean));
const trimUrl = (u) => u.replace(/\/+$/, "");

async function failFrom(res) {
  const t = await res.text().catch(() => "");
  let msg = t;
  try {
    const j = JSON.parse(t);
    msg = j.error?.message || j.error || j.message || t;
  } catch {}
  return new Error(`${res.status} ${String(msg).slice(0, 300)}`);
}

async function* sseLines(res) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}

// ---- OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM, ...) ----
async function openaiCompat({ provider, key, model, system, user, images = [], signal, onChunk }) {
  const userContent = images.length
    ? [{ type: "text", text: user }, ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
    : user;
  const body = {
    model,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
    response_format: { type: "json_object" },
  };
  const headers = { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const url = `${trimUrl(provider.baseUrl)}/chat/completions`;
  const post = (b) => fetch(url, { method: "POST", headers, body: JSON.stringify(b), signal: withTimeout(signal) });
  let res = await post(body);
  if (res.status === 400) {
    // some servers reject these options; the prompt already demands bare JSON
    delete body.response_format;
    delete body.stream_options;
    res = await post(body);
  }
  if (!res.ok) throw await failFrom(res);

  let text = "", usage;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const d = line.slice(5).trim();
    if (d === "[DONE]") break;
    let j;
    try { j = JSON.parse(d); } catch { continue; }
    if (j.error) throw new Error(String(j.error.message || j.error).slice(0, 300));
    const c = j.choices?.[0]?.delta?.content;
    if (c) {
      text += c;
      onChunk?.(text.length);
    }
    if (j.usage) usage = { in: j.usage.prompt_tokens, out: j.usage.completion_tokens };
  }
  return { text, usage };
}

// ---- Anthropic Messages API ----
async function anthropic({ provider, key, model, system, user, images = [], signal, onChunk }) {
  const content = [
    ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })),
    { type: "text", text: user },
  ];
  const res = await fetch(`${trimUrl(provider.baseUrl)}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8000, system, stream: true, messages: [{ role: "user", content }] }),
    signal: withTimeout(signal),
  });
  if (!res.ok) throw await failFrom(res);

  let text = "";
  const usage = {};
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    let j;
    try { j = JSON.parse(line.slice(5)); } catch { continue; }
    if (j.type === "error") throw new Error(String(j.error?.message || "stream error").slice(0, 300));
    if (j.type === "message_start") usage.in = j.message?.usage?.input_tokens;
    if (j.type === "message_delta") usage.out = j.usage?.output_tokens;
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
      text += j.delta.text;
      onChunk?.(text.length);
    }
  }
  return { text, usage: usage.in || usage.out ? usage : undefined };
}

// ---- CLI: run a configured command, prompt on stdin (or via {{user}}) ----
function cli({ provider, model, effort, system, user, images = [], signal, onChunk }) {
  if (images.length) return Promise.reject(new Error(`${provider.name} can't read images; pick an API provider with a vision model`));
  const sub = (s) => s.replaceAll("{{system}}", system).replaceAll("{{user}}", user);
  const args = (provider.args || []).map(sub);
  const useStdin = !(provider.args || []).some((a) => a.includes("{{user}}"));
  if (model && provider.modelFlag) args.push(provider.modelFlag, model);
  if (effort && provider.effortFlag) args.push(provider.effortFlag, effort);
  return new Promise((resolve, reject) => {
    // cwd outside the project so no project settings or memory leak into the call
    const child = spawn(provider.command, args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"], signal: withTimeout(signal) });
    let out = "", err = "";
    child.stdout.on("data", (d) => {
      out += d;
      onChunk?.(out.length);
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(e.name === "AbortError" ? "cancelled or timed out" : `could not run ${provider.command}: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve({ text: out }) : reject(new Error((err || out || `exit ${code}`).trim().slice(0, 400)))));
    child.stdin.on("error", () => {});
    child.stdin.end(useStdin ? user : "");
  });
}

const ADAPTERS = { "openai-compat": openaiCompat, anthropic, cli };

// -> { text, usage? }
export function generate(args) {
  const fn = ADAPTERS[args.provider.type];
  if (!fn) throw new Error(`unknown provider type "${args.provider.type}"`);
  return fn(args);
}

export async function listModels({ provider, key, signal }) {
  if (provider.type === "cli") return provider.models || [];
  const headers =
    provider.type === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : key ? { Authorization: `Bearer ${key}` } : {};
  const url = provider.type === "anthropic" ? `${trimUrl(provider.baseUrl)}/v1/models` : `${trimUrl(provider.baseUrl)}/models`;
  const res = await fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)].filter(Boolean)) });
  if (!res.ok) throw await failFrom(res);
  const j = await res.json();
  // Ollama can list a model twice and also exposes its internal runner ids ("llamacpp:<hash>"): neither is selectable
  const ids = (j.data || j.models || []).map((m) => m.id || m.name).filter((id) => id && !/^llamacpp:[0-9a-f]{16,}$/i.test(id));
  return [...new Set(ids)].sort();
}
