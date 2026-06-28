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
  taskSort?: "gantt" | "datum" | "aktiv" | "name" | "nummer";
  readOnly?: boolean;
  sharedNadelTag?: React.MutableRefObject<number>;
  sichtbar?: boolean;
}

export default function TabBauteile({ api, aktiveSim, updateSim, aktivesModellId, taskSort, readOnly, sharedNadelTag, sichtbar }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [ganttOffen, setGanttOffen] = useState(false);
  const [nadelTag, setNadelTag] = useState(-1);
  const [ghostTag, setGhostTag] = useState(-1);
  const [filterOffen, setFilterOffen] = useState(true);
  const [selToolOffen, setSelToolOffen] = useState(true);
  const [suchOffen, setSuchOffen] = useState(false);
  const [suchQuery, setSuchQuery] = useState("");
  const [ganttH, setGanttH] = useState(() => {
    try { return Number(localStorage.getItem("4d-gantt-height-bauteile")) || 260; } catch { return 260; }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  // Shared Nadel: minDate hier berechnen (vor early return)
  const allStarts = (aktiveSim?.tasks ?? []).map(t => parseDateUniversal(t.start)).filter(Boolean) as Date[];
  const allEnds = (aktiveSim?.tasks ?? []).map(t => parseDateUniversal(t.end)).filter(Boolean) as Date[];
  const minDate = allStarts.length ? new Date(Math.min(...allStarts.map(d => d.getTime()))) : null;
  const maxDate = allEnds.length ? new Date(Math.max(...allEnds.map(d => d.getTime()))) : null;
  const totalTage = minDate && maxDate ? Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000)) : 0;

  // Shared Nadel lesen wenn Tab sichtbar wird
  const prevSichtbar = useRef(false);
  useEffect(() => {
    if (sichtbar && !prevSichtbar.current && ganttOffen && sharedNadelTag && sharedNadelTag.current > 0 && minDate) {
      const tag = Math.round((sharedNadelTag.current - minDate.getTime()) / 86400000);
      if (tag >= 0 && tag <= totalTage) {
        setGhostTag(tag);
        setNadelTag(-1);
      }
    }
    prevSichtbar.current = !!sichtbar;
  }, [sichtbar]);

  function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    setResetSignal(s => s + 1);
    if (suchQuery) { setSuchOffen(false); setSuchQuery(""); }
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

  // Gantt-Daten (bereits oben berechnet)
  const tasks = aktiveSim?.tasks ?? [];

  function ganttDateChange(taskId: string, newStart: string, newEnd: string) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t =>
      t.id === taskId ? { ...t, start: newStart, end: newEnd } : t
    )});
  }

  function ganttTaskReorder(fromIdx: number, toIdx: number) {
    if (!aktiveSim || fromIdx === toIdx) return;
    const tasks = [...aktiveSim.tasks];
    const [moved] = tasks.splice(fromIdx, 1);
    tasks.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    updateSim({ ...aktiveSim, tasks });
  }

  return (
    <div className="tasklist-wrap">
      {/* Suche + Toggle */}
      <div style={{ display: "flex", alignItems: "center", padding: "4px 8px 0", gap: 4 }}>
        {suchOffen ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#8a9baa", flexShrink: 0, cursor: "pointer" }}
              onClick={() => { setSuchOffen(false); setSuchQuery(""); }}>✕</span>
            <input
              autoFocus
              placeholder="Task suchen…"
              value={suchQuery}
              onChange={e => setSuchQuery(e.target.value)}
              style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d4dce4", fontFamily: "inherit", outline: "none" }}
              onKeyDown={e => { if (e.key === "Escape") { setSuchOffen(false); setSuchQuery(""); } }}
            />
          </div>
        ) : (
          <button className="tc-btn-secondary" style={{ fontSize: 12, padding: "2px 6px" }}
            onClick={() => setSuchOffen(true)} title="Tasks suchen"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#333" strokeWidth="1.8"><circle cx="6.5" cy="6.5" r="5"/><line x1="10.2" y1="10.2" x2="14.5" y2="14.5"/></svg></button>
        )}
        <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "2px 8px", marginLeft: "auto" }}
          onClick={() => {
            const willOpen = !ganttOffen;
            setGanttOffen(willOpen);
            if (willOpen && sharedNadelTag && sharedNadelTag.current > 0 && minDate) {
              const tag = Math.round((sharedNadelTag.current - minDate.getTime()) / 86400000);
              if (tag >= 0 && tag <= totalTage) {
                setGhostTag(tag);
                setNadelTag(-1);
              }
            }
          }}>
          {ganttOffen ? "☰ Liste" : "▤ Gantt"}
        </button>
      </div>

      {ganttOffen ? (
        <>
          <GanttChart
            tasks={tasks}
            currentTag={ghostTag >= 0 ? ghostTag : nadelTag}
            totalTage={totalTage}
            minDate={minDate}
            laeuft={false}
            onTaskClick={idx => { if (tasks[idx]) taskAnklicken(tasks[idx].id); }}
            onNadelClick={tag => { setGhostTag(-1); setNadelTag(tag); }}
            selTaskId={aktivTaskId}
            selGuids={selGuids}
            taskSort={taskSort}
            height={ganttH}
            editable={!readOnly}
            onDateChange={ganttDateChange}
            onTaskReorder={ganttTaskReorder}
            showObjektCount
            nadelStil={ghostTag >= 0 ? "ghost" : "normal"}
          />
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
            detailOnly
          />
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
          suchQuery={suchQuery}
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
          <div className="detail-block">
            <div className="detail-block-title" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setSelToolOffen(o => !o)}>
              <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${selToolOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
              Mausklick Zuweisung
            </div>
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
        </>
      )}
    </div>
  );
}
