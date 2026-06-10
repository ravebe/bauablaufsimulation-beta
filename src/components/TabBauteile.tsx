// TabBauteile.tsx — Orchestrator
import { useState, useEffect } from "react";
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
}

export default function TabBauteile({ api, aktiveSim, updateSim, aktivesModellId }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    setResetSignal(s => s + 1);
  }

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
            aktivTask={aktivTask}
            aktiveSim={aktiveSim}
            api={api}
            updateSim={updateSim}
          />
        </>
      )}
    </div>
  );
}
