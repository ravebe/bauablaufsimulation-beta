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
}

const FARBEN: Record<string, string> = { neubau: "#6cc07a", bestand: "#999", abbruch: "#edb94c", temporaer: "#a0522d" };
const ROW_H = 30;
const HEAD_H = 32;
const MIN_PX = 0.3;
const MAX_PX = 40;
const LS_LABEL_W = "4d-gantt-label-w";

const MONAT_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export default function GanttChart({ tasks, currentTag, totalTage, minDate, onTaskClick, onSliderChange, selTaskId, selGuids, taskSort }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxProTag, setPxProTag] = useState(6);
  const [labelW, setLabelW] = useState(() => {
    try { return Number(localStorage.getItem(LS_LABEL_W)) || 140; } catch { return 140; }
  });
  const isDraggingNeedle = useRef(false);
  const isDraggingLabel = useRef(false);
  const scrollLock = useRef(false);

  useEffect(() => { localStorage.setItem(LS_LABEL_W, String(labelW)); }, [labelW]);

  // Initialer Zoom
  useEffect(() => {
    if (!scrollRef.current || totalTage <= 0) return;
    const viewW = scrollRef.current.clientWidth - labelW;
    setPxProTag(Math.max(MIN_PX, Math.min(10, viewW / totalTage)));
  }, [totalTage]);

  // Mausrad Zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setPxProTag(prev => Math.max(MIN_PX, Math.min(MAX_PX, prev * (e.deltaY < 0 ? 1.15 : 0.87))));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Nadel zentriert halten
  useEffect(() => {
    if (scrollLock.current) return;
    const el = scrollRef.current;
    if (!el || !minDate || totalTage <= 0) return;
    el.scrollLeft = Math.max(0, currentTag * pxProTag - el.clientWidth / 2);
  }, [currentTag, pxProTag, minDate, totalTage]);

  // Nadel-Drag
  const startNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    isDraggingNeedle.current = true;
    scrollLock.current = true;
    const el = scrollRef.current;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingNeedle.current || !el) return;
      const x = ev.clientX - el.getBoundingClientRect().left + el.scrollLeft;
      onSliderChange?.(Math.max(0, Math.min(totalTage, Math.round(x / pxProTag))));
    };
    const onUp = () => {
      isDraggingNeedle.current = false;
      setTimeout(() => { scrollLock.current = false; }, 300);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pxProTag, totalTage, onSliderChange]);

  // Label-Resize
  const startLabelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    isDraggingLabel.current = true;
    const startX = e.clientX, startW = labelW;
    const onMove = (ev: MouseEvent) => { if (isDraggingLabel.current) setLabelW(Math.max(60, Math.min(300, startW + ev.clientX - startX))); };
    const onUp = () => { isDraggingLabel.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [labelW]);

  if (!minDate || totalTage <= 0 || tasks.length === 0) {
    return <div style={{ padding: 12, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>Keine Tasks</div>;
  }

  // Sortierung anwenden
  const sortedTasks = tasks.map((t, i) => ({ task: t, origIdx: i }));
  if (taskSort === "datum") {
    sortedTasks.sort((a, b) => {
      const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0;
      const sb = parseDateUniversal(b.task.start)?.getTime() ?? 0;
      if (sa !== sb) return sa - sb;
      const ea = parseDateUniversal(a.task.end)?.getTime() ?? sa;
      const eb = parseDateUniversal(b.task.end)?.getTime() ?? sb;
      return ea - eb;
    });
  } else if (taskSort === "aktiv") {
    sortedTasks.sort((a, b) => {
      const aHat = selGuids && selGuids.size > 0 && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
      const bHat = selGuids && selGuids.size > 0 && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
      return bHat - aHat;
    });
  }

  const chartW = Math.max(totalTage * pxProTag, 200);
  const bodyH = sortedTasks.length * ROW_H;

  // Smart Monats-Labels
  const monatMarkers: { x: number; label: string }[] = [];
  for (let d = 0; d <= totalTage; d++) {
    const date = new Date(minDate.getTime() + d * 86400000);
    if (date.getDate() === 1) {
      monatMarkers.push({
        x: d * pxProTag,
        label: `${MONAT_KURZ[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`,
      });
    }
  }
  // Erster Tag auch wenn nicht 1.
  if (monatMarkers.length === 0 || monatMarkers[0].x > 20) {
    const d0 = minDate;
    monatMarkers.unshift({ x: 0, label: `${MONAT_KURZ[d0.getMonth()]} ${String(d0.getFullYear()).slice(2)}` });
  }

  // Überschneidungs-Check → kürzen
  let labelMode: "full" | "short" | "year" = "full";
  const minSpacing = 50;
  if (monatMarkers.length > 1) {
    const avgGap = monatMarkers.reduce((s, m, i) => i > 0 ? s + (m.x - monatMarkers[i - 1].x) : s, 0) / (monatMarkers.length - 1);
    if (avgGap < 25) labelMode = "year";
    else if (avgGap < minSpacing) labelMode = "short";
  }

  // Bei "year": nur Jahreswechsel
  let headerLabels: { x: number; label: string }[] = [];
  if (labelMode === "year") {
    let lastY = "";
    for (const m of monatMarkers) {
      const yr = m.label.split(" ")[1];
      if (yr !== lastY) { headerLabels.push({ x: m.x, label: `20${yr}` }); lastY = yr; }
    }
  } else if (labelMode === "short") {
    headerLabels = monatMarkers.map(m => ({ x: m.x, label: `${m.label[0]} ${m.label.split(" ")[1]}` }));
  } else {
    headerLabels = monatMarkers;
  }

  // Wochen-Linien
  const wochenLinien: number[] = [];
  if (pxProTag >= 2) {
    for (let d = 0; d <= totalTage; d++) {
      const date = new Date(minDate.getTime() + d * 86400000);
      if (date.getDay() === 1) wochenLinien.push(d * pxProTag);
    }
  }

  const nadelX = currentTag * pxProTag;

  return (
    <div style={{ display: "flex", border: "1px solid #d4dce4", background: "#fff", overflow: "hidden" }}>
      {/* FIXIERTE linke Spalte */}
      <div style={{ width: labelW, flexShrink: 0, borderRight: "1px solid #d4dce4", overflow: "hidden", position: "relative" }}>
        {/* Header */}
        <div style={{ height: HEAD_H, background: "#f5f7f9", borderBottom: "1px solid #d4dce4", display: "flex", alignItems: "center", padding: "0 6px" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#555" }}>Task</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#8a9baa" }}>Tage</span>
        </div>
        {/* Task-Zeilen */}
        <div style={{ overflowY: "hidden" }} className="gantt-labels">
          {sortedTasks.map(({ task: t, origIdx }, i) => {
            const sd = parseDateUniversal(t.start);
            const ed = parseDateUniversal(t.end);
            const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
            const istSel = selTaskId === t.id;
            const hatSel = selGuids && selGuids.size > 0 && t.objektGuids.some(g => selGuids.has(g));
            const maxC = Math.max(4, Math.floor((labelW - 40) / 7));
            const label = t.name.length > maxC ? t.name.slice(0, maxC - 1) + "…" : t.name;
            return (
              <div key={t.id} onClick={() => onTaskClick?.(origIdx)} style={{
                height: ROW_H, display: "flex", alignItems: "center", padding: "0 6px",
                borderBottom: "1px solid #eef1f4", cursor: "pointer",
                background: istSel ? "#e8f0fe" : hatSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginRight: 5,
                  background: FARBEN[t.typ] || "#6cc07a" }} />
                <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: istSel ? "#2d7dbd" : "#333", fontWeight: istSel ? 600 : 400 }}>{label}</span>
                <span style={{ fontSize: 10, color: "#8a9baa", flexShrink: 0 }}>{dauer}d</span>
              </div>
            );
          })}
        </div>
        {/* Resize-Handle */}
        <div onMouseDown={startLabelResize} style={{
          position: "absolute", top: 0, right: -3, width: 6, height: "100%",
          cursor: "col-resize", zIndex: 5,
        }} />
      </div>

      {/* SCROLLBARER Chart-Bereich */}
      <div ref={scrollRef} style={{ flex: 1, overflowX: "auto", overflowY: "hidden", position: "relative" }}
        onScroll={() => {
          // Labels synchron scrollen
          const el = scrollRef.current;
          const labels = el?.parentElement?.querySelector(".gantt-labels") as HTMLElement | null;
          if (el && labels) labels.scrollTop = el.scrollTop;
        }}>
        <svg width={chartW} height={HEAD_H + bodyH} style={{ display: "block" }}>
          {/* Header */}
          <rect x={0} y={0} width={chartW} height={HEAD_H} fill="#f5f7f9" />
          <line x1={0} y1={HEAD_H} x2={chartW} y2={HEAD_H} stroke="#d4dce4" strokeWidth={0.5} />

          {/* Monats-Linien + Labels */}
          {monatMarkers.map((m, i) => (
            <line key={`ml${i}`} x1={m.x} y1={HEAD_H} x2={m.x} y2={HEAD_H + bodyH} stroke="#d4dce4" strokeWidth={0.6} />
          ))}
          {headerLabels.map((m, i) => (
            <text key={`hl${i}`} x={m.x + 4} y={20} fontSize={12} fontWeight={600} fill="#555">{m.label}</text>
          ))}

          {/* Wochen-Linien */}
          {wochenLinien.map((x, i) => (
            <line key={`wl${i}`} x1={x} y1={HEAD_H} x2={x} y2={HEAD_H + bodyH} stroke="#f0f2f4" strokeWidth={0.4} />
          ))}

          {/* Task-Balken */}
          {sortedTasks.map(({ task: t }, i) => {
            const y = HEAD_H + i * ROW_H;
            const sd = parseDateUniversal(t.start);
            const ed = parseDateUniversal(t.end);
            const startTag = sd ? Math.max(0, (sd.getTime() - minDate.getTime()) / 86400000) : 0;
            const endTag = ed ? (ed.getTime() - minDate.getTime()) / 86400000 : startTag + 1;
            const dauer = Math.max(1, Math.round(endTag - startTag));
            const barX = startTag * pxProTag;
            const barW = Math.max((endTag - startTag) * pxProTag, 3);
            const istSel = selTaskId === t.id;
            const hatSel = selGuids && selGuids.size > 0 && t.objektGuids.some(g => selGuids.has(g));

            return (
              <g key={t.id}>
                {/* Zeilen-BG */}
                <rect x={0} y={y} width={chartW} height={ROW_H}
                  fill={istSel ? "#e8f0fe" : hatSel ? "#f0f0f0" : i % 2 === 0 ? "#fafbfc" : "#fff"} />
                <line x1={0} y1={y + ROW_H} x2={chartW} y2={y + ROW_H} stroke="#eef1f4" strokeWidth={0.5} />
                {/* Balken */}
                {sd && <rect x={barX} y={y + 5} width={barW} height={ROW_H - 10} rx={3}
                  fill={FARBEN[t.typ] || "#6cc07a"} opacity={istSel ? 1 : 0.85}
                  stroke={istSel ? "#2d7dbd" : "none"} strokeWidth={istSel ? 1.5 : 0} />}
                {sd && barW > 28 && (
                  <text x={barX + 5} y={y + ROW_H - 9} fontSize={9} fill="rgba(255,255,255,0.9)" fontWeight={600}>{dauer}d</text>
                )}
              </g>
            );
          })}

          {/* Nadel */}
          {currentTag >= 0 && (
            <g style={{ cursor: "ew-resize" }} onMouseDown={startNeedleDrag as any}>
              <rect x={nadelX - 10} y={0} width={20} height={HEAD_H + bodyH} fill="transparent" />
              <line x1={nadelX} y1={HEAD_H} x2={nadelX} y2={HEAD_H + bodyH} stroke="#e63946" strokeWidth={1.5} />
              <polygon points={`${nadelX - 5},${HEAD_H} ${nadelX + 5},${HEAD_H} ${nadelX},${HEAD_H + 6}`} fill="#e63946" />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
