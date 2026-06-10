// TabBauteile.tsx — Orchestrator (schlanker Einstieg, delegiert an Sub-Komponenten)
import { useState, useEffect } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile, clearEchteBauteileCache } from "./modelHelpers";
import TabTasks from "./TabTasks";
import AttributeFilter from "./AttributeFilter";
import SelectionTools from "./SelectionTools";
import ModelSelector from "./ModelSelector";
import TabDebug from "./TabDebug";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  updateSim: (sim: SimProjekt) => void;
  selektion: number[];
  aktivesModellId: string | null;
}

const SHOW_DEBUG = false; // auf true setzen für Diagnose

export default function TabBauteile({ api, aktiveSim, updateSim, selektion, aktivesModellId }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [totalLaedt, setTotalLaedt] = useState(false);
  const [resetSignal, setResetSignal] = useState(0); // erhöht sich bei Task-Wechsel

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;
  const alleGuids = new Set(aktiveSim?.tasks.flatMap(t => t.objektGuids) ?? []);

  function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    setResetSignal(s => s + 1); // AttributeFilter zurücksetzen
  }

  // Gesamtzählung echte Bauteile
  useEffect(() => {
    if (!api || !aktiveSim || aktiveSim.modelle.length === 0) { setTotalObjekte(null); return; }
    clearEchteBauteileCache();
    (async () => {
      setTotalLaedt(true);
      let gesamt = 0;
      for (const modell of aktiveSim.modelle) {
        if (!modell.id) continue;
        const echte = await getEchteBauteile(api, aktiveSim.id, modell.id);
        gesamt += echte.length;
      }
      setTotalObjekte(gesamt > 0 ? gesamt : null);
      setTotalLaedt(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiveSim?.id, api]);

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
      {SHOW_DEBUG && (
        <TabDebug
          selektion={selektion}
          aktivesModellId={aktivesModellId}
          aktivSimId={aktiveSim.id}
          aktivTaskId={aktivTaskId}
          totalObjekte={totalObjekte}
        />
      )}

      {/* Gantt-Header */}
      <div className="gantt-section-header" style={{ padding: "6px 10px" }}>
        <span>Gantt · {aktiveSim.tasks.length} Tasks</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {totalObjekte != null && <span style={{ color: "var(--tc-blue)", fontSize: 9 }}>⬡ {alleGuids.size} / {totalObjekte}</span>}
        </div>
      </div>

      <TabTasks
        api={api}
        aktiveSim={aktiveSim}
        aktivTask={aktivTask}
        aktivTaskId={aktivTaskId}
        totalObjekte={totalObjekte}
        updateSim={updateSim}
        onTaskClick={taskAnklicken}
      />

      {aktivTask && (
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
            selektion={selektion}
            aktivTask={aktivTask}
            aktiveSim={aktiveSim}
            api={api}
            aktivesModellId={aktivesModellId}
            updateSim={updateSim}
          />
          <ModelSelector
            aktiveSim={aktiveSim}
            totalObjekte={totalObjekte}
            totalLaedt={totalLaedt}
            alleGuids={alleGuids}
          />
        </>
      )}
    </div>
  );
}
