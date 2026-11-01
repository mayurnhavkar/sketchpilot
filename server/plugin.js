import crypto from "node:crypto";
import path from "node:path";
import { loadEnv } from "vite";
import { DEFAULT_PALETTE, buildSystem, buildUser, parseModelJson, sanitizeReply } from "./prompt.js";
import { generate, listModels } from "./adapters.js";
import { createScenes } from "./scenes.js";
import {
  ID_RE, apiKeyFor, getProvider, presets, publicProvider,
  readUserConfig, resolveProviders, writeUserConfig,
} from "./config.js";

const SMALL_BODY = 2_000_000;
const DRAW_BODY = 30_000_000; // images ride in the request
const SCENE_BODY = 40_000_000;
const MAX_ATTEMPTS = 2;
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const send = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
};

function readBody(req, limit = SMALL_BODY) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const parts = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      try {
        const s = Buffer.concat(parts).toString("utf8");
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
export function guard(req, token) {
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

export function cleanImages(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((i) => i && IMAGE_MIMES.has(i.mime) && typeof i.data === "string" && /^[A-Za-z0-9+/=]+$/.test(i.data) && i.data.length <= 8_000_000)
    .slice(0, 3)
    .map((i) => ({ mime: i.mime, data: i.data }));
}

export function cleanFiles(raw) {
  let budget = 150_000;
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!f || typeof f.name !== "string" || typeof f.text !== "string" || budget <= 0) continue;
    const text = f.text.slice(0, Math.min(60_000, budget));
    budget -= text.length;
    out.push({ name: f.name.slice(0, 120), text });
  }
  return out;
}

export function cleanPalette(raw) {
  const ok = Array.isArray(raw) && raw.length >= 1 && raw.length <= 6 && raw.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c));
  return ok ? raw : DEFAULT_PALETTE;
}

export default function claudeBridge() {
  const token = crypto.randomBytes(24).toString("hex");
  let env = process.env;
  let scenes;

  async function draw(req, res) {
    const p = await readBody(req, DRAW_BODY);
    const provider = getProvider(p.providerId);
    if (!provider) return send(res, 400, { error: "unknown provider" });
    const model = String(p.model || provider.defaultModel || "");
    if (!model && provider.type !== "cli") return send(res, 400, { error: "pick a model for this provider" });
    if (typeof p.prompt !== "string" || !p.prompt.trim()) return send(res, 400, { error: "empty prompt" });
    const images = cleanImages(p.images);
    if (images.length && provider.type === "cli") return send(res, 400, { error: `${provider.name} can't read images` });
    const effort = provider.efforts?.includes(p.effort) ? p.effort : "";
    const key = apiKeyFor(provider, env);
    const knownIds = (Array.isArray(p.knownIds) ? p.knownIds : []).filter((i) => typeof i === "string").slice(0, 3000);
    const system = buildSystem({ palette: cleanPalette(p.palette) });
    let user = buildUser({ prompt: p.prompt, context: p.context, history: Array.isArray(p.history) ? p.history : [], files: cleanFiles(p.files) });

    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const emit = (ev) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(ev)}\n`); };

    const t0 = Date.now();
    let lastErr = "", lastEmit = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) emit({ t: "retry", attempt });
      let out;
      try {
        out = await generate({
          provider, key, model, effort, system, user, images, signal: ac.signal,
          onChunk: (chars) => {
            const now = Date.now();
            if (now - lastEmit > 150) {
              lastEmit = now;
              emit({ t: "progress", chars });
            }
          },
        });
      } catch (e) {
        emit({ t: "error", error: e.message });
        return res.end();
      }
      try {
        const reply = sanitizeReply(parseModelJson(out.text), knownIds);
        emit({ t: "done", reply, meta: { provider: provider.id, model: model || "(default)", ms: Date.now() - t0, attempts: attempt, usage: out.usage } });
        return res.end();
      } catch (e) {
        lastErr = e.message;
        // feed the problem back once; weak models often fix it
        user += `\n\nYour previous reply was unusable (${e.message}). Reply again with ONLY the JSON object.`;
      }
    }
    emit({ t: "error", error: `model did not return a usable reply (${lastErr}). Rephrase, or select the element you mean first.` });
    res.end();
  }

  async function test(res, provider, model) {
    const key = apiKeyFor(provider, env);
    const m = model || provider.defaultModel || "";
    const t0 = Date.now();
    try {
      const out = await generate({
        provider, key, model: m, effort: "",
        system: 'Reply with exactly this JSON and nothing else: {"elements":[]}',
        user: "ping",
      });
      send(res, 200, { ok: true, ms: Date.now() - t0, model: m || "(default)", sample: out.text.trim().slice(0, 80) });
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
      if (typeof body.vision === "boolean") cur.vision = body.vision;
      if (body.clearKey) delete cur.apiKey;
      else if (typeof body.apiKey === "string" && body.apiKey.trim()) cur.apiKey = body.apiKey.trim();
      if (!existing && !cur.baseUrl) throw new Error("base URL required");
    }
    cfg.providers[id] = cur;
    writeUserConfig(cfg);
  }

  async function sceneRoutes(req, res, route, url) {
    const m = url.pathname.match(/^\/scenes(?:\/([^/]+)(?:\/(history)(?:\/(\d+))?)?)?$/);
    if (!m) return false;
    const name = m[1] && decodeURIComponent(m[1]);
    const kind = m[2], ts = m[3];
    if (!name && req.method === "GET") return send(res, 200, { scenes: scenes.list() }), true;
    if (name && !kind && req.method === "GET") return send(res, 200, scenes.read(name)), true;
    if (name && !kind && req.method === "PUT") {
      scenes.write(name, await readBody(req, SCENE_BODY));
      return send(res, 200, { ok: true }), true;
    }
    if (name && kind && !ts && req.method === "GET") return send(res, 200, { versions: scenes.history(name) }), true;
    if (name && kind && ts && req.method === "GET") return send(res, 200, scenes.readHistory(name, ts)), true;
    return false;
  }

  return {
    name: "claude-bridge",
    configResolved(c) {
      env = { ...process.env, ...loadEnv(c.mode, c.root, "") };
      scenes = createScenes(env.EXCALIDRAW_SCENES_DIR || path.join(c.root, "scenes"));
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
          if (await sceneRoutes(req, res, route, url)) return;
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
            return await test(res, provider, String(b.model || ""));
          }
          send(res, 404, { error: "not found" });
        } catch (e) {
          if (!res.headersSent) send(res, 400, { error: e.message });
          else res.end();
        }
      });
    },
  };
}
