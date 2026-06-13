// TabTasks.tsx — Task-Liste + Task-Detail + Visibility-Buttons + Guid-Liste
import { useState, useEffect } from "react";
import type { SimProjekt, Task, TaskTyp } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile } from "./modelHelpers";

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
  selGuids: Set<string>;
}

const STORAGE_PREFIX = "4d-guid-display-";

function ladeDisplayConfig(simId: string): { zeile1: string; zeile2: string } {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + simId);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { zeile1: "Layer||Layer", zeile2: "Reference Object||Common Type" };
}

export default function TabTasks({ api, aktiveSim, aktivTask, aktivTaskId, totalObjekte, updateSim, onTaskClick, selGuids }: Props) {
  const [guidWerte, setGuidWerte] = useState<Map<string, ObjWerte>>(new Map());
  const [verfuegbareAttrs, setVerfuegbareAttrs] = useState<string[]>([]);
  const [displayConfig, setDisplayConfig] = useState(() => ladeDisplayConfig(aktiveSim.id));
  const [settingsOffen, setSettingsOffen] = useState(false);
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [settingsQuery1, setSettingsQuery1] = useState("");
  const [settingsQuery2, setSettingsQuery2] = useState("");
  const [settingsFocus, setSettingsFocus] = useState<1 | 2 | null>(null);

  // Display-Config neu laden wenn Sim wechselt
  useEffect(() => {
    setDisplayConfig(ladeDisplayConfig(aktiveSim.id));
  }, [aktiveSim.id]);

  // Alle Properties für Task-Objekte laden
  useEffect(() => {
    setGuidWerte(new Map());
    setVerfuegbareAttrs([]);
    setLoeschenBestaetigen(false);
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
    localStorage.setItem(STORAGE_PREFIX + aktiveSim.id, JSON.stringify(cfg));
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

  async function offeneMarkieren() {
    if (!api || !aktiveSim) return;
    const vergeben = new Set(aktiveSim.tasks.flatMap(t => t.objektGuids));
    const byModel = new Map<string, number[]>();
    for (const modell of aktiveSim.modelle) {
      if (!modell.id) continue;
      const echteIds = await getEchteBauteile(api, aktiveSim.id, modell.id);
      const offene = echteIds.filter(rId => !vergeben.has(`${modell.id}:::${rId}`));
      if (offene.length > 0) byModel.set(modell.id, offene);
    }
    if (byModel.size === 0) return;
    const modelObjectIds = [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: rIds }));
    try { await (api.viewer as any).setSelection({ modelObjectIds }, "set"); } catch {}
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

  function displayName(key: string): string {
    if (!key.includes("||")) return key;
    const [pset, name] = key.split("||");
    return `${name} (${pset})`;
  }

  return (
    <>
      {/* Task-Liste */}
      <div className="gantt-section">
        <div className="gantt-section-header" style={{ letterSpacing: ".8px", color: "#8a9baa", fontWeight: 600 }}>
          <span>GANTT · {aktiveSim.tasks.length} TASKS</span>
          {totalObjekte != null && (() => {
            const vergeben = new Set(aktiveSim.tasks.flatMap(t => t.objektGuids)).size;
            const offen = Math.max(0, totalObjekte - vergeben);
            return offen > 0 ? (
              <button style={{ fontSize: 11, color: "#2d7dbd", fontWeight: 600, background: "none", border: "1px solid #2d7dbd",
                padding: "1px 8px", cursor: "pointer", fontFamily: "inherit" }}
                onClick={offeneMarkieren} title="Offene Bauteile im 3D markieren">
                {offen} OFFEN
              </button>
            ) : (
              <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ VERTEILT</span>
            );
          })()}
        </div>
        <div style={{ minHeight: 220, maxHeight: 450, overflowY: "auto" }}>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>
            Noch keine Tasks — Gantt in Tab „Projekte" importieren
          </div>
        ) : (
          aktiveSim.tasks.map(task => {
            const hatSelektierte = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
            const selAnzahl = hatSelektierte ? task.objektGuids.filter(g => selGuids.has(g)).length : 0;
            return (
            <div key={task.id} className={`task-row ${task.id === aktivTaskId ? "active" : ""}`}
              style={{ borderBottom: "1px solid #eef1f4", padding: "6px 10px", gap: 7,
                background: task.id === aktivTaskId ? "#e8f2fa" : hatSelektierte ? "#f0f0f0" : undefined }}
              onClick={() => onTaskClick(task.id)}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: task.typ === "neubau" ? "#6cc07a" : task.typ === "abbruch" ? "#edb94c" : "#888" }} />
              <span className="task-row-name" style={{ fontSize: 13, color: task.id === aktivTaskId ? "#2d7dbd" : "#333", fontWeight: task.id === aktivTaskId || hatSelektierte ? 600 : 400 }}>{task.name}</span>
              <span className="task-row-date" style={{ fontSize: 12, color: "#8a9baa" }}>{task.start}</span>
              <span className="task-row-count" style={{ fontSize: 12, marginLeft: 8 }}>
                {hatSelektierte
                  ? <span style={{ color: "#2d7dbd", fontWeight: 600 }}>{selAnzahl}/{task.objektGuids.length}</span>
                  : task.objektGuids.length > 0
                    ? <span style={{ color: "#8a9baa" }}>O {task.objektGuids.length}</span>
                    : <span style={{ color: "#d4dce4" }}>∅</span>}
              </span>
            </div>
            );
          })
        )}
        </div>
      </div>

      {/* Task-Detail */}
      {aktivTask ? (
        <div className="detail-section">
          <div className="detail-header">
            <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: aktivTask.typ === "neubau" ? "#22C55E" : aktivTask.typ === "abbruch" ? "#EAB308" : "#999" }} />
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
                  {typ === "neubau" ? "🟢" : typ === "bestand" ? "⚫" : "🟡"} {typ}
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
                    <button className="tc-btn-ghost" style={{ color: "var(--tc-red)" }} onClick={() => setLoeschenBestaetigen(true)}>🗑</button>
                  </>
                )}
                <button className="tc-btn-ghost" title="Anzeige-Einstellungen" style={{ fontSize: 12 }}
                  onClick={() => setSettingsOffen(s => !s)}>⚙</button>
              </div>
            </div>

            {/* Lösch-Bestätigung */}
            {loeschenBestaetigen && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", padding: 8, marginBottom: 6, fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: "#DC2626", marginBottom: 4 }}>
                  ⚠ Alle {aktivTask.objektGuids.length} Bauteile von „{aktivTask.name}" entfernen?
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button className="tc-btn-primary" style={{ flex: 1, background: "#DC2626", borderColor: "#DC2626", fontSize: 11 }}
                    onClick={() => { speichereGuids(aktivTask.id, []); setLoeschenBestaetigen(false); }}>Alle entfernen</button>
                  <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 11 }}
                    onClick={() => setLoeschenBestaetigen(false)}>Abbrechen</button>
                </div>
              </div>
            )}

            {/* Anzeige-Einstellungen — Autocomplete */}
            {settingsOffen && verfuegbareAttrs.length > 0 && (
              <div style={{ background: "#F8FAFC", border: "1px solid var(--tc-border)", padding: 6, marginBottom: 6, fontSize: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--tc-text-2)" }}>Anzeige-Attribute</div>
                {/* Zeile 1 */}
                <div style={{ marginBottom: 4, position: "relative" }}>
                  <span style={{ color: "var(--tc-text-3)", fontSize: 9 }}>Zeile 1:</span>
                  <input className="ac-input" style={{ fontSize: 10, padding: "2px 6px", width: "100%", marginTop: 2 }}
                    placeholder={displayName(displayConfig.zeile1)}
                    value={settingsQuery1}
                    onChange={e => { setSettingsQuery1(e.target.value); setSettingsFocus(1); }}
                    onFocus={() => setSettingsFocus(1)}
                  />
                  {settingsFocus === 1 && (
                    <div className="ac-dropdown" style={{ maxHeight: 120 }}>
                      {verfuegbareAttrs
                        .filter(a => !settingsQuery1 || displayName(a).toLowerCase().includes(settingsQuery1.toLowerCase()))
                        .slice(0, 15)
                        .map(a => (
                          <div key={a} className="ac-item" style={{ fontSize: 10, padding: "3px 6px" }}
                            onMouseDown={() => { saveDisplayConfig({ ...displayConfig, zeile1: a }); setSettingsQuery1(""); setSettingsFocus(null); }}>
                            {displayName(a)}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                {/* Zeile 2 */}
                <div style={{ position: "relative" }}>
                  <span style={{ color: "var(--tc-text-3)", fontSize: 9 }}>Zeile 2:</span>
                  <input className="ac-input" style={{ fontSize: 10, padding: "2px 6px", width: "100%", marginTop: 2 }}
                    placeholder={displayConfig.zeile2 ? displayName(displayConfig.zeile2) : "— keine —"}
                    value={settingsQuery2}
                    onChange={e => { setSettingsQuery2(e.target.value); setSettingsFocus(2); }}
                    onFocus={() => setSettingsFocus(2)}
                  />
                  {settingsFocus === 2 && (
                    <div className="ac-dropdown" style={{ maxHeight: 120 }}>
                      <div className="ac-item" style={{ fontSize: 10, padding: "3px 6px", color: "#8a9baa" }}
                        onMouseDown={() => { saveDisplayConfig({ ...displayConfig, zeile2: "" }); setSettingsQuery2(""); setSettingsFocus(null); }}>
                        — keine —
                      </div>
                      {verfuegbareAttrs
                        .filter(a => !settingsQuery2 || displayName(a).toLowerCase().includes(settingsQuery2.toLowerCase()))
                        .slice(0, 15)
                        .map(a => (
                          <div key={a} className="ac-item" style={{ fontSize: 10, padding: "3px 6px" }}
                            onMouseDown={() => { saveDisplayConfig({ ...displayConfig, zeile2: a }); setSettingsQuery2(""); setSettingsFocus(null); }}>
                            {displayName(a)}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Objekt-Liste — kompakt, klickbar */}
            {aktivTask.objektGuids.length > 0 && (
              <div className="guid-list">
                {aktivTask.objektGuids.map((g, i) => {
                  const w = guidWerte.get(g);
                  const val1 = w?.[displayConfig.zeile1] ?? "";
                  const val2 = displayConfig.zeile2 ? (w?.[displayConfig.zeile2] ?? "") : "";
                  const istSelektiert = selGuids.has(g);
                  return (
                    <div key={i} className="guid-row" style={{
                      padding: "3px 8px", cursor: "pointer",
                      background: istSelektiert ? "#e8f2fa" : undefined,
                      borderLeft: istSelektiert ? "3px solid #2d7dbd" : "3px solid transparent",
                    }} onClick={() => einzelnMarkieren(g)}>
                      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontSize: 11, fontWeight: istSelektiert ? 600 : 400, color: istSelektiert ? "#2d7dbd" : "#555" }}>
                        {val1 || `Objekt ${g.split(":::")[1] ?? i}`}
                        {val2 && <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 6 }}>{val2}</span>}
                      </div>
                      <button className="guid-row-x" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); guidEntfernen(aktivTask.id, g); }}>✕</button>
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