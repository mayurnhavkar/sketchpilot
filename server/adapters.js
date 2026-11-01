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

// ---- OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM, ...) ----
async function openaiCompat({ provider, key, model, system, user, signal }) {
  const body = {
    model,
    temperature: 0.2,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
  };
  const headers = { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const url = `${trimUrl(provider.baseUrl)}/chat/completions`;
  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: withTimeout(signal) });
  if (res.status === 400) {
    // some servers reject response_format; the prompt already demands bare JSON
    delete body.response_format;
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: withTimeout(signal) });
  }
  if (!res.ok) throw await failFrom(res);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

// ---- Anthropic Messages API ----
async function anthropic({ provider, key, model, system, user, signal }) {
  const res = await fetch(`${trimUrl(provider.baseUrl)}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
    signal: withTimeout(signal),
  });
  if (!res.ok) throw await failFrom(res);
  const j = await res.json();
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---- CLI: run a configured command, prompt on stdin (or via {{user}}) ----
function cli({ provider, model, effort, system, user, signal }) {
  const sub = (s) => s.replaceAll("{{system}}", system).replaceAll("{{user}}", user);
  const args = (provider.args || []).map(sub);
  const useStdin = !(provider.args || []).some((a) => a.includes("{{user}}"));
  if (model && provider.modelFlag) args.push(provider.modelFlag, model);
  if (effort && provider.effortFlag) args.push(provider.effortFlag, effort);
  return new Promise((resolve, reject) => {
    // cwd outside the project so no project settings or memory leak into the call
    const child = spawn(provider.command, args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"], signal: withTimeout(signal) });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(e.name === "AbortError" ? "cancelled or timed out" : `could not run ${provider.command}: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error((err || out || `exit ${code}`).trim().slice(0, 400)))));
    child.stdin.on("error", () => {});
    child.stdin.end(useStdin ? user : "");
  });
}

const ADAPTERS = { "openai-compat": openaiCompat, anthropic, cli };

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
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}
