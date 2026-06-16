// GanttChart.tsx — Horizontales Gantt-Diagramm mit Zeitachse und Playback-Nadel
import { useRef, useEffect } from "react";
import type { Task } from "../types";
import { parseDateUniversal, formatDatum } from "../types";

interface Props {
  tasks: Task[];
  currentTag: number;
  totalTage: number;
  minDate: Date | null;
  laeuft: boolean;
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 24;
const LABEL_W = 160;
const HEAD_H = 32;

export default function GanttChart({ tasks, currentTag, totalTage, minDate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas zeichnen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !minDate || totalTage <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chartW = Math.max(totalTage * 6, 600);
    const chartH = HEAD_H + tasks.length * ROW_H + 10;
    canvas.width = (LABEL_W + chartW) * 2; // retina
    canvas.height = chartH * 2;
    canvas.style.width = `${LABEL_W + chartW}px`;
    canvas.style.height = `${chartH}px`;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, LABEL_W + chartW, chartH);
    ctx.font = "10px 'Segoe UI', sans-serif";

    // Hintergrund
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, LABEL_W + chartW, chartH);

    // Zeitachse Header
    ctx.fillStyle = "#f5f7f9";
    ctx.fillRect(LABEL_W, 0, chartW, HEAD_H);
    ctx.strokeStyle = "#e0e4e8";
    ctx.lineWidth = 0.5;

    // Monats-Labels + vertikale Linien
    const pxProTag = chartW / totalTage;
    let lastMonth = -1;
    for (let d = 0; d <= totalTage; d++) {
      const date = new Date(minDate.getTime() + d * 86400000);
      const m = date.getMonth();
      const x = LABEL_W + d * pxProTag;

      // Wochenanfang: feine Linie
      if (date.getDay() === 1) {
        ctx.beginPath(); ctx.moveTo(x, HEAD_H); ctx.lineTo(x, chartH);
        ctx.strokeStyle = "#f0f2f4"; ctx.stroke();
      }

      // Monatsanfang: Label + dickere Linie
      if (m !== lastMonth) {
        lastMonth = m;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH);
        ctx.strokeStyle = "#d4dce4"; ctx.stroke();
        const monat = date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
        ctx.fillStyle = "#555";
        ctx.font = "bold 10px 'Segoe UI', sans-serif";
        ctx.fillText(monat, x + 4, 14);
        ctx.font = "10px 'Segoe UI', sans-serif";
        // Tage des Monats
        ctx.fillStyle = "#8a9baa";
        ctx.fillText(`${date.getDate()}.`, x + 4, 26);
      }
    }

    // Zeilen
    for (let i = 0; i < tasks.length; i++) {
      const y = HEAD_H + i * ROW_H;
      const t = tasks[i];

      // Zebra
      if (i % 2 === 0) {
        ctx.fillStyle = "#fafbfc";
        ctx.fillRect(0, y, LABEL_W + chartW, ROW_H);
      }

      // Zeile: Trennlinie
      ctx.beginPath(); ctx.moveTo(0, y + ROW_H); ctx.lineTo(LABEL_W + chartW, y + ROW_H);
      ctx.strokeStyle = "#eef1f4"; ctx.lineWidth = 0.5; ctx.stroke();

      // Label links
      ctx.fillStyle = "#333";
      const label = t.name.length > 22 ? t.name.slice(0, 20) + "…" : t.name;
      ctx.fillText(label, 6, y + 16);

      // Balken
      const sd = parseDateUniversal(t.start);
      const ed = parseDateUniversal(t.end);
      if (sd && minDate) {
        const startTag = Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000);
        const endTag = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : startTag + 1;
        const barX = LABEL_W + startTag * pxProTag;
        const barW = Math.max((endTag - startTag) * pxProTag, 3);
        const barY = y + 5;
        const barH = ROW_H - 10;

        ctx.fillStyle = FARBEN[t.typ] || "#6cc07a";
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 2);
        ctx.fill();

        // Objekt-Count im Balken
        if (barW > 30 && t.objektGuids.length > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.font = "bold 8px 'Segoe UI', sans-serif";
          ctx.fillText(`${t.objektGuids.length}`, barX + 4, barY + barH - 2);
          ctx.font = "10px 'Segoe UI', sans-serif";
        }
      }
    }

    // Label-Spalte Trennlinie
    ctx.beginPath(); ctx.moveTo(LABEL_W, 0); ctx.lineTo(LABEL_W, chartH);
    ctx.strokeStyle = "#d4dce4"; ctx.lineWidth = 1; ctx.stroke();

    // Playback-Nadel
    if (currentTag > 0) {
      const nadelX = LABEL_W + currentTag * pxProTag;
      ctx.beginPath(); ctx.moveTo(nadelX, 0); ctx.lineTo(nadelX, chartH);
      ctx.strokeStyle = "#e63946"; ctx.lineWidth = 1.5; ctx.stroke();
      // Dreieck oben
      ctx.fillStyle = "#e63946";
      ctx.beginPath();
      ctx.moveTo(nadelX - 5, 0); ctx.lineTo(nadelX + 5, 0); ctx.lineTo(nadelX, 8);
      ctx.fill();
      // Datum-Label
      if (minDate) {
        const datumStr = formatDatum(new Date(minDate.getTime() + currentTag * 86400000).toISOString().slice(0, 10));
        ctx.fillStyle = "#e63946";
        ctx.font = "bold 9px 'Segoe UI', sans-serif";
        const tw = ctx.measureText(datumStr).width;
        ctx.fillRect(nadelX - tw / 2 - 3, 9, tw + 6, 13);
        ctx.fillStyle = "#fff";
        ctx.fillText(datumStr, nadelX - tw / 2, 19);
      }
    }
  }, [tasks, currentTag, totalTage, minDate]);

  // Auto-Scroll zur Nadel bei Playback
  useEffect(() => {
    if (!scrollRef.current || !minDate || totalTage <= 0) return;
    const chartW = Math.max(totalTage * 6, 600);
    const pxProTag = chartW / totalTage;
    const nadelX = LABEL_W + currentTag * pxProTag;
    const container = scrollRef.current;
    const viewW = container.clientWidth;
    if (nadelX > container.scrollLeft + viewW - 100 || nadelX < container.scrollLeft + LABEL_W) {
      container.scrollLeft = Math.max(0, nadelX - viewW / 2);
    }
  }, [currentTag, totalTage, minDate]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks für Gantt-Ansicht</div>;
  }

  return (
    <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: 300, border: "1px solid #d4dce4", background: "#fff" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}