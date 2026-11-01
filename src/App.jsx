import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { api } from "./api.js";
import Settings from "./Settings.jsx";

const STORE = "excalidraw-claude:scene";

function loadScene() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    return s ? { elements: s.elements || [], appState: { viewBackgroundColor: "#ffffff" } } : null;
  } catch {
    return null;
  }
}

// compact text summary of the canvas so the model can see what exists
function summarize(elements) {
  const live = elements.filter((e) => !e.isDeleted).slice(0, 150);
  return live
    .map((e) => {
      const t = e.text || e.label?.text || "";
      return `${e.type}${t ? ` "${t.slice(0, 40).replace(/\n/g, " ")}"` : ""} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.width)}x${Math.round(e.height)}`;
    })
    .join("\n");
}

// point on the edge of `a` facing `b` (side midpoints, top/bottom when mostly vertical)
function edge(a, b) {
  const aw = a.width ?? 180, ah = a.height ?? 70;
  const bw = b.width ?? 180, bh = b.height ?? 70;
  const acx = a.x + aw / 2, acy = a.y + ah / 2;
  const dx = b.x + bw / 2 - acx, dy = b.y + bh / 2 - acy;
  return Math.abs(dx) * ah >= Math.abs(dy) * aw
    ? [acx + Math.sign(dx || 1) * (aw / 2), acy]
    : [acx, acy + Math.sign(dy || 1) * (ah / 2)];
}

// give bound arrows real coordinates so they span the gap between their shapes
function connect(e, byId) {
  if (e.type !== "arrow" || !e.start?.id || !e.end?.id) return e;
  const a = byId[e.start.id], b = byId[e.end.id];
  if (!a || !b) return e;
  const [sx, sy] = edge(a, b);
  const [ex, ey] = edge(b, a);
  // a 0 width/height is treated as "unset" by the converter and replaced by a default
  return { ...e, x: sx, y: sy, width: ex - sx || 0.01, height: ey - sy || 0.01 };
}

function usePersisted(key, init) {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) ?? init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch {}
  }, [key, v]);
  return [v, setV];
}

const selectStyle = {
  border: "1px solid #ced4da", borderRadius: 8, padding: "6px 8px", fontSize: 13,
  background: "#fff", color: "#343a40", cursor: "pointer", maxWidth: 150,
};

export default function App() {
  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState([]);
  const [providerId, setProviderId] = usePersisted("excalidraw-claude:provider", "claude-cli");
  const [model, setModel] = useState("");
  const [effort, setEffort] = usePersisted("excalidraw-claude:effort", "");
  const [modelList, setModelList] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [api_, setApi] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const initial = useMemo(loadScene, []);
  const saveTimer = useRef(null);

  const provider = providers.find((p) => p.id === providerId) || providers[0];

  const refresh = useCallback(async () => {
    try {
      const d = await api("/providers");
      setProviders(d.providers);
      setPresets(d.presets);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // remembered model per provider; fall back to the provider's default
  useEffect(() => {
    if (!provider) return;
    let saved = "";
    try { saved = localStorage.getItem(`excalidraw-claude:model:${provider.id}`) || ""; } catch {}
    setModel(saved || provider.defaultModel);
    setModelList(provider.models);
    let live = true;
    api(`/providers/${provider.id}/models`)
      .then((d) => live && setModelList(d.models))
      .catch(() => {});
    return () => { live = false; };
  }, [provider?.id, provider?.baseUrl, provider?.keySource]);

  const pickModel = (v) => {
    setModel(v);
    try { localStorage.setItem(`excalidraw-claude:model:${provider.id}`, v); } catch {}
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onChange = (elements) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({ elements }));
      } catch {}
    }, 500);
  };

  async function run() {
    const text = prompt.trim();
    if (!text || !api_ || !provider || busy) return;
    setBusy(true);
    setMsg(`${provider.name} is drawing…`);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const existing = api_.getSceneElements();
      const data = await api("/draw", {
        method: "POST",
        signal: ac.signal,
        body: {
          prompt: text,
          context: summarize(existing),
          providerId: provider.id,
          model,
          effort: provider.capabilities.effort ? effort : "",
        },
      });

      // place new content below everything already on the canvas
      const live = existing.filter((e) => !e.isDeleted);
      const maxY = live.length ? Math.max(...live.map((e) => e.y + e.height)) : 0;
      const minX = live.length ? Math.min(...live.map((e) => e.x)) : 0;
      const oy = live.length ? maxY + 120 : 0;

      const shifted = data.elements.map((e) => ({ ...e, x: (e.x ?? 0) + minX, y: (e.y ?? 0) + oy }));
      const byId = Object.fromEntries(shifted.filter((e) => e.id).map((e) => [e.id, e]));
      const created = convertToExcalidrawElements(shifted.map((e) => connect(e, byId)), { regenerateIds: true });
      api_.updateScene({ elements: [...existing, ...created] });
      api_.scrollToContent(created, { fitToViewport: true, viewportZoomFactor: 0.8, animate: true });
      const m = data.meta;
      setMsg(`Added ${created.length} elements · ${m.model} · ${(m.ms / 1000).toFixed(1)}s${m.attempts > 1 ? ` · ${m.attempts} tries` : ""}`);
      setPrompt("");
    } catch (e) {
      setMsg(e.name === "AbortError" ? "Cancelled" : `Error: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const cancel = () => abortRef.current?.abort();

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Excalidraw excalidrawAPI={setApi} initialData={initial} onChange={onChange} />
      <div
        style={{
          position: "absolute", left: "50%", bottom: 64, transform: "translateX(-50%)",
          width: "min(940px, 94vw)", zIndex: 10, background: "#fff", border: "1px solid #ced4da",
          borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,.15)", padding: 10,
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontFamily: "system-ui, sans-serif",
        }}
      >
        <input
          ref={inputRef}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Ask AI to draw…  (⌘K to focus, Enter to send)"
          style={{ flex: "1 1 240px", border: "none", outline: "none", fontSize: 15, background: "transparent", minWidth: 200 }}
        />
        <select value={provider?.id || ""} disabled={busy} onChange={(e) => setProviderId(e.target.value)} style={selectStyle} title="Provider">
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input
          list="model-list"
          value={model}
          disabled={busy}
          onChange={(e) => pickModel(e.target.value)}
          placeholder={provider?.type === "cli" ? "default model" : "model id"}
          title="Model (type any id, or pick from the list)"
          style={{ ...selectStyle, width: 150, cursor: "text" }}
        />
        <datalist id="model-list">{modelList.map((m) => <option key={m} value={m} />)}</datalist>
        {provider?.capabilities.effort && (
          <select value={effort} disabled={busy} onChange={(e) => setEffort(e.target.value)} style={selectStyle} title="Effort level">
            <option value="">Default effort</option>
            {provider.capabilities.efforts.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>
        )}
        <button onClick={() => setShowSettings(true)} title="Provider settings" style={{ ...selectStyle, padding: "6px 10px" }}>⚙</button>
        {busy ? (
          <button onClick={cancel} style={{ border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", background: "#e03131", color: "#fff", fontSize: 14 }}>
            Cancel
          </button>
        ) : (
          <button
            onClick={run}
            disabled={!prompt.trim()}
            style={{ border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", background: prompt.trim() ? "#6965db" : "#adb5bd", color: "#fff", fontSize: 14 }}
          >
            Draw
          </button>
        )}
      </div>
      {msg && (
        <div
          style={{
            position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)",
            zIndex: 10, fontSize: 13, fontFamily: "system-ui, sans-serif",
            color: msg.startsWith("Error") ? "#c92a2a" : "#495057",
            background: "#fff", padding: "4px 10px", borderRadius: 8, maxWidth: "90vw",
          }}
        >
          {msg}
        </div>
      )}
      {showSettings && (
        <Settings providers={providers} presets={presets} onChanged={refresh} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
