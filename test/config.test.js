import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-cfg-"));
process.env.EXCALIDRAW_CLAUDE_CONFIG = path.join(dir, "providers.json");
const cfg = await import("../server/config.js");

test("code defaults load when there is no user file", () => {
  const ids = cfg.resolveProviders().map((p) => p.id);
  assert.deepEqual(ids.slice(0, 4), ["claude-cli", "anthropic", "openai", "ollama"]);
});

test("user file overlays defaults and adds custom providers; file is owner-only", () => {
  cfg.writeUserConfig({ providers: { ollama: { defaultModel: "llama3" }, groq: { type: "openai-compat", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "SECRET" } } });
  assert.equal(fs.statSync(process.env.EXCALIDRAW_CLAUDE_CONFIG).mode & 0o777, 0o600);
  assert.equal(cfg.getProvider("ollama").defaultModel, "llama3");
  assert.equal(cfg.getProvider("ollama").baseUrl, "http://localhost:11434/v1");
  assert.equal(cfg.getProvider("groq").builtin, false);
});

test("the browser-facing view never contains the key", () => {
  const pub = cfg.publicProvider(cfg.getProvider("groq"), {});
  assert.ok(!JSON.stringify(pub).includes("SECRET"));
  assert.equal(pub.keySource, "ui");
  assert.equal(pub.needsKey, true);
  assert.equal(pub.local, false);
});

test("env keys are used when no UI key is saved, and reported as such", () => {
  const p = cfg.getProvider("anthropic");
  assert.equal(cfg.apiKeyFor(p, { ANTHROPIC_API_KEY: "from-env" }), "from-env");
  assert.equal(cfg.publicProvider(p, { ANTHROPIC_API_KEY: "from-env" }).keySource, "env");
  assert.equal(cfg.publicProvider(p, {}).keySource, null);
  assert.equal(cfg.apiKeyFor(cfg.getProvider("groq"), { }), "SECRET"); // UI key wins / is used
});

test("local and vision flags", () => {
  assert.equal(cfg.publicProvider(cfg.getProvider("ollama"), {}).local, true);
  assert.equal(cfg.publicProvider(cfg.getProvider("claude-cli"), {}).local, false);
  assert.equal(cfg.publicProvider(cfg.getProvider("anthropic"), {}).vision, true);
  assert.equal(cfg.publicProvider(cfg.getProvider("ollama"), {}).vision, false);
});

test("CLI providers expose effort capability only when configured", () => {
  assert.equal(cfg.publicProvider(cfg.getProvider("claude-cli"), {}).capabilities.effort, true);
  assert.equal(cfg.publicProvider(cfg.getProvider("openai"), {}).capabilities.effort, false);
});
