import crypto from "node:crypto";
import { loadEnv } from "vite";
import { SYSTEM_PROMPT, parseModelJson, sanitize } from "./prompt.js";
import { generate, listModels } from "./adapters.js";
import {
  ID_RE, apiKeyFor, getProvider, isBuiltin, presets, publicProvider,
  readUserConfig, resolveProviders, writeUserConfig,
} from "./config.js";

const MAX_BODY = 2_000_000;
const MAX_ATTEMPTS = 2;

const send = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0, s = "";
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) return reject(new Error("body too large"));
      s += c;
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

// Any website can fire requests at localhost. Require a local Host, a same-origin Origin,
// and a per-process token that only our own page (served with it embedded) knows.
function guard(req, token) {
  const host = req.headers.host || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return "bad host";
  const origin = req.headers.origin;
  if (origin) {
    let o;
    try { o = new URL(origin); } catch { return "bad origin"; }
    if (o.host !== host) return "bad origin";
  }
  const sent = Buffer.from(String(req.headers["x-ec-token"] || ""));
  const want = Buffer.from(token);
  if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) return "bad token";
  return null;
}

function validBaseUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

export default function claudeBridge() {
  const token = crypto.randomBytes(24).toString("hex");
  let env = process.env;

  async function draw(req, res) {
    const p = await readBody(req);
    const provider = getProvider(p.providerId);
    if (!provider) return send(res, 400, { error: "unknown provider" });
    const model = String(p.model || provider.defaultModel || "");
    if (!model && provider.type !== "cli") return send(res, 400, { error: "pick a model for this provider" });
    const effort = provider.efforts?.includes(p.effort) ? p.effort : "";
    const key = apiKeyFor(provider, env);

    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });

    let user =
      `Request: ${p.prompt}\n\n` +
      (p.context ? `Existing canvas (context only):\n${p.context}\n` : "Canvas is empty.\n");
    const t0 = Date.now();
    let lastErr = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let text;
      try {
        text = await generate({ provider, key, model, effort, system: SYSTEM_PROMPT, user, signal: ac.signal });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
      try {
        const elements = sanitize(parseModelJson(text));
        return send(res, 200, { elements, meta: { provider: provider.id, model: model || "(default)", ms: Date.now() - t0, attempts: attempt } });
      } catch (e) {
        lastErr = e.message;
        // feed the problem back once; weak models often fix it
        user += `\n\nYour previous reply was unusable (${e.message}). Reply again with ONLY the JSON object.`;
      }
    }
    send(res, 502, { error: `model did not return usable shapes (${lastErr})` });
  }

  async function test(res, provider, model, signal) {
    const key = apiKeyFor(provider, env);
    const m = model || provider.defaultModel || "";
    const t0 = Date.now();
    try {
      const text = await generate({
        provider, key, model: m, effort: "", signal,
        system: 'Reply with exactly this JSON and nothing else: {"elements":[]}',
        user: "ping",
      });
      send(res, 200, { ok: true, ms: Date.now() - t0, model: m || "(default)", sample: text.trim().slice(0, 80) });
    } catch (e) {
      send(res, 200, { ok: false, ms: Date.now() - t0, error: e.message });
    }
  }

  function upsert(id, body) {
    const cfg = readUserConfig();
    const existing = getProvider(id);
    const cur = { ...(cfg.providers[id] || {}) };
    if (existing?.type === "cli") {
      // CLI providers: only the default model is editable from the UI
      if (typeof body.defaultModel === "string") cur.defaultModel = body.defaultModel.slice(0, 120);
    } else {
      const type = existing?.type || body.type;
      if (type !== "anthropic" && type !== "openai-compat") throw new Error("type must be anthropic or openai-compat");
      cur.type = type;
      if (!existing?.builtin || typeof body.name === "string") cur.name = String(body.name || existing?.name || id).slice(0, 60);
      if (typeof body.baseUrl === "string") {
        if (!validBaseUrl(body.baseUrl)) throw new Error("base URL must be http(s)");
        cur.baseUrl = body.baseUrl.replace(/\/+$/, "");
      }
      if (typeof body.defaultModel === "string") cur.defaultModel = body.defaultModel.slice(0, 120);
      if (body.clearKey) delete cur.apiKey;
      else if (typeof body.apiKey === "string" && body.apiKey.trim()) cur.apiKey = body.apiKey.trim();
      if (!existing && !cur.baseUrl) throw new Error("base URL required");
    }
    cfg.providers[id] = cur;
    writeUserConfig(cfg);
  }

  return {
    name: "claude-bridge",
    configResolved(c) {
      env = { ...process.env, ...loadEnv(c.mode, c.root, "") };
    },
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "ec-token", content: token }, injectTo: "head" }];
    },
    configureServer(server) {
      server.middlewares.use("/api", async (req, res) => {
        const bad = guard(req, token);
        if (bad) return send(res, 403, { error: bad });
        const url = new URL(req.url, "http://x");
        const route = `${req.method} ${url.pathname.replace(/\/+$/, "")}`;
        const m = url.pathname.match(/^\/providers\/([^/]+)(\/(test|models))?$/);
        const id = m?.[1];
        try {
          if (route === "GET /providers") {
            return send(res, 200, { providers: resolveProviders().map((p) => publicProvider(p, env)), presets });
          }
          if (route === "POST /draw") return await draw(req, res);
          if (id && !ID_RE.test(id)) return send(res, 400, { error: "bad provider id" });

          if (m && req.method === "PUT" && !m[2]) {
            upsert(id, await readBody(req));
            return send(res, 200, { provider: publicProvider(getProvider(id), env) });
          }
          if (m && req.method === "DELETE" && !m[2]) {
            const cfg = readUserConfig();
            delete cfg.providers[id]; // built-ins fall back to code defaults
            writeUserConfig(cfg);
            return send(res, 200, { ok: true });
          }
          const provider = id && getProvider(id);
          if (m && !provider) return send(res, 404, { error: "unknown provider" });
          if (m?.[3] === "models" && req.method === "GET") {
            try {
              return send(res, 200, { models: await listModels({ provider, key: apiKeyFor(provider, env) }) });
            } catch (e) {
              return send(res, 200, { models: provider.models || [], error: e.message });
            }
          }
          if (m?.[3] === "test" && req.method === "POST") {
            const b = await readBody(req);
            return await test(res, provider, String(b.model || ""), undefined);
          }
          send(res, 404, { error: "not found" });
        } catch (e) {
          send(res, 400, { error: e.message });
        }
      });
    },
  };
}
