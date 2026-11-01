import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generate, listModels } from "../server/adapters.js";

const realFetch = globalThis.fetch;
let calls;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; });

const sse = (events) =>
  new Response(new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(e));
      c.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

const openai = { type: "openai-compat", baseUrl: "http://localhost:11434/v1/", name: "O" };
const chunk = (s) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;

test("openai-compat: streams deltas, reports chars and usage, sends json mode", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return sse([chunk('{"ele'), chunk('ments":[]}'), `data: ${JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`, "data: [DONE]\n\n"]);
  };
  const seen = [];
  const out = await generate({ provider: openai, key: "k", model: "m", system: "S", user: "U", onChunk: (n) => seen.push(n) });
  assert.equal(out.text, '{"elements":[]}');
  assert.deepEqual(out.usage, { in: 7, out: 3 });
  assert.deepEqual(seen, [5, 15]);
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer k");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.equal(calls[0].body.stream, true);
});

test("openai-compat: retries without json mode / usage options when the server answers 400", async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return n++ === 0 ? new Response('{"error":{"message":"response_format unsupported"}}', { status: 400 }) : sse([chunk("{}"), "data: [DONE]\n\n"]);
  };
  const out = await generate({ provider: openai, model: "m", system: "S", user: "U" });
  assert.equal(out.text, "{}");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].response_format && !calls[1].response_format && !calls[1].stream_options);
});

test("openai-compat: a persistent error surfaces its message", async () => {
  globalThis.fetch = async () => new Response('{"error":{"message":"model not found"}}', { status: 404 });
  await assert.rejects(generate({ provider: openai, model: "m", system: "S", user: "U" }), /404 model not found/);
});

test("openai-compat: images go out as image_url data URLs", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return sse(["data: [DONE]\n\n"]);
  };
  await generate({ provider: openai, model: "m", system: "S", user: "U", images: [{ mime: "image/png", data: "QUJD" }] });
  const parts = calls[0].messages[1].content;
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].image_url.url, "data:image/png;base64,QUJD");
});

test("anthropic: parses the event stream, usage, and sends images before text", async () => {
  const ev = (o) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return sse([
      ev({ type: "message_start", message: { usage: { input_tokens: 11 } } }),
      ev({ type: "content_block_delta", delta: { type: "text_delta", text: '{"elements"' } }),
      ev({ type: "content_block_delta", delta: { type: "text_delta", text: ":[]}" } }),
      ev({ type: "message_delta", usage: { output_tokens: 4 } }),
    ]);
  };
  const out = await generate({
    provider: { type: "anthropic", baseUrl: "https://api.anthropic.com" }, key: "sk", model: "claude-x",
    system: "S", user: "U", images: [{ mime: "image/jpeg", data: "QUJD" }],
  });
  assert.equal(out.text, '{"elements":[]}');
  assert.deepEqual(out.usage, { in: 11, out: 4 });
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "sk");
  assert.equal(calls[0].body.messages[0].content[0].type, "image");
  assert.equal(calls[0].body.messages[0].content[1].text, "U");
});

test("anthropic: stream error events become errors", async () => {
  globalThis.fetch = async () => sse([`data: ${JSON.stringify({ type: "error", error: { message: "overloaded" } })}\n\n`]);
  await assert.rejects(generate({ provider: { type: "anthropic", baseUrl: "http://x" }, key: "k", model: "m", system: "S", user: "U" }), /overloaded/);
});

const echo = { type: "cli", name: "Echo", command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"] };

test("cli: user prompt goes through stdin and stdout is the reply", async () => {
  const out = await generate({ provider: echo, system: "S", user: "hello" });
  assert.equal(out.text, "hello");
});

test("cli: {{user}} / {{system}} substitution and model flag", async () => {
  const p = { ...echo, args: ["-e", "console.log(process.argv.slice(1).join('|'))", "{{system}}", "{{user}}"], modelFlag: "--model" };
  const out = await generate({ provider: p, model: "opus", system: "SYS", user: "USR" });
  assert.equal(out.text.trim(), "SYS|USR|--model|opus");
});

test("cli: images are refused, non-zero exit reports stderr, abort cancels", async () => {
  await assert.rejects(generate({ provider: echo, system: "S", user: "U", images: [{ mime: "image/png", data: "QQ==" }] }), /can't read images/);
  const bad = { ...echo, args: ["-e", "console.error('boom'); process.exit(3)"] };
  await assert.rejects(generate({ provider: bad, system: "S", user: "U" }), /boom/);
  const slow = { ...echo, args: ["-e", "setTimeout(()=>{}, 30000)"] };
  const ac = new AbortController();
  const p = generate({ provider: slow, system: "S", user: "U", signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, /cancelled/);
});

test("unknown provider type is rejected", () => {
  assert.throws(() => generate({ provider: { type: "nope" } }), /unknown provider type/);
});

test("listModels: sorted, de-duplicated, without Ollama runner ids; cli lists its configured models", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ data: [{ id: "qwen2.5vl:3b" }, { id: "llamacpp:79d4979787523c92629bc043c0584a5132d6758e40b429586203a6b1094cb6f8" }, { id: "qwen2.5:7b" }, { id: "qwen2.5vl:3b" }] }), { status: 200 });
  };
  assert.deepEqual(await listModels({ provider: openai, key: "" }), ["qwen2.5:7b", "qwen2.5vl:3b"]);
  assert.equal(calls[0].url, "http://localhost:11434/v1/models");
  assert.deepEqual(await listModels({ provider: { type: "cli", models: ["opus", "sonnet"] } }), ["opus", "sonnet"]);
  globalThis.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
  await assert.rejects(listModels({ provider: { type: "anthropic", baseUrl: "http://x" }, key: "k" }), /401 bad key/);
});
