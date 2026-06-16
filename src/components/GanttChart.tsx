// GanttChart.tsx — Horizontales Gantt-Diagramm mit Zeitachse und Playback-Nadel
import { useRef } from "react";
import type { Task } from "../types";
import { parseDateUniversal } from "../types";

interface Props {
  tasks: Task[];
  currentTag: number;
  totalTage: number;
  minDate: Date | null;
  laeuft: boolean;
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 22;
const LABEL_W = 140;
const HEAD_H = 28;

export default function GanttChart({ tasks, currentTag, totalTage, minDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks für Gantt-Ansicht</div>;
  }

  const pxProTag = Math.max(4, Math.min(12, 800 / totalTage));
  const chartW = Math.max(totalTage * pxProTag, 400);
  const totalW = LABEL_W + chartW;
  const totalH = HEAD_H + tasks.length * ROW_H;

  // Monats-Marker berechnen
  const monate: { x: number; label: string }[] = [];
  let lastMonth = -1;
  for (let d = 0; d <= totalTage; d++) {
    const date = new Date(minDate.getTime() + d * 86400000);
    if (date.getMonth() !== lastMonth) {
      lastMonth = date.getMonth();
      monate.push({ x: LABEL_W + d * pxProTag, label: date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" }) });
    }
  }

  const nadelX = LABEL_W + currentTag * pxProTag;

  return (
    <div ref={containerRef} style={{ overflowX: "auto", overflowY: "auto", border: "1px solid #d4dce4", background: "#fff" }}>
      <svg width={totalW} height={totalH} style={{ display: "block", minWidth: totalW }}>
        {/* Header Hintergrund */}
        <rect x={LABEL_W} y={0} width={chartW} height={HEAD_H} fill="#f5f7f9" />
        <line x1={LABEL_W} y1={HEAD_H} x2={totalW} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.5} />

        {/* Monats-Labels + Linien */}
        {monate.map((m, i) => (
          <g key={i}>
            <line x1={m.x} y1={0} x2={m.x} y2={totalH} stroke="#e0e4e8" strokeWidth={0.5} />
            <text x={m.x + 4} y={16} fontSize={9} fontWeight={600} fill="#555">{m.label}</text>
          </g>
        ))}

        {/* Label-Spalte Trennlinie */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={totalH} stroke="#d4dce4" strokeWidth={1} />

        {/* Zeilen */}
        {tasks.map((t, i) => {
          const y = HEAD_H + i * ROW_H;
          const sd = parseDateUniversal(t.start);
          const ed = parseDateUniversal(t.end);
          const startTag = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
          const endTag = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : startTag + 1;
          const barX = LABEL_W + startTag * pxProTag;
          const barW = Math.max((endTag - startTag) * pxProTag, 3);
          const label = t.name.length > 20 ? t.name.slice(0, 18) + "…" : t.name;

          return (
            <g key={t.id}>
              {/* Zebra */}
              {i % 2 === 0 && <rect x={0} y={y} width={totalW} height={ROW_H} fill="#fafbfc" />}
              {/* Trennlinie */}
              <line x1={0} y1={y + ROW_H} x2={totalW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
              {/* Label */}
              <text x={4} y={y + 15} fontSize={10} fill="#333">{label}</text>
              {/* Balken */}
              {sd && <rect x={barX} y={y + 4} width={barW} height={ROW_H - 8} rx={2} fill={FARBEN[t.typ] || "#6cc07a"} />}
              {/* Count */}
              {sd && barW > 25 && t.objektGuids.length > 0 && (
                <text x={barX + 3} y={y + ROW_H - 6} fontSize={7} fill="rgba(255,255,255,0.9)" fontWeight={700}>{t.objektGuids.length}</text>
              )}
            </g>
          );
        })}

        {/* Playback-Nadel */}
        {currentTag > 0 && (
          <g>
            <line x1={nadelX} y1={0} x2={nadelX} y2={totalH} stroke="#e63946" strokeWidth={1.5} />
            <polygon points={`${nadelX - 5},0 ${nadelX + 5},0 ${nadelX},7`} fill="#e63946" />
          </g>
        )}
      </svg>
    </div>
  );
}