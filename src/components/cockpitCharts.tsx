// cockpitCharts.tsx — wiederverwendbarer Chart-/Cockpit-Baukasten (reines SVG, kein Package) für
// Tab AVOR und spätere Cockpits. Farben nach validierter Referenzpalette (dataviz-Skill, Light only
// — die App hat aktuell keinen Dark-Mode).
import { useState, useEffect } from "react";
import { nsKey } from "../types";

export const FARBEN = {
  kategorial: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  andere: "#898781",
  status: { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" },
  surface: "#fcfcfb",
  gridline: "#e1e0d9",
  achse: "#c3c2b7",
  textPrimaer: "#0b0b0b",
  textSekundaer: "#52514e",
  textMuted: "#898781",
};

export interface Serie { key: string; label: string; color: string; werte: number[] }

interface TimeSeriesProps {
  tage: string[]; // YYYY-MM-DD, gleiche Länge wie serien[].werte
  serien: Serie[];
  modus: "linie" | "flaeche-gestapelt";
  referenzlinie?: { wert: number; label: string };
  einheit?: string;
  hoehe?: number;
  formatWert?: (v: number) => string;
}

const VBW = 1000, ML = 40, MR = 8, MT = 10, MB = 20;

export function TimeSeriesChart({ tage, serien, modus, referenzlinie, einheit = "", hoehe = 180, formatWert }: TimeSeriesProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const fmt = formatWert ?? ((v: number) => v.toLocaleString("de-CH", { maximumFractionDigits: 1 }));

  if (tage.length === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

  const n = tage.length;
  const innerW = VBW - ML - MR;
  const innerH = hoehe - MT - MB;
  const x = (i: number) => ML + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  let maxY = referenzlinie?.wert ?? 0;
  if (modus === "flaeche-gestapelt") {
    for (let i = 0; i < n; i++) {
      let summe = 0;
      for (const s of serien) summe += s.werte[i] ?? 0;
      maxY = Math.max(maxY, summe);
    }
  } else {
    for (const s of serien) for (const w of s.werte) maxY = Math.max(maxY, w ?? 0);
  }
  if (maxY <= 0) maxY = 1;
  const y = (v: number) => MT + innerH - (v / maxY) * innerH;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  }

  const stackedPaths: { d: string; color: string; key: string }[] = [];
  if (modus === "flaeche-gestapelt") {
    let kumBase = new Array(n).fill(0);
    for (const s of serien) {
      const oben = kumBase.map((b, i) => b + (s.werte[i] ?? 0));
      const oberePunkte = oben.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
      const unterePunkte = [...kumBase].reverse().map((v, i) => `${x(n - 1 - i)},${y(v)}`).join(" L ");
      stackedPaths.push({ d: `M ${oberePunkte} L ${unterePunkte} Z`, color: s.color, key: s.key });
      kumBase = oben;
    }
  }

  const zeigeLegende = serien.length >= 2;
  const tickIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  return (
    <div style={{ position: "relative" }}>
      {zeigeLegende && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, color: FARBEN.textSekundaer, marginBottom: 4 }}>
          {serien.map(s => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${VBW} ${hoehe}`} width="100%" height={hoehe} preserveAspectRatio="none"
        onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)} style={{ display: "block", cursor: "crosshair" }}>
        <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
        <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
        <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fill={FARBEN.textMuted}>{fmt(maxY)}</text>
        <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fill={FARBEN.textMuted}>0</text>
        {tickIdx.map(i => (
          <text key={i} x={x(i)} y={hoehe - 4} textAnchor="middle" fontSize={9} fill={FARBEN.textMuted}>{tage[i].slice(5)}</text>
        ))}
        {referenzlinie && (<>
          <line x1={ML} y1={y(referenzlinie.wert)} x2={VBW - MR} y2={y(referenzlinie.wert)}
            stroke={FARBEN.status.critical} strokeWidth={1} strokeDasharray="4 3" />
          <text x={VBW - MR} y={y(referenzlinie.wert) - 3} textAnchor="end" fontSize={9} fill={FARBEN.status.critical}>{referenzlinie.label}</text>
        </>)}
        {modus === "flaeche-gestapelt" && stackedPaths.map(p => (
          <path key={p.key} d={p.d} fill={p.color} fillOpacity={0.85} stroke={FARBEN.surface} strokeWidth={1} />
        ))}
        {modus === "linie" && serien.map(s => (
          <path key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            d={s.werte.map((w, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(w ?? 0)}`).join(" ")} />
        ))}
        {hoverIdx !== null && (
          <line x1={x(hoverIdx)} y1={MT} x2={x(hoverIdx)} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} strokeDasharray="2 2" />
        )}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", top: 4, left: `${Math.min(Math.max((x(hoverIdx) / VBW) * 100, 14), 86)}%`,
          transform: "translateX(-50%)", background: "#fff", border: `1px solid ${FARBEN.gridline}`,
          boxShadow: "0 2px 6px rgba(0,0,0,.12)", padding: "5px 8px", fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
        }}>
          <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>{tage[hoverIdx]}</div>
          {serien.map(s => (
            <div key={s.key} style={{ color: FARBEN.textSekundaer }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: s.color, marginRight: 4 }} />
              {s.label}: {fmt(s.werte[hoverIdx] ?? 0)} {einheit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface KategorieSerie { key: string; label: string; color: string; werte: number[] }

interface CategoryBarProps {
  kategorien: string[]; // x-Achse, gleiche Länge wie serien[].werte
  serien: KategorieSerie[];
  einheit?: string;
  hoehe?: number;
  formatWert?: (v: number) => string;
}

/** Gruppierte Balken über einer kategorialen x-Achse (Kürzel/Gewerke statt Zeit). */
export function CategoryBarChart({ kategorien, serien, einheit = "", hoehe = 180, formatWert }: CategoryBarProps) {
  const [hover, setHover] = useState<{ ki: number; si: number } | null>(null);
  const fmt = formatWert ?? ((v: number) => v.toLocaleString("de-CH", { maximumFractionDigits: 1 }));

  if (kategorien.length === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

  const n = kategorien.length;
  const innerW = VBW - ML - MR;
  const innerH = hoehe - MT - MB;
  let maxY = 0;
  for (const s of serien) for (const w of s.werte) maxY = Math.max(maxY, w ?? 0);
  if (maxY <= 0) maxY = 1;
  const y = (v: number) => MT + innerH - (v / maxY) * innerH;

  const gruppenBreite = innerW / n;
  const pad = gruppenBreite * 0.15;
  const balkenBreite = (gruppenBreite - pad * 2) / serien.length;
  const zeigeLegende = serien.length >= 2;
  const engeKategorien = n > 10;

  return (
    <div style={{ overflowX: engeKategorien ? "auto" : "visible" }}>
      <div style={{ minWidth: engeKategorien ? n * 60 : undefined, position: "relative" }}>
        {zeigeLegende && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, color: FARBEN.textSekundaer, marginBottom: 4 }}>
            {serien.map(s => (
              <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
        <svg viewBox={`0 0 ${VBW} ${hoehe}`} width="100%" height={hoehe} preserveAspectRatio="none" style={{ display: "block" }}>
          <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
          <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
          <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fill={FARBEN.textMuted}>{fmt(maxY)}</text>
          <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fill={FARBEN.textMuted}>0</text>
          {kategorien.map((kat, ki) => (
            <text key={ki} x={ML + ki * gruppenBreite + gruppenBreite / 2} y={hoehe - 4} textAnchor="middle" fontSize={9} fill={FARBEN.textMuted}>{kat}</text>
          ))}
          {kategorien.map((_, ki) => serien.map((s, si) => {
            const w = s.werte[ki] ?? 0;
            const bx = ML + ki * gruppenBreite + pad + si * balkenBreite;
            const by = y(w);
            const bh = hoehe - MB - by;
            return (
              <rect key={`${ki}-${si}`} x={bx} y={by} width={Math.max(balkenBreite - 1, 1)} height={Math.max(bh, 0)}
                fill={s.color} rx={2} onMouseEnter={() => setHover({ ki, si })} onMouseLeave={() => setHover(null)} />
            );
          }))}
        </svg>
        {hover && (() => {
          const s = serien[hover.si];
          const bx = ML + hover.ki * gruppenBreite + pad + hover.si * balkenBreite + balkenBreite / 2;
          return (
            <div style={{
              position: "absolute", top: 4, left: `${Math.min(Math.max((bx / VBW) * 100, 10), 90)}%`,
              transform: "translateX(-50%)", background: "#fff", border: `1px solid ${FARBEN.gridline}`,
              boxShadow: "0 2px 6px rgba(0,0,0,.12)", padding: "5px 8px", fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
            }}>
              <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>{kategorien[hover.ki]}</div>
              <div style={{ color: FARBEN.textSekundaer }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: s.color, marginRight: 4 }} />
                {s.label}: {fmt(s.werte[hover.ki] ?? 0)} {einheit}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export function StatTile({ label, wert, status, sub }: { label: string; wert: string; status?: "good" | "warning" | "critical"; sub?: string }) {
  const farbe = status ? FARBEN.status[status] : FARBEN.textPrimaer;
  return (
    <div style={{ border: `1px solid ${FARBEN.gridline}`, padding: "8px 12px", minWidth: 120, flex: 1 }}>
      <div style={{ fontSize: 9, color: FARBEN.textMuted, fontWeight: 600, letterSpacing: ".3px", marginBottom: 3 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: farbe }}>{wert}</div>
      {sub && <div style={{ fontSize: 10, color: FARBEN.textSekundaer, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Persistiert (localStorage, Projekt-namespaced), welche Cockpit-Diagramme eingeklappt sind. */
export function useEingeklappt(projectId: string | null | undefined, namespace: string) {
  const lsKey = nsKey(`4d-cockpit-collapse-${namespace}`, projectId ?? null);
  const [eingeklappt, setEingeklappt] = useState<Record<string, boolean>>(() => {
    try { const raw = localStorage.getItem(lsKey); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey, JSON.stringify(eingeklappt)); } catch { /* ignore */ } }, [eingeklappt, lsKey]);
  function toggle(key: string) { setEingeklappt(prev => ({ ...prev, [key]: !prev[key] })); }
  return { eingeklappt, toggle };
}

/** Ein-/ausklappbarer Cockpit-Abschnitt (Diagramm-Titel mit Dreieck-Toggle, optional Aktionen rechts). */
export function CockpitAbschnitt({ titel, eingeklappt, onToggle, aktionen, children }: { titel: string; eingeklappt: boolean; onToggle: () => void; aktionen?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: eingeklappt ? 0 : 6 }}>
        <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", userSelect: "none" }}>
          <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${eingeklappt ? -90 : 0}deg)`, transition: "transform .15s", fontSize: 9, color: FARBEN.textMuted }}>▼</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: FARBEN.textMuted, letterSpacing: ".5px" }}>{titel.toUpperCase()}</span>
        </div>
        {aktionen}
      </div>
      {!eingeklappt && children}
    </div>
  );
}
