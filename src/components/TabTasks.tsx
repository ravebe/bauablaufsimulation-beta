// TabTasks.tsx — Task-Liste + Task-Detail + Visibility-Buttons + Guid-Liste
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task, TaskTyp } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getModellObjekte } from "./modelHelpers";

interface GuidInfo { name: string; ifcId: string; }

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt;
  aktivTask: Task | null;
  aktivTaskId: string | null;
  totalObjekte: number | null;
  updateSim: (sim: SimProjekt) => void;
  onTaskClick: (id: string) => void;
}

export default function TabTasks({ api, aktiveSim, aktivTask, aktivTaskId, totalObjekte, updateSim, onTaskClick }: Props) {
  const [guidInfo, setGuidInfo] = useState<Map<string, GuidInfo>>(new Map());

  // Guid-Labels laden wenn Task wechselt
  useEffect(() => {
    setGuidInfo(new Map());
    if (!api || !aktivTask?.objektGuids.length) return;
    (async () => {
      const info = new Map<string, GuidInfo>();
      for (const g of aktivTask.objektGuids) {
        if (!g.includes(":::")) continue;
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        let name = ""; let ifcId = "";
        try { const ids = await api.viewer.convertToObjectIds(mid, [rId]); ifcId = (ids as any)?.[0] ?? ""; } catch {}
        try {
          const props: any[] = await api.viewer.getObjectProperties(mid, [rId]) as any;
          outer: for (const pset of props ?? []) {
            for (const p of pset?.properties ?? []) {
              const pn = (p?.name ?? "").toLowerCase();
              if (["name","product name","bezeichnung","objectname","object name","bauteilname"].includes(pn)) {
                const v = String(p?.value ?? "").trim();
                if (v && v !== "null" && v !== "undefined") { name = v; break outer; }
              }
            }
          }
          // Fallback: erster nicht-leerer Wert
          if (!name && props?.[0]?.properties?.length) {
            for (const p of props[0].properties) { const v = String(p?.value ?? "").trim(); if (v && v.length > 1 && v !== "null") { name = v; break; } }
          }
          // Fallback: product.name
          if (!name) for (const obj of (props ?? [])) if (obj?.product?.name) { name = String(obj.product.name); break; }
        } catch {}
        info.set(g, { name: name || ifcId.slice(0, 22) || `Objekt ${rId}`, ifcId });
      }
      setGuidInfo(info);
    })();
  }, [aktivTask?.id, aktivTask?.objektGuids.length, api]);

  function typAendern(taskId: string, typ: TaskTyp) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, typ } : t) });
  }
  function speichereGuids(taskId: string, guids: string[]) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: guids } : t) });
  }
  function guidEntfernen(taskId: string, guid: string) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: t.objektGuids.filter(g => g !== guid) } : t) });
  }

  const nurAnzeigenLaeuft = useRef(false);

  const letzteMarkierung = useRef<{ mid: string; rId: number } | null>(null);

  async function einzelnMarkieren(guid: string) {
    if (!api || !guid.includes(":::")) return;
    const sep = guid.indexOf(":::");
    const mid = guid.slice(0, sep); const rId = Number(guid.slice(sep + 3));
    if (!mid || isNaN(rId)) return;

    // Vorherige Markierung zurücksetzen
    if (letzteMarkierung.current) {
      const prev = letzteMarkierung.current;
      try {
        await api.viewer.setObjectState(
          [{ modelId: prev.mid, objectRuntimeIds: [prev.rId] }] as any,
          { color: null } as any  // Farbe entfernen → Originalfarbe
        );
      } catch {}
    }

    // Neues Objekt farblich hervorheben (helles Blau)
    try {
      await api.viewer.setObjectState(
        [{ modelId: mid, objectRuntimeIds: [rId] }] as any,
        { color: [0.2, 0.6, 1.0, 1.0] } as any
      );
      letzteMarkierung.current = { mid, rId };
      console.log("[einzelnMarkieren] Objekt gefärbt:", mid, rId);
    } catch (e) { console.log("[einzelnMarkieren] Fehler:", e); }
  }

  async function nurAnzeigen(guids: string[]) {
    if (!api || nurAnzeigenLaeuft.current) return;
    nurAnzeigenLaeuft.current = true;
    try {
      const byModel = new Map<string, number[]>();
      for (const g of guids) {
        if (!g.includes(":::")) continue;
        const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
      }
      if (byModel.size === 0) return;
      for (const [mid, taskRIds] of byModel.entries()) {
        const taskSet = new Set<number>(taskRIds);
        const alleIds = await getModellObjekte(api, mid);
        const hideIds = alleIds.filter(id => !taskSet.has(id));
        console.log("[nurAnzeigen] mid:", mid, "alle:", alleIds.length, "task:", taskRIds.length, "hide:", hideIds.length);
        if (hideIds.length > 0) try { await api.viewer.setObjectState([{ modelId: mid, objectRuntimeIds: hideIds }], { visible: false }); } catch {}
      }
    } finally {
      setTimeout(() => { nurAnzeigenLaeuft.current = false; }, 500);
    }
  }

  async function ausblenden(guids: string[]) {
    if (!api) return;
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    for (const [mid, rIds] of byModel.entries())
      try { await api.viewer.setObjectState([{ modelId: mid, objectRuntimeIds: [...new Set(rIds)] }] as any, { visible: false } as any); } catch {}
  }

  async function alleEinblenden() {
    if (!api) return;
    try { await api.viewer.reset(); } catch {}
  }

  return (
    <>
      {/* Task-Liste */}
      <div className="gantt-section">
        <div className="gantt-section-header">
          <span>Gantt · {aktiveSim.tasks.length} Tasks</span>
        </div>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Noch keine Tasks — Gantt in Tab „Projekte" importieren
          </div>
        ) : (
          aktiveSim.tasks.map(task => (
            <div key={task.id} className={`task-row ${task.id === aktivTaskId ? "active" : ""}`} onClick={() => onTaskClick(task.id)}>
              <span className={`task-row-dot ${task.typ}`} />
              <span className="task-row-name">{task.name}</span>
              <span className="task-row-date">{task.start}</span>
              <span className="task-row-count">
                {task.objektGuids.length > 0
                  ? <span style={{ color: "var(--tc-blue)" }}>⬡ {task.objektGuids.length}</span>
                  : <span style={{ color: "var(--tc-border)" }}>∅</span>}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Task-Detail */}
      {aktivTask ? (
        <div className="detail-section">
          <div className="detail-header">
            <span className={`task-row-dot ${aktivTask.typ}`} style={{ width: 8, height: 8 }} />
            <span className="detail-task-name">{aktivTask.name}</span>
            <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>
              {totalObjekte != null ? `⬡ ${aktivTask.objektGuids.length} / ${totalObjekte}` : `⬡ ${aktivTask.objektGuids.length}`}
            </span>
          </div>

          {/* Task-Typ */}
          <div className="detail-block">
            <div className="detail-block-title">Task-Typ</div>
            <div className="typ-btns">
              {(["neubau", "bestand", "abbruch"] as TaskTyp[]).map(typ => (
                <button key={typ} className={`typ-btn ${aktivTask.typ === typ ? `aktiv-${typ}` : ""}`} onClick={() => typAendern(aktivTask.id, typ)}>
                  {typ === "neubau" ? "🟢" : typ === "bestand" ? "🟡" : "🔴"} {typ}
                </button>
              ))}
            </div>
          </div>

          {/* Zugewiesene Bauteile + Visibility-Buttons */}
          <div className="detail-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <div className="detail-block-title" style={{ margin: 0 }}>
                {aktivTask.objektGuids.length > 0 ? `${aktivTask.objektGuids.length} Bauteile zugewiesen` : "Noch keine Bauteile zugewiesen"}
              </div>
              {aktivTask.objektGuids.length > 0 && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="tc-btn-primary" title="Nur diese anzeigen" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => nurAnzeigen(aktivTask.objektGuids)}>👁 Nur diese</button>
                  <button className="tc-btn-ghost" title="Ausblenden" onClick={() => ausblenden(aktivTask.objektGuids)}>🚫</button>
                  <button className="tc-btn-ghost" title="Alle einblenden" onClick={alleEinblenden}>↺</button>
                  <button className="tc-btn-ghost" style={{ color: "var(--tc-red)" }} onClick={() => speichereGuids(aktivTask.id, [])}>🗑</button>
                </div>
              )}
            </div>
            {aktivTask.objektGuids.length > 0 && (
              <div className="guid-list">
                {aktivTask.objektGuids.map((g, i) => {
                  const info = guidInfo.get(g);
                  return (
                    <div key={i} className="guid-row">
                      <div className="guid-row-id" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {info?.name ?? g}
                        </div>
                        {info?.ifcId && info.ifcId !== info.name && (
                          <div style={{ fontSize: 9, opacity: 0.55, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {info.ifcId}
                          </div>
                        )}
                      </div>
                      <button className="guid-row-x" title="Im 3D markieren" style={{ color: "var(--tc-blue)", fontSize: 12 }} onClick={() => einzelnMarkieren(g)}>👁</button>
                      <button className="guid-row-x" onClick={() => guidEntfernen(aktivTask.id, g)}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-empty">↑ Task anklicken</div>
      )}
    </>
  );
}