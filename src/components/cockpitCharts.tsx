// cockpitCharts.tsx — wiederverwendbarer Chart-/Cockpit-Baukasten (reines SVG, kein Package) für
// Tab AVOR und spätere Cockpits. Farben nach validierter Referenzpalette (dataviz-Skill, Light only
// — die App hat aktuell keinen Dark-Mode).
import { useState, useEffect, useRef } from "react";
import { nsKey } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, getKW } from "./kalenderHelpers";

const MIN_PX_TAG = 0.3, MAX_PX_TAG = 40;
const MONAT_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WE_BG = "#f2f3f5"; // Wochenende/Feiertag-Hintergrund, wie im Gantt
const HEAD_H = 30; // Höhe der Datums-Kopfzeile (Monat/Jahr + KW bzw. Tageszahlen), wie im GanttChart

/** Kleine Zoom-Bedienung (Lupe +/−), unten rechts über einem Zeitachsen-Diagramm platziert —
 *  gemeinsam genutzt von TimeSeriesChart und GanttChart. right/bottom sind bewusst größer als der
 *  Button selbst, damit die Gruppe nicht auf dem nativen Scrollbar (horizontal am Diagramm-Fuß,
 *  vertikal am Tab-Rand) sitzt, sondern knapp oberhalb/links davon mit etwas Luft dazu endet. Der
 *  Hilfe-Tooltip zum Strg-Mausrad-Zoom erscheint jetzt beim Hover über +/− statt über einem eigenen
 *  „?"-Icon. */
export function ZoomControls({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  const [hilfeOffen, setHilfeOffen] = useState(false);
  const btnStyle: React.CSSProperties = { width: 20, height: 20, lineHeight: "18px", padding: 0, border: "1px solid #d4dce4", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#555", borderRadius: 2 };
  return (
    <div style={{ position: "absolute", right: 18, bottom: 18, display: "flex", alignItems: "center", gap: 3, zIndex: 6 }}
      onMouseEnter={() => setHilfeOffen(true)} onMouseLeave={() => setHilfeOffen(false)}>
      {hilfeOffen && (
        <div style={{ position: "absolute", bottom: "125%", right: 0, background: "#333", color: "#fff", fontSize: 10,
          padding: "5px 8px", borderRadius: 4, whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(0,0,0,.25)", zIndex: 10 }}>
          Strg + Mausrad zum Zoomen
        </div>
      )}
      <button type="button" onClick={onZoomOut} title="Verkleinern" style={btnStyle}>−</button>
      <button type="button" onClick={onZoomIn} title="Vergrößern" style={btnStyle}>+</button>
    </div>
  );
}

/** ISO-Datum (YYYY-MM-DD) ohne UTC-Verschiebung in ein lokales Date parsen. */
function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Misst die tatsächliche Pixelbreite eines Containers, damit die SVG-viewBox exakt dazu passt
 * (sonst verzerrt preserveAspectRatio bei ungleichem Seitenverhältnis die Achsentexte). */
export function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

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
  markerIdx?: number | null; // Index in tage[] für eine dauerhafte Markierung (z.B. "Heute")
  markerLabel?: string;
  kalender?: Kalender; // für Wochenend-/Feiertag-Schattierung; ohne wird nur Sa/So schattiert
  /** Gemeinsamer Zoom-/Scroll-Zustand mehrerer Charts auf derselben Zeitachse (siehe Tab AVOR) —
   *  Mausrad zoomt zum Cursor wie im Gantt, Achse wechselt Monate → Wochen → Tage. Ohne diese Props
   *  verwaltet der Chart Zoom/Scroll selbst (Einzeldiagramm, initial auf Containerbreite eingepasst). */
  pxProTag?: number;
  onPxProTagChange?: (px: number) => void;
  scrollTag?: number;
  onScrollChange?: (tag: number) => void;
}

const ML = 44, MR = 8, MT = 16, MB = 20;

export function TimeSeriesChart({ tage, serien, modus, referenzlinie, einheit = "", hoehe = 180, formatWert, markerIdx, markerLabel = "Heute", kalender,
  pxProTag: pxProTagProp, onPxProTagChange: onPxProTagChangeProp, scrollTag: scrollTagProp, onScrollChange: onScrollChangeProp }: TimeSeriesProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [outerRef, viewportW] = useMeasuredWidth<HTMLDivElement>(1000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const fmt = formatWert ?? ((v: number) => v.toLocaleString("de-CH", { maximumFractionDigits: 1 }));

  const n = tage.length;

  // Unkontrollierter Fallback: eigener Zoom/Scroll, initial auf Containerbreite eingepasst (wie Gantt)
  const [localPx, setLocalPx] = useState(0);
  const [localScroll, setLocalScroll] = useState(0);
  const localInitDone = useRef(false);
  useEffect(() => {
    if (pxProTagProp !== undefined || localInitDone.current || viewportW === 0 || n === 0) return;
    localInitDone.current = true;
    setLocalPx(Math.max(MIN_PX_TAG, Math.min(10, viewportW / n)));
  }, [pxProTagProp, viewportW, n]);
  const pxProTag = pxProTagProp ?? (localPx || 6);
  const onPxProTagChange = onPxProTagChangeProp ?? setLocalPx;
  const scrollTag = scrollTagProp ?? localScroll;
  const onScrollChange = onScrollChangeProp ?? setLocalScroll;

  const VBW = Math.max(n * pxProTag, viewportW);
  const innerH = hoehe - MT - MB;
  const x = (i: number) => ML + i * pxProTag;

  // Mausrad + Strg = Zoom zum Cursor (wie GanttChart); ohne Strg scrollt das Rad normal, statt den
  // Zeitmaßstab zu verstellen.
  useEffect(() => {
    const el = scrollRef.current; if (!el || n === 0) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const tagAmCursor = (el.scrollLeft + mouseX) / pxProTag;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const neuPx = Math.max(MIN_PX_TAG, Math.min(MAX_PX_TAG, pxProTag * factor));
      onPxProTagChange(neuPx);
      onScrollChange(tagAmCursor - mouseX / neuPx);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [pxProTag, onPxProTagChange, onScrollChange, n]);

  // Zoom-Buttons: wie Mausrad-Zoom, aber zentriert auf die Mitte des sichtbaren Ausschnitts
  function zoomBy(factor: number) {
    const el = scrollRef.current; if (!el) return;
    const centerX = el.clientWidth / 2;
    const tagAmZentrum = (el.scrollLeft + centerX) / pxProTag;
    const neuPx = Math.max(MIN_PX_TAG, Math.min(MAX_PX_TAG, pxProTag * factor));
    onPxProTagChange(neuPx);
    onScrollChange(tagAmZentrum - centerX / neuPx);
  }

  // Scrollposition synchron zum gemeinsamen scrollTag halten (auch bei manuellem Scrollen anderer
  // Charts). Das programmatische Setzen von scrollLeft löst selbst ein "scroll"-Event aus — ohne
  // suppressScroll würde onChartScroll das als Nutzeraktion werten, onScrollChange erneut aufrufen
  // und so alle Charts endlos gegenseitig aufschaukeln (sichtbares "Zittern" beim Scrollen).
  const suppressScroll = useRef(false);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const ziel = Math.max(0, scrollTag * pxProTag);
    if (Math.abs(el.scrollLeft - ziel) > 0.5) {
      suppressScroll.current = true;
      el.scrollLeft = ziel;
      if (headerRef.current) headerRef.current.scrollLeft = ziel;
      setTimeout(() => { suppressScroll.current = false; }, 50);
    }
  }, [scrollTag, pxProTag]);

  function onChartScroll() {
    if (headerRef.current && scrollRef.current) headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
    if (suppressScroll.current) return;
    const el = scrollRef.current; if (!el) return;
    onScrollChange(el.scrollLeft / pxProTag);
  }

  if (n === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

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
    const mouseX = e.clientX - rect.left;
    const idx = Math.round((mouseX - ML) / pxProTag);
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

  // Zeitachse: Monate immer, Wochen-/Tagesticks erst ab genügend Zoom (analog GanttChart-Schwellen)
  const startDate = parseIsoLocal(tage[0]);
  const zeigeWochen = pxProTag >= 1.5;
  const zeigeTage = pxProTag >= 10;
  const monatTicks: { x: number; label: string }[] = [];
  const wochenTicks: { x: number; label: string }[] = [];
  const tagTicks: { x: number; label: string }[] = [];
  const weekendBands: { x: number; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    if (i === 0 || d.getDate() === 1) monatTicks.push({ x: x(i), label: `${MONAT_KURZ[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    if (zeigeWochen && d.getDay() === 1) wochenTicks.push({ x: x(i), label: `KW ${getKW(d)}` });
    if (zeigeTage) tagTicks.push({ x: x(i), label: String(d.getDate()) });
    const frei = kalender ? !istArbeitstag(tage[i], kalender) : (d.getDay() === 0 || d.getDay() === 6);
    if (frei) weekendBands.push({ x: x(i), w: pxProTag });
  }
  // Zu eng stehende Achsenticks weglassen statt überlappenden Text zu zeichnen — sonst laufen sich
  // bei einem langen Projektzeitraum und geringem Zoom die Monatslabels ineinander.
  const entzerrt = (ticks: { x: number; label: string }[], mindestabstand: number) => {
    const out: typeof ticks = [];
    let letztesX = -Infinity;
    for (const t of ticks) { if (t.x - letztesX >= mindestabstand) { out.push(t); letztesX = t.x; } }
    return out;
  };
  const monatTicksAnzeige = entzerrt(monatTicks, 42);
  const wochenTicksAnzeige = entzerrt(wochenTicks, 32);
  const tagTicksAnzeige = entzerrt(tagTicks, 14);

  const zeigeLegende = serien.length >= 2;

  return (
    <div ref={outerRef} style={{ position: "relative" }}>
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
      <div style={{ position: "relative" }}>
        {/* Kopfzeile: Monat/Jahr + KW bzw. Tageszahlen, wie im GanttChart — eigener Scroll-Container,
            synchron zum Diagramm gehalten (siehe onChartScroll/scrollTag-Effekt oben). */}
        <div ref={headerRef} style={{ overflow: "hidden", background: "#f5f7f9", borderBottom: `1px solid ${FARBEN.gridline}` }}>
          <svg width={VBW} height={HEAD_H} style={{ display: "block" }}>
            {monatTicks.map((t, i) => (
              <line key={`hml${i}`} x1={t.x} y1={0} x2={t.x} y2={HEAD_H} stroke="#aab4bd" strokeWidth={1.4} />
            ))}
            {monatTicksAnzeige.map((t, i) => (
              <text key={`hm${i}`} x={t.x + 4} y={13} fontSize={10} fontWeight={600} fontFamily="var(--tc-font)" fill={FARBEN.textSekundaer}>{t.label}</text>
            ))}
            {zeigeTage ? tagTicksAnzeige.map((t, i) => (
              <text key={`ht${i}`} x={t.x + pxProTag / 2} y={HEAD_H - 4} textAnchor="middle" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{t.label}</text>
            )) : wochenTicksAnzeige.map((t, i) => (
              <text key={`hw${i}`} x={t.x + 2} y={HEAD_H - 4} fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{t.label}</text>
            ))}
          </svg>
        </div>
        <div ref={scrollRef} onScroll={onChartScroll} style={{ overflowX: "auto", overflowY: "hidden" }}>
          <svg width={VBW} height={hoehe} viewBox={`0 0 ${VBW} ${hoehe}`}
            onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)} style={{ display: "block", cursor: "crosshair" }}>
            {weekendBands.map((b, i) => <rect key={`we${i}`} x={b.x} y={MT} width={b.w} height={innerH} fill={WE_BG} />)}
            <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{fmt(maxY)}</text>
            <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>0</text>
            {/* Monats-Linien durchgehend dicker als sonstige Hilfslinien, damit der Monatswechsel auffällt */}
            {monatTicks.map((t, i) => (
              <line key={`ml${i}`} x1={t.x} y1={MT} x2={t.x} y2={hoehe - MB} stroke="#aab4bd" strokeWidth={1.4} />
            ))}
            {referenzlinie && (<>
              <line x1={ML} y1={y(referenzlinie.wert)} x2={VBW - MR} y2={y(referenzlinie.wert)}
                stroke={FARBEN.status.critical} strokeWidth={1} strokeDasharray="4 3" />
              <text x={VBW - MR} y={y(referenzlinie.wert) - 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.status.critical}>
                {referenzlinie.label}: {fmt(referenzlinie.wert)} {einheit}
              </text>
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
            {markerIdx !== null && markerIdx !== undefined && markerIdx >= 0 && markerIdx < n && (
              <g>
                <line x1={x(markerIdx)} y1={MT} x2={x(markerIdx)} y2={hoehe - MB} stroke={FARBEN.status.warning} strokeWidth={1.5} />
                <text x={x(markerIdx)} y={MT - 5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="var(--tc-font)" fill={FARBEN.status.warning}>{markerLabel}</text>
              </g>
            )}
          </svg>
        </div>
        {hoverIdx !== null && (
          <div style={{
            position: "absolute", top: 4, left: Math.min(Math.max(x(hoverIdx) - scrollTag * pxProTag, 70), Math.max(viewportW - 70, 70)),
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
            {referenzlinie && (
              <div style={{ color: FARBEN.status.critical }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: FARBEN.status.critical, marginRight: 4 }} />
                {referenzlinie.label}: {fmt(referenzlinie.wert)} {einheit}
              </div>
            )}
          </div>
        )}
        <ZoomControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} />
      </div>
    </div>
  );
}

/** Persistiert (localStorage, Projekt-namespaced) den gemeinsamen Zoom-Level mehrerer TimeSeriesChart
 *  auf derselben Zeitachse — passt sich beim ersten Rendern an die verfügbare Breite an (wie Gantt). */
export function useChartZoom(projectId: string | null | undefined, namespace: string, tageAnzahl: number) {
  const lsKey = nsKey(`4d-cockpit-zoom-${namespace}`, projectId ?? null);
  const [pxProTag, setPxProTag] = useState(() => {
    try { const raw = Number(localStorage.getItem(lsKey)); return raw > 0 ? raw : 0; } catch { return 0; }
  });
  const [scrollTag, setScrollTag] = useState(0);
  const [outerRef, breite] = useMeasuredWidth<HTMLDivElement>(0);
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current || pxProTag > 0 || breite === 0 || tageAnzahl <= 0) return;
    initDone.current = true;
    setPxProTag(Math.max(MIN_PX_TAG, Math.min(10, breite / tageAnzahl)));
  }, [breite, tageAnzahl, pxProTag]);
  useEffect(() => { if (pxProTag > 0) { try { localStorage.setItem(lsKey, String(pxProTag)); } catch { /* ignore */ } } }, [pxProTag, lsKey]);
  return { pxProTag: pxProTag || 6, setPxProTag, scrollTag, setScrollTag, breitenRef: outerRef };
}

/** Persistiert (localStorage, Projekt-namespaced) die frei einstellbare Höhe eines Cockpit-Diagramms. */
export function useChartHoehe(projectId: string | null | undefined, key: string, standard = 180) {
  const lsKey = nsKey(`4d-cockpit-hoehe-${key}`, projectId ?? null);
  const [hoehe, setHoehe] = useState(() => {
    try { const raw = Number(localStorage.getItem(lsKey)); return raw > 0 ? raw : standard; } catch { return standard; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey, String(hoehe)); } catch { /* ignore */ } }, [hoehe, lsKey]);
  return [hoehe, setHoehe] as const;
}

/** Ziehbarer Balken unterhalb eines Diagramms zum Verändern seiner Höhe (wie Bauteil-/Gantt-Listen). */
export function ChartResizeHandle({ hoehe, setHoehe, min = 100, max = 640 }: { hoehe: number; setHoehe: (h: number) => void; min?: number; max?: number }) {
  return (
    <div
      style={{ height: 8, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}
      onMouseDown={e => {
        e.preventDefault();
        const startY = e.clientY, startH = hoehe;
        const onMove = (ev: MouseEvent) => setHoehe(Math.max(min, Math.min(max, startH + ev.clientY - startY)));
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      }}
    >
      <div style={{ width: 40, height: 3, background: "#ccc", borderRadius: 2 }} />
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
  const [containerRef, VBW] = useMeasuredWidth<HTMLDivElement>(1000);
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
      <div ref={containerRef} style={{ minWidth: engeKategorien ? n * 60 : undefined, position: "relative" }}>
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
        <svg viewBox={`0 0 ${VBW} ${hoehe}`} width="100%" height={hoehe} style={{ display: "block" }}>
          <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
          <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
          <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{fmt(maxY)}</text>
          <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>0</text>
          {kategorien.map((kat, ki) => (
            <text key={ki} x={ML + ki * gruppenBreite + gruppenBreite / 2} y={hoehe - 4} textAnchor="middle" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{kat}</text>
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
    <div style={{ border: `1px solid ${FARBEN.gridline}`, background: FARBEN.surface, padding: "8px 12px", minWidth: 120, flex: 1 }}>
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
