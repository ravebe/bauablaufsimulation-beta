// TabTasks.tsx — Task-Liste + Task-Detail + Visibility-Buttons + Guid-Liste
import { useState, useEffect } from "react";
import type { SimProjekt, Task, TaskTyp } from "../types";
import type { ApiInstance } from "../hooks/useApi";

// Alle Werte eines Objekts flach sammeln
interface ObjWerte { [key: string]: string; } // "PSet||PropName" → value

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt;
  aktivTask: Task | null;
  aktivTaskId: string | null;
  totalObjekte: number | null;
  updateSim: (sim: SimProjekt) => void;
  onTaskClick: (id: string) => void;
}

const STORAGE_KEY = "4d-guid-display";

function ladeDisplayConfig(): { zeile1: string; zeile2: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { zeile1: "Layer||Layer", zeile2: "Reference Object||Common Type" };
}

export default function TabTasks({ api, aktiveSim, aktivTask, aktivTaskId, totalObjekte, updateSim, onTaskClick }: Props) {
  const [guidWerte, setGuidWerte] = useState<Map<string, ObjWerte>>(new Map());
  const [verfuegbareAttrs, setVerfuegbareAttrs] = useState<string[]>([]);
  const [displayConfig, setDisplayConfig] = useState(ladeDisplayConfig);
  const [settingsOffen, setSettingsOffen] = useState(false);

  // Alle Properties für Task-Objekte laden
  useEffect(() => {
    setGuidWerte(new Map());
    setVerfuegbareAttrs([]);
    if (!api || !aktivTask?.objektGuids.length) return;
    (async () => {
      const werte = new Map<string, ObjWerte>();
      const allKeys = new Set<string>();

      for (const g of aktivTask.objektGuids) {
        if (!g.includes(":::")) continue;
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        const obj: ObjWerte = {};

        // IFC GUID
        try {
          const ids = await api.viewer.convertToObjectIds(mid, [rId]);
          const ifcGuid = (ids as any)?.[0] ?? "";
          if (ifcGuid) { obj["Reference Object||GUID (IFC)"] = ifcGuid; allKeys.add("Reference Object||GUID (IFC)"); }
        } catch {}

        // Properties durchsuchen
        try {
          const props: any[] = await api.viewer.getObjectProperties(mid, [rId]) as any;
          const sammelWerte = (pset: any, psetName: string) => {
            for (const p of pset?.properties ?? []) {
              if (!p?.name) continue;
              const sub = p?.properties ?? p?.items;
              if (Array.isArray(sub) && sub.length > 0) {
                sammelWerte(p, p.name);
              } else {
                const v = String(p?.value ?? "").trim();
                if (v && v !== "null" && v !== "undefined") {
                  const key = `${psetName}||${p.name}`;
                  obj[key] = v;
                  allKeys.add(key);
                }
              }
            }
          };
          for (const pset of props ?? []) sammelWerte(pset, pset?.name || "Eigenschaften");

          // Product-Felder
          for (const pset of props ?? []) {
            if (pset?.product) {
              const p = pset.product;
              if (p.name) { obj["Product||Product Name"] = String(p.name); allKeys.add("Product||Product Name"); }
              if (p.objectType) { obj["Reference Object||Common Type"] = String(p.objectType); allKeys.add("Reference Object||Common Type"); }
              if (p.description) { obj["Product||Description"] = String(p.description); allKeys.add("Product||Description"); }
            }
          }
        } catch {}

        // Layer über getLayers + convertToObjectIds
        try {
          const layers = await api.viewer.getLayers(mid) as any[];
          if (Array.isArray(layers)) {
            for (const l of layers) {
              const memberIds: number[] = l?.objectRuntimeIds ?? [];
              if (memberIds.includes(rId) && l?.name) {
                obj["Layer||Layer"] = String(l.name);
                allKeys.add("Layer||Layer");
                break;
              }
            }
          }
        } catch {}

        werte.set(g, obj);
      }

      setGuidWerte(werte);
      setVerfuegbareAttrs([...allKeys].sort());
    })();
  }, [aktivTask?.id, aktivTask?.objektGuids.length, api]);

  function saveDisplayConfig(cfg: { zeile1: string; zeile2: string }) {
    setDisplayConfig(cfg);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function typAendern(taskId: string, typ: TaskTyp) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, typ } : t) });
  }
  function speichereGuids(taskId: string, guids: string[]) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: guids } : t) });
  }
  function guidEntfernen(taskId: string, guid: string) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: t.objektGuids.filter(g => g !== guid) } : t) });
  }

  async function einzelnMarkieren(guid: string) {
    if (!api || !guid.includes(":::")) return;
    const sep = guid.indexOf(":::");
    const mid = guid.slice(0, sep); const rId = Number(guid.slice(sep + 3));
    if (!mid || isNaN(rId)) return;
    try {
      await (api.viewer as any).setSelection(
        { modelObjectIds: [{ modelId: mid, objectRuntimeIds: [rId] }] }, "set"
      );
    } catch (e) { console.log("[einzelnMarkieren] Fehler:", e); }
  }

  async function nurAnzeigen(guids: string[]) {
    if (!api) return;
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    if (byModel.size === 0) return;
    const modelObjectIds = [...byModel.entries()].map(([modelId, rIds]) => ({
      modelId, objectRuntimeIds: [...new Set(rIds)]
    }));
    try { await (api.viewer as any).setSelection({ modelObjectIds }, "set"); } catch {}
  }

  async function ausblenden(guids: string[]) {
    if (!api) return;
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    for (const [mid, rIds] of byModel.entries()) {
      try {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId: mid, objectRuntimeIds: [...new Set(rIds)] }] } as any,
          { visible: false } as any
        );
      } catch {}
    }
  }

  async function alleEinblenden() {
    if (!api) return;
    try { await api.viewer.reset(); } catch {}
  }

  function displayName(key: string): string {
    if (!key.includes("||")) return key;
    const [pset, name] = key.split("||");
    return `${name} (${pset})`;
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

          {/* Zugewiesene Bauteile */}
          <div className="detail-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <div className="detail-block-title" style={{ margin: 0 }}>
                {aktivTask.objektGuids.length > 0 ? `${aktivTask.objektGuids.length} Bauteile zugewiesen` : "Noch keine Bauteile zugewiesen"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {aktivTask.objektGuids.length > 0 && (
                  <>
                    <button className="tc-btn-primary" title="Nur diese anzeigen" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => nurAnzeigen(aktivTask.objektGuids)}>👁 Nur diese</button>
                    <button className="tc-btn-ghost" title="Ausblenden" onClick={() => ausblenden(aktivTask.objektGuids)}>🚫</button>
                    <button className="tc-btn-ghost" title="Alle einblenden" onClick={alleEinblenden}>↺</button>
                    <button className="tc-btn-ghost" style={{ color: "var(--tc-red)" }} onClick={() => speichereGuids(aktivTask.id, [])}>🗑</button>
                  </>
                )}
                <button className="tc-btn-ghost" title="Anzeige-Einstellungen" style={{ fontSize: 12 }}
                  onClick={() => setSettingsOffen(s => !s)}>⚙</button>
              </div>
            </div>

            {/* Anzeige-Einstellungen */}
            {settingsOffen && verfuegbareAttrs.length > 0 && (
              <div style={{ background: "#F8FAFC", border: "1px solid var(--tc-border)", borderRadius: 4, padding: 6, marginBottom: 6, fontSize: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--tc-text-2)" }}>Anzeige-Attribute</div>
                <div style={{ marginBottom: 3 }}>
                  <span style={{ color: "var(--tc-text-3)" }}>Zeile 1: </span>
                  <select style={{ fontSize: 10, padding: "1px 4px", maxWidth: 200 }} value={displayConfig.zeile1}
                    onChange={e => saveDisplayConfig({ ...displayConfig, zeile1: e.target.value })}>
                    {verfuegbareAttrs.map(a => <option key={a} value={a}>{displayName(a)}</option>)}
                  </select>
                </div>
                <div>
                  <span style={{ color: "var(--tc-text-3)" }}>Zeile 2: </span>
                  <select style={{ fontSize: 10, padding: "1px 4px", maxWidth: 200 }} value={displayConfig.zeile2}
                    onChange={e => saveDisplayConfig({ ...displayConfig, zeile2: e.target.value })}>
                    <option value="">— keine —</option>
                    {verfuegbareAttrs.map(a => <option key={a} value={a}>{displayName(a)}</option>)}
                  </select>
                </div>
              </div>
            )}

            {aktivTask.objektGuids.length > 0 && (
              <div className="guid-list">
                {aktivTask.objektGuids.map((g, i) => {
                  const w = guidWerte.get(g);
                  const val1 = w?.[displayConfig.zeile1] ?? "";
                  const val2 = displayConfig.zeile2 ? (w?.[displayConfig.zeile2] ?? "") : "";
                  return (
                    <div key={i} className="guid-row">
                      <div className="guid-row-id" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {val1 || `Objekt ${g.split(":::")[1] ?? i}`}
                        </div>
                        {val2 && (
                          <div style={{ fontSize: 9, opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {val2}
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