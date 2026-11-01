// Finding, tagging and recognising notes already on the canvas. All elements of one note share an id prefix
// (`nt<time>_`); the spec rides along in the customData of its first element, like AWS diagrams.
export const NOTES_HINT = /\b(notes?|cheat ?sheets?|study guide|flash ?cards?|revision|lecture|summari[sz]e|summary of|write[- ]?up)\b/i;

const live = (els) => els.filter((e) => !e.isDeleted);
export const notePrefixOf = (id) => (typeof id === "string" && /^nt[0-9a-z]{9}_/.test(id) ? id.slice(0, id.indexOf("_") + 1) : null);

// -> [{ prefix, spec, origin: {x, y}, ids }] (oldest first)
export function listNotes(elements) {
  const els = live(elements);
  const out = [];
  for (const e of els) {
    if (!e.customData?.notesSpec) continue;
    const prefix = notePrefixOf(e.id);
    if (!prefix) continue;
    let spec;
    try { spec = JSON.parse(e.customData.notesSpec); } catch { continue; }
    const mine = els.filter((x) => x.id.startsWith(prefix));
    out.push({
      prefix, spec, ids: mine.map((x) => x.id),
      origin: { x: Math.min(...mine.map((x) => x.x)), y: Math.min(...mine.map((x) => x.y)) },
    });
  }
  return out.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// The note being edited: the one containing the selection, else `lastPrefix`, else the newest.
export function findNote(elements, selectedIds = new Set(), lastPrefix = null) {
  const all = listNotes(elements);
  if (!all.length) return { note: null, selected: false };
  for (const id of selectedIds) {
    const p = notePrefixOf(id);
    const hit = p && all.find((d) => d.prefix === p);
    if (hit) return { note: hit, selected: true };
  }
  const last = lastPrefix && all.find((d) => d.prefix === lastPrefix);
  return { note: last || all[all.length - 1], selected: false };
}

export function tagNotes(created, prefix, spec) {
  const json = JSON.stringify(spec);
  const i = created.findIndex((e) => e.id.startsWith(prefix));
  return i < 0 ? created : created.map((e, j) => (j === i ? { ...e, customData: { ...(e.customData || {}), notesSpec: json } } : e));
}
