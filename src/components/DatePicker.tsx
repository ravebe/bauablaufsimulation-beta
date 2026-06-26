import { useState, useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (val: string) => void;
  label?: string;
}

const TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONATE = ["JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI", "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"];

function parseDMY(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}
function fmtDMY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

const CAL_W = 224;
const CAL_H = 280;

export default function DatePicker({ value, onChange }: Props) {
  const [offen, setOffen] = useState(false);
  const parsed = parseDMY(value);
  const [monat, setMonat] = useState(parsed?.getMonth() ?? new Date().getMonth());
  const [jahr, setJahr] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!offen) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [offen]);

  useEffect(() => {
    if (offen && parsed) { setMonat(parsed.getMonth()); setJahr(parsed.getFullYear()); }
    if (offen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceRight = window.innerWidth - r.left;
      const p: typeof pos = {};
      if (spaceBelow < CAL_H && r.top > CAL_H) p.bottom = r.height + 2; else p.top = r.height + 2;
      if (spaceRight < CAL_W) p.right = 0; else p.left = 0;
      setPos(p);
    }
  }, [offen]);

  const ersterTag = new Date(jahr, monat, 1).getDay();
  const tageImMonat = new Date(jahr, monat + 1, 0).getDate();
  const heute = new Date();

  function prev() { if (monat === 0) { setMonat(11); setJahr(j => j - 1); } else setMonat(m => m - 1); }
  function next() { if (monat === 11) { setMonat(0); setJahr(j => j + 1); } else setMonat(m => m + 1); }
  function waehlen(tag: number) { onChange(fmtDMY(new Date(jahr, monat, tag))); setOffen(false); }

  const zellen: (number | null)[] = [];
  for (let i = 0; i < ersterTag; i++) zellen.push(null);
  for (let d = 1; d <= tageImMonat; d++) zellen.push(d);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button ref={btnRef} onClick={e => { e.stopPropagation(); setOffen(o => !o); }}
        style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 2px", fontSize: 11, color: "#2d7dbd", display: "inline-flex", alignItems: "center", gap: 3 }}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#2d7dbd" strokeWidth="1.3">
          <rect x="1" y="3" width="14" height="12" rx="1.5" /><line x1="1" y1="7" x2="15" y2="7" />
          <line x1="4.5" y1="1" x2="4.5" y2="5" /><line x1="11.5" y1="1" x2="11.5" y2="5" />
        </svg>
        <span>{value || "—"}</span>
      </button>

      {offen && (
        <div style={{
          position: "absolute", zIndex: 200, ...pos,
          background: "#1a3a5c", color: "#fff", borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,.35)", width: CAL_W, fontFamily: "Segoe UI, sans-serif", userSelect: "none",
        }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px 6px" }}>
            <button onClick={prev} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>◀</button>
            <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>{MONATE[monat]} {jahr}</span>
            <button onClick={next} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>▶</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", padding: "4px 8px", gap: 0 }}>
            {TAGE.map(t => <div key={t} style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.6)", padding: 2 }}>{t}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", padding: "0 8px 8px", gap: 1 }}>
            {zellen.map((tag, i) => {
              if (tag === null) return <div key={`e${i}`} />;
              const d = new Date(jahr, monat, tag);
              const istH = d.toDateString() === heute.toDateString();
              const istG = parsed && d.toDateString() === parsed.toDateString();
              return (
                <button key={tag} onClick={() => waehlen(tag)} style={{
                  width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: istG || istH ? 700 : 400, margin: "auto",
                  background: istG ? "#3a7bd5" : istH ? "rgba(255,255,255,.15)" : "transparent",
                  color: istG ? "#fff" : istH ? "#90caf9" : "rgba(255,255,255,.85)",
                  outline: istH && !istG ? "1.5px solid #90caf9" : "none",
                }}>{tag}</button>
              );
            })}
          </div>
          <button onClick={() => { setMonat(heute.getMonth()); setJahr(heute.getFullYear()); waehlen(heute.getDate()); }}
            style={{ display: "block", width: "100%", padding: "8px 0", background: "rgba(255,255,255,.08)",
              border: "none", borderTop: "1px solid rgba(255,255,255,.15)", color: "#90caf9",
              cursor: "pointer", fontSize: 12, fontWeight: 600, borderRadius: "0 0 6px 6px" }}>Heute</button>
        </div>
      )}
    </div>
  );
}