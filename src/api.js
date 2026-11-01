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
