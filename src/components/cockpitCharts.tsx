// cockpitCharts.tsx — wiederverwendbarer Chart-/Cockpit-Baukasten (reines SVG, kein Package) für
// Tab AVOR und spätere Cockpits. Farben nach validierter Referenzpalette (dataviz-Skill, Light only
// — die App hat aktuell keinen Dark-Mode).
import { useState, useEffect, useRef } from "react";
import { fmtZahl } from "./zahlFormat";
import { nsKey } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, getKW } from "./kalenderHelpers";

const MIN_PX_TAG = 0.3, MAX_PX_TAG = 40;
const MONAT_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WE_BG = "#f2f3f5"; // Wochenende/Feiertag-Hintergrund, wie im Gantt
const HEAD_H = 30; // Höhe der Datums-Kopfzeile (Monat/Jahr + KW bzw. Tageszahlen), wie im GanttChart
const WOCHEN_LINIE = "#cfd6dd"; // Wochentrennung bei ausgeblendeten Wochenenden — feiner als die Monatslinie (#aab4bd, 1.4)

/** Kleine Zoom-Bedienung (Lupe +/−), unten rechts über einem Zeitachsen-Diagramm platziert —
 *  gemeinsam genutzt von TimeSeriesChart und GanttChart. right/bottom sind bewusst größer als der
 *  Button selbst, damit die Gruppe nicht auf dem nativen Scrollbar (horizontal am Diagramm-Fuß,
 *  vertikal am Tab-Rand) sitzt, sondern knapp oberhalb/links davon mit etwas Luft dazu endet. Der
 *  Hilfe-Tooltip zum Strg-Mausrad-Zoom erscheint jetzt beim Hover über +/− statt über einem eigenen
 *  „?"-Icon. */
export function ZoomControls({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  const [hilfeOffen, setHilfeOffen] = useState(false);
  const btnStyle: React.CSSProperties = { width: 20, height: 20, lineHeight: "18px", padding: 0, border: "1px solid #d4dce4", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#555", borderRadius: 3 };
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

/** Mausrad+Strg-Zoom (zum Cursor) + Scroll-Synchronisation einer Zeitachse — gemeinsam genutzt von
 *  TimeSeriesChart und KranBalkenChart, damit mehrere Diagramme mit gemeinsamem pxProTag/scrollTag
 *  (siehe useChartZoom) exakt gleich auf Zoom/Scroll reagieren. suppressScroll verhindert, dass das
 *  programmatische Setzen von scrollLeft (beim Nachführen von scrollTag) selbst wieder als
 *  Nutzer-Scroll gewertet wird und sich mehrere Diagramme gegenseitig aufschaukeln. */
function useZeitachsenInteraktion(n: number, pxProTag: number, onPxProTagChange: (px: number) => void, scrollTag: number, onScrollChange: (tag: number) => void) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const suppressScroll = useRef(false);

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

  function zoomBy(factor: number) {
    const el = scrollRef.current; if (!el) return;
    const centerX = el.clientWidth / 2;
    const tagAmZentrum = (el.scrollLeft + centerX) / pxProTag;
    const neuPx = Math.max(MIN_PX_TAG, Math.min(MAX_PX_TAG, pxProTag * factor));
    onPxProTagChange(neuPx);
    onScrollChange(tagAmZentrum - centerX / neuPx);
  }

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

  return { scrollRef, headerRef, zoomBy, onChartScroll };
}

/** Sichtbare Tage einer Tagesreihe: idx = Original-Indizes der angezeigten Tage, posAb[i] = Anzahl
 *  sichtbarer Tage vor Original-Index i (Länge n+1) — x-Position von Tag i ist ML + posAb[i] × pxProTag.
 *  Mit ohneWochenenden fallen Sa/So weg (nur wenn sie laut Kalender arbeitsfrei sind, damit keine
 *  Wochenend-Arbeit verschwindet); ohne sind beide Indizes identisch. */
interface ZeitachsenPositionen { idx: number[]; posAb: number[] }
function zeitachsenPositionen(tage: string[], ohneWochenenden: boolean, kalender?: Kalender): ZeitachsenPositionen {
  const idx: number[] = [], posAb: number[] = [];
  for (let i = 0; i < tage.length; i++) {
    posAb.push(idx.length);
    const dow = parseIsoLocal(tage[i]).getDay();
    const wochenende = (dow === 0 || dow === 6) && (!kalender || !istArbeitstag(tage[i], kalender));
    if (!ohneWochenenden || !wochenende) idx.push(i);
  }
  posAb.push(idx.length);
  if (idx.length === 0 && tage.length > 0) return zeitachsenPositionen(tage, false, kalender);
  return { idx, posAb };
}

interface ZeitachsenTicks {
  monatTicks: { x: number; label: string }[];
  monatTicksAnzeige: { x: number; label: string }[];
  wochenTicksAnzeige: { x: number; label: string }[];
  tagTicksAnzeige: { x: number; label: string }[];
  weekendBands: { x: number; w: number }[];
  /** Trennlinien zwischen den Wochen — nur bei ausgeblendeten Wochenenden (sonst trennen die Wochenend-Bänder) */
  wochenLinien: number[];
  zeigeTage: boolean;
}

/** Monats-/Wochen-/Tages-Ticks + Wochenend-Bänder einer Tagesreihe — gemeinsam genutzt von
 *  TimeSeriesChart und KranBalkenChart, damit beide exakt dieselbe Kopfzeile/Gitternetzlinien zeigen. */
function berechneZeitachsenTicks(tage: string[], pxProTag: number, pos: ZeitachsenPositionen, ohneWochenenden: boolean, kalender?: Kalender): ZeitachsenTicks {
  const x = (p: number) => ML + p * pxProTag;
  const startDate = parseIsoLocal(tage[0]);
  const zeigeWochen = pxProTag >= 1.5;
  const zeigeTage = pxProTag >= 10;
  const monatTicks: { x: number; label: string }[] = [];
  const wochenTicks: { x: number; label: string }[] = [];
  const tagTicks: { x: number; label: string }[] = [];
  const weekendBands: { x: number; w: number }[] = [];
  const wochenLinien: number[] = [];
  const montag = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7).getTime();
  let vorher: Date | null = null;
  pos.idx.forEach((i, p) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    // Wechsel gegenüber dem vorherigen sichtbaren Tag (bei ausgeblendeten Wochenenden fehlen Sa/So, ggf. auch der Monatserste)
    const neuerMonat = !vorher || d.getMonth() !== vorher.getMonth();
    const neueWoche = vorher ? montag(d) !== montag(vorher) : d.getDay() === 1;
    if (neuerMonat) monatTicks.push({ x: x(p), label: `${MONAT_KURZ[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    if (zeigeWochen && neueWoche) wochenTicks.push({ x: x(p), label: `KW ${getKW(d)}` });
    if (ohneWochenenden && vorher && neueWoche) wochenLinien.push(x(p));
    if (zeigeTage) tagTicks.push({ x: x(p), label: String(d.getDate()) });
    const frei = kalender ? !istArbeitstag(tage[i], kalender) : (d.getDay() === 0 || d.getDay() === 6);
    if (frei) weekendBands.push({ x: x(p), w: pxProTag });
    vorher = d;
  });
  // Zu eng stehende Achsenticks weglassen statt überlappenden Text zu zeichnen — sonst laufen sich
  // bei einem langen Projektzeitraum und geringem Zoom die Monatslabels ineinander.
  const entzerrt = (ticks: { x: number; label: string }[], mindestabstand: number) => {
    const out: typeof ticks = [];
    let letztesX = -Infinity;
    for (const t of ticks) { if (t.x - letztesX >= mindestabstand) { out.push(t); letztesX = t.x; } }
    return out;
  };
  return {
    monatTicks,
    monatTicksAnzeige: entzerrt(monatTicks, 42),
    wochenTicksAnzeige: entzerrt(wochenTicks, 32),
    tagTicksAnzeige: entzerrt(tagTicks, 14),
    weekendBands,
    wochenLinien,
    zeigeTage,
  };
}

/** Datums-Kopfzeile (Monat/Jahr + KW bzw. Tageszahlen) über einem Zeitachsen-Diagramm — eigener
 *  Scroll-Container, synchron zum Diagramm gehalten (siehe useZeitachsenInteraktion). Gemeinsam
 *  genutzt von TimeSeriesChart und KranBalkenChart. */
function ZeitachsenKopf({ headerRef, VBW, ticks, pxProTag }: { headerRef: React.RefObject<HTMLDivElement | null>; VBW: number; ticks: ZeitachsenTicks; pxProTag: number }) {
  return (
    <div ref={headerRef} style={{ overflow: "hidden", background: "#f5f7f9", borderBottom: `1px solid ${FARBEN.gridline}` }}>
      <svg width={VBW} height={HEAD_H} style={{ display: "block" }}>
        {ticks.wochenLinien.map((wx, i) => (
          <line key={`hwl${i}`} x1={wx} y1={16} x2={wx} y2={HEAD_H} stroke={WOCHEN_LINIE} strokeWidth={0.8} />
        ))}
        {ticks.monatTicks.map((t, i) => (
          <line key={`hml${i}`} x1={t.x} y1={0} x2={t.x} y2={HEAD_H} stroke="#aab4bd" strokeWidth={1.4} />
        ))}
        {ticks.monatTicksAnzeige.map((t, i) => (
          <text key={`hm${i}`} x={t.x + 4} y={13} fontSize={10} fontWeight={600} fontFamily="var(--tc-font)" fill={FARBEN.textSekundaer}>{t.label}</text>
        ))}
        {ticks.zeigeTage ? ticks.tagTicksAnzeige.map((t, i) => (
          <text key={`ht${i}`} x={t.x + pxProTag / 2} y={HEAD_H - 4} textAnchor="middle" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{t.label}</text>
        )) : ticks.wochenTicksAnzeige.map((t, i) => (
          <text key={`hw${i}`} x={t.x + 2} y={HEAD_H - 4} fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{t.label}</text>
        ))}
      </svg>
    </div>
  );
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
  status: { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#7a1f2e" }, // critical = weinrot, synchron mit --tc-red in App.css
  surface: "#fcfcfb",
  gridline: "#e1e0d9",
  achse: "#c3c2b7",
  textPrimaer: "#0b0b0b",
  textSekundaer: "#52514e",
  textMuted: "#898781",
};

export interface Serie { key: string; label: string; color: string; werte: number[] }

/** Eine Zeile der festen Tagesangaben-Tabelle (siehe detailSpalten): Total, Serie oder gestrichelte Linie */
export interface DetailZeile { key: string; art: "total" | "serie" | "linie" | "referenz"; wert: number }
/** erklaerung = Tooltip beim Überfahren von Spaltentitel und Werten: wie die Angabe gerechnet wird */
export interface DetailSpalte { titel: string; erklaerung?: string; wert: (zeile: DetailZeile, idx: number) => string;
  /** Tooltip einer einzelnen Zelle (statt erklaerung), z.B. Aufschlüsselung des Totals */
  zellenTitel?: (zeile: DetailZeile, idx: number) => string | undefined }

interface DetailTabellenZeile { key: string; label: string; color?: string; gestrichelt?: boolean; fett?: boolean; rot?: boolean; werte: string[]; titel?: (string | undefined)[] }

/** Feste Angaben zum angeklickten Tag/Zeitraum an Stelle der Legende (Tab AVOR) — Spalte je Angabe,
 *  Zeile je Position mit Farbcode wie in der Legende. */
function DetailTabelle({ kopf, spalten, zeilen, onSchliessen }: { kopf: string; spalten: { titel: string; erklaerung?: string }[]; zeilen: DetailTabellenZeile[]; onSchliessen?: () => void }) {
  const zelle: React.CSSProperties = { padding: "2px 10px", textAlign: "right", whiteSpace: "nowrap" };
  return (
    <div style={{ overflowX: "auto", marginBottom: 6 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 10, fontVariantNumeric: "tabular-nums", color: FARBEN.textSekundaer }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${FARBEN.gridline}` }}>
            <th style={{ ...zelle, textAlign: "left", paddingLeft: 0, color: FARBEN.textPrimaer, fontWeight: 700 }}>
              {kopf}
              {onSchliessen && (
                <button type="button" onClick={onSchliessen} title="Auswahl aufheben — wieder Legende anzeigen"
                  style={{ marginLeft: 6, border: "none", background: "none", cursor: "pointer", color: FARBEN.textMuted, fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
              )}
            </th>
            {spalten.map(sp => <th key={sp.titel} title={sp.erklaerung} style={{ ...zelle, fontWeight: 600, color: FARBEN.textMuted, cursor: sp.erklaerung ? "help" : undefined }}>{sp.titel}</th>)}
          </tr>
        </thead>
        <tbody>
          {zeilen.map(z => (
            <tr key={z.key} style={{ fontWeight: z.fett ? 700 : 400, color: z.rot ? FARBEN.status.critical : z.fett ? FARBEN.textPrimaer : undefined }}>
              <td style={{ ...zelle, textAlign: "left", paddingLeft: 0 }}>
                {z.color && (z.gestrichelt
                  ? <span style={{ display: "inline-block", width: 10, height: 0, borderTop: `2px dashed ${z.color}`, marginRight: 5, verticalAlign: "middle" }} />
                  : <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: z.color, marginRight: 5, verticalAlign: "middle" }} />)}
                {z.label}
              </td>
              {z.werte.map((w, i) => {
                const titel = z.titel?.[i] ?? spalten[i]?.erklaerung;
                return <td key={i} title={titel} style={{ ...zelle, cursor: titel ? "help" : undefined }}>{w}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface TimeSeriesProps {
  tage: string[]; // YYYY-MM-DD, gleiche Länge wie serien[].werte
  serien: Serie[];
  modus: "linie" | "flaeche-gestapelt";
  /** Konstante Schwelle (wert) ODER Tageswerte über die Zeit (werte, gleiche Länge wie tage) — z.B.
   *  eine fixe Kranauslastungs-Kapazität vs. eine tagesabhängige Soll-Linie. */
  referenzlinie?: { label: string; wert?: number; werte?: number[] };
  /** Zusätzliche gestrichelte Tageslinien mit eigener Farbe (z.B. "Perfekte Auslastung") — in Legende und Tooltip */
  weitereLinien?: { key: string; label: string; werte: number[]; farbe: string }[];
  einheit?: string;
  hoehe?: number;
  formatWert?: (v: number) => string;
  /** Zusatz hinter jedem Wert im Tooltip (mit " · " angehängt), z.B. Personen → "86 h" */
  zusatz?: (v: number) => string;
  /** Wie zusatz, aber je Serie und Tag (hat Vorrang für die Serien-Zeilen) — z.B. Kolonnen je Gewerk */
  zusatzSerie?: (serieKey: string, idx: number, wert: number) => string;
  /** Wie zusatz, aber für die Total-Zeile mit Tag-Index (hat Vorrang) */
  zusatzTotal?: (idx: number, total: number) => string;
  /** Im Tooltip zuoberst (fett, schwarz) die Summe aller Serien — z.B. Personen total bei gestapelten Flächen */
  totalZeile?: boolean;
  markerIdx?: number | null; // Index in tage[] für eine dauerhafte Markierung (z.B. "Heute")
  markerLabel?: string;
  /** Klick ins Diagramm meldet den getroffenen Tag zurück (z.B. um das 3D-Modell auf dieses Datum zu
   *  setzen und markerIdx/markerLabel entsprechend nachzuführen) — siehe Tab AVOR. */
  onTagKlick?: (tag: string, index: number) => void;
  /** Statt Hover-Tooltip: Angaben zum angeklickten Tag (markerIdx) fest als Tabelle an Stelle der Legende,
   *  Spalten = diese Angaben, Zeilen = Total/Serien/Linien mit Farbcode (Tab AVOR) */
  detailSpalten?: DetailSpalte[];
  /** × in der Tagesangaben-Tabelle — Auswahl aufheben, wieder Legende */
  onMarkerEntfernen?: () => void;
  /** Zusätzlicher Inhalt unter der Tagesangaben-Tabelle, über dem Diagramm (z.B. Tagesablauf in Tab AVOR) */
  detailUnten?: (idx: number) => React.ReactNode;
  kalender?: Kalender; // für Wochenend-/Feiertag-Schattierung; ohne wird nur Sa/So schattiert
  /** Arbeitsfreie Sa/So aus der Zeitachse entfernen — Wochen dann durch eine feine graue Linie getrennt (Tab AVOR ⋮) */
  ohneWochenenden?: boolean;
  /** Gemeinsamer Zoom-/Scroll-Zustand mehrerer Charts auf derselben Zeitachse (siehe Tab AVOR) —
   *  Mausrad zoomt zum Cursor wie im Gantt, Achse wechselt Monate → Wochen → Tage. Ohne diese Props
   *  verwaltet der Chart Zoom/Scroll selbst (Einzeldiagramm, initial auf Containerbreite eingepasst). */
  pxProTag?: number;
  onPxProTagChange?: (px: number) => void;
  scrollTag?: number;
  onScrollChange?: (tag: number) => void;
}

const ML = 44, MR = 8, MT = 16, MB = 20;

export function TimeSeriesChart({ tage, serien, modus, referenzlinie, einheit = "", hoehe = 180, formatWert, zusatz, zusatzSerie, zusatzTotal, totalZeile, weitereLinien = [], markerIdx, markerLabel = "Heute", onTagKlick, detailSpalten, onMarkerEntfernen, detailUnten, kalender, ohneWochenenden = false,
  pxProTag: pxProTagProp, onPxProTagChange: onPxProTagChangeProp, scrollTag: scrollTagProp, onScrollChange: onScrollChangeProp }: TimeSeriesProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [outerRef, viewportW] = useMeasuredWidth<HTMLDivElement>(1000);
  const fmt = formatWert ?? fmtZahl;

  const n = tage.length;
  const pos = zeitachsenPositionen(tage, ohneWochenenden, kalender);
  const sicht = pos.idx;
  const m = sicht.length;

  // Unkontrollierter Fallback: eigener Zoom/Scroll, initial auf Containerbreite eingepasst (wie Gantt)
  const [localPx, setLocalPx] = useState(0);
  const [localScroll, setLocalScroll] = useState(0);
  const localInitDone = useRef(false);
  useEffect(() => {
    if (pxProTagProp !== undefined || localInitDone.current || viewportW === 0 || m === 0) return;
    localInitDone.current = true;
    setLocalPx(Math.max(MIN_PX_TAG, Math.min(10, viewportW / m)));
  }, [pxProTagProp, viewportW, m]);
  const pxProTag = pxProTagProp ?? (localPx || 6);
  const onPxProTagChange = onPxProTagChangeProp ?? setLocalPx;
  const scrollTag = scrollTagProp ?? localScroll;
  const onScrollChange = onScrollChangeProp ?? setLocalScroll;

  const VBW = Math.max(m * pxProTag, viewportW);
  const innerH = hoehe - MT - MB;
  const x = (i: number) => ML + pos.posAb[i] * pxProTag; // i = Original-Index in tage[]

  const { scrollRef, headerRef, zoomBy, onChartScroll } = useZeitachsenInteraktion(m, pxProTag, onPxProTagChange, scrollTag, onScrollChange);

  if (n === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

  let maxY = referenzlinie ? (referenzlinie.werte ? Math.max(0, ...referenzlinie.werte) : referenzlinie.wert ?? 0) : 0;
  for (const l of weitereLinien) maxY = Math.max(maxY, ...l.werte);
  if (modus === "flaeche-gestapelt") {
    for (const i of sicht) {
      let summe = 0;
      for (const s of serien) summe += s.werte[i] ?? 0;
      maxY = Math.max(maxY, summe);
    }
  } else {
    for (const s of serien) for (const i of sicht) maxY = Math.max(maxY, s.werte[i] ?? 0);
  }
  if (maxY <= 0) maxY = 1;
  // Linien dürfen negativ werden (z.B. Marge kumuliert in Tab Kosten) — dann reicht die y-Achse unter 0
  let minY = 0;
  if (modus === "linie") for (const s of serien) for (const i of sicht) minY = Math.min(minY, s.werte[i] ?? 0);
  const y = (v: number) => MT + innerH - ((v - minY) / (maxY - minY)) * innerH;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const p = Math.round((mouseX - ML) / pxProTag);
    setHoverIdx(sicht[Math.max(0, Math.min(m - 1, p))]);
  }

  function onKlick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onTagKlick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const idx = sicht[Math.max(0, Math.min(m - 1, Math.round((mouseX - ML) / pxProTag)))];
    onTagKlick(tage[idx], idx);
  }

  const stackedPaths: { d: string; color: string; key: string }[] = [];
  if (modus === "flaeche-gestapelt") {
    let kumBase: number[] = new Array(m).fill(0);
    for (const s of serien) {
      const oben = kumBase.map((b, p) => b + (s.werte[sicht[p]] ?? 0));
      const oberePunkte = oben.map((v, p) => `${x(sicht[p])},${y(v)}`).join(" L ");
      const unterePunkte = [...kumBase].reverse().map((v, j) => `${x(sicht[m - 1 - j])},${y(v)}`).join(" L ");
      stackedPaths.push({ d: `M ${oberePunkte} L ${unterePunkte} Z`, color: s.color, key: s.key });
      kumBase = oben;
    }
  }

  const ticks = berechneZeitachsenTicks(tage, pxProTag, pos, ohneWochenenden, kalender);
  const linienPfad = (werte: number[]) => sicht.map((i, p) => `${p === 0 ? "M" : "L"} ${x(i)} ${y(werte[i] ?? 0)}`).join(" ");

  const zeigeLegende = serien.length >= 2 || !!referenzlinie?.werte || weitereLinien.length > 0;

  // Feste Tagesangaben (detailSpalten): Zeilen in derselben Reihenfolge wie bisher im Tooltip
  const detailIdx = detailSpalten && markerIdx != null && markerIdx >= 0 && markerIdx < n ? markerIdx : null;
  const detailZeilen: DetailTabellenZeile[] = [];
  if (detailSpalten && detailIdx != null) {
    const zeile = (label: string, z: DetailZeile, extra: Partial<DetailTabellenZeile> = {}) =>
      detailZeilen.push({ key: `${z.art}-${z.key}`, label, werte: detailSpalten.map(sp => sp.wert(z, detailIdx)),
        titel: detailSpalten.map(sp => sp.zellenTitel?.(z, detailIdx)), ...extra });
    if (totalZeile) zeile("Total", { key: "__total", art: "total", wert: serien.reduce((sum, s) => sum + (s.werte[detailIdx] ?? 0), 0) }, { fett: true });
    for (const s of serien) zeile(s.label, { key: s.key, art: "serie", wert: s.werte[detailIdx] ?? 0 }, { color: s.color });
    for (const l of weitereLinien) zeile(l.label, { key: l.key, art: "linie", wert: l.werte[detailIdx] ?? 0 }, { color: l.farbe, gestrichelt: true });
    if (referenzlinie) zeile(referenzlinie.label, { key: "__referenz", art: "referenz", wert: referenzlinie.werte ? referenzlinie.werte[detailIdx] ?? 0 : referenzlinie.wert ?? 0 },
      { color: FARBEN.status.critical, gestrichelt: true });
  }

  return (
    <div ref={outerRef} style={{ position: "relative" }}>
      {detailSpalten && detailIdx != null ? (<>
        <DetailTabelle kopf={tage[detailIdx].split("-").reverse().join(".")} spalten={detailSpalten} zeilen={detailZeilen} onSchliessen={onMarkerEntfernen} />
        {detailUnten?.(detailIdx)}
      </>) : zeigeLegende && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, color: FARBEN.textSekundaer, marginBottom: 4 }}>
          {serien.map(s => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
          {referenzlinie?.werte && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 0, borderTop: `2px dashed ${FARBEN.status.critical}`, display: "inline-block" }} />
              {referenzlinie.label}
            </span>
          )}
          {weitereLinien.map(l => (
            <span key={l.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 0, borderTop: `2px dashed ${l.farbe}`, display: "inline-block" }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <ZeitachsenKopf headerRef={headerRef} VBW={VBW} ticks={ticks} pxProTag={pxProTag} />
        <div ref={scrollRef} onScroll={onChartScroll} style={{ overflowX: "auto", overflowY: "hidden" }}>
          <svg width={VBW} height={hoehe} viewBox={`0 0 ${VBW} ${hoehe}`}
            onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)} onClick={onKlick}
            style={{ display: "block", cursor: onTagKlick ? "pointer" : "crosshair" }}>
            {ticks.weekendBands.map((b, i) => <rect key={`we${i}`} x={b.x} y={MT} width={b.w} height={innerH} fill={WE_BG} />)}
            <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{fmt(maxY)}</text>
            <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{minY < 0 ? fmt(minY) : "0"}</text>
            {minY < 0 && (<>
              <line x1={ML} y1={y(0)} x2={VBW - MR} y2={y(0)} stroke={FARBEN.achse} strokeWidth={1} />
              <text x={ML - 4} y={y(0) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>0</text>
            </>)}
            {/* Monats-Linien durchgehend dicker als sonstige Hilfslinien, damit der Monatswechsel auffällt */}
            {ticks.wochenLinien.map((wx, i) => (
              <line key={`wl${i}`} x1={wx} y1={MT} x2={wx} y2={hoehe - MB} stroke={WOCHEN_LINIE} strokeWidth={0.8} />
            ))}
            {ticks.monatTicks.map((t, i) => (
              <line key={`ml${i}`} x1={t.x} y1={MT} x2={t.x} y2={hoehe - MB} stroke="#aab4bd" strokeWidth={1.4} />
            ))}
            {referenzlinie?.werte && (
              <path fill="none" stroke={FARBEN.status.critical} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round"
                d={linienPfad(referenzlinie.werte)} />
            )}
            {weitereLinien.map(l => (
              <path key={l.key} fill="none" stroke={l.farbe} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round"
                d={linienPfad(l.werte)} />
            ))}
            {referenzlinie?.wert != null && (<>
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
                d={linienPfad(s.werte)} />
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
        {hoverIdx !== null && !detailSpalten && (() => {
          // Tooltip neben dem Cursor, auf der Seite mit mehr Platz — so bleibt er auch am ersten/letzten Tag ganz sichtbar
          const cx = x(hoverIdx) - scrollTag * pxProTag;
          const rechtsDavon = cx < viewportW / 2;
          return (
          <div style={{
            position: "absolute", top: 4, ...(rechtsDavon ? { left: Math.max(0, cx + 12) } : { right: Math.max(0, viewportW - cx + 12) }),
            maxWidth: Math.max(160, viewportW - 8), background: "#fff", border: `1px solid ${FARBEN.gridline}`,
            boxShadow: "0 2px 6px rgba(0,0,0,.12)", padding: "5px 8px", fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
          }}>
            <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>{tage[hoverIdx].split("-").reverse().join(".")}</div>
            {totalZeile && (() => {
              const total = serien.reduce((sum, s) => sum + (s.werte[hoverIdx] ?? 0), 0);
              return (
                <div style={{ fontWeight: 700, color: "#000", marginBottom: 2 }}>
                  Total: {fmt(total)} {einheit}{zusatzTotal ? ` · ${zusatzTotal(hoverIdx, total)}` : zusatz ? ` · ${zusatz(total)}` : ""}
                </div>
              );
            })()}
            {serien.map(s => (
              <div key={s.key} style={{ color: FARBEN.textSekundaer }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: s.color, marginRight: 4 }} />
                {s.label}: {fmt(s.werte[hoverIdx] ?? 0)} {einheit}{zusatzSerie ? ` · ${zusatzSerie(s.key, hoverIdx, s.werte[hoverIdx] ?? 0)}` : zusatz ? ` · ${zusatz(s.werte[hoverIdx] ?? 0)}` : ""}
              </div>
            ))}
            {weitereLinien.map(l => (
              <div key={l.key} style={{ color: l.farbe }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: l.farbe, marginRight: 4 }} />
                {l.label}: {fmt(l.werte[hoverIdx] ?? 0)} {einheit}
              </div>
            ))}
            {referenzlinie && (referenzlinie.werte ? referenzlinie.werte[hoverIdx] != null : referenzlinie.wert != null) && (
              <div style={{ color: FARBEN.status.critical }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: FARBEN.status.critical, marginRight: 4 }} />
                {referenzlinie.label}: {fmt(referenzlinie.werte ? referenzlinie.werte[hoverIdx] ?? 0 : referenzlinie.wert!)} {einheit}
                {zusatz ? ` · ${zusatz(referenzlinie.werte ? referenzlinie.werte[hoverIdx] ?? 0 : referenzlinie.wert!)}` : ""}
              </div>
            )}
          </div>
          );
        })()}
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

export interface KategorieSerie {
  key: string; label: string; color: string; werte: number[];
  /** Kapazitätsgrenze je Kategorie, parallel zu werte (z.B. verfügbare Kranstunden je Zeitraster-Bucket)
   *  — Balken über dieser Grenze werden rot (Engpass) eingefärbt, siehe Kranoptik in Tab AVOR. */
  kapazitaet?: number[];
}

interface CategoryBarProps {
  kategorien: string[]; // x-Achse, gleiche Länge wie serien[].werte
  serien: KategorieSerie[];
  einheit?: string;
  hoehe?: number;
  formatWert?: (v: number) => string;
}

/** Gruppierte Balken über einer kategorialen x-Achse (Kürzel/Gewerke statt Zeit). Bei nur einer Serie
 *  (Standardfall wie "Kosten je Gewerk") steht der Wert direkt sichtbar über jedem Balken, nicht erst
 *  bei Hover — ein Klick auf einen Balken markiert ihn dauerhaft (bis zum nächsten Klick) und hebt
 *  dessen Zahl hervor, damit der Wert auch ohne Maus über dem Diagramm ablesbar bleibt. */
export function CategoryBarChart({ kategorien, serien, einheit = "", hoehe = 180, formatWert }: CategoryBarProps) {
  const [hover, setHover] = useState<{ ki: number; si: number } | null>(null);
  const [ausgewaehlt, setAusgewaehlt] = useState<{ ki: number; si: number } | null>(null);
  const aktiv = hover ?? ausgewaehlt;
  const [containerRef, VBW] = useMeasuredWidth<HTMLDivElement>(1000);
  const fmt = formatWert ?? fmtZahl;

  if (kategorien.length === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

  const n = kategorien.length;
  const innerW = VBW - ML - MR;
  const innerH = hoehe - MT - MB;
  let maxY = 0;
  for (const s of serien) {
    for (const w of s.werte) maxY = Math.max(maxY, w ?? 0);
    for (const c of s.kapazitaet ?? []) maxY = Math.max(maxY, c ?? 0);
  }
  if (maxY <= 0) maxY = 1;
  // Negative Werte (z.B. Marge je Gewerk in Tab Kosten) → Balken nach unten ab der Nulllinie
  let minY = 0;
  for (const s of serien) for (const w of s.werte) minY = Math.min(minY, w ?? 0);
  const y = (v: number) => MT + innerH - ((v - minY) / (maxY - minY)) * innerH;

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
          <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{minY < 0 ? fmt(minY) : "0"}</text>
          {minY < 0 && (<>
            <line x1={ML} y1={y(0)} x2={VBW - MR} y2={y(0)} stroke={FARBEN.achse} strokeWidth={1} />
            <text x={ML - 4} y={y(0) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>0</text>
          </>)}
          {kategorien.map((kat, ki) => (
            <text key={ki} x={ML + ki * gruppenBreite + gruppenBreite / 2} y={hoehe - 4} textAnchor="middle" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{kat}</text>
          ))}
          {kategorien.map((_, ki) => serien.map((s, si) => {
            const w = s.werte[ki] ?? 0;
            const kap = s.kapazitaet?.[ki];
            const engpass = kap != null && w > kap;
            const bx = ML + ki * gruppenBreite + pad + si * balkenBreite;
            const by = Math.min(y(w), y(0));
            const bh = Math.abs(y(w) - y(0));
            const bw = Math.max(balkenBreite - 1, 1);
            const istAusgewaehlt = ausgewaehlt?.ki === ki && ausgewaehlt?.si === si;
            return (
              <g key={`${ki}-${si}`} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover({ ki, si })} onMouseLeave={() => setHover(null)}
                onClick={() => setAusgewaehlt(prev => (prev && prev.ki === ki && prev.si === si) ? null : { ki, si })}>
                <rect x={bx} y={by} width={bw} height={Math.max(bh, 0)} fill={engpass ? FARBEN.status.critical : s.color} rx={2}
                  stroke={istAusgewaehlt ? FARBEN.textPrimaer : "none"} strokeWidth={istAusgewaehlt ? 2 : 0} />
                {kap != null && (
                  <line x1={bx} y1={y(kap)} x2={bx + bw} y2={y(kap)} stroke={FARBEN.textPrimaer} strokeWidth={1.5} />
                )}
                {engpass ? (
                  <text x={bx + bw / 2} y={by - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill={FARBEN.status.critical}>!</text>
                ) : serien.length === 1 && (
                  <text x={bx + bw / 2} y={w < 0 ? by + bh + 11 : by - 4} textAnchor="middle" fontSize={9}
                    fontWeight={istAusgewaehlt ? 700 : 400} fill={istAusgewaehlt ? FARBEN.textPrimaer : FARBEN.textSekundaer}>{fmt(w)}</text>
                )}
              </g>
            );
          }))}
        </svg>
        {aktiv && (() => {
          const s = serien[aktiv.si];
          const w = s.werte[aktiv.ki] ?? 0;
          const kap = s.kapazitaet?.[aktiv.ki];
          const engpass = kap != null && w > kap;
          const bx = ML + aktiv.ki * gruppenBreite + pad + aktiv.si * balkenBreite + balkenBreite / 2;
          return (
            <div style={{
              position: "absolute", top: 4,
              ...(bx < VBW / 2 ? { left: `${(bx / VBW) * 100}%` } : { right: `${100 - (bx / VBW) * 100}%` }),
              background: "#fff", border: `1px solid ${FARBEN.gridline}`,
              boxShadow: "0 2px 6px rgba(0,0,0,.12)", padding: "5px 8px", fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
            }}>
              <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>{kategorien[aktiv.ki]}</div>
              <div style={{ color: engpass ? FARBEN.status.critical : FARBEN.textSekundaer, fontWeight: engpass ? 700 : 400 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: engpass ? FARBEN.status.critical : s.color, marginRight: 4 }} />
                {s.label}: {kap != null ? `${fmt(w)} / ${fmt(kap)} ${einheit}${engpass ? " ← ENGPASS" : ""}` : `${fmt(w)} ${einheit}`}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

interface KranBalkenChartProps {
  /** Tagesreihe, die dieselbe Zeitachse wie die übrigen Diagramme dieses Tabs referenziert (gleicher
   *  Starttag) — Tag-0-Referenz für die Bucket-Positionierung, siehe pxProTag/scrollTag unten. */
  tage: string[];
  buckets: { key: string; label: string; start: string; end: string }[];
  /** Ein Eintrag je Kran; werte/kapazitaet parallel zu buckets (gleicher Index). */
  serien: KategorieSerie[];
  einheit?: string;
  hoehe?: number;
  formatWert?: (v: number) => string;
  kalender?: Kalender;
  /** Wie bei TimeSeriesChart: arbeitsfreie Sa/So aus der Zeitachse entfernen */
  ohneWochenenden?: boolean;
  /** Gemeinsame Tagesmarkierung (Index in tage[]) und Klick wie bei TimeSeriesChart */
  markerIdx?: number | null;
  markerLabel?: string;
  onTagKlick?: (tag: string, index: number) => void;
  /** Statt Hover-Tooltip: Angaben zum Zeitraum (Monat/Woche) des markierten Tages fest als Tabelle an
   *  Stelle der Legende — Spalten = diese Angaben, Zeilen = Kräne mit Farbcode (Tab AVOR) */
  detailSpalten?: { titel: string; erklaerung?: string; wert: (s: KategorieSerie, bucketIdx: number) => string }[];
  onMarkerEntfernen?: () => void;
  /** Gemeinsamer Zoom-/Scroll-Zustand mit den übrigen Zeitachsen-Diagrammen dieses Tabs (siehe
   *  TimeSeriesChart) — Pflichtprops, da dieser Chart nur im Verbund mit anderen sinnvoll ist. */
  pxProTag: number;
  onPxProTagChange: (px: number) => void;
  scrollTag: number;
  onScrollChange: (tag: number) => void;
}

/** Wie CategoryBarChart, aber die Kategorien sind Zeitraster-Buckets (Monat/Woche) auf derselben Tages-
 *  Pixel-Zeitachse wie TimeSeriesChart — Zoom (Lupe/Strg-Mausrad) und horizontales Scrollen wirken sich
 *  dadurch exakt gemeinsam auf dieses und alle anderen Diagramme desselben Tabs aus (siehe Kranoptik in
 *  Tab AVOR, geteilter Zustand über useChartZoom). Balken über der optionalen Kapazitätslinie (kap)
 *  werden rot (Engpass) eingefärbt, wie in CategoryBarChart. */
export function KranBalkenChart({ tage, buckets, serien, einheit = "", hoehe = 180, formatWert, kalender, ohneWochenenden = false,
  markerIdx, markerLabel = "Heute", onTagKlick, detailSpalten, onMarkerEntfernen,
  pxProTag, onPxProTagChange, scrollTag, onScrollChange }: KranBalkenChartProps) {
  const [hover, setHover] = useState<{ bi: number; si: number } | null>(null);
  const [outerRef, viewportW] = useMeasuredWidth<HTMLDivElement>(1000);
  const fmt = formatWert ?? fmtZahl;
  const n = tage.length;
  const pos = zeitachsenPositionen(tage, ohneWochenenden, kalender);

  const { scrollRef, headerRef, zoomBy, onChartScroll } = useZeitachsenInteraktion(pos.idx.length, pxProTag, onPxProTagChange, scrollTag, onScrollChange);

  if (n === 0 || buckets.length === 0 || serien.length === 0) {
    return <div style={{ fontSize: 11, color: FARBEN.textMuted, padding: 12 }}>Keine Daten</div>;
  }

  const VBW = Math.max(pos.idx.length * pxProTag, viewportW);
  const innerH = hoehe - MT - MB;
  const x = (i: number) => ML + pos.posAb[i] * pxProTag; // i = Original-Tagesindex (0..n), ausgeblendete Tage haben keine Breite
  const startDate = parseIsoLocal(tage[0]);
  // Bucket-Tagesindex relativ zum Diagramm-Starttag — auf [0, n-1] geklemmt, falls ein Bucket (z.B.
  // der erste Monat/die erste Woche) über den Projektzeitraum hinausragt (siehe zeitrasterBuckets()).
  const dayIndexClamped = (iso: string, istEnde: boolean): number => {
    const raw = Math.round((parseIsoLocal(iso).getTime() - startDate.getTime()) / 86400000);
    return istEnde ? Math.min(raw, n - 1) : Math.max(raw, 0);
  };

  let maxY = 0;
  for (const s of serien) {
    for (const w of s.werte) maxY = Math.max(maxY, w ?? 0);
    for (const c of s.kapazitaet ?? []) maxY = Math.max(maxY, c ?? 0);
  }
  if (maxY <= 0) maxY = 1;
  const y = (v: number) => MT + innerH - (v / maxY) * innerH;

  const ticks = berechneZeitachsenTicks(tage, pxProTag, pos, ohneWochenenden, kalender);
  const zeigeLegende = serien.length >= 2;

  // Markierter Tag → Zeitraum (Monat/Woche), dessen Angaben fest über dem Diagramm stehen
  const markerGueltig = markerIdx != null && markerIdx >= 0 && markerIdx < n;
  const markerBucket = markerGueltig ? buckets.findIndex(b => tage[markerIdx!] >= b.start && tage[markerIdx!] <= b.end) : -1;

  function onKlick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onTagKlick) return;
    const p = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left - ML) / pxProTag);
    const idx = pos.idx[Math.max(0, Math.min(pos.idx.length - 1, p))];
    onTagKlick(tage[idx], idx);
  }

  return (
    <div ref={outerRef} style={{ position: "relative" }}>
      {detailSpalten && markerBucket >= 0 ? (
        <DetailTabelle kopf={buckets[markerBucket].label} spalten={detailSpalten} onSchliessen={onMarkerEntfernen}
          zeilen={serien.map(s => {
            const kap = s.kapazitaet?.[markerBucket];
            return { key: s.key, label: s.label, color: s.color, rot: kap != null && (s.werte[markerBucket] ?? 0) > kap,
              werte: detailSpalten.map(sp => sp.wert(s, markerBucket)) };
          })} />
      ) : zeigeLegende && (
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
        <ZeitachsenKopf headerRef={headerRef} VBW={VBW} ticks={ticks} pxProTag={pxProTag} />
        <div ref={scrollRef} onScroll={onChartScroll} style={{ overflowX: "auto", overflowY: "hidden" }}>
          <svg width={VBW} height={hoehe} viewBox={`0 0 ${VBW} ${hoehe}`} onClick={onKlick}
            style={{ display: "block", cursor: onTagKlick ? "pointer" : undefined }}>
            {ticks.weekendBands.map((b, i) => <rect key={`we${i}`} x={b.x} y={MT} width={b.w} height={innerH} fill={WE_BG} />)}
            {markerBucket >= 0 && (() => {
              const bx0 = x(dayIndexClamped(buckets[markerBucket].start, false));
              const bx1 = x(dayIndexClamped(buckets[markerBucket].end, true) + 1);
              return <rect x={bx0} y={MT} width={Math.max(bx1 - bx0, 1)} height={innerH} fill="#eaf2fb" />;
            })()}
            <line x1={ML} y1={MT} x2={ML} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <line x1={ML} y1={hoehe - MB} x2={VBW - MR} y2={hoehe - MB} stroke={FARBEN.achse} strokeWidth={1} />
            <text x={ML - 4} y={y(maxY) + 3} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>{fmt(maxY)}</text>
            <text x={ML - 4} y={hoehe - MB} textAnchor="end" fontSize={9} fontFamily="var(--tc-font)" fill={FARBEN.textMuted}>0</text>
            {ticks.wochenLinien.map((wx, i) => (
              <line key={`wl${i}`} x1={wx} y1={MT} x2={wx} y2={hoehe - MB} stroke={WOCHEN_LINIE} strokeWidth={0.8} />
            ))}
            {ticks.monatTicks.map((t, i) => (
              <line key={`ml${i}`} x1={t.x} y1={MT} x2={t.x} y2={hoehe - MB} stroke="#aab4bd" strokeWidth={1.4} />
            ))}
            {buckets.map((b, bi) => {
              const bx0 = x(dayIndexClamped(b.start, false));
              const bx1 = x(dayIndexClamped(b.end, true) + 1);
              const bucketW = Math.max(bx1 - bx0, 1);
              const pad = bucketW * 0.15;
              const balkenBreite = (bucketW - pad * 2) / serien.length;
              return (
                <g key={b.key}>
                  {serien.map((s, si) => {
                    const w = s.werte[bi] ?? 0;
                    const kap = s.kapazitaet?.[bi];
                    const engpass = kap != null && w > kap;
                    const bx = bx0 + pad + si * balkenBreite;
                    const by = y(w);
                    const bh = hoehe - MB - by;
                    const bw = Math.max(balkenBreite - 1, 1);
                    return (
                      <g key={s.key} onMouseEnter={() => setHover({ bi, si })} onMouseLeave={() => setHover(null)}>
                        <rect x={bx} y={by} width={bw} height={Math.max(bh, 0)} fill={engpass ? FARBEN.status.critical : s.color} rx={2} />
                        {kap != null && (
                          <line x1={bx} y1={y(kap)} x2={bx + bw} y2={y(kap)} stroke={FARBEN.textPrimaer} strokeWidth={1.5} />
                        )}
                        {engpass && (
                          <text x={bx + bw / 2} y={by - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill={FARBEN.status.critical}>!</text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {markerGueltig && (
              <g>
                <line x1={x(markerIdx!)} y1={MT} x2={x(markerIdx!)} y2={hoehe - MB} stroke={FARBEN.status.warning} strokeWidth={1.5} />
                <text x={x(markerIdx!)} y={MT - 5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="var(--tc-font)" fill={FARBEN.status.warning}>{markerLabel}</text>
              </g>
            )}
          </svg>
        </div>
        {hover && !detailSpalten && (() => {
          const b = buckets[hover.bi];
          const s = serien[hover.si];
          const w = s.werte[hover.bi] ?? 0;
          const kap = s.kapazitaet?.[hover.bi];
          const engpass = kap != null && w > kap;
          const mitte = (x(dayIndexClamped(b.start, false)) + x(dayIndexClamped(b.end, true) + 1)) / 2;
          return (
            <div style={{
              position: "absolute", top: 4,
              ...(mitte - scrollTag * pxProTag < viewportW / 2 ? { left: Math.max(0, mitte - scrollTag * pxProTag + 12) } : { right: Math.max(0, viewportW - (mitte - scrollTag * pxProTag) + 12) }),
              background: "#fff", border: `1px solid ${FARBEN.gridline}`,
              boxShadow: "0 2px 6px rgba(0,0,0,.12)", padding: "5px 8px", fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5,
            }}>
              <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>{b.label}</div>
              <div style={{ color: engpass ? FARBEN.status.critical : FARBEN.textSekundaer, fontWeight: engpass ? 700 : 400 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: engpass ? FARBEN.status.critical : s.color, marginRight: 4 }} />
                {s.label}: {kap != null ? `${fmt(w)} / ${fmt(kap)} ${einheit}${engpass ? " ← ENGPASS" : ""}` : `${fmt(w)} ${einheit}`}
              </div>
            </div>
          );
        })()}
        <ZoomControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} />
      </div>
    </div>
  );
}

export function StatTile({ label, wert, status, sub, title }: { label: string; wert: React.ReactNode; status?: "good" | "warning" | "critical"; sub?: string; title?: string }) {
  void status; // Zahl bewusst immer schwarz, kein Status-Farbcode mehr — siehe StatTile-Aufrufer für Warn-/Fehlerhinweise
  return (
    <div title={title} style={{ border: "1px solid #dbeafe", background: "#f5f9ff", borderRadius: 8, padding: "8px 12px", minWidth: 120, flex: 1 }}>
      <div style={{ fontSize: 9, color: FARBEN.textPrimaer, fontWeight: 600, letterSpacing: ".3px", marginBottom: 3 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: FARBEN.textPrimaer }}>{wert}</div>
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
