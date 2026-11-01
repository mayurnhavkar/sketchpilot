import React, { useState } from "react";
import { IconButton, Select } from "./ui.jsx";

const row = { border: "none", background: "transparent", borderRadius: 6, padding: "7px 10px", fontSize: 12, cursor: "pointer", color: "#343a40", display: "block", width: "100%", textAlign: "left" };

// Scenes are plain .excalidraw files in the scenes folder; history is the server's snapshots of earlier saves.
export default function SceneMenu({ scenes, current, status, onSwitch, onNew, onLoadVersions, onRestore, extra }) {
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
      <Select
        value={current} onChange={onSwitch} title="Scene (saved as .excalidraw files)" style={{ maxWidth: 190 }}
        options={scenes.map((x) => ({ value: x.name, label: x.name }))}
      />
      <IconButton icon="plus" title="New scene" onClick={onNew} />
      <IconButton icon="history" title="Earlier saved versions of this scene" onClick={toggleHistory} />
      {extra}
      {versions && (
        <div
          style={{
            position: "absolute", top: 40, right: 0, background: "#fff", border: "1px solid #ced4da", borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,.15)", padding: 6, width: 230, maxHeight: 280, overflow: "auto",
          }}
        >
          {versions.length === 0 && <div style={{ fontSize: 12, color: "#868e96", padding: 6 }}>No earlier versions yet.</div>}
          {versions.map((ts) => (
            <button
              key={ts}
              style={row}
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
