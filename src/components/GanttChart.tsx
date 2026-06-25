import { useRef, useState, useEffect, useCallback } from "react";
import type { Task } from "../types";
import { parseDateUniversal } from "../types";

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
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 30;
const HEAD_H = 30;
const MIN_PX = 0.3;
const MAX_PX = 40;
const LS_LABEL_W = "4d-gantt-label-w";
const MONAT_VOLL = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONAT_KURZ = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, selTaskId, selGuids, taskSort, height }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(6);
  const [labelW, setLabelW] = useState(() => {
    try { return Number(localStorage.getItem(LS_LABEL_W)) || 140; } catch { return 140; }
  });
  const [zoomMode, setZoomMode] = useState(true); // true=zoom, false=scroll
  const needleDrag = useRef(false);
  const scrollLock = useRef(false);

  useEffect(() => { localStorage.setItem(LS_LABEL_W, String(labelW)); }, [labelW]);

  // Initial zoom
  useEffect(() => {
    if (!bodyRef.current || totalTage <= 0) return;
    setPxProTag(Math.max(MIN_PX, Math.min(10, bodyRef.current.clientWidth / totalTage)));
  }, [totalTage]);

  // Mausrad: Zoom ODER Scroll
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (zoomMode) {
        e.preventDefault();
        setPxProTag(prev => Math.max(MIN_PX, Math.min(MAX_PX, prev * (e.deltaY < 0 ? 1.15 : 0.87))));
      }
      // Scroll-Modus: Browser-Default (vertikal scrollen)
    };
    el.addEventListener("wheel", handler, { passive: !zoomMode });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomMode]);

  // Nadel zentrieren
  useEffect(() => {
    if (scrollLock.current) return;
    const el = bodyRef.current;
    if (!el || !minDate || totalTage <= 0) return;
    const target = Math.max(0, currentTag * pxProTag - el.clientWidth / 2);
    el.scrollLeft = target;
    if (headerRef.current) headerRef.current.scrollLeft = target;
  }, [currentTag, pxProTag, minDate, totalTage]);

  // Sync scroll
  const syncScroll = useCallback(() => {
    const b = bodyRef.current, h = headerRef.current, l = labelRef.current;
    if (b && h) h.scrollLeft = b.scrollLeft;
    if (b && l) l.scrollTop = b.scrollTop;
  }, []);

  // Nadel-Drag
  const startNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    needleDrag.current = true; scrollLock.current = true;
    const el = bodyRef.current;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      if (!needleDrag.current || !el) return;
      const x = ev.clientX - el.getBoundingClientRect().left + el.scrollLeft;
      onSliderChange?.(Math.max(0, Math.min(totalTage, Math.round(x / pxProTag))));
    };
    const onUp = () => {
      needleDrag.current = false;
      setTimeout(() => { scrollLock.current = false; }, 300);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pxProTag, totalTage, onSliderChange]);

  // Label-Resize
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = labelW;
    const onMove = (ev: MouseEvent) => setLabelW(Math.max(60, Math.min(300, startW + ev.clientX - startX)));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [labelW]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks</div>;
  }

  // Sortierung
  const sorted = tasks.map((t, i) => ({ task: t, origIdx: i }));
  if (taskSort === "datum") {
    sorted.sort((a, b) => {
      const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0, sb = parseDateUniversal(b.task.start)?.getTime() ?? 0;
      if (sa !== sb) return sa - sb;
      return (parseDateUniversal(a.task.end)?.getTime() ?? sa) - (parseDateUniversal(b.task.end)?.getTime() ?? sb);
    });
  } else if (taskSort === "aktiv") {
    sorted.sort((a, b) => {
      const aH = selGuids?.size && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
      const bH = selGuids?.size && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
      return bH - aH;
    });
  }

  const chartW = Math.max(totalTage * pxProTag, 200);
  const bodyH = sorted.length * ROW_H;

  // Monats-Marker
  const rawM: { x: number; m: number; y: number }[] = [];
  for (let d = 0; d <= totalTage; d++) {
    const dt = new Date(minDate.getTime() + d * 86400000);
    if (dt.getDate() === 1) rawM.push({ x: d * pxProTag, m: dt.getMonth(), y: dt.getFullYear() });
  }
  if (rawM.length === 0 || rawM[0].x > 20) rawM.unshift({ x: 0, m: minDate.getMonth(), y: minDate.getFullYear() });

  let mode: "full" | "short" | "year" = "full";
  if (rawM.length > 1) {
    const avg = rawM.reduce((s, m, i) => i > 0 ? s + (m.x - rawM[i - 1].x) : s, 0) / (rawM.length - 1);
    if (avg < 22) mode = "year"; else if (avg < 48) mode = "short";
  }

  let hLabels: { x: number; label: string }[] = [];
  if (mode === "year") {
    let ly = -1;
    for (const m of rawM) { if (m.y !== ly) { hLabels.push({ x: m.x, label: String(m.y) }); ly = m.y; } }
  } else if (mode === "short") {
    hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_KURZ[m.m]} ${String(m.y).slice(2)}` }));
  } else {
    hLabels = rawM.map(m => ({ x: m.x, label: `${MONAT_VOLL[m.m]} ${String(m.y).slice(2)}` }));
  }

  // Tages-Marker (nur bei genug Zoom)
  const tageMarkers: { x: number; label: string }[] = [];
  if (pxProTag >= 15) {
    for (let d = 0; d <= totalTage; d++) {
      const dt = new Date(minDate.getTime() + d * 86400000);
      if (dt.getDate() !== 1) tageMarkers.push({ x: d * pxProTag, label: `${dt.getDate()}` });
    }
  }

  const nadelX = currentTag * pxProTag;
  const containerH = height ?? 350;

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid #d4dce4", background: "#fff", height: containerH, overflow: "hidden" }}>
      {/* HEADER (fixiert) */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        {/* Header links */}
        <div style={{ width: labelW, flexShrink: 0, height: HEAD_H, background: "#f5f7f9", borderBottom: "1px solid #d4dce4", borderRight: "1px solid #d4dce4",
          display: "flex", alignItems: "center", padding: "0 6px", position: "relative" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#555" }}>Task</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#8a9baa", display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setZoomMode(z => !z)} title={zoomMode ? "Modus: Zoom → Scroll" : "Modus: Scroll → Zoom"}
              style={{ fontSize: 9, padding: "1px 4px", border: "1px solid #ccc", borderRadius: 3, background: zoomMode ? "#e8f0fe" : "#fff", cursor: "pointer", fontFamily: "inherit", color: "#555" }}>
              {zoomMode ? "🔍" : "↕"}
            </button>
          </span>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>
        {/* Header rechts: Zeitachse */}
        <div ref={headerRef} style={{ flex: 1, height: HEAD_H, overflow: "hidden", background: "#f5f7f9", borderBottom: "1px solid #d4dce4" }}>
          <svg width={chartW} height={HEAD_H} style={{ display: "block" }}>
            {hLabels.map((m, i) => (
              <g key={`h${i}`}>
                <line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.6} />
                <text x={m.x + 4} y={13} fontSize={10} fontWeight={600} fill="#555">{m.label}</text>
              </g>
            ))}
            {tageMarkers.map((m, i) => (
              <text key={`t${i}`} x={m.x + 2} y={25} fontSize={8} fill="#999">{m.label}</text>
            ))}
            {currentTag >= 0 && <polygon points={`${nadelX - 5},${HEAD_H} ${nadelX + 5},${HEAD_H} ${nadelX},${HEAD_H - 6}`} fill="#e63946" />}
          </svg>
        </div>
      </div>

      {/* BODY (scrollbar) */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Labels links (vertikal sync) */}
        <div ref={labelRef} style={{ width: labelW, flexShrink: 0, overflowY: "hidden", overflowX: "hidden", borderRight: "1px solid #d4dce4", position: "relative" }}>
          <div style={{ height: bodyH }}>
            {sorted.map(({ task: t, origIdx }, i) => {
              const sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
              const isSel = selTaskId === t.id;
              const hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              const maxC = Math.max(4, Math.floor((labelW - 40) / 7));
              const lbl = t.name.length > maxC ? t.name.slice(0, maxC - 1) + "…" : t.name;
              return (
                <div key={t.id} onClick={() => onTaskClick?.(origIdx)} style={{
                  height: ROW_H, display: "flex", alignItems: "center", padding: "0 6px", cursor: "pointer",
                  borderBottom: "1px solid #eef1f4",
                  background: isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginRight: 5, background: FARBEN[t.typ] || "#6cc07a" }} />
                  <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: isSel ? "#2d7dbd" : "#333", fontWeight: isSel ? 600 : 400 }}>{lbl}</span>
                  <span style={{ fontSize: 10, color: "#8a9baa", flexShrink: 0 }}>{dauer}d</span>
                </div>
              );
            })}
          </div>
          <div onMouseDown={startResize} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
        </div>

        {/* Chart rechts (scrollbar H+V) */}
        <div ref={bodyRef} onScroll={syncScroll} style={{ flex: 1, overflow: "auto" }}>
          <svg width={chartW} height={bodyH} style={{ display: "block" }}>
            {/* Monats-Linien */}
            {rawM.map((m, i) => <line key={`ml${i}`} x1={m.x} y1={0} x2={m.x} y2={bodyH} stroke="#d4dce4" strokeWidth={0.6} />)}
            {/* Tages-Linien */}
            {pxProTag >= 15 && tageMarkers.map((m, i) => <line key={`tl${i}`} x1={m.x} y1={0} x2={m.x} y2={bodyH} stroke="#f0f2f4" strokeWidth={0.3} />)}

            {/* Balken */}
            {sorted.map(({ task: t }, i) => {
              const y = i * ROW_H;
              const sd = parseDateUniversal(t.start), ed = parseDateUniversal(t.end);
              const sT = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
              const eT = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : sT + 1;
              const dauer = Math.max(1, Math.round(eT - sT));
              const bX = sT * pxProTag, bW = Math.max((eT - sT) * pxProTag, 3);
              const isSel = selTaskId === t.id;
              const hasSel = selGuids?.size ? t.objektGuids.some(g => selGuids!.has(g)) : false;
              return (
                <g key={t.id}>
                  <rect x={0} y={y} width={chartW} height={ROW_H} fill={isSel ? "#e8f0fe" : hasSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff"} />
                  <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
                  {sd && <rect x={bX} y={y + 5} width={bW} height={ROW_H - 10} rx={3}
                    fill={FARBEN[t.typ] || "#6cc07a"} opacity={isSel ? 1 : 0.85}
                    stroke={isSel ? "#2d7dbd" : "none"} strokeWidth={isSel ? 1.5 : 0} />}
                  {sd && bW > 28 && <text x={bX + 5} y={y + ROW_H - 9} fontSize={9} fill="rgba(255,255,255,.9)" fontWeight={600}>{dauer}d</text>}
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
    </div>
  );
}
