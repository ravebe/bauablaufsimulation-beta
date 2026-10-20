import { useState, useRef, useEffect } from "react";
import Schwebend from "./Schwebend";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag } from "./kalenderHelpers";
import type { Zeiteinheit } from "./zeitHelpers";
import { ARBEITSBEGINN_MIN, ARBEITSENDE_MIN, MITTAG_VON_MIN, MITTAG_BIS_MIN, minZuZeit, zeitOptionen as arbeitszeitOptionen } from "./zeitHelpers";

interface Props {
  value: string;
  /** min: gewählte Uhrzeit in Minuten (nur mit `zeit`, Zeiteinheit Halbtage/Uhrzeit) */
  onChange: (val: string, min?: number) => void;
  readOnly?: boolean;
  defaultOpen?: boolean;
  /** Ist der Schalter "Wochenenden, Feiertage und Ferien berücksichtigen" an, sind diese freien Tage ausgegraut und nicht wählbar */
  kalender?: Kalender;
  /** Zeiteinheit Halbtage/Uhrzeit: unter dem Kalender Vormittag/Nachmittag bzw. die Stunden wählen. Ein Tag wird dann nur
   *  vorgemerkt; ein Klick auf die Zeit oder "Übernehmen" übernimmt Datum und Zeit. */
  zeit?: { einheit: Zeiteinheit; art: "start" | "ende"; min: number };
  /** Kein eigener Text (z.B. im Gantt, wo das Datum schon am Balken steht) — nur der Kalender an dieser Stelle */
  ohneAnzeige?: boolean;
  /** Zusatz hinter dem Datum, z.B. " 13:00" oder " NM" */
  anzeigeZusatz?: string;
}

/** Wählbare Zeiten aus der Arbeitszeit (Tab Ressourcen): Halbtage Vormittag/Nachmittag, sonst Beginn, volle Stunden, Mittag, Ende */
function zeitOptionen(einheit: Zeiteinheit, art: "start" | "ende"): { min: number; label: string }[] {
  if (einheit === "halbtage") return art === "start"
    ? [{ min: ARBEITSBEGINN_MIN, label: "Vormittag" }, { min: MITTAG_BIS_MIN, label: "Nachmittag" }]
    : [{ min: MITTAG_VON_MIN, label: "Vormittag" }, { min: ARBEITSENDE_MIN, label: "Nachmittag" }];
  return arbeitszeitOptionen(einheit, art).map(m => ({ min: m, label: minZuZeit(m) }));
}
/** Welche Option entspricht der aktuellen Zeit (Halbtage: VM/NM-Hälfte, Uhrzeit: angefangene Stunde) */
function istZeitGewaehlt(einheit: Zeiteinheit, art: "start" | "ende", opt: number, min: number): boolean {
  if (einheit === "halbtage") {
    const nm = art === "start" ? min >= MITTAG_BIS_MIN : min > MITTAG_VON_MIN;
    return nm === (art === "start" ? opt >= MITTAG_BIS_MIN : opt > MITTAG_VON_MIN);
  }
  const optionen = arbeitszeitOptionen(einheit, art);
  const gewaehlt = art === "start" ? [...optionen].reverse().find(o => o <= min) ?? optionen[0] : optionen.find(o => o >= min) ?? optionen[optionen.length - 1];
  return gewaehlt === opt;
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

export default function DatePicker({ value, onChange, readOnly, defaultOpen, kalender, zeit, ohneAnzeige, anzeigeZusatz }: Props) {
  const [offen, setOffen] = useState(!!defaultOpen);
  const parsed = parseDMY(value);
  const mitZeit = !!zeit && zeit.einheit !== "tage";
  // Mit Zeitwahl: Tag nur vormerken, übernommen wird mit der Zeit bzw. "Übernehmen"
  const [vorgemerkt, setVorgemerkt] = useState<Date | null>(parsed);
  const [zeitMin, setZeitMin] = useState(zeit?.min ?? ARBEITSBEGINN_MIN);
  const [monat, setMonat] = useState(parsed?.getMonth() ?? new Date().getMonth());
  const [jahr, setJahr] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null); // Kalender hängt per Portal an body (Schwebend.tsx)

  useEffect(() => {
    if (!offen) return;
    const handler = (e: MouseEvent) => {
      const ziel = e.target as Node;
      if (ref.current && !ref.current.contains(ziel) && !menuRef.current?.contains(ziel)) setOffen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [offen]);

  useEffect(() => {
    if (offen && parsed) { setMonat(parsed.getMonth()); setJahr(parsed.getFullYear()); }
    if (offen) { setVorgemerkt(parsed); setZeitMin(zeit?.min ?? ARBEITSBEGINN_MIN); }
  }, [offen]);

  const ersterTag = new Date(jahr, monat, 1).getDay();
  const tageImMonat = new Date(jahr, monat + 1, 0).getDate();
  const heute = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const gesperrt = (d: Date) => !!kalender && !istArbeitstag(iso(d), kalender);

  function prev() { if (monat === 0) { setMonat(11); setJahr(j => j - 1); } else setMonat(m => m - 1); }
  function next() { if (monat === 11) { setMonat(0); setJahr(j => j + 1); } else setMonat(m => m + 1); }
  function waehlen(tag: number) {
    const d = new Date(jahr, monat, tag);
    if (mitZeit) { setVorgemerkt(d); return; }
    onChange(fmtDMY(d)); setOffen(false);
  }
  function uebernehmen(min: number) {
    const d = vorgemerkt ?? parsed;
    if (!d) return;
    onChange(fmtDMY(d), min); setOffen(false);
  }

  const zellen: (number | null)[] = [];
  for (let i = 0; i < ersterTag; i++) zellen.push(null);
  for (let d = 1; d <= tageImMonat; d++) zellen.push(d);

  if (readOnly) {
    return <span style={{ fontSize: 11, color: "#2d7dbd" }}>{value || "—"}</span>;
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span ref={triggerRef} onClick={e => { e.stopPropagation(); setOffen(o => !o); }}
        style={{ fontSize: 11, color: "#2d7dbd", cursor: "pointer" }}>
        {ohneAnzeige ? null : <>{value || "—"}{anzeigeZusatz}</>}
      </span>

      {offen && (
        <Schwebend anker={triggerRef} menuRef={menuRef} style={{
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
              const auswahl = mitZeit ? vorgemerkt : parsed;
              const istG = auswahl && d.toDateString() === auswahl.toDateString();
              const frei = gesperrt(d);
              return (
                <button key={tag} disabled={frei} title={frei ? "Arbeitsfrei (Wochenende, Feiertag oder Ferien) — nicht wählbar" : undefined} onClick={() => waehlen(tag)} style={{
                  width: 28, height: 28, borderRadius: "50%", border: "none", cursor: frei ? "not-allowed" : "pointer",
                  fontSize: 12, fontWeight: istG || istH ? 700 : 400, margin: "auto",
                  background: istG ? "#3a7bd5" : istH ? "rgba(255,255,255,.15)" : "transparent",
                  color: istG ? "#fff" : frei ? "rgba(255,255,255,.28)" : istH ? "#90caf9" : "rgba(255,255,255,.85)",
                  outline: istH && !istG ? "1.5px solid #90caf9" : "none",
                }}>{tag}</button>
              );
            })}
          </div>
          {mitZeit && zeit && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", padding: "8px 8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.6)", textAlign: "center", letterSpacing: 1, marginBottom: 6 }}>
                {zeit.einheit === "halbtage" ? (zeit.art === "start" ? "BEGINN" : "ENDE") : (zeit.art === "start" ? "BEGINN UM" : "ENDE UM")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: zeit.einheit === "halbtage" ? "1fr 1fr" : "repeat(4, 1fr)", gap: 4 }}>
                {zeitOptionen(zeit.einheit, zeit.art).map(o => {
                  const gew = istZeitGewaehlt(zeit.einheit, zeit.art, o.min, zeitMin);
                  return (
                    <button key={o.min} onClick={() => { setZeitMin(o.min); uebernehmen(o.min); }}
                      title={zeit.einheit === "halbtage" ? `${zeit.art === "start" ? "Beginnt" : "Endet"} um ${minZuZeit(o.min)}` : undefined}
                      style={{ height: 26, borderRadius: 13, border: "none", cursor: "pointer", fontSize: 12, fontWeight: gew ? 700 : 400,
                        background: gew ? "#3a7bd5" : "rgba(255,255,255,.08)", color: gew ? "#fff" : "rgba(255,255,255,.85)", fontFamily: "inherit" }}>{o.label}</button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,.15)" }}>
            <button disabled={gesperrt(heute)} onClick={() => { setMonat(heute.getMonth()); setJahr(heute.getFullYear()); waehlen(heute.getDate()); }}
              style={{ flex: 1, opacity: gesperrt(heute) ? 0.35 : 1, cursor: gesperrt(heute) ? "not-allowed" : "pointer", padding: "8px 0", background: "rgba(255,255,255,.08)",
                border: "none", color: "#90caf9",
                fontSize: 12, fontWeight: 600, borderRadius: mitZeit ? "0 0 0 6px" : "0 0 6px 6px" }}>Heute</button>
            {mitZeit && (
              <button onClick={() => uebernehmen(zeitMin)}
                style={{ flex: 1, cursor: "pointer", padding: "8px 0", background: "#3a7bd5", border: "none", color: "#fff",
                  fontSize: 12, fontWeight: 600, borderRadius: "0 0 6px 0" }}>Übernehmen</button>
            )}
          </div>
        </Schwebend>
      )}
    </div>
  );
}