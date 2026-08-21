import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../types";
import { parseDateUniversal, getOutlineLevel, istGruppe, gruppenDaten, berechneNummern, gueltigeVorgaenger, sucheSortiereTasks, nsKey } from "../types";
import DatePicker from "./DatePicker";
import { useDoppelklickHinweis } from "../hooks/useDoppelklickHinweis";

interface Props {
  projectId?: string | null;
  tasks: Task[];
  currentTag: number;
  totalTage: number;
  minDate: Date | null;
  laeuft: boolean;
  onTaskClick?: (idx: number, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onSliderChange?: (tag: number) => void;
  onNadelClick?: (tag: number) => void;
  selTaskId?: string | null;
  selectedIds?: string[];
  selGuids?: Set<string>;
  taskSort?: "gantt" | "datum" | "aktiv" | "name" | "nummer";
  height?: number;
  editable?: boolean;
  onDateChange?: (taskId: string, newStart: string, newEnd: string) => void;
  onTaskReorder?: (fromIdx: number, toIdx: number) => void;
  onTaskRename?: (taskId: string, newName: string) => void;
  onSetPredecessor?: (taskId: string, predId: string | null, lagDays: number) => void;
  showObjektCount?: boolean;
  suchQuery?: string;
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

export default function GanttChart({ projectId = null, tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, onNadelClick, selectedIds = [], selGuids, taskSort, height, editable, onDateChange, onTaskReorder, onTaskRename, onSetPredecessor, showObjektCount, suchQuery = "", nadelStil = "normal", dateColor = "#2d7dbd" }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const lsZoomKey = nsKey(LS_ZOOM, projectId);
  const lsLabelWKey = nsKey(LS_LABEL_W, projectId);
  const [pxProTag, setPxProTag] = useState(() => { try { return Number(localStorage.getItem(lsZoomKey)) || 6; } catch { return 6; } });
  const [labelW, setLabelW] = useState(() => { try { return Number(localStorage.getItem(lsLabelWKey)) || 140; } catch { return 140; } });
  const needleDrag = useRef(false);
  const scrollLock = useRef(false);
  const pxRef = useRef(pxProTag);
  useEffect(() => { pxRef.current = pxProTag; }, [pxProTag]);
  const initDone = useRef(false);
  const [calEdit, setCalEdit] = useState<{ taskId: string; field: "start" | "end"; value: string; x: number; y: number } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [ganttCollapsed, setGanttCollapsed] = useState<Set<string>>(new Set());
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  // Vorgänger-Auswahl (Popover per Portal)
  const [predPickerTaskId, setPredPickerTaskId] = useState<string | null>(null);
  const [predPos, setPredPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [predInput, setPredInput] = useState("");
  const [lagInput, setLagInput] = useState("0");
  const predPopoverRef = useRef<HTMLDivElement>(null);
  const { sichtbar: hinweisSichtbar, pos: hinweisPos, hinweisRef, melden } = useDoppelklickHinweis();

  useEffect(() => {
    if (!predPickerTaskId) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (predPopoverRef.current && !predPopoverRef.current.contains(e.target as Node)) setPredPickerTaskId(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [predPickerTaskId]);

  function oeffnePredPicker(t: Task, e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const POPOVER_W = 190;
    setPredPos({ top: r.bottom + 2, left: Math.min(r.right - POPOVER_W, window.innerWidth - POPOVER_W - 4) });
    setPredPickerTaskId(t.id);
    setPredInput(t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "");
    setLagInput(String(t.lagDays ?? 0));
  }

  useEffect(() => { localStorage.setItem(lsLabelWKey, String(labelW)); }, [lsLabelWKey, labelW]);
  useEffect(() => { localStorage.setItem(lsZoomKey, String(pxProTag)); }, [lsZoomKey, pxProTag]);

  // Drag safety: reset wenn abgebrochen
  useEffect(() => {
    if (dragIdx === null) return;
    const reset = () => { setDragIdx(null); setDropIdx(null); };
    window.addEventListener("dragend", reset);
    window.addEventListener("mouseup", reset);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("mouseup", reset); };
  }, [dragIdx]);

  // Initial zoom nur wenn kein gespeicherter Wert
  useEffect(() => {
    if (initDone.current) return; initDone.current = true;
    const saved = Number(localStorage.getItem(lsZoomKey));
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

  // Needle centering — nur wenn die Nadel den sichtbaren Bereich verlässt (nicht bei jedem
  // Frame während des Abspielens neu zentrieren, sonst zittert die Ansicht)
  const lastCentered = useRef(-999);
  useEffect(() => {
    if (scrollLock.current) return;
    if (currentTag < 0) return;
    if (currentTag === lastCentered.current) return;
    const el = bodyRef.current; if (!el || !minDate || totalTage <= 0) return;
    const nadelX = currentTag * pxProTag;
    const rand = el.clientWidth * 0.15;
    if (nadelX >= el.scrollLeft + rand && nadelX <= el.scrollLeft + el.clientWidth - rand) return;
    lastCentered.current = currentTag;
    el.scrollLeft = Math.max(0, nadelX - el.clientWidth / 2);
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
    const onMove = (ev: MouseEvent) => setLabelW(Math.max(60, sw + ev.clientX - sx));
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
  let allSorted = tasks.map((t, i) => ({ task: t, origIdx: i }));
  const istSuche = suchQuery.trim().length > 0;
  if (istSuche) {
    allSorted = sucheSortiereTasks(allSorted, e => e.task, suchQuery);
  } else if (taskSort === "datum") allSorted.sort((a, b) => { const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0, sb = parseDateUniversal(b.task.start)?.getTime() ?? 0; return sa !== sb ? sa - sb : (parseDateUniversal(a.task.end)?.getTime() ?? sa) - (parseDateUniversal(b.task.end)?.getTime() ?? sb); });
  else if (taskSort === "aktiv") allSorted.sort((a, b) => { const aH = selGuids?.size && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0; return (selGuids?.size && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0) - aH; });
  else if (taskSort === "name") allSorted.sort((a, b) => a.task.name.localeCompare(b.task.name, "de"));
  else if (taskSort === "nummer") { const ex = (s: string) => { const m = s.match(/\d+/g); return m ? parseInt(m[m.length - 1], 10) : Infinity; }; allSorted.sort((a, b) => { const na = ex(a.task.name), nb = ex(b.task.name); return na !== nb ? na - nb : a.task.name.localeCompare(b.task.name, "de"); }); }

  // Collapse-Filter: Kinder eingeklappter Gruppen ausblenden — bei aktiver Suche übersprungen,
  // damit Treffer aus eingeklappten Gruppen trotzdem angezeigt werden
  const sorted = istSuche ? allSorted : allSorted.filter(({ origIdx }) => {
    const level = getOutlineLevel(tasks[origIdx]);
    for (let p = origIdx - 1; p >= 0; p--) {
      const pLevel = getOutlineLevel(tasks[p]);
      if (pLevel < level && ganttCollapsed.has(tasks[p].id)) return false;
      if (pLevel < level) break;
    }
    return true;
  });

  const chartW = Math.max(totalTage * pxProTag, 200);
  const bodyH = sorted.length * ROW_H;
  const longDates = pxProTag >= 8;
  const nummern = useMemo(() => berechneNummern(tasks), [tasks]);

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
          onScroll={() => { const l = labelRef.current, b = bodyRef.current; if (l && b) b.scrollTop = l.scrollTop; }}
          onDragOver={e => {
            if (dragIdx === null) return;
            e.preventDefault();
            const rect = labelRef.current?.getBoundingClientRect();
            if (!rect) return;
            const y = e.clientY - rect.top + (labelRef.current?.scrollTop ?? 0);
            const rowIdx = Math.min(sorted.length, Math.max(0, Math.round(y / ROW_H)));
            const origI = rowIdx < sorted.length ? sorted[rowIdx].origIdx : tasks.length;
            setDropIdx(origI);
          }}
          onDrop={e => {
            e.preventDefault();
            if (dragIdx !== null && dropIdx !== null && onTaskReorder) onTaskReorder(dragIdx, dropIdx);
            setDragIdx(null); setDropIdx(null);
          }}>
          <div style={{ height: bodyH }}>
            {sorted.map(({ task: t, origIdx }, i) => {
              const sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
              const isSel = selectedIds.includes(t.id);
              const hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const isEditing = editingTaskId === t.id || calEdit?.taskId === t.id;
              const isGrp = t.isGroup || istGruppe(tasks, origIdx);
              const gDaten = isGrp ? gruppenDaten(tasks, origIdx) : null;
              const level = getOutlineLevel(t);
              const indent = (level - 1) * 12;
              const maxC = Math.max(4, Math.floor((labelW - 55 - indent) / 7));
              const lbl = t.name.length > maxC ? t.name.slice(0, maxC - 1) + "…" : t.name;
              const isDropTarget = dropIdx === origIdx;
              const istHover = hoverIdx === i;
              const canDrag = editable && (taskSort === "gantt" || taskSort === "aktiv");
              const collapsed = ganttCollapsed.has(t.id);
              const prevSelected = i > 0 && selectedIds.includes(sorted[i - 1]?.task.id);
              const showDropLine = isDropTarget && dragIdx !== null && dragIdx !== origIdx && !(isSel && prevSelected);
              return (
                <div key={t.id}>
                  {showDropLine && (
                    <div style={{ height: 2, background: "#2d7dbd", margin: "0 4px" }} />
                  )}
                  <div
                    onClick={(e) => onTaskClick?.(origIdx, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    style={{
                      height: ROW_H, display: "flex", alignItems: "center", padding: "0 4px", paddingLeft: 4 + indent, cursor: "pointer", borderBottom: "1px solid #eef1f4",
                      background: isGrp && isDropTarget && dragIdx !== null ? "#dbeafe" : isEditing ? "#FFF8E1" : isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : istHover ? "var(--tc-bg-hover)" : i % 2 === 0 ? "#fafbfc" : "#fff",
                      opacity: dragIdx !== null && selectedIds.includes(t.id) ? 0.4 : 1,
                    }}>
                    {/* Typ-Punkt/Auf-Zuklapp-Dreieck — beim Hover bzw. während des Ziehens vom Drag-Handle überblendet */}
                    <span style={{ width: 12, height: 12, flexShrink: 0, marginRight: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {canDrag && (dragIdx === origIdx || (istHover && dragIdx === null)) ? (
                        <span
                          draggable
                          onDragStart={e => { setDragIdx(origIdx); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                          onClick={e => { e.stopPropagation(); if (isGrp) setGanttCollapsed(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }); }}
                          style={{ cursor: "grab", color: "#8a9baa", fontSize: 13, userSelect: "none" }}
                          title="Ziehen zum Verschieben"
                        >☰</span>
                      ) : isGrp ? (
                        <span onClick={e => { e.stopPropagation(); setGanttCollapsed(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }); }}
                          style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${collapsed ? -90 : 0}deg)`, transition: "transform .15s", fontSize: 9, cursor: "pointer", color: "#555" }}>▼</span>
                      ) : (
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isEditing ? "#FF9800" : FARBEN[t.typ] || "#6cc07a" }} />
                      )}
                    </span>
                    {editable && renameId === t.id ? (
                      <input autoFocus value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && renameVal.trim()) { onTaskRename?.(t.id, renameVal.trim()); setRenameId(null); } if (e.key === "Escape") setRenameId(null); }}
                        onBlur={() => { if (renameVal.trim()) onTaskRename?.(t.id, renameVal.trim()); setRenameId(null); }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, fontSize: 11, padding: "0 2px", border: "1px solid #2d7dbd", outline: "none", fontFamily: "inherit", minWidth: 0, fontWeight: isGrp ? 700 : 400 }} />
                    ) : (
                      <span
                        onDoubleClick={editable ? (e) => { e.stopPropagation(); setRenameId(t.id); setRenameVal(t.name); } : undefined}
                        style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: editable ? "text" : "default", color: isEditing ? "#E65100" : isSel ? "#2d7dbd" : "#333", fontWeight: isEditing || isSel || isGrp ? 600 : 400 }}>{lbl}</span>
                    )}
                    <span style={{ flexShrink: 0, fontSize: 10, marginRight: 16, minWidth: 34, textAlign: "right" }} onClick={e => e.stopPropagation()}>
                      <span
                        onClick={editable ? (e) => oeffnePredPicker(t, e) : (e) => melden(`pred-${t.id}`, e.clientX, e.clientY)}
                        style={{ cursor: editable ? "pointer" : "default", fontWeight: 500, color: "#666" }}
                        title="Vorgänger festlegen">
                        {nummern.get(t.id) ?? ""}
                      </span>
                      {t.predecessorId && (
                        <span style={{ color: "#999", fontStyle: "italic" }}> | {nummern.get(t.predecessorId) ?? "?"}</span>
                      )}
                      {predPickerTaskId === t.id && createPortal(
                        <div ref={predPopoverRef}
                          style={{ position: "fixed", top: predPos.top, left: predPos.left, zIndex: 1000, background: "#fff",
                            border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", padding: 8, width: 190, fontWeight: 400, fontSize: 11 }}
                          onClick={e => e.stopPropagation()}>
                          <div style={{ position: "relative" }}>
                            <div style={{ fontSize: 9, color: "#8a9baa", marginBottom: 2 }}>Vorgänger (Nummer)</div>
                            <input className="ac-input" autoFocus style={{ fontSize: 11, padding: "3px 6px", width: "100%" }}
                              placeholder="— kein Vorgänger —"
                              value={predInput}
                              onChange={e => setPredInput(e.target.value)} />
                            <div className="ac-dropdown" style={{ maxHeight: 120 }}>
                              {gueltigeVorgaenger(tasks, t.id)
                                .filter(c => {
                                  const lbl = nummern.get(c.id) ?? "";
                                  return !predInput || lbl.toLowerCase().startsWith(predInput.trim().toLowerCase()) || c.name.toLowerCase().includes(predInput.trim().toLowerCase());
                                })
                                .slice(0, 20)
                                .map(c => (
                                  <div key={c.id} className="ac-item" style={{ fontSize: 11, padding: "3px 6px" }}
                                    onMouseDown={() => { onSetPredecessor?.(t.id, c.id, Number(lagInput) || 0); setPredPickerTaskId(null); }}>
                                    <span style={{ fontWeight: 600 }}>{nummern.get(c.id)}</span> — {c.name}
                                  </div>
                                ))}
                            </div>
                          </div>
                          <div style={{ fontSize: 9, color: "#8a9baa", marginTop: 6 }}>Wartetage nach Vorgänger-Ende</div>
                          <input type="number" className="ac-input" style={{ fontSize: 11, padding: "3px 6px", width: "100%", marginTop: 2 }}
                            value={lagInput}
                            onChange={e => setLagInput(e.target.value)} />
                          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                            <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 10 }}
                              onClick={() => { onSetPredecessor?.(t.id, null, 0); setPredPickerTaskId(null); }}>Entfernen</button>
                            <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10 }}
                              onClick={() => {
                                const treffer = gueltigeVorgaenger(tasks, t.id)
                                  .find(c => (nummern.get(c.id) ?? "").toLowerCase() === predInput.trim().toLowerCase());
                                if (treffer) onSetPredecessor?.(t.id, treffer.id, Number(lagInput) || 0);
                                setPredPickerTaskId(null);
                              }}>Übernehmen</button>
                          </div>
                        </div>,
                        document.body
                      )}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: "#8a9baa", minWidth: 33, textAlign: "right" }}>{
                      isGrp && showObjektCount
                        ? (() => { const ids: string[] = []; for (let ci = origIdx + 1; ci < tasks.length; ci++) { if (getOutlineLevel(tasks[ci]) <= getOutlineLevel(t)) break; ids.push(...tasks[ci].objektGuids); } const cnt = new Set(ids).size; return cnt > 0 ? `O ${cnt}` : ""; })()
                        : isGrp && gDaten ? `${gDaten.tage}d`
                        : showObjektCount ? (t.objektGuids.length > 0 ? `O ${t.objektGuids.length}` : "")
                        : `${dauer}d`
                    }</span>
                  </div>
                  {isGrp && showDropLine && (
                    <div style={{ height: 2, background: "#2d7dbd", margin: "0 4px" }} />
                  )}
                </div>
              );
            })}
          </div>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>

        <div ref={bodyRef} onScroll={syncScroll}
          onDragOver={e => {
            if (dragIdx === null) return;
            e.preventDefault();
            const rect = bodyRef.current?.getBoundingClientRect();
            if (!rect) return;
            const y = e.clientY - rect.top + (bodyRef.current?.scrollTop ?? 0);
            const rowIdx = Math.min(sorted.length, Math.max(0, Math.round(y / ROW_H)));
            const origI = rowIdx < sorted.length ? sorted[rowIdx].origIdx : tasks.length;
            setDropIdx(origI);
          }}
          onDrop={e => {
            e.preventDefault();
            if (dragIdx !== null && dropIdx !== null && onTaskReorder) onTaskReorder(dragIdx, dropIdx);
            setDragIdx(null); setDropIdx(null);
          }}
          style={{ flex: 1, overflow: "auto", position: "relative" }}>
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

            {sorted.map(({ task: t, origIdx }, i) => {
              const isGrp = t.isGroup || istGruppe(tasks, origIdx);
              const gDaten = isGrp ? gruppenDaten(tasks, origIdx) : null;
              const effStart = isGrp && gDaten ? gDaten.start : t.start;
              const effEnd = isGrp && gDaten ? gDaten.end : t.end;
              const y = i * ROW_H, sd = parseDateUniversal(effStart), ed = parseDateUniversal(effEnd);
              const sT = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
              const eT = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : sT + 1;
              const dauer = Math.max(1, Math.round(eT - sT));
              const bX = sT * pxProTag, bW = Math.max((eT - sT) * pxProTag, 3);
              const isSel = selectedIds.includes(t.id), hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const isEditing = editingTaskId === t.id || calEdit?.taskId === t.id;
              const handleW = Math.min(6, bW / 3);
              const showDates = sd && ed && pxProTag >= 2;
              const barFill = isEditing ? "#FFE0B2" : (FARBEN[t.typ] || "#6cc07a");
              const barStroke = isEditing ? "#FF9800" : (isSel ? "#2d7dbd" : "none");
              const barStrokeW = isEditing ? 2 : (isSel ? 1.5 : 0);

              if (isGrp) {
                // Gruppe: Klammer nach unten (MSP-Stil)
                const bracketY = y + ROW_H / 2 - 2;
                const bracketH = 6;
                const tickH = 4;
                return (
                  <g key={t.id}>
                    <rect x={0} y={y} width={chartW} height={ROW_H} fill={isSel ? "#e8f0fe" : "transparent"} />
                    <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
                    {sd && <>
                      <rect x={bX} y={bracketY} width={bW} height={bracketH} rx={1} fill="#555" opacity={0.8} />
                      <polygon points={`${bX},${bracketY + bracketH} ${bX + tickH},${bracketY + bracketH} ${bX},${bracketY + bracketH + tickH}`} fill="#555" />
                      <polygon points={`${bX + bW},${bracketY + bracketH} ${bX + bW - tickH},${bracketY + bracketH} ${bX + bW},${bracketY + bracketH + tickH}`} fill="#555" />
                    </>}
                    {showDates && <text x={bX - 3} y={y + ROW_H / 2 + 4} fontSize={11} fill="#888" textAnchor="end">{fmtDatum(sd!, longDates)}</text>}
                    {sd && bW > 40 && <text x={bX + bW / 2} y={y + ROW_H / 2 + 4} fontSize={11} fill="#555" fontWeight={600} textAnchor="middle" style={{ pointerEvents: "none" }}>{dauer}d</text>}
                    {showDates && <text x={bX + bW + 3} y={y + ROW_H / 2 + 4} fontSize={11} fill="#888">{fmtDatum(ed!, longDates)}</text>}
                  </g>
                );
              }

              return (
                <g key={t.id}>
                  <rect x={0} y={y} width={chartW} height={ROW_H} fill={isEditing ? "#FFF8E1" : isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : "transparent"} />
                  <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
                  {showDates && <text x={bX - 3} y={y + ROW_H / 2 + 4} fontSize={11} fill={dateColor} textAnchor="end"
                    style={{ cursor: editable ? "pointer" : "default" }}
                    onClick={editable ? (e) => { e.stopPropagation(); setEditingTaskId(t.id); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "start", value: fmtDMY(sd!), x: r.left, y: r.bottom }); } : (e) => melden(`start-${t.id}`, e.clientX, e.clientY)}
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
                    onClick={editable ? (e) => { e.stopPropagation(); setEditingTaskId(t.id); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "end", value: fmtDMY(ed!), x: r.left, y: r.bottom }); } : (e) => melden(`end-${t.id}`, e.clientX, e.clientY)}
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

      {hinweisSichtbar && createPortal(
        <div ref={hinweisRef} style={{ position: "fixed", left: hinweisPos?.left ?? -9999, top: hinweisPos?.top ?? -9999,
          visibility: hinweisPos ? "visible" : "hidden", zIndex: 2000,
          background: "#333", color: "#fff", fontSize: 11, fontFamily: "var(--tc-font)", padding: "4px 8px", borderRadius: 4,
          whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 2px 6px rgba(0,0,0,.25)" }}>
          Bearbeitung nur unter „Bauteile" möglich
        </div>,
        document.body
      )}
    </div>
  );
}