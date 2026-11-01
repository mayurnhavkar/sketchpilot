// the server embeds a per-process token in the page; every /api call must send it back
const token = document.querySelector('meta[name="ec-token"]')?.content || "";

export async function api(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: { "Content-Type": "application/json", "X-EC-Token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// POST /api/draw streams newline-delimited JSON events: progress, retry, then done (or error).
export async function drawStream(body, { signal, onEvent } = {}) {
  const res = await fetch("/api/draw", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-EC-Token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let d = {};
    try { d = await res.json(); } catch {}
    throw new Error(d.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", done = null;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      onEvent?.(ev);
      if (ev.t === "error") throw new Error(ev.error);
      if (ev.t === "done") done = ev;
    }
  }
  if (!done) throw new Error("connection closed before the reply finished");
  return done;
}
