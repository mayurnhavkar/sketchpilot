import React, { useEffect, useRef, useState } from "react";
import { IconButton } from "./ui.jsx";
import { api } from "./api.js";

const row = { display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "#343a40" };
const sub = { fontSize: 11, color: "#868e96", marginTop: 2 };

// Export the current note / diagram / scene to Markdown + image (+ an editable drawing) in a folder, e.g. a vault.
export default function ExportMenu({ describe, onExport, onCopy }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [label, setLabel] = useState("");
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    setResult(null);
    setLabel(describe());
    setOpen(true);
    api("/export/info").then(setInfo).catch(() => setInfo(null));
  }

  async function run(fn, done) {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: done(await fn()) });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const saved = (r) =>
    `Saved ${r.files.map((f) => f.name).join(", ")}${r.files.some((f) => f.backup) ? ". Your earlier version was kept in .export-history." : ""}${r.related?.length ? ` Linked to ${r.related.map((t) => `[[${t}]]`).join(", ")}.` : ""}`;

  return (
    <span ref={root} style={{ position: "relative", display: "inline-flex" }}>
      <IconButton icon="download" title="Export to Markdown, image or Obsidian" onClick={toggle} />
      {open && (
        <div
          style={{
            position: "absolute", top: 40, right: 0, width: 320, background: "#fff", border: "1px solid #ced4da", borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: 8, zIndex: 30, fontFamily: "system-ui, sans-serif", fontSize: 13,
          }}
        >
          <div style={{ padding: "4px 10px 8px", color: "#495057", fontWeight: 600 }}>{label}</div>
          <button style={row} disabled={busy} onClick={() => run(() => onExport({ markdown: true, svg: true }), saved)}>
            Save Markdown + image
            <div style={sub}>A note with tags and an embedded picture; searchable and linkable</div>
          </button>
          <button style={row} disabled={busy} onClick={() => run(() => onExport({ drawing: true }), saved)}>
            Save editable drawing
            <div style={sub}>One .excalidraw.md file: notes on top, drawing below (Obsidian Excalidraw plugin). Close it in Obsidian before exporting again.</div>
          </button>
          <button style={row} disabled={busy} onClick={() => run(onCopy, () => "Markdown copied to the clipboard")}>
            Copy Markdown
          </button>
          <div style={{ padding: "8px 10px 2px", fontSize: 11, color: "#868e96", wordBreak: "break-all" }}>
            {info ? <>Saves to <b>{info.dir}</b>. Set EXCALIDRAW_EXPORT_DIR to use your vault.</> : "…"}
          </div>
          {result && <div style={{ padding: "6px 10px", fontSize: 12, color: result.ok ? "#2f9e44" : "#c92a2a", wordBreak: "break-word" }}>{busy ? "Working…" : result.text}</div>}
        </div>
      )}
    </span>
  );
}
