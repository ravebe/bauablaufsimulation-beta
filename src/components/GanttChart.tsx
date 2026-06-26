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
  selTaskId?: string | null;
  selGuids?: Set<string>;
  taskSort?: "gantt" | "datum" | "aktiv";
  height?: number;
  editable?: boolean;
  onDateChange?: (taskId: string, newStart: string, newEnd: string) => void;
  scrollTopRef?: React.MutableRefObject<number>;
  scrollLeftRef?: React.MutableRefObject<number>;
  zoomRef?: React.MutableRefObject<number>;
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 28;
const HEAD_H = 34;
const MIN_PX = 0.3;
const MAX_PX = 40;
const LS_LABEL_W = "4d-gantt-label-w";
const MONAT_VOLL = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONAT_KURZ = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function fmtISO(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fmtDatum(d: Date, lang: boolean): string {
  if (lang) return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
  return `${d.getDate()}.${d.getMonth()+1}`;
}
function fmtDMY(d: Date): string { return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; }

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, selTaskId, selGuids, taskSort, height, editable, onDateChange, scrollTopRef, scrollLeftRef, zoomRef }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(() => zoomRef?.current || 6);
  const [labelW, setLabelW] = useState(() => { try { return Number(localStorage.getItem(LS_LABEL_W)) || 140; } catch { return 140; } });
  const needleDrag = useRef(false);
  const scrollLock = useRef(false);
  const [calEdit, setCalEdit] = useState<{ taskId: string; field: "start" | "end"; value: string; x: number; y: number } | null>(null);

  useEffect(() => { localStorage.setItem(LS_LABEL_W, String(labelW)); }, [labelW]);
  useEffect(() => { if (zoomRef) zoomRef.current = pxProTag; }, [pxProTag]);

  // Initial zoom
  useEffect(() => {
    if (zoomRef?.current && zoomRef.current !== 6) { setPxProTag(zoomRef.current); return; }
    if (!bodyRef.current || totalTage <= 0) return;
    setPxProTag(Math.max(MIN_PX, Math.min(10, bodyRef.current.clientWidth / totalTage)));
  }, [totalTage]);

  // Restore scroll position
  useEffect(() => {
    const b = bodyRef.current, l = labelRef.current;
    if (b && scrollLeftRef) b.scrollLeft = scrollLeftRef.current;
    if (b && scrollTopRef) { b.scrollTop = scrollTopRef.current; if (l) l.scrollTop = scrollTopRef.current; }
  }, []);

  // Wheel in chart = zoom
  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const handler = (e: WheelEvent) => { e.preventDefault(); setPxProTag(prev => Math.max(MIN_PX, Math.min(MAX_PX, prev * (e.deltaY < 0 ? 1.15 : 0.87)))); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Needle centering
  useEffect(() => {
    if (scrollLock.current || scrollLeftRef?.current) return;
    const el = bodyRef.current; if (!el || !minDate || totalTage <= 0) return;
    el.scrollLeft = Math.max(0, currentTag * pxProTag - el.clientWidth / 2);
    if (headerRef.current) headerRef.current.scrollLeft = el.scrollLeft;
  }, [currentTag, pxProTag, minDate, totalTage]);

  const syncScroll = useCallback(() => {
    const b = bodyRef.current, h = headerRef.current, l = labelRef.current;
    if (b && h) h.scrollLeft = b.scrollLeft;
    if (b && l) l.scrollTop = b.scrollTop;
    if (b && scrollLeftRef) scrollLeftRef.current = b.scrollLeft;
    if (b && scrollTopRef) scrollTopRef.current = b.scrollTop;
  }, [scrollLeftRef, scrollTopRef]);

  const startNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    needleDrag.current = true; scrollLock.current = true;
    const el = bodyRef.current; if (!el) return;
    const onMove = (ev: MouseEvent) => { if (!needleDrag.current || !el) return; onSliderChange?.(Math.max(0, Math.min(totalTage, Math.round((ev.clientX - el.getBoundingClientRect().left + el.scrollLeft) / pxProTag)))); };
    const onUp = () => { needleDrag.current = false; setTimeout(() => { scrollLock.current = false; }, 300); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [pxProTag, totalTage, onSliderChange]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sw = labelW;
    const onMove = (ev: MouseEvent) => setLabelW(Math.max(60, Math.min(300, sw + ev.clientX - sx)));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [labelW]);

  const startBarDrag = useCallback((e: React.MouseEvent, taskId: string, mode: "start" | "end" | "move", origStart: Date, origEnd: Date) => {
    if (!editable || !minDate || !onDateChange) return;
    e.preventDefault(); e.stopPropagation();
    scrollLock.current = true;
    const sx = e.clientX, oS = (origStart.getTime() - minDate.getTime()) / 86400000, oE = (origEnd.getTime() - minDate.getTime()) / 86400000, dur = oE - oS;
    const onMove = (ev: MouseEvent) => {
      const dd = Math.round((ev.clientX - sx) / pxProTag);
      let nS = oS, nE = oE;
      if (mode === "start") { nS = Math.max(0, oS + dd); if (nS >= nE) nS = nE - 1; }
      else if (mode === "end") { nE = Math.max(nS + 1, oE + dd); }
      else { nS = Math.max(0, oS + dd); nE = nS + dur; }
      onDateChange(taskId, fmtISO(new Date(minDate.getTime() + nS * 86400000)), fmtISO(new Date(minDate.getTime() + nE * 86400000)));
    };
    const onUp = () => { setTimeout(() => { scrollLock.current = false; }, 200); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [editable, minDate, pxProTag, onDateChange]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks</div>;

  const sorted = tasks.map((t, i) => ({ task: t, origIdx: i }));
  if (taskSort === "datum") sorted.sort((a, b) => { const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0, sb = parseDateUniversal(b.task.start)?.getTime() ?? 0; return sa !== sb ? sa - sb : (parseDateUniversal(a.task.end)?.getTime() ?? sa) - (parseDateUniversal(b.task.end)?.getTime() ?? sb); });
  else if (taskSort === "aktiv") sorted.sort((a, b) => { const aH = selGuids?.size && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0; return (selGuids?.size && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0) - aH; });

  const chartW = Math.max(totalTage * pxProTag, 200);
  const bodyH = sorted.length * ROW_H;
  const longDates = pxProTag >= 8;

  // Monats-Marker
  const rawM: { x: number; m: number; y: number }[] = [];
  for (let d = 0; d <= totalTage; d++) { const dt = new Date(minDate.getTime() + d * 86400000); if (dt.getDate() === 1) rawM.push({ x: d * pxProTag, m: dt.getMonth(), y: dt.getFullYear() }); }
  if (rawM.length === 0 || rawM[0].x > 20) rawM.unshift({ x: 0, m: minDate.getMonth(), y: minDate.getFullYear() });

  let mode: "full" | "short" | "year" = "full";
  if (rawM.length > 1) { const avg = rawM.reduce((s, m, i) => i > 0 ? s + (m.x - rawM[i-1].x) : s, 0) / (rawM.length - 1); if (avg < 22) mode = "year"; else if (avg < 48) mode = "short"; }

  let hLabels: { x: number; label: string }[] = [];
  if (mode === "year") { let ly = -1; for (const m of rawM) { if (m.y !== ly) { hLabels.push({ x: m.x, label: String(m.y) }); ly = m.y; } } }
  else if (mode === "short") hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_KURZ[m.m]} ${String(m.y).slice(2)}` }));
  else hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_VOLL[m.m]} ${String(m.y).slice(2)}` }));
  if (hLabels.length === 0) hLabels.push({ x: 0, label: `${MONAT_VOLL[minDate.getMonth()]} ${String(minDate.getFullYear()).slice(2)}` });

  const tageM: { x: number; label: string }[] = [];
  if (pxProTag >= 15) { for (let d = 0; d <= totalTage; d++) { const dt = new Date(minDate.getTime() + d * 86400000); if (dt.getDate() !== 1) tageM.push({ x: d * pxProTag, label: `${dt.getDate()}` }); } }

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
            {hLabels.map((m, i) => (<g key={`h${i}`}><line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.6} /><text x={m.x + 4} y={14} fontSize={11} fontWeight={600} fill="#555">{m.label}</text></g>))}
            {tageM.map((m, i) => <text key={`t${i}`} x={m.x + pxProTag/2} y={28} fontSize={10} fill="#888" textAnchor="middle">{m.label}</text>)}
            {currentTag >= 0 && <polygon points={`${nadelX-5},${HEAD_H} ${nadelX+5},${HEAD_H} ${nadelX},${HEAD_H-6}`} fill="#e63946" />}
          </svg>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Labels — scrollbar vertikal */}
        <div ref={labelRef} style={{ width: labelW, flexShrink: 0, overflowY: "auto", overflowX: "hidden", borderRight: "1px solid #d4dce4", position: "relative" }}
          onScroll={() => { const l = labelRef.current, b = bodyRef.current; if (l && b) b.scrollTop = l.scrollTop; }}>
          <div style={{ height: bodyH }}>
            {sorted.map(({ task: t, origIdx }, i) => {
              const sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
              const isSel = selTaskId === t.id, hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const maxC = Math.max(4, Math.floor((labelW - 40) / 7));
              const lbl = t.name.length > maxC ? t.name.slice(0, maxC - 1) + "…" : t.name;
              return (
                <div key={t.id} onClick={() => onTaskClick?.(origIdx)} style={{
                  height: ROW_H, display: "flex", alignItems: "center", padding: "0 6px", cursor: "pointer",
                  borderBottom: "1px solid #eef1f4",
                  background: isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginRight: 5, background: FARBEN[t.typ] || "#6cc07a" }} />
                  <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isSel ? "#2d7dbd" : "#333", fontWeight: isSel ? 600 : 400 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: "#8a9baa", flexShrink: 0 }}>{dauer}d</span>
                </div>
              );
            })}
          </div>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>

        {/* Chart */}
        <div ref={bodyRef} onScroll={syncScroll} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <svg width={chartW} height={bodyH} style={{ display: "block" }}>
            {rawM.map((m, i) => <line key={`ml${i}`} x1={m.x} y1={0} x2={m.x} y2={bodyH} stroke="#d4dce4" strokeWidth={0.6} />)}
            {pxProTag >= 15 && tageM.map((m, i) => <line key={`tl${i}`} x1={m.x} y1={0} x2={m.x} y2={bodyH} stroke="#f0f2f4" strokeWidth={0.3} />)}

            {sorted.map(({ task: t }, i) => {
              const y = i * ROW_H, sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const sT = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
              const eT = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : sT + 1;
              const dauer = Math.max(1, Math.round(eT - sT));
              const bX = sT * pxProTag, bW = Math.max((eT - sT) * pxProTag, 3);
              const isSel = selTaskId === t.id, hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const handleW = Math.min(6, bW / 3);
              const showDates = sd && ed && pxProTag >= 2;
              return (
                <g key={t.id}>
                  <rect x={0} y={y} width={chartW} height={ROW_H} fill={isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff"} />
                  <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />

                  {/* Start-Datum vor Balken */}
                  {showDates && <text x={bX - 3} y={y + ROW_H / 2 + 4} fontSize={11} fill="#2d7dbd" textAnchor="end"
                    style={{ cursor: editable ? "pointer" : "default" }}
                    onClick={editable ? (e) => { e.stopPropagation(); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "start", value: fmtDMY(sd!), x: r.left, y: r.bottom }); } : undefined}
                  >{fmtDatum(sd!, longDates)}</text>}

                  {/* Balken */}
                  {sd && <rect x={bX} y={y + 5} width={bW} height={ROW_H - 10} rx={3}
                    fill={FARBEN[t.typ] || "#6cc07a"} opacity={isSel ? 1 : 0.85}
                    stroke={isSel ? "#2d7dbd" : "none"} strokeWidth={isSel ? 1.5 : 0}
                    style={editable && ed ? { cursor: "move" } : undefined}
                    onMouseDown={editable && ed ? (e) => startBarDrag(e, t.id, "move", sd, ed) : undefined} />}

                  {/* Dauer zentriert im Balken — schwarz, 12px */}
                  {sd && bW > 28 && <text x={bX + bW / 2} y={y + ROW_H / 2 + 4} fontSize={12} fill="#333" fontWeight={600} textAnchor="middle" style={{ pointerEvents: "none" }}>{dauer}d</text>}

                  {/* Ende-Datum nach Balken */}
                  {showDates && <text x={bX + bW + 3} y={y + ROW_H / 2 + 4} fontSize={11} fill="#2d7dbd"
                    style={{ cursor: editable ? "pointer" : "default" }}
                    onClick={editable ? (e) => { e.stopPropagation(); const r = (e.target as SVGElement).getBoundingClientRect(); setCalEdit({ taskId: t.id, field: "end", value: fmtDMY(ed!), x: r.left, y: r.bottom }); } : undefined}
                  >{fmtDatum(ed!, longDates)}</text>}

                  {/* Drag-Handles */}
                  {editable && sd && ed && bW > 8 && (<>
                    <rect x={bX} y={y + 3} width={handleW} height={ROW_H - 6} rx={1} fill="rgba(255,255,255,.3)" style={{ cursor: "ew-resize" }} onMouseDown={e => startBarDrag(e, t.id, "start", sd, ed)} />
                    <rect x={bX + bW - handleW} y={y + 3} width={handleW} height={ROW_H - 6} rx={1} fill="rgba(255,255,255,.3)" style={{ cursor: "ew-resize" }} onMouseDown={e => startBarDrag(e, t.id, "end", sd, ed)} />
                  </>)}
                </g>
              );
            })}

            {/* Nadel */}
            {currentTag >= 0 && (
              <g style={{ cursor: "ew-resize" }} onMouseDown={startNeedleDrag as any}>
                <rect x={nadelX - 10} y={0} width={20} height={bodyH} fill="transparent" />
                <line x1={nadelX} y1={0} x2={nadelX} y2={bodyH} stroke="#e63946" strokeWidth={1.5} />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* DatePicker Overlay */}
      {calEdit && onDateChange && (
        <div style={{ position: "fixed", left: calEdit.x, top: calEdit.y, zIndex: 300 }}>
          <DatePicker value={calEdit.value} onChange={(val: string) => {
            const t = sorted.find(s => s.task.id === calEdit.taskId)?.task;
            if (!t) return;
            const iso = val.split(".").reverse().join("-");
            if (calEdit.field === "start") onDateChange(t.id, iso, t.end);
            else onDateChange(t.id, t.start, iso);
            setCalEdit(null);
          }} />
          <div style={{ position: "fixed", inset: 0, zIndex: -1 }} onClick={() => setCalEdit(null)} />
        </div>
      )}
    </div>
  );
}
