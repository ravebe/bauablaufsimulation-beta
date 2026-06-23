// TabBauteile.tsx — Orchestrator mit Selektions-Tracking
import { useState, useEffect, useRef } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile, clearEchteBauteileCache } from "./modelHelpers";
import TabTasks from "./TabTasks";
import AttributeFilter from "./AttributeFilter";
import SelectionTools from "./SelectionTools";

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

  return (
    <div className="tasklist-wrap">
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
      {aktivTask && !readOnly && (
        <>
          <AttributeFilter
            api={api}
            aktiveSim={aktiveSim}
            aktivTask={aktivTask}
            aktivesModellId={aktivesModellId}
            updateSim={updateSim}
            resetSignal={resetSignal}
          />
          <SelectionTools
            aktivTask={aktivTask}
            aktiveSim={aktiveSim}
            api={api}
            updateSim={updateSim}
            selGuids={selGuids}
          />
        </>
      )}
    </div>
  );
}
