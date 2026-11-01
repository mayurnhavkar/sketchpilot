import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, getSceneVersion, restoreElements,
} from "@excalidraw/excalidraw";
import { api, drawStream } from "./api.js";
import Settings from "./Settings.jsx";
import SceneMenu from "./SceneMenu.jsx";
import { mermaidToSkeleton } from "./lib/mermaid.js";
import { readImage, readTextFiles } from "./lib/files.js";
import {
  PALETTES, STYLES, applyDeletes, applyStyle, applyUpdates, bindToExisting, connect, describeScene,
  freeSpace, namespaceIds, selectedIdsOf, styleById, summarizeResult,
} from "./lib/scene.js";

const LS = {
  scene: "excalidraw-claude:scene-name",
  legacy: "excalidraw-claude:scene",
  provider: "excalidraw-claude:provider",
  effort: "excalidraw-claude:effort",
  style: "excalidraw-claude:style",
};
const lsGet = (k, d = "") => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const lsSet = (k, v) => {
  try { localStorage.setItem(k, v); } catch {}
};

function usePersisted(key, init) {
  const [v, setV] = useState(() => lsGet(key, init));
  useEffect(() => lsSet(key, v), [key, v]);
  return [v, setV];
}

const ctl = {
  border: "1px solid #ced4da", borderRadius: 8, padding: "6px 8px", fontSize: 13,
  background: "#fff", color: "#343a40", cursor: "pointer", maxWidth: 150,
};
const iconBtn = { ...ctl, padding: "6px 9px" };

// pixel width of a string in a CSS font, for wrapping edited labels
let _ctx;
const measureText = (text, font) => {
  _ctx ||= document.createElement("canvas").getContext("2d");
  _ctx.font = font;
  return _ctx.measureText(text).width;
};

const bbox = (els) => ({
  maxY: els.length ? Math.max(...els.map((e) => (e.y || 0) + (e.height || 0))) : 0,
});

export default function App() {
  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState([]);
  const [providerId, setProviderId] = usePersisted(LS.provider, "claude-cli");
  const [model, setModel] = useState("");
  const [effort, setEffort] = usePersisted(LS.effort, "");
  const [styleId, setStyleId] = usePersisted(LS.style, "sketch");
  const [modelList, setModelList] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [excal, setExcal] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [selCount, setSelCount] = useState(0);
  const [thread, setThread] = useState([]);
  const [attached, setAttached] = useState({ files: [], skipped: 0, chars: 0 });
  const [images, setImages] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [sceneName, setSceneName] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const imageRef = useRef(null);
  const abortRef = useRef(null);
  const sceneRef = useRef("");
  const readyRef = useRef(false);
  const latestRef = useRef(null);
  const savedVersionRef = useRef(-1);
  const saveTimer = useRef(null);

  const provider = providers.find((p) => p.id === providerId) || providers[0];
  const style = styleById(styleId);

  // ---------- providers ----------
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

  useEffect(() => {
    if (!provider) return;
    setModel(lsGet(`excalidraw-claude:model:${provider.id}`) || provider.defaultModel);
    setModelList(provider.models);
    let live = true;
    api(`/providers/${provider.id}/models`).then((d) => live && setModelList(d.models)).catch(() => {});
    return () => { live = false; };
  }, [provider?.id, provider?.baseUrl, provider?.keySource]);

  const pickModel = (v) => {
    setModel(v);
    lsSet(`excalidraw-claude:model:${provider.id}`, v);
  };

  // ---------- scenes: plain .excalidraw files on disk ----------
  const applyLoaded = useCallback((data, { undoable = false } = {}) => {
    if (!excal) return;
    const els = restoreElements(data.elements || [], null);
    const files = Object.values(data.files || {});
    if (files.length) excal.addFiles(files);
    excal.updateScene({
      elements: els,
      appState: { viewBackgroundColor: data.appState?.viewBackgroundColor || "#ffffff" },
      captureUpdate: undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
    });
    if (!undoable) excal.history.clear();
    savedVersionRef.current = getSceneVersion(els);
    const visible = els.filter((e) => !e.isDeleted);
    if (visible.length) excal.scrollToContent(visible, { fitToViewport: true, viewportZoomFactor: 0.85 });
  }, [excal]);

  const flush = useCallback(async (keepalive = false) => {
    const L = latestRef.current;
    const name = sceneRef.current;
    if (!L || !name || !readyRef.current) return;
    const v = getSceneVersion(L.elements);
    if (v === savedVersionRef.current) return;
    const elements = L.elements.filter((e) => !e.isDeleted);
    const used = new Set(elements.filter((e) => e.type === "image").map((e) => e.fileId));
    const files = Object.fromEntries(Object.entries(L.files || {}).filter(([id]) => used.has(id)));
    try {
      await fetch(`/api/scenes/${encodeURIComponent(name)}`, {
        method: "PUT",
        keepalive,
        headers: { "Content-Type": "application/json", "X-EC-Token": document.querySelector('meta[name="ec-token"]')?.content || "" },
        body: JSON.stringify({ elements, appState: { viewBackgroundColor: L.appState?.viewBackgroundColor }, files }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      });
      savedVersionRef.current = v;
      setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e.message}`);
    }
  }, []);

  const refreshScenes = useCallback(async () => {
    const d = await api("/scenes");
    setScenes(d.scenes);
    return d.scenes;
  }, []);

  const openScene = useCallback(async (name) => {
    await flush();
    readyRef.current = false;
    const data = await api(`/scenes/${encodeURIComponent(name)}`);
    applyLoaded(data);
    sceneRef.current = name;
    setSceneName(name);
    lsSet(LS.scene, name);
    setThread([]);
    readyRef.current = true;
  }, [applyLoaded, flush]);

  // first load: last-used scene, else newest, else migrate the old browser-storage canvas, else a blank one
  useEffect(() => {
    if (!excal || readyRef.current) return;
    (async () => {
      try {
        let list = await refreshScenes();
        if (!list.length) {
          let legacy = null;
          try { legacy = JSON.parse(lsGet(LS.legacy, "null")); } catch {}
          await api("/scenes/Untitled", { method: "PUT", body: { elements: legacy?.elements || [] } });
          list = await refreshScenes();
        }
        const want = lsGet(LS.scene);
        await openScene(list.some((s) => s.name === want) ? want : list[0].name);
      } catch (e) {
        setMsg(`Error: ${e.message}`);
      }
    })();
  }, [excal, refreshScenes, openScene]);

  const onChange = (elements, appState, files) => {
    const sc = Object.values(appState.selectedElementIds || {}).filter(Boolean).length;
    setSelCount((p) => (p === sc ? p : sc));
    latestRef.current = { elements, appState, files };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 1200);
  };

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  async function newScene() {
    const name = (window.prompt("Name for the new scene:") || "").trim();
    if (!name) return;
    try {
      await flush();
      await api(`/scenes/${encodeURIComponent(name)}`, { method: "PUT", body: { elements: [] } });
      await refreshScenes();
      await openScene(name);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  }

  const loadVersions = async () => (await api(`/scenes/${encodeURIComponent(sceneRef.current)}/history`)).versions;
  const restoreVersion = async (ts) => {
    try {
      await flush();
      applyLoaded(await api(`/scenes/${encodeURIComponent(sceneRef.current)}/history/${ts}`), { undoable: true });
      setMsg("Restored an earlier version (Ctrl+Z undoes it)");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") abortRef.current?.abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- attachments ----------
  async function addFiles(list) {
    const r = await readTextFiles(list);
    setAttached((a) => ({ files: [...a.files, ...r.files], skipped: a.skipped + r.skipped, chars: a.chars + r.chars }));
  }
  async function addImages(list) {
    if (!provider?.vision) {
      setMsg("This provider isn't marked as vision-capable (tick it in ⚙ settings, or pick another provider).");
      return;
    }
    const imgs = [];
    for (const f of Array.from(list).filter((f) => f.type.startsWith("image/"))) {
      try { imgs.push(await readImage(f)); } catch { setMsg(`Could not read ${f.name}`); }
    }
    setImages((cur) => [...cur, ...imgs].slice(0, 3));
  }
  const onPaste = (e) => {
    const pics = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (pics.length) {
      e.preventDefault();
      addImages(pics);
    }
  };

  // ---------- the draw ----------
  async function run() {
    const text = prompt.trim();
    if (!text || !excal || !provider || busy) return;
    setBusy(true);
    setMsg(`${provider.name} is thinking…`);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const all = excal.getSceneElementsIncludingDeleted();
      const { text: context, knownIds } = describeScene(all, selectedIdsOf(excal.getAppState()));
      const done = await drawStream(
        {
          prompt: text, context, knownIds, history: thread,
          providerId: provider.id, model, effort: provider.capabilities.effort ? effort : "",
          files: attached.files, images: images.map(({ mime, data }) => ({ mime, data })),
          palette: PALETTES[style.palette].fills,
        },
        {
          signal: ac.signal,
          onEvent: (ev) => {
            if (ev.t === "progress") setMsg(`${provider.name} · receiving ${(ev.chars / 1000).toFixed(1)}k chars… (Esc cancels)`);
            if (ev.t === "retry") setMsg("Reply was unusable, asking again…");
          },
        },
      );
      const note = await applyReply(done.reply, all, text);
      const m = done.meta;
      const tok = m.usage ? ` · ${m.usage.in ?? "?"}→${m.usage.out ?? "?"} tok` : "";
      setMsg(`${note} · ${m.model} · ${(m.ms / 1000).toFixed(1)}s${tok}${m.attempts > 1 ? ` · ${m.attempts} tries` : ""}`);
      setPrompt("");
      setImages([]); // one-shot; attached files stay as session context
    } catch (e) {
      setMsg(e.name === "AbortError" ? "Cancelled" : `Error: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function applyReply(reply, all, promptText) {
    // 1. edits to what is already there
    let elements = applyDeletes(applyUpdates(all, reply.update, measureText), reply.delete);

    // 2. new content: Mermaid (auto-laid-out) and/or freeform shapes
    const prefix = `n${Date.now().toString(36).slice(-4)}_`;
    const existingById = Object.fromEntries(all.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
    const { ox, oy } = freeSpace(all);
    let mermaidSk = [], freeSk = [], mermaidErr = "", files = {};

    if (reply.mermaid) {
      try {
        const m = await mermaidToSkeleton(reply.mermaid);
        files = m.files;
        mermaidSk = namespaceIds(m.elements, `${prefix}m`).map((e) => ({ ...e, x: (e.x ?? 0) + ox, y: (e.y ?? 0) + oy }));
      } catch (e) {
        mermaidErr = String(e.message || e).split("\n")[0].slice(0, 120);
      }
    }
    if (reply.elements.length) {
      const dx = reply.absolute ? 0 : ox;
      // freeform content goes below a Mermaid diagram if both arrive together
      const dy = reply.absolute ? 0 : oy + (mermaidSk.length ? bbox(mermaidSk).maxY - oy + 120 : 0);
      freeSk = namespaceIds(reply.elements, `${prefix}f`).map((e) => ({ ...e, x: (e.x ?? 0) + dx, y: (e.y ?? 0) + dy }));
      const byId = { ...existingById, ...Object.fromEntries(freeSk.filter((e) => e.id).map((e) => [e.id, e])) };
      freeSk = freeSk.map((e) => connect(e, byId));
    }

    let created = [];
    const skeleton = [...mermaidSk, ...freeSk];
    if (skeleton.length) {
      created = convertToExcalidrawElements(skeleton, { regenerateIds: false });
      created = applyStyle(created, style, { recolor: (e) => e.id.startsWith(`${prefix}m`) });
      const bound = bindToExisting(created, existingById, skeleton);
      created = bound.created;
      if (bound.patched.size) elements = elements.map((e) => bound.patched.get(e.id) || e);
    }
    if (Object.keys(files).length) excal.addFiles(Object.values(files));

    // 3. one undoable step for the whole reply
    excal.updateScene({ elements: [...elements, ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    // after the scene has rendered, so the bounds of the new elements are known
    if (created.length) setTimeout(() => excal.scrollToContent(created, { fitToContent: true, maxZoom: 1, animate: true }), 60);

    const labels = created.filter((e) => e.type === "text").map((e) => e.text);
    const result = summarizeResult(reply, labels);
    setThread((t) => [...t, { prompt: promptText, result }].slice(-6));
    const nothing = !created.length && !reply.update.length && !reply.delete.length;
    if (mermaidErr && nothing) throw new Error(`The diagram had a syntax error (${mermaidErr}). Try again or rephrase.`);
    return `${created.length ? `Added ${created.length}` : ""}${reply.update.length ? ` Updated ${reply.update.length}` : ""}${reply.delete.length ? ` Deleted ${reply.delete.length}` : ""}`.trim() +
      (mermaidErr ? ` (diagram skipped: ${mermaidErr})` : "");
  }

  const cancel = () => abortRef.current?.abort();
  const sizeKb = Math.round(attached.chars / 1000);
  const cloud = provider && !provider.local;

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Excalidraw excalidrawAPI={setExcal} onChange={onChange} />
      <SceneMenu
        scenes={scenes} current={sceneName} status={saveStatus}
        onSwitch={(n) => openScene(n).catch((e) => setMsg(`Error: ${e.message}`))}
        onNew={newScene} onLoadVersions={loadVersions} onRestore={restoreVersion}
      />

      <div
        style={{
          position: "absolute", left: "50%", bottom: 64, transform: "translateX(-50%)",
          width: "min(940px, 94vw)", zIndex: 10, background: "#fff", border: "1px solid #ced4da",
          borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,.15)", padding: 10,
          display: "flex", flexDirection: "column", gap: 8, fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder={selCount ? `Edit the ${selCount} selected element${selCount > 1 ? "s" : ""}…` : "Ask AI to draw or edit…  (⌘K focus · Enter send · Esc cancel)"}
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15, background: "transparent", minWidth: 200 }}
          />
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

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={provider?.id || ""} disabled={busy} onChange={(e) => setProviderId(e.target.value)} style={ctl} title="Provider">
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            list="model-list" value={model} disabled={busy} onChange={(e) => pickModel(e.target.value)}
            placeholder={provider?.type === "cli" ? "default model" : "model id"}
            title="Model (type any id, or pick from the list)" style={{ ...ctl, width: 150, cursor: "text" }}
          />
          <datalist id="model-list">{modelList.map((m) => <option key={m} value={m} />)}</datalist>
          {provider?.capabilities.effort && (
            <select value={effort} disabled={busy} onChange={(e) => setEffort(e.target.value)} style={ctl} title="Effort level">
              <option value="">Default effort</option>
              {provider.capabilities.efforts.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </select>
          )}
          <select value={styleId} disabled={busy} onChange={(e) => setStyleId(e.target.value)} style={ctl} title="Style for new shapes">
            {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span style={{ width: 1, height: 20, background: "#dee2e6" }} />
          <button style={iconBtn} title="Attach files as context" onClick={() => fileRef.current?.click()}>📎</button>
          <button style={iconBtn} title="Attach a folder as context" onClick={() => folderRef.current?.click()}>📁</button>
          {provider?.vision && <button style={iconBtn} title="Attach an image (or paste one)" onClick={() => imageRef.current?.click()}>🖼</button>}
          <button style={iconBtn} onClick={() => setShowSettings(true)} title="Provider settings">⚙</button>
          <span style={{ flex: 1 }} />
          {thread.length > 0 && (
            <button style={{ ...iconBtn, fontSize: 12, color: "#868e96" }} onClick={() => setThread([])} title="Forget earlier requests in this session">
              {thread.length} earlier ✕
            </button>
          )}
        </div>

        {(attached.files.length > 0 || images.length > 0) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "#495057" }}>
            {attached.files.length > 0 && (
              <span style={{ background: "#f1f3f5", borderRadius: 6, padding: "3px 8px" }}>
                {attached.files.length} file{attached.files.length > 1 ? "s" : ""} · {attached.chars < 1000 ? `${attached.chars} B` : `${sizeKb} KB`}
                {attached.skipped ? ` · ${attached.skipped} skipped` : ""}{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); setAttached({ files: [], skipped: 0, chars: 0 }); }}>remove</a>
              </span>
            )}
            {images.map((im, i) => (
              <span key={i} style={{ background: "#f1f3f5", borderRadius: 6, padding: "2px 6px", display: "inline-flex", gap: 6, alignItems: "center" }}>
                <img src={im.preview} alt="" style={{ height: 22, borderRadius: 3 }} />
                <a href="#" onClick={(e) => { e.preventDefault(); setImages((c) => c.filter((_, j) => j !== i)); }}>remove</a>
              </span>
            ))}
            {cloud && <span style={{ color: "#e8590c" }}>⚠ this is sent to {provider.name} (cloud). Use a local provider for private material.</span>}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />

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
      {showSettings && <Settings providers={providers} presets={presets} onChanged={refresh} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
