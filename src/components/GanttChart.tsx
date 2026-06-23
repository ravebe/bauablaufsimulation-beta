// GanttChart.tsx — SVG Gantt mit Zoom, zentrierter Nadel, Task-Klick
import { useRef, useState, useEffect, useCallback } from "react";
import type { Task } from "../types";
import { parseDateUniversal, formatDatum } from "../types";

interface Props {
  tasks: Task[];
  currentTag: number;
  totalTage: number;
  minDate: Date | null;
  laeuft: boolean;
  onTaskClick?: (idx: number) => void;
  selTaskId?: string | null;
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 22;
const LABEL_W = 130;
const HEAD_H = 28;
const MIN_PX = 0.5;  // max zoom out
const MAX_PX = 40;   // max zoom in (halber Tag sichtbar)

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, selTaskId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(6);

  // Initialen Zoom berechnen: gesamter Ablauf passt in Ansicht
  useEffect(() => {
    if (!containerRef.current || totalTage <= 0) return;
    const viewW = containerRef.current.clientWidth - LABEL_W;
    const initial = Math.max(MIN_PX, Math.min(12, viewW / totalTage));
    setPxProTag(initial);
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

  // Nadel zentriert halten
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !minDate || totalTage <= 0) return;
    const nadelX = LABEL_W + currentTag * pxProTag;
    const viewW = el.clientWidth;
    el.scrollLeft = Math.max(0, nadelX - viewW / 2);
  }, [currentTag, pxProTag, minDate, totalTage]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks für Gantt-Ansicht</div>;
  }

  const chartW = Math.max(totalTage * pxProTag, 200);
  const totalW = LABEL_W + chartW;
  const totalH = HEAD_H + tasks.length * ROW_H;

  // Monats/Wochen/Tage-Marker je nach Zoom
  const markers: { x: number; label: string; major: boolean }[] = [];
  let lastLabel = "";
  for (let d = 0; d <= totalTage; d++) {
    const date = new Date(minDate.getTime() + d * 86400000);
    const x = LABEL_W + d * pxProTag;

    if (pxProTag >= 20) {
      // Tages-Ansicht
      const label = `${date.getDate()}.${date.getMonth() + 1}`;
      if (label !== lastLabel) { markers.push({ x, label, major: date.getDate() === 1 }); lastLabel = label; }
    } else if (pxProTag >= 4) {
      // Wochen-Ansicht
      if (date.getDay() === 1) {
        const label = `${date.getDate()}.${date.getMonth() + 1}`;
        markers.push({ x, label, major: date.getDate() <= 7 });
      }
      if (date.getDate() === 1 && date.getDay() !== 1) {
        const monat = date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
        markers.push({ x, label: monat, major: true });
      }
    } else {
      // Monats-Ansicht
      if (date.getDate() === 1) {
        const monat = date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
        if (monat !== lastLabel) { markers.push({ x, label: monat, major: true }); lastLabel = monat; }
      }
    }
  }

  const nadelX = LABEL_W + currentTag * pxProTag;

  return (
    <div ref={containerRef} style={{ overflowX: "auto", overflowY: "auto", border: "1px solid #d4dce4", background: "#fff", cursor: "default" }}>
      <svg width={totalW} height={totalH} style={{ display: "block", minWidth: totalW }}>
        {/* Header */}
        <rect x={0} y={0} width={totalW} height={HEAD_H} fill="#f5f7f9" />
        <line x1={0} y1={HEAD_H} x2={totalW} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.5} />

        {/* Zeitachse-Marker */}
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={m.x} y1={0} x2={m.x} y2={totalH} stroke={m.major ? "#d4dce4" : "#eef1f4"} strokeWidth={m.major ? 0.8 : 0.4} />
            <text x={m.x + 3} y={m.major ? 13 : 22} fontSize={m.major ? 9 : 8} fontWeight={m.major ? 600 : 400} fill={m.major ? "#555" : "#8a9baa"}>{m.label}</text>
          </g>
        ))}

        {/* Label-Spalte Trennlinie */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={totalH} stroke="#d4dce4" strokeWidth={1} />

        {/* Task-Zeilen */}
        {tasks.map((t, i) => {
          const y = HEAD_H + i * ROW_H;
          const sd = parseDateUniversal(t.start);
          const ed = parseDateUniversal(t.end);
          const startTag = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
          const endTag = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : startTag + 1;
          const dauer = Math.max(1, Math.round(endTag - startTag));
          const barX = LABEL_W + startTag * pxProTag;
          const barW = Math.max((endTag - startTag) * pxProTag, 3);
          const label = t.name.length > 18 ? t.name.slice(0, 16) + "…" : t.name;
          const istSel = selTaskId === t.id;

          return (
            <g key={t.id} style={{ cursor: "pointer" }} onClick={() => onTaskClick?.(i)}>
              {/* Hintergrund */}
              <rect x={0} y={y} width={totalW} height={ROW_H} fill={istSel ? "#e8f0fe" : i % 2 === 0 ? "#fafbfc" : "#fff"} />
              {/* Trennlinie */}
              <line x1={0} y1={y + ROW_H} x2={totalW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
              {/* Label + Tage */}
              <text x={4} y={y + 15} fontSize={10} fill={istSel ? "#2d7dbd" : "#333"} fontWeight={istSel ? 600 : 400}>{label}</text>
              <text x={LABEL_W - 4} y={y + 15} fontSize={8} fill="#8a9baa" textAnchor="end">{dauer}d</text>
              {/* Balken */}
              {sd && <rect x={barX} y={y + 4} width={barW} height={ROW_H - 8} rx={2} fill={FARBEN[t.typ] || "#6cc07a"} opacity={istSel ? 1 : 0.85} stroke={istSel ? "#2d7dbd" : "none"} strokeWidth={istSel ? 1.5 : 0} />}
              {/* Dauer im Balken */}
              {sd && barW > 25 && (
                <text x={barX + 4} y={y + ROW_H - 6} fontSize={7} fill="rgba(255,255,255,0.9)" fontWeight={700}>{dauer}d</text>
              )}
            </g>
          );
        })}

        {/* Playback-Nadel */}
        {currentTag > 0 && (
          <g>
            <line x1={nadelX} y1={0} x2={nadelX} y2={totalH} stroke="#e63946" strokeWidth={1.5} />
            <polygon points={`${nadelX - 5},0 ${nadelX + 5},0 ${nadelX},7`} fill="#e63946" />
            {/* Datum-Label */}
            <rect x={nadelX - 24} y={8} width={48} height={14} rx={2} fill="#e63946" />
            <text x={nadelX} y={18} fontSize={8} fill="#fff" textAnchor="middle" fontWeight={600}>
              {formatDatum(new Date(minDate.getTime() + currentTag * 86400000).toISOString().slice(0, 10))}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
