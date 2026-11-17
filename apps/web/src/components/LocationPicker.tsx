import { useEffect, useMemo, useRef, useState } from "react";
import { useAreas } from "../lib/queries";
import type { Area } from "../lib/types";
import { ChevronIcon, CheckIcon, PinIcon, SearchIcon } from "./icons";

const KEY = "cm_area";
export const stateLabel = (s: string) => (s === "FCT" ? "FCT (Abuja)" : s);
export const statesOf = (areas: Area[]) => [...new Set(areas.map((a) => a.state))];

export function rememberedArea(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
/** Closest launched area to a map pin, so dropping a pin fills in the dropdowns. */
export function nearestArea(areas: Area[], lat: number, lng: number): Area | null {
  let best: Area | null = null, bd = Infinity;
  for (const a of areas) { const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2; if (d < bd) { bd = d; best = a; } }
  return best && Math.sqrt(bd) < 0.5 ? best : null;
}

function AreaCombobox({ id, areas, value, onChange, disabled, placeholder, invalid }: { id: string; areas: Area[]; value: string; onChange: (id: string) => void; disabled?: boolean; placeholder: string; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const current = areas.find((a) => a.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return areas.filter((a) => !s || a.name.toLowerCase().includes(s) || a.city.toLowerCase().includes(s));
  }, [areas, q]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  return (
    <div ref={box} className="relative">
      <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`input flex items-center justify-between gap-2 text-left disabled:bg-surface disabled:text-muted ${invalid ? "!border-danger" : ""}`}>
        <span className={`flex items-center gap-2 truncate ${current ? "" : "text-muted/70"}`}><PinIcon size={18} />{current ? `${current.name}, ${current.city}` : placeholder}</span>
        <ChevronIcon size={18} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2"><SearchIcon size={18} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search areas" aria-label="Search areas" className="w-full bg-transparent py-1 text-sm focus:outline-none" />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {list.length === 0 && <li className="px-4 py-3 text-sm text-muted">No area matches “{q}”.</li>}
            {list.map((a) => (
              <li key={a.id} role="option" aria-selected={a.id === value}>
                <button type="button" onClick={() => { onChange(a.id); setOpen(false); setQ(""); }} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface">
                  <span><b>{a.name}</b> <span className="text-muted">{a.city}</span></span>{a.id === value && <span className="text-brand"><CheckIcon size={16} /></span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** State first, then a searchable list of areas in that state. Only launched states appear. */
export function LocationPicker({ value, onChange, allowAny, onStateChange, initialState, exclude, remember = true, error, idPrefix = "loc", compact }: {
  value: string; onChange: (areaId: string) => void; allowAny?: boolean; onStateChange?: (s: string) => void; initialState?: string; exclude?: string[]; remember?: boolean; error?: string; idPrefix?: string; compact?: boolean;
}) {
  const all = useAreas().data ?? [];
  const areas = all.filter((a) => !exclude?.includes(a.id));
  const states = statesOf(all);
  const selected = all.find((a) => a.id === value);
  const [state, setState] = useState<string>(initialState ?? "");
  useEffect(() => { if (selected && selected.state !== state) setState(selected.state); }, [selected?.id]); // pin or saved choice fills the state
  useEffect(() => {
    if (value || !all.length) return;
    const r = remember ? all.find((a) => a.id === rememberedArea()) : undefined;
    if (r) { setState(r.state); onChange(r.id); }
    else if (!state && states.length === 1) setState(states[0] ?? "");
  }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  function pick(id: string) { onChange(id); if (remember && id) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } } }
  function pickState(s: string) { setState(s); onStateChange?.(s); if (selected && selected.state !== s) onChange(""); }
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
      <div>
        <label htmlFor={`${idPrefix}-state`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">State</label>
        <select id={`${idPrefix}-state`} className="input" value={state} onChange={(e) => pickState(e.target.value)}>
          <option value="">{allowAny ? "All states" : "Select state"}</option>
          {states.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-area`} className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Area</label>
        <AreaCombobox id={`${idPrefix}-area`} areas={areas.filter((a) => !state || a.state === state)} value={value} onChange={pick} disabled={!state && !allowAny}
          placeholder={state || allowAny ? (allowAny ? "Any area" : "Choose your area") : "Choose a state first"} invalid={!!error} />
      </div>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
    </div>
  );
}
