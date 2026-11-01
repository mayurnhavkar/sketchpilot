import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import defaults from "../providers.config.js";

export const CONFIG_PATH =
  process.env.EXCALIDRAW_CLAUDE_CONFIG ||
  path.join(os.homedir(), ".config", "excalidraw-claude", "providers.json");

export const ID_RE = /^[a-z0-9-]{1,40}$/;

export function readUserConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { providers: c.providers || {} };
  } catch {
    return { providers: {} };
  }
}

export function writeUserConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
}

export const isBuiltin = (id) => defaults.providers.some((p) => p.id === id);

// code defaults overlaid with the user file; user-only entries are custom providers
export function resolveProviders() {
  const user = readUserConfig().providers;
  const out = defaults.providers.map((p) => ({ ...p, ...(user[p.id] || {}), id: p.id, builtin: true }));
  for (const [id, p] of Object.entries(user)) {
    if (!isBuiltin(id)) out.push({ ...p, id, builtin: false });
  }
  return out;
}

export function getProvider(id) {
  return resolveProviders().find((p) => p.id === id);
}

export function apiKeyFor(p, env) {
  return p.apiKey || (p.apiKeyEnv && env[p.apiKeyEnv]) || "";
}

// what the browser is allowed to see: never the key itself
export function publicProvider(p, env) {
  const ui = !!p.apiKey;
  const fromEnv = !ui && !!(p.apiKeyEnv && env[p.apiKeyEnv]);
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    builtin: p.builtin,
    baseUrl: p.baseUrl || "",
    defaultModel: p.defaultModel || "",
    models: p.models || [],
    needsKey: p.type === "anthropic" || (p.type === "openai-compat" && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(p.baseUrl || "")),
    keySource: ui ? "ui" : fromEnv ? "env" : null,
    capabilities: { effort: !!p.effortFlag, efforts: p.efforts || [] },
  };
}

export const presets = defaults.presets;
