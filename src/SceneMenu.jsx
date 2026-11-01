import React, { useState } from "react";

const btn = { border: "1px solid #ced4da", borderRadius: 8, padding: "5px 9px", fontSize: 13, background: "#fff", cursor: "pointer", color: "#343a40" };

// Scenes are plain .excalidraw files in the scenes folder; history is the server's snapshots of earlier saves.
export default function SceneMenu({ scenes, current, status, onSwitch, onNew, onLoadVersions, onRestore }) {
  const [versions, setVersions] = useState(null);

  async function toggleHistory() {
    if (versions) return setVersions(null);
    setVersions(await onLoadVersions());
  }

  return (
    <div
      style={{
        position: "absolute", top: 64, right: 16, zIndex: 10, display: "flex", gap: 6, alignItems: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {status && <span style={{ fontSize: 12, color: status.startsWith("Save failed") ? "#c92a2a" : "#868e96" }}>{status}</span>}
      <select value={current} onChange={(e) => onSwitch(e.target.value)} style={{ ...btn, maxWidth: 160 }} title="Scene (saved as .excalidraw files)">
        {scenes.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
      <button style={btn} onClick={onNew} title="New scene">＋</button>
      <button style={btn} onClick={toggleHistory} title="Earlier saved versions of this scene">🕘</button>
      {versions && (
        <div
          style={{
            position: "absolute", top: 36, right: 0, background: "#fff", border: "1px solid #ced4da", borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,.15)", padding: 6, width: 230, maxHeight: 280, overflow: "auto",
          }}
        >
          {versions.length === 0 && <div style={{ fontSize: 12, color: "#868e96", padding: 6 }}>No earlier versions yet.</div>}
          {versions.map((ts) => (
            <button
              key={ts}
              style={{ ...btn, display: "block", width: "100%", textAlign: "left", border: "none", fontSize: 12 }}
              onClick={async () => {
                await onRestore(ts);
                setVersions(null);
              }}
            >
              {new Date(ts).toLocaleString()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
