import { useRef, useState, useEffect, useCallback } from "react";
import type { Task } from "../types";
import { parseDateUniversal } from "../types";
import DatePicker from "./DatePicker";

interface Props {
  tasks: Task[];
  currentTag: number;
  totalTage: number;
  minDate: Date | null;
  laeuft: boolean;
  onTaskClick?: (idx: number) => void;
  onSliderChange?: (tag: number) => void;
  onNadelClick?: (tag: number) => void;
  selTaskId?: string | null;
  selGuids?: Set<string>;
  taskSort?: "gantt" | "datum" | "aktiv";
  height?: number;
  editable?: boolean;
  onDateChange?: (taskId: string, newStart: string, newEnd: string) => void;
  nadelStil?: "normal" | "ghost";
  dateColor?: string;
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 28;
const HEAD_H = 34;
const MIN_PX = 0.3;
const MAX_PX = 40;
const LS_LABEL_W = "4d-gantt-label-w";
const LS_ZOOM = "4d-gantt-zoom";
const MONAT_VOLL = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONAT_KURZ = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const WE_BG = "#f2f3f5"; // Wochenende Hintergrund

function fmtISO(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fmtDatum(d: Date, lang: boolean): string {
  if (lang) return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
  return `${d.getDate()}.${d.getMonth()+1}`;
}
function fmtDMY(d: Date): string { return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; }
function getKW(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, onNadelClick, selTaskId, selGuids, taskSort, height, editable, onDateChange, nadelStil = "normal", dateColor = "#2d7dbd" }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(() => { try { return Number(localStorage.getItem(LS_ZOOM)) || 6; } catch { return 6; } });
  const [labelW, setLabelW] = useState(() => { try { return Number(localStorage.getItem(LS_LABEL_W)) || 140; } catch { return 140; } });
  const needleDrag = useRef(false);
  const scrollLock = useRef(false);
  const pxRef = useRef(pxProTag);
  useEffect(() => { pxRef.current = pxProTag; }, [pxProTag]);
  const initDone = useRef(false);
  const [calEdit, setCalEdit] = useState<{ taskId: string; field: "start" | "end"; value: string; x: number; y: number } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem(LS_LABEL_W, String(labelW)); }, [labelW]);
  useEffect(() => { localStorage.setItem(LS_ZOOM, String(pxProTag)); }, [pxProTag]);

  // Initial zoom nur wenn kein gespeicherter Wert
  useEffect(() => {
    if (initDone.current) return; initDone.current = true;
    const saved = Number(localStorage.getItem(LS_ZOOM));
    if (saved > 0) { setPxProTag(saved); return; }
    if (!bodyRef.current || totalTage <= 0) return;
    setPxProTag(Math.max(MIN_PX, Math.min(10, bodyRef.current.clientWidth / totalTage)));
  }, [totalTage]);

  // Wheel = zoom zum Mauszeiger (wie Google Maps)
  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      scrollLock.current = true;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const curPx = pxRef.current;
      const dayAtCursor = (el.scrollLeft + mouseX) / curPx;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const newPx = Math.max(MIN_PX, Math.min(MAX_PX, curPx * factor));
      pxRef.current = newPx;
      setPxProTag(newPx);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, dayAtCursor * newPx - mouseX);
        if (headerRef.current) headerRef.current.scrollLeft = el.scrollLeft;
        setTimeout(() => { scrollLock.current = false; }, 100);
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Needle centering — nur bei echtem Wechsel von currentTag
  const lastCentered = useRef(-999);
  useEffect(() => {
    if (scrollLock.current) return;
    if (currentTag < 0) return;
    if (currentTag === lastCentered.current) return;
    lastCentered.current = currentTag;
    const el = bodyRef.current; if (!el || !minDate || totalTage <= 0) return;
    el.scrollLeft = Math.max(0, currentTag * pxProTag - el.clientWidth / 2);
    if (headerRef.current) headerRef.current.scrollLeft = el.scrollLeft;
  }, [currentTag]);

  const syncScroll = useCallback(() => {
    const b = bodyRef.current, h = headerRef.current, l = labelRef.current;
    if (b && h) h.scrollLeft = b.scrollLeft;
    if (b && l) l.scrollTop = b.scrollTop;
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sw = labelW;
    const onMove = (ev: MouseEvent) => setLabelW(Math.max(60, Math.min(300, sw + ev.clientX - sx)));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [labelW]);

  const startBarDrag = useCallback((e: React.MouseEvent, taskId: string, mode: "start" | "end" | "move", origStart: Date, origEnd: Date) => {
    if (!editable || !minDate || !onDateChange) return;
    e.preventDefault(); e.stopPropagation(); scrollLock.current = true;
    setEditingTaskId(taskId);
    const sx = e.clientX, oS = (origStart.getTime() - minDate.getTime()) / 86400000, oE = (origEnd.getTime() - minDate.getTime()) / 86400000, dur = oE - oS;
    const onMove = (ev: MouseEvent) => {
      const dd = Math.round((ev.clientX - sx) / pxProTag);
      let nS = oS, nE = oE;
      if (mode === "start") { nS = Math.max(0, oS + dd); if (nS >= nE) nS = nE - 1; }
      else if (mode === "end") { nE = Math.max(nS + 1, oE + dd); }
      else { nS = Math.max(0, oS + dd); nE = nS + dur; }
      onDateChange(taskId, fmtISO(new Date(minDate.getTime() + nS * 86400000)), fmtISO(new Date(minDate.getTime() + nE * 86400000)));
    };
    const onUp = () => { setEditingTaskId(null); setTimeout(() => { scrollLock.current = false; }, 200); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [editable, minDate, pxProTag, onDateChange]);

  // Klick ins Leere → Nadel setzen + zentrieren
  const handleChartClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (needleDrag.current) return;
    const el = bodyRef.current; if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const tag = Math.max(0, Math.min(totalTage, Math.round(x / pxRef.current)));
    onNadelClick?.(tag);
    onSliderChange?.(tag);
  }, [totalTage, onNadelClick, onSliderChange]);

  // Nadel-Drag → verschieben + Chart scrollt mit
  const startNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    needleDrag.current = true; scrollLock.current = true;
    const el = bodyRef.current; if (!el) return;
    const onMove = (ev: MouseEvent) => {
      if (!needleDrag.current || !el) return;
      const tag = Math.max(0, Math.min(totalTage, Math.round((ev.clientX - el.getBoundingClientRect().left + el.scrollLeft) / pxRef.current)));
      onNadelClick?.(tag);
      onSliderChange?.(tag);
    };
    const onUp = () => {
      needleDrag.current = false;
      setTimeout(() => { scrollLock.current = false; }, 300);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [totalTage, onNadelClick, onSliderChange]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks</div>;

  // Sortierung
  const sorted = tasks.map((t, i) => ({ task: t, origIdx: i }));
  if (taskSort === "datum") sorted.sort((a, b) => { const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0, sb = parseDateUniversal(b.task.start)?.getTime() ?? 0; return sa !== sb ? sa - sb : (parseDateUniversal(a.task.end)?.getTime() ?? sa) - (parseDateUniversal(b.task.end)?.getTime() ?? sb); });
  else if (taskSort === "aktiv") sorted.sort((a, b) => { const aH = selGuids?.size && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0; return (selGuids?.size && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0) - aH; });

  const chartW = Math.max(totalTage * pxProTag, 200);
  const bodyH = sorted.length * ROW_H;
  const longDates = pxProTag >= 8;

  // Zoom-Stufen: welche Details zeigen?
  const showWeekLines = pxProTag >= 1.5;    // Wochen-Trennlinien
  const showKW = pxProTag >= 5;             // Kalenderwochen
  const showDayLines = pxProTag >= 10;      // Tages-Trennlinien
  const showDayNums = pxProTag >= 15;       // Tageszahlen

  // Alle Tage pre-compute
  const allDays: { x: number; date: Date; dow: number }[] = [];
  for (let d = 0; d <= totalTage; d++) {
    const dt = new Date(minDate.getTime() + d * 86400000);
    allDays.push({ x: d * pxProTag, date: dt, dow: dt.getDay() });
  }

  // Wochenend-Bänder (Sa+So)
  const weekendBands: { x: number; w: number }[] = [];
  for (const day of allDays) {
    if (day.dow === 6) weekendBands.push({ x: day.x, w: Math.min(2, totalTage - (day.x / pxProTag)) * pxProTag });
  }

  // Monats-Marker
  const rawM: { x: number; m: number; y: number }[] = [];
  for (const day of allDays) { if (day.date.getDate() === 1) rawM.push({ x: day.x, m: day.date.getMonth(), y: day.date.getFullYear() }); }
  if (rawM.length === 0 || rawM[0].x > 20) rawM.unshift({ x: 0, m: minDate.getMonth(), y: minDate.getFullYear() });

  let labelMode: "full" | "short" | "year" = "full";
  if (rawM.length > 1) { const avg = rawM.reduce((s, m, i) => i > 0 ? s + (m.x - rawM[i-1].x) : s, 0) / (rawM.length - 1); if (avg < 22) labelMode = "year"; else if (avg < 48) labelMode = "short"; }

  let hLabels: { x: number; label: string }[] = [];
  if (labelMode === "year") { let ly = -1; for (const m of rawM) { if (m.y !== ly) { hLabels.push({ x: m.x, label: String(m.y) }); ly = m.y; } } }
  else if (labelMode === "short") hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_KURZ[m.m]} ${String(m.y).slice(2)}` }));
  else hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_VOLL[m.m]} ${String(m.y).slice(2)}` }));
  if (hLabels.length === 0) hLabels.push({ x: 0, label: `${MONAT_VOLL[minDate.getMonth()]} ${String(minDate.getFullYear()).slice(2)}` });

  // KW-Marker (Montage)
  const kwMarkers: { x: number; label: string }[] = [];
  if (showKW && !showDayNums) {
    for (const day of allDays) {
      if (day.dow === 1) kwMarkers.push({ x: day.x, label: `KW ${getKW(day.date)}` });
    }
  }

  // Tages-Nummern
  const dayNums: { x: number; label: string }[] = [];
  if (showDayNums) {
    for (const day of allDays) { if (day.date.getDate() !== 1) dayNums.push({ x: day.x, label: `${day.date.getDate()}` }); }
  }

  // Wochen-Trennlinien (So→Mo)
  const weekLines: number[] = [];
  if (showWeekLines) { for (const day of allDays) { if (day.dow === 1) weekLines.push(day.x); } }

  // Tages-Trennlinien
  const dayLines: number[] = [];
  if (showDayLines) { for (const day of allDays) { if (day.date.getDate() !== 1 && day.dow !== 1) dayLines.push(day.x); } }

  const nadelX = currentTag * pxProTag;
  const containerH = height ?? 350;

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid #d4dce4", background: "#fff", height: containerH, overflow: "hidden", position: "relative" }}>
      {/* HEADER */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        <div style={{ width: labelW, flexShrink: 0, height: HEAD_H, background: "#f5f7f9", borderBottom: "1px solid #d4dce4", borderRight: "1px solid #d4dce4", display: "flex", alignItems: "center", padding: "0 6px", position: "relative" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#555" }}>Task</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#8a9baa" }}>Tage</span>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>
        <div ref={headerRef} style={{ flex: 1, height: HEAD_H, overflow: "hidden", background: "#f5f7f9", borderBottom: "1px solid #d4dce4" }}>
          <svg width={chartW} height={HEAD_H} style={{ display: "block" }}>
            {/* Wochenend-Hintergrund im Header */}
            {weekendBands.map((b, i) => <rect key={`weh${i}`} x={b.x} y={0} width={b.w} height={HEAD_H} fill={WE_BG} />)}
            {/* Monats-Labels */}
            {hLabels.map((m, i) => (<g key={`h${i}`}><line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.6} /><text x={m.x + 4} y={14} fontSize={11} fontWeight={600} fill="#555">{m.label}</text></g>))}
            {/* KW-Labels */}
            {kwMarkers.map((m, i) => <text key={`kw${i}`} x={m.x + 2} y={27} fontSize={9} fill="#8a9baa">{m.label}</text>)}
            {/* Tages-Nummern */}
            {dayNums.map((m, i) => <text key={`dn${i}`} x={m.x + pxProTag/2} y={28} fontSize={10} fill="#888" textAnchor="middle">{m.label}</text>)}
            {/* Nadel-Dreieck */}
            {currentTag >= 0 && <polygon points={`${nadelX-5},${HEAD_H} ${nadelX+5},${HEAD_H} ${nadelX},${HEAD_H-6}`} fill={nadelStil === "ghost" ? "#EAB308" : "#e63946"} />}
          </svg>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div ref={labelRef} style={{ width: labelW, flexShrink: 0, overflowY: "auto", overflowX: "hidden", borderRight: "1px solid #d4dce4", position: "relative" }}
          onScroll={() => { const l = labelRef.current, b = bodyRef.current; if (l && b) b.scrollTop = l.scrollTop; }}>
          <div style={{ height: bodyH }}>
            {sorted.map(({ task: t, origIdx }, i) => {
              const sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
              const isSel = selTaskId === t.id, hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const isEditing = editingTaskId === t.id || calEdit?.taskId === t.id;
              const maxC = Math.max(4, Math.floor((labelW - 40) / 7));
              const lbl = t.name.length > maxC ? t.name.slice(0, maxC - 1) + "…" : t.name;
              return (
                <div key={t.id} onClick={() => onTaskClick?.(origIdx)} style={{
                  height: ROW_H, display: "flex", alignItems: "center", padding: "0 6px", cursor: "pointer", borderBottom: "1px solid #eef1f4",
                  background: isEditing ? "#FFF8E1" : isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginRight: 5, background: isEditing ? "#FF9800" : FARBEN[t.typ] || "#6cc07a" }} />
                  <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isEditing ? "#E65100" : isSel ? "#2d7dbd" : "#333", fontWeight: isEditing || isSel ? 600 : 400 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: "#8a9baa", flexShrink: 0 }}>{dauer}d</span>
                </div>
              );
            })}
          </div>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>

        <div ref={bodyRef} onScroll={syncScroll} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <svg width={chartW} height={bodyH} style={{ display: "block" }}
            onClick={handleChartClick}>
            {/* Wochenend-Bänder */}
            {weekendBands.map((b, i) => <rect key={`we${i}`} x={b.x} y={0} width={b.w} height={bodyH} fill={WE_BG} />)}
            {/* Monats-Linien */}
            {rawM.map((m, i) => <line key={`ml${i}`} x1={m.x} y1={0} x2={m.x} y2={bodyH} stroke="#d4dce4" strokeWidth={0.6} />)}
            {/* Wochen-Trennlinien */}
            {weekLines.map((x, i) => <line key={`wl${i}`} x1={x} y1={0} x2={x} y2={bodyH} stroke="#e4e7ea" strokeWidth={0.5} />)}
            {/* Tages-Trennlinien */}
            {dayLines.map((x, i) => <line key={`dl${i}`} x1={x} y1={0} x2={x} y2={bodyH} stroke="#f0f2f4" strokeWidth={0.3} />)}

            {sorted.map(({ task: t }, i) => {
              const y = i * ROW_H, sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const sT = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
              const eT = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : sT + 1;
              const dauer = Math.max(1, Math.round(eT - sT));
              const bX = sT * pxProTag, bW = Math.max((eT - sT) * pxProTag, 3);
              const isSel = selTaskId === t.id, hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const isEditing = editingTaskId === t.id || calEdit?.taskId === t.id;
              const handleW = Math.min(6, bW / 3);
              const showDates = sd && ed && pxProTag >= 2;
              const barFill = isEditing ? "#FFE0B2" : (FARBEN[t.typ] || "#6cc07a");
              const barStroke = isEditing ? "#FF9800" : (isSel ? "#2d7dbd" : "none");
              const barStrokeW = isEditing ? 2 : (isSel ? 1.5 : 0);
              return (
                <g key={t.id}>
                  <rect x={0} y={y} width={chartW} height={ROW_H} fill={isEditing ? "#FFF8E1" : isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : "transparent"} />
                  <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
                  {showDates && <text x={bX - 3} y={y + ROW_H / 2 + 4} fontSize={11} fill={dateColor} textAnchor="end"
                    style={{ cursor: editable ? "pointer" : "default" }}
                    onClick={editable ? (e) => { e.stopPropagation(); setEditingTaskId(t.id); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "start", value: fmtDMY(sd!), x: r.left, y: r.bottom }); } : undefined}
                  >{fmtDatum(sd!, longDates)}</text>}
                  {sd && <rect x={bX} y={y + 5} width={bW} height={ROW_H - 10} rx={3}
                    fill={barFill} opacity={isEditing ? 1 : isSel ? 1 : 0.85}
                    stroke={barStroke} strokeWidth={barStrokeW}
                    style={editable && ed ? { cursor: "move" } : undefined}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={editable && ed ? (e) => startBarDrag(e, t.id, "move", sd, ed) : undefined} />}
                  {sd && bW > 28 && <text x={bX + bW / 2} y={y + ROW_H / 2 + 4} fontSize={12} fill="#333" fontWeight={600} textAnchor="middle" style={{ pointerEvents: "none" }}>{dauer}d</text>}
                  {showDates && <text x={bX + bW + 3} y={y + ROW_H / 2 + 4} fontSize={11} fill={dateColor}
                    style={{ cursor: editable ? "pointer" : "default" }}
                    onClick={editable ? (e) => { e.stopPropagation(); setEditingTaskId(t.id); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "end", value: fmtDMY(ed!), x: r.left, y: r.bottom }); } : undefined}
                  >{fmtDatum(ed!, longDates)}</text>}
                  {editable && sd && ed && bW > 8 && (<>
                    <rect x={bX} y={y + 3} width={handleW} height={ROW_H - 6} rx={1} fill="rgba(255,255,255,.3)" style={{ cursor: "ew-resize" }} onMouseDown={e => startBarDrag(e, t.id, "start", sd, ed)} />
                    <rect x={bX + bW - handleW} y={y + 3} width={handleW} height={ROW_H - 6} rx={1} fill="rgba(255,255,255,.3)" style={{ cursor: "ew-resize" }} onMouseDown={e => startBarDrag(e, t.id, "end", sd, ed)} />
                  </>)}
                </g>
              );
            })}
            {currentTag >= 0 && (
              <g style={{ cursor: "ew-resize" }} onMouseDown={startNeedleDrag as any} onClick={e => e.stopPropagation()}>
                <rect x={nadelX - 10} y={0} width={20} height={bodyH} fill="transparent" />
                <line x1={nadelX} y1={0} x2={nadelX} y2={bodyH} stroke={nadelStil === "ghost" ? "#EAB308" : "#e63946"} strokeWidth={1.5} strokeDasharray={nadelStil === "ghost" ? "6 3" : "none"} />
              </g>
            )}
          </svg>
        </div>
      </div>

      {calEdit && onDateChange && (
        <div style={{ position: "fixed", left: calEdit.x, top: calEdit.y, zIndex: 300 }}>
          <DatePicker value={calEdit.value} defaultOpen onChange={(val: string) => {
            const t = sorted.find(s => s.task.id === calEdit.taskId)?.task;
            if (!t) return;
            const iso = val.split(".").reverse().join("-");
            if (calEdit.field === "start") onDateChange(t.id, iso, t.end);
            else onDateChange(t.id, t.start, iso);
            setCalEdit(null);
            setEditingTaskId(null);
          }} />
          <div style={{ position: "fixed", inset: 0, zIndex: -1 }} onClick={() => { setCalEdit(null); setEditingTaskId(null); }} />
        </div>
      )}
    </div>
  );
}