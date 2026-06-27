// TabBauteile.tsx — Orchestrator mit Selektions-Tracking + Gantt-Toggle
import { useState, useEffect, useRef } from "react";
import type { SimProjekt } from "../types";
import { parseDateUniversal } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile, clearEchteBauteileCache } from "./modelHelpers";
import TabTasks from "./TabTasks";
import AttributeFilter from "./AttributeFilter";
import SelectionTools from "./SelectionTools";
import GanttChart from "./GanttChart";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  updateSim: (sim: SimProjekt) => void;
  selektion: number[];
  aktivesModellId: string | null;
  taskSort?: "gantt" | "datum" | "aktiv";
  readOnly?: boolean;
}

export default function TabBauteile({ api, aktiveSim, updateSim, aktivesModellId, taskSort, readOnly }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [ganttOffen, setGanttOffen] = useState(false);
  const [nadelTag, setNadelTag] = useState(-1);
  const [filterOffen, setFilterOffen] = useState(true);
  const [selToolOffen, setSelToolOffen] = useState(true);
  const [ganttH, setGanttH] = useState(() => {
    try { return Number(localStorage.getItem("4d-gantt-height-bauteile")) || 260; } catch { return 260; }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    setResetSignal(s => s + 1);
  }

  // Gesamtzählung
  useEffect(() => {
    if (!api || !aktiveSim || aktiveSim.modelle.length === 0) { setTotalObjekte(null); return; }
    clearEchteBauteileCache();
    (async () => {
      let gesamt = 0;
      for (const modell of aktiveSim.modelle) {
        if (!modell.id) continue;
        const echte = await getEchteBauteile(api, aktiveSim.id, modell.id);
        gesamt += echte.length;
      }
      setTotalObjekte(gesamt > 0 ? gesamt : null);
    })();
  }, [aktiveSim?.id, api]);

  // Selektion alle 1.5s pollen → mid:::rId Set bauen
  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        const guids = new Set<string>();
        if (Array.isArray(sel)) {
          for (const s of sel) {
            const mid = s?.modelId ?? "";
            for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`);
            for (const o of s?.objects ?? []) guids.add(`${mid}:::${o?.id ?? o}`);
          }
        }
        setSelGuids(guids);
      } catch { setSelGuids(new Set()); }
    }
    check();
    intervalRef.current = setInterval(check, 1500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [api]);

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">🔧</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Tab „Projekte" → Simulation aktivieren</div>
      </div>
    );
  }

  // Gantt-Daten berechnen
  const tasks = aktiveSim?.tasks ?? [];
  const daten = tasks.map(t => parseDateUniversal(t.start)).filter(Boolean) as Date[];
  const datenEnd = tasks.map(t => parseDateUniversal(t.end)).filter(Boolean) as Date[];
  const minDate = daten.length ? new Date(Math.min(...daten.map(d => d.getTime()))) : null;
  const maxDate = datenEnd.length ? new Date(Math.max(...datenEnd.map(d => d.getTime()))) : null;
  const totalTage = minDate && maxDate ? Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000)) : 0;

  function ganttDateChange(taskId: string, newStart: string, newEnd: string) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t =>
      t.id === taskId ? { ...t, start: newStart, end: newEnd } : t
    )});
  }

  return (
    <div className="tasklist-wrap">
      {/* Toggle Liste/Gantt */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px 0" }}>
        <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "2px 8px" }}
          onClick={() => setGanttOffen(g => !g)}>
          {ganttOffen ? "☰ Liste" : "▤ Gantt"}
        </button>
      </div>

      {ganttOffen ? (
        <>
          <GanttChart
            tasks={tasks}
            currentTag={nadelTag}
            totalTage={totalTage}
            minDate={minDate}
            laeuft={false}
            onTaskClick={idx => { if (tasks[idx]) taskAnklicken(tasks[idx].id); }}
            onNadelClick={tag => setNadelTag(tag)}
            selTaskId={aktivTaskId}
            selGuids={selGuids}
            taskSort={taskSort}
            height={ganttH}
            editable={!readOnly}
            onDateChange={ganttDateChange}
          />
          {/* Resize Handle */}
          <div onMouseDown={e => {
            e.preventDefault();
            const sy = e.clientY, sh = ganttH;
            const onMove = (ev: MouseEvent) => {
              const newH = Math.max(120, Math.min(600, sh + ev.clientY - sy));
              setGanttH(newH);
              localStorage.setItem("4d-gantt-height-bauteile", String(newH));
            };
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }} style={{ height: 6, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 40, height: 3, background: "#d4dce4", borderRadius: 2 }} />
          </div>
        </>
      ) : (
        <TabTasks
          api={api}
          aktiveSim={aktiveSim}
          aktivTask={aktivTask}
          aktivTaskId={aktivTaskId}
          totalObjekte={totalObjekte}
          updateSim={updateSim}
          onTaskClick={taskAnklicken}
          selGuids={selGuids}
          taskSort={taskSort}
          readOnly={readOnly}
        />
      )}
      {aktivTask && !readOnly && (
        <>
          <div className="detail-block">
            <div className="detail-block-title" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setFilterOffen(o => !o)}>
              <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${filterOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
              IFC-Attribut Filter
            </div>
            {filterOffen && (
              <AttributeFilter
                api={api}
                aktiveSim={aktiveSim}
                aktivTask={aktivTask}
                aktivesModellId={aktivesModellId}
                updateSim={updateSim}
                resetSignal={resetSignal}
              />
            )}
          </div>
          <div className="detail-block">
            <div className="detail-block-title" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setSelToolOffen(o => !o)}>
              <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${selToolOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
              Mausklick Zuweisung
            </div>
            {selToolOffen && (
              <SelectionTools
                aktivTask={aktivTask}
                aktiveSim={aktiveSim}
                api={api}
                updateSim={updateSim}
                selGuids={selGuids}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
