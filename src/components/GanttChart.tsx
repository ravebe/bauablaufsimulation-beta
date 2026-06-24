// GanttChart.tsx — SVG Gantt mit Zoom, Resize, Drag-Nadel, Task-Klick
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
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 22;
const HEAD_H = 24;
const MIN_PX = 0.3;
const MAX_PX = 40;
const LS_LABEL_W = "4d-gantt-label-w";

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, selTaskId, selGuids }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(6);
  const [labelW, setLabelW] = useState(() => {
    try { return Number(localStorage.getItem(LS_LABEL_W)) || 130; } catch { return 130; }
  });
  const isDraggingNeedle = useRef(false);
  const isDraggingLabel = useRef(false);
  const scrollLock = useRef(false);

  // Label-Breite speichern
  useEffect(() => { localStorage.setItem(LS_LABEL_W, String(labelW)); }, [labelW]);

  // Initialen Zoom
  useEffect(() => {
    if (!containerRef.current || totalTage <= 0) return;
    const viewW = containerRef.current.clientWidth - labelW;
    setPxProTag(Math.max(MIN_PX, Math.min(12, viewW / totalTage)));
  }, [totalTage]);

  // Mausrad → Zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setPxProTag(prev => {
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      return Math.max(MIN_PX, Math.min(MAX_PX, prev * factor));
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Nadel zentrieren (nur wenn nicht manuell gescrollt)
  useEffect(() => {
    if (scrollLock.current) return;
    const el = containerRef.current;
    if (!el || !minDate || totalTage <= 0) return;
    const nadelX = labelW + currentTag * pxProTag;
    const viewW = el.clientWidth;
    const target = Math.max(0, nadelX - viewW / 2);
    el.scrollLeft = target;
  }, [currentTag, pxProTag, labelW, minDate, totalTage]);

  // Nadel-Drag
  const startNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    isDraggingNeedle.current = true;
    scrollLock.current = true;
    const el = containerRef.current;
    if (!el) return;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingNeedle.current || !el) return;
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left + el.scrollLeft - labelW;
      const tag = Math.max(0, Math.min(totalTage, Math.round(x / pxProTag)));
      onSliderChange?.(tag);
    };
    const onUp = () => {
      isDraggingNeedle.current = false;
      setTimeout(() => { scrollLock.current = false; }, 200);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pxProTag, labelW, totalTage, onSliderChange]);

  // Label-Spalte Resize
  const startLabelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    isDraggingLabel.current = true;
    const startX = e.clientX;
    const startW = labelW;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingLabel.current) return;
      setLabelW(Math.max(60, Math.min(300, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      isDraggingLabel.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [labelW]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks</div>;
  }

  const chartW = Math.max(totalTage * pxProTag, 200);
  const totalW = labelW + chartW;
  const totalH = HEAD_H + tasks.length * ROW_H;

  // Zeitachse-Marker adaptiv
  const markers: { x: number; label: string; major: boolean }[] = [];
  let lastLabel = "";
  for (let d = 0; d <= totalTage; d++) {
    const date = new Date(minDate.getTime() + d * 86400000);
    const x = labelW + d * pxProTag;
    if (pxProTag >= 20) {
      const lbl = `${date.getDate()}.`;
      if (lbl !== lastLabel) { markers.push({ x, label: lbl, major: date.getDate() === 1 }); lastLabel = lbl; }
    } else if (pxProTag >= 4) {
      if (date.getDay() === 1) markers.push({ x, label: `${date.getDate()}.${date.getMonth() + 1}`, major: false });
      if (date.getDate() === 1) {
        markers.push({ x, label: date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" }), major: true });
      }
    } else {
      if (date.getDate() === 1) {
        const m = date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
        if (m !== lastLabel) { markers.push({ x, label: m, major: true }); lastLabel = m; }
      }
    }
  }

  const nadelX = labelW + currentTag * pxProTag;

  return (
    <div ref={containerRef} style={{ overflowX: "auto", overflowY: "auto", border: "1px solid #d4dce4", background: "#fff", position: "relative" }}>
      <svg width={totalW} height={totalH} style={{ display: "block", minWidth: totalW }}>
        {/* Header BG */}
        <rect x={0} y={0} width={totalW} height={HEAD_H} fill="#f5f7f9" />
        <line x1={0} y1={HEAD_H} x2={totalW} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.5} />

        {/* Zeitachse */}
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={m.x} y1={HEAD_H} x2={m.x} y2={totalH} stroke={m.major ? "#d4dce4" : "#eef1f4"} strokeWidth={m.major ? 0.8 : 0.4} />
            {m.major && <line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.5} />}
            <text x={m.x + 3} y={m.major ? 11 : 18} fontSize={m.major ? 9 : 7} fontWeight={m.major ? 600 : 400} fill={m.major ? "#555" : "#999"}>{m.label}</text>
          </g>
        ))}

        {/* Label-Spalte BG + Trennlinie */}
        <rect x={0} y={0} width={labelW} height={totalH} fill="#fff" opacity={0.95} />
        <line x1={labelW} y1={0} x2={labelW} y2={totalH} stroke="#d4dce4" strokeWidth={1} />

        {/* Resize-Handle für Label-Spalte */}
        <rect x={labelW - 3} y={0} width={6} height={totalH} fill="transparent" style={{ cursor: "col-resize" }}
          onMouseDown={startLabelResize as any} />

        {/* Task-Zeilen */}
        {tasks.map((t, i) => {
          const y = HEAD_H + i * ROW_H;
          const sd = parseDateUniversal(t.start);
          const ed = parseDateUniversal(t.end);
          const startTag = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
          const endTag = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : startTag + 1;
          const dauer = Math.max(1, Math.round(endTag - startTag));
          const barX = labelW + startTag * pxProTag;
          const barW = Math.max((endTag - startTag) * pxProTag, 3);
          const maxChars = Math.max(6, Math.floor((labelW - 30) / 6));
          const label = t.name.length > maxChars ? t.name.slice(0, maxChars - 1) + "…" : t.name;
          const istSel = selTaskId === t.id;
          const hatSel = selGuids && selGuids.size > 0 && t.objektGuids.some(g => selGuids.has(g));

          return (
            <g key={t.id} style={{ cursor: "pointer" }} onClick={() => onTaskClick?.(i)}>
              <rect x={0} y={y} width={totalW} height={ROW_H} fill={istSel ? "#e8f0fe" : hatSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff"} />
              <line x1={0} y1={y + ROW_H} x2={totalW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
              {/* Label */}
              <text x={4} y={y + 15} fontSize={10} fill={istSel ? "#2d7dbd" : "#333"} fontWeight={istSel ? 600 : 400}>{label}</text>
              <text x={labelW - 6} y={y + 15} fontSize={8} fill="#8a9baa" textAnchor="end">{dauer}d</text>
              {/* Balken */}
              {sd && <rect x={barX} y={y + 4} width={barW} height={ROW_H - 8} rx={2}
                fill={FARBEN[t.typ] || "#6cc07a"} opacity={istSel ? 1 : 0.85}
                stroke={istSel ? "#2d7dbd" : "none"} strokeWidth={istSel ? 1.5 : 0} />}
              {sd && barW > 25 && <text x={barX + 4} y={y + ROW_H - 6} fontSize={7} fill="rgba(255,255,255,0.9)" fontWeight={700}>{dauer}d</text>}
            </g>
          );
        })}

        {/* Playback-Nadel (klickbar zum Ziehen) */}
        {currentTag >= 0 && (
          <g style={{ cursor: "ew-resize" }} onMouseDown={startNeedleDrag as any}>
            <rect x={nadelX - 8} y={0} width={16} height={totalH} fill="transparent" />
            <line x1={nadelX} y1={HEAD_H} x2={nadelX} y2={totalH} stroke="#e63946" strokeWidth={1.5} />
            <polygon points={`${nadelX - 4},${HEAD_H} ${nadelX + 4},${HEAD_H} ${nadelX},${HEAD_H + 6}`} fill="#e63946" />
          </g>
        )}
      </svg>
    </div>
  );
}
