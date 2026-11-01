import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { ModelCombo, Select } from "./ui.jsx";

const box = { border: "1px solid #dee2e6", borderRadius: 10, padding: 12, marginBottom: 10 };
const input = { border: "1px solid #ced4da", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box" };
const btn = { border: "1px solid #ced4da", borderRadius: 6, padding: "5px 10px", fontSize: 13, background: "#fff", cursor: "pointer" };
const label = { fontSize: 12, color: "#868e96", marginTop: 8, marginBottom: 2 };

function ProviderCard({ p, onChanged }) {
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [defaultModel, setDefaultModel] = useState(p.defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [vision, setVision] = useState(p.vision);
  const [models, setModels] = useState(p.models);

  // the provider's own model list (Ollama's installed models, an API's catalogue, the CLI's aliases)
  useEffect(() => {
    let live = true;
    api(`/providers/${p.id}/models`).then((d) => live && setModels(d.models)).catch(() => {});
    return () => { live = false; };
  }, [p.id, p.baseUrl, p.keySource]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const isCli = p.type === "cli";

  async function save(extra = {}) {
    setBusy(true);
    setStatus(null);
    try {
      await api(`/providers/${p.id}`, { method: "PUT", body: { baseUrl, defaultModel, apiKey, vision, ...extra } });
      setApiKey("");
      await onChanged();
      setStatus({ ok: true, text: "Saved" });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus({ ok: true, text: "Testing…" });
    try {
      if (apiKey || baseUrl !== p.baseUrl || defaultModel !== p.defaultModel || vision !== p.vision) await save();
      const r = await api(`/providers/${p.id}/test`, { method: "POST", body: { model: defaultModel } });
      setStatus(r.ok ? { ok: true, text: `OK · ${r.model} · ${r.ms} ms` } : { ok: false, text: r.error });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(p.builtin ? `Reset ${p.name} to defaults (removes saved key)?` : `Remove ${p.name}?`)) return;
    await api(`/providers/${p.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 14 }}>{p.name}</b>
        <span style={{ fontSize: 11, color: "#868e96" }}>{p.type}</span>
        <span style={{ flex: 1 }} />
        {p.needsKey && (
          <span style={{ fontSize: 12, color: p.keySource ? "#2f9e44" : "#e03131" }}>
            {p.keySource === "ui" ? "key saved" : p.keySource === "env" ? "key from .env" : "no key"}
          </span>
        )}
      </div>
      {isCli ? (
        <div style={{ fontSize: 12, color: "#868e96", marginTop: 6 }}>
          Runs a local command (defined in providers.config.js). Uses your existing CLI login; no key needed.
        </div>
      ) : (
        <>
          <div style={label}>Base URL</div>
          <input style={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
          {(p.needsKey || p.keySource) && (
            <>
              <div style={label}>API key (stored on this machine only, never shown again)</div>
              <input
                style={input}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={p.keySource ? "leave blank to keep current" : "paste key"}
              />
            </>
          )}
        </>
      )}
      <div style={label}>Default model{isCli ? " (blank = CLI default)" : ""}</div>
      <ModelCombo block popup="down" value={defaultModel} onChange={setDefaultModel} options={models} placeholder="model id" title="Default model: pick from the list or type any id" />
      {!isCli && (
        <label style={{ ...label, display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
          This model can read images (shows the image attach button)
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button style={btn} disabled={busy} onClick={() => save()}>Save</button>
        <button style={btn} disabled={busy} onClick={test}>Test</button>
        {p.keySource === "ui" && <button style={btn} disabled={busy} onClick={() => save({ clearKey: true })}>Clear key</button>}
        {(!p.builtin || !isCli) && <button style={{ ...btn, color: "#c92a2a" }} disabled={busy} onClick={remove}>{p.builtin ? "Reset" : "Remove"}</button>}
        <span style={{ fontSize: 12, color: status?.ok ? "#2f9e44" : "#c92a2a", marginLeft: 4, wordBreak: "break-word" }}>{status?.text}</span>
      </div>
    </div>
  );
}

function AwsIcons({ status, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function install() {
    setBusy(true);
    setNote({ ok: true, text: "Downloading the official AWS Architecture Icons (14 MB)…" });
    try {
      const r = await api("/aws/install", { method: "POST", body: {} });
      await onChanged();
      setNote({ ok: true, text: `Installed ${r.services} services, ${r.resources} resources, ${r.groups} groups (release ${r.version})` });
    } catch (e) {
      setNote({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 14 }}>AWS architecture icons</b>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: status.installed ? "#2f9e44" : "#e03131" }}>
          {status.installed ? `installed · ${status.services} services · release ${status.version}` : "not installed"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#868e96", marginTop: 6 }}>
        Official icons from aws.amazon.com/architecture/icons, downloaded to this machine only (public/aws-icons, git-ignored; AWS permits use in
        architecture diagrams). Enables professional AWS diagrams with groups, subnets and numbered flows.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button style={btn} disabled={busy} onClick={install}>{status.installed ? "Update icons" : "Download & install (14 MB)"}</button>
        <span style={{ fontSize: 12, color: note?.ok ? "#2f9e44" : "#c92a2a" }}>{note?.text}</span>
      </div>
    </div>
  );
}

export default function Settings({ providers, presets, onClose, onChanged, awsStatus = { installed: false }, onAwsChanged = () => {} }) {
  const [preset, setPreset] = useState("");
  const [err, setErr] = useState("");

  async function add() {
    const pr = presets.find((x) => x.name === preset);
    if (!pr) return;
    const base = pr.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    let id = base, n = 2;
    while (providers.some((p) => p.id === id)) id = `${base}-${n++}`;
    try {
      await api(`/providers/${id}`, { method: "PUT", body: { name: pr.name, type: pr.type, baseUrl: pr.baseUrl || "https://" } });
      await onChanged();
      setPreset("");
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 14, width: "min(640px, 94vw)", maxHeight: "86vh", overflow: "auto", padding: 18, fontFamily: "system-ui, sans-serif" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <b style={{ fontSize: 17, flex: 1 }}>Model providers</b>
          <button style={btn} onClick={onClose}>Close</button>
        </div>
        <AwsIcons status={awsStatus} onChanged={onAwsChanged} />
        {providers.map((p) => (
          <ProviderCard key={p.id} p={p} onChanged={onChanged} />
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Select
            value={preset} onChange={setPreset} title="Add a provider" style={{ flex: 1 }}
            options={[{ value: "", label: "Add provider…" }, ...presets.map((x) => ({ value: x.name, label: x.name }))]}
          />
          <button style={btn} disabled={!preset} onClick={add}>Add</button>
        </div>
        {err && <div style={{ color: "#c92a2a", fontSize: 12, marginTop: 6 }}>{err}</div>}
        <div style={{ fontSize: 12, color: "#868e96", marginTop: 12 }}>
          Keys are saved to ~/.config/excalidraw-claude/providers.json (owner-only). Keys in .env or the environment work too.
          CLI providers are defined in providers.config.js.
        </div>
      </div>
    </div>
  );
}
