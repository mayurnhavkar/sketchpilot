import React, { useEffect, useRef, useState } from "react";
import "./ui.css";

// one icon family (24px grid, 1.75 stroke, rounded), drawn inline so it matches in every browser
const PATHS = {
  chevron: <polyline points="6 9 12 15 18 9" />,
  check: <polyline points="5 12.5 10 17.5 19 7.5" />,
  paperclip: <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name, size = 16, className, style }) {
  return (
    <svg
      className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function IconButton({ icon, title, onClick, disabled, size = 16 }) {
  return (
    <button type="button" className="ec-ctl ec-iconbtn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// options: [{ value, label }]
export function Select({ value, onChange, options, title, disabled, style }) {
  return (
    <span className="ec-select" style={style}>
      <select className="ec-ctl" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} title={title} aria-label={title}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevron" size={14} className="ec-chev" />
    </span>
  );
}

// Free-text model id with a visible chevron that opens the list. Typing filters it; any id may be entered.
export function ModelCombo({ value, onChange, options, placeholder, disabled, title, popup = "up", block = false }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false); // only filter once the user has typed
  const [active, setActive] = useState(-1);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const q = value.trim().toLowerCase();
  const unique = [...new Set(options)]; // a provider may list a model twice
  const shown = filter && q ? unique.filter((o) => o.toLowerCase().includes(q)) : unique;

  const choose = (v) => {
    onChange(v);
    setOpen(false);
    setFilter(false);
  };
  const toggle = () => {
    setOpen((o) => !o);
    setFilter(false);
    setActive(Math.max(0, unique.indexOf(value)));
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return toggle();
      const n = shown.length;
      if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
      e.preventDefault();
      e.stopPropagation();
      choose(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span className={`ec-combo${block ? " block" : ""}`} ref={root}>
      <input
        className="ec-ctl"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        aria-label={title}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setFilter(true);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="ec-chevbtn" tabIndex={-1} disabled={disabled} onClick={toggle} title="Show models" aria-label="Show models">
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className={`ec-pop${popup === "down" ? " down" : ""}`} role="listbox">
          {shown.length === 0 ? (
            <div className="ec-empty">
              {unique.length ? "No match. Press Enter to use what you typed." : "This provider did not list its models. Type any model id."}
            </div>
          ) : (
            shown.map((o, i) => (
              <div
                key={o} role="option" aria-selected={o === value} className="ec-opt" data-active={i === active}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              >
                <span className="ec-check">{o === value && <Icon name="check" size={14} />}</span>
                {o}
              </div>
            ))
          )}
        </div>
      )}
    </span>
  );
}
