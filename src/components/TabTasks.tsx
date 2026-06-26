// TabTasks.tsx — Task-Liste + Task-Detail + Visibility-Buttons + Guid-Liste
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task, TaskTyp } from "../types";
import { formatDatum, normalizeDatum, parseDateUniversal } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import DatePicker from "./DatePicker";

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
  taskSort?: "gantt" | "datum" | "aktiv";
  readOnly?: boolean;
}

const STORAGE_PREFIX = "4d-guid-display-";

function ladeDisplayConfig(simId: string): { zeile1: string; zeile2: string } {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + simId);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { zeile1: "Layer||Layer", zeile2: "Reference Object||Common Type" };
}

export default function TabTasks({ api, aktiveSim, aktivTask, aktivTaskId, totalObjekte, updateSim, onTaskClick, selGuids, taskSort = "gantt", readOnly = false }: Props) {
  const [guidWerte, setGuidWerte] = useState<Map<string, ObjWerte>>(new Map());
  const [verfuegbareAttrs, setVerfuegbareAttrs] = useState<string[]>([]);
  const [displayConfig, setDisplayConfig] = useState(() => ladeDisplayConfig(aktiveSim.id));
  const [settingsOffen, setSettingsOffen] = useState(false);
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [settingsQuery1, setSettingsQuery1] = useState("");
  const [settingsQuery2, setSettingsQuery2] = useState("");
  const [settingsFocus, setSettingsFocus] = useState<1 | 2 | null>(null);
  // Drag & Drop
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Safety: dragIdx zurücksetzen wenn Drag abbricht (z.B. Drop ausserhalb)
  useEffect(() => {
    if (dragIdx === null) return;
    const reset = () => { setDragIdx(null); setDropIdx(null); };
    window.addEventListener("dragend", reset);
    window.addEventListener("mouseup", reset);
    // Fallback: nach 5s automatisch reset
    const timer = setTimeout(reset, 5000);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("mouseup", reset); clearTimeout(timer); };
  }, [dragIdx]);
  // Task hinzufügen
  const [zeigeNeuTask, setZeigeNeuTask] = useState(false);
  const [neuTaskName, setNeuTaskName] = useState("");
  const [bauteilListHeight, setBauteilListHeight] = useState(() => {
    try { return Number(localStorage.getItem("4d-list-height-bauteile")) || 350; } catch { return 350; }
  });
  const resizingRef = useRef(false);

  useEffect(() => { localStorage.setItem("4d-list-height-bauteile", String(bauteilListHeight)); }, [bauteilListHeight]);

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

  function taskVerschieben(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const tasks = [...aktiveSim.tasks];
    const [moved] = tasks.splice(fromIdx, 1);
    tasks.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    updateSim({ ...aktiveSim, tasks });
  }

  function taskLoeschen(taskId: string) {
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.filter(t => t.id !== taskId) });
    if (aktivTaskId === taskId) onTaskClick(taskId); // deselect
  }

  function taskHinzufuegen() {
    if (!neuTaskName.trim()) return;
    const neuerTask: Task = {
      id: crypto.randomUUID(),
      name: neuTaskName.trim(),
      start: new Date().toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
      typ: "neubau",
      objektGuids: [],
    };
    const tasks = [...aktiveSim.tasks];
    const idx = aktivTaskId ? tasks.findIndex(t => t.id === aktivTaskId) : -1;
    if (idx >= 0) tasks.splice(idx + 1, 0, neuerTask);
    else tasks.unshift(neuerTask);
    updateSim({ ...aktiveSim, tasks });
    setNeuTaskName("");
    setZeigeNeuTask(false);
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
    // Alle zugewiesenen Guids sammeln
    const vergeben = aktiveSim.tasks.flatMap(t => t.objektGuids);
    if (vergeben.length === 0) return;

    // Zugewiesene Objekte ausblenden → nur offene bleiben sichtbar
    const byModel = new Map<string, Set<number>>();
    for (const g of vergeben) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::");
      const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, new Set()); byModel.get(mid)!.add(rId); }
    }
    const modelObjectIds = [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...rIds] }));
    try {
      await api.viewer.setObjectState({ modelObjectIds } as any, { visible: false } as any);
      console.log("[offeneMarkieren] Zugewiesene ausgeblendet:", vergeben.length);
    } catch (e) { console.log("[offeneMarkieren] Fehler:", e); }
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
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {totalObjekte != null && (() => {
              const vergeben = new Set(aktiveSim.tasks.flatMap(t => t.objektGuids)).size;
              const offen = Math.max(0, totalObjekte - vergeben);
              return offen > 0 ? (
                <button style={{ fontSize: 11, color: "#2d7dbd", fontWeight: 600, background: "none", border: "1px solid #2d7dbd",
                  padding: "1px 8px", cursor: "pointer", fontFamily: "inherit" }}
                  onClick={offeneMarkieren} title="Zugewiesene ausblenden → offene sichtbar">
                  {offen} OFFEN
                </button>
              ) : (
                <span style={{ fontSize: 11, color: "#2d7dbd", fontWeight: 600 }}>✓ VERTEILT</span>
              );
            })()}
            <button style={{ fontSize: 11, color: "#2d7dbd", fontWeight: 600, background: "none", border: "1px solid #2d7dbd",
              padding: "1px 6px", cursor: "pointer", fontFamily: "inherit", display: readOnly ? "none" : "inline-flex" }}
              onClick={() => setZeigeNeuTask(z => !z)}>+</button>
          </div>
        </div>

        {/* Neuen Task hinzufügen */}
        {!readOnly && zeigeNeuTask && (
          <div style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4", display: "flex", gap: 4 }}>
            <input className="ac-input" style={{ flex: 1, fontSize: 11 }} placeholder="Task-Name…" value={neuTaskName}
              onChange={e => setNeuTaskName(e.target.value)} onKeyDown={e => e.key === "Enter" && taskHinzufuegen()} autoFocus />
            <button className="tc-btn-primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={taskHinzufuegen}>✓</button>
            <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => { setZeigeNeuTask(false); setNeuTaskName(""); }}>✕</button>
          </div>
        )}

        <div style={{ maxHeight: bauteilListHeight, overflowY: "auto" }}>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>
            Noch keine Tasks — „+" oder Gantt importieren
          </div>
        ) : (
          (() => {
            // Sortierte Anzeige basierend auf taskSort
            const tasksWithIdx = aktiveSim.tasks.map((task, idx) => ({ task, idx }));
            if (taskSort === "datum") {
              tasksWithIdx.sort((a, b) => {
                const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0;
                const sb = parseDateUniversal(b.task.start)?.getTime() ?? 0;
                if (sa !== sb) return sa - sb;
                const ea = parseDateUniversal(a.task.end)?.getTime() ?? sa;
                const eb = parseDateUniversal(b.task.end)?.getTime() ?? sb;
                return ea - eb;
              });
            } else if (taskSort === "aktiv") {
              tasksWithIdx.sort((a, b) => {
                const aHat = selGuids.size > 0 && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
                const bHat = selGuids.size > 0 && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
                return bHat - aHat;
              });
            }
            return tasksWithIdx.map(({ task, idx }) => {
            const hatSelektierte = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
            const selAnzahl = hatSelektierte ? task.objektGuids.filter(g => selGuids.has(g)).length : 0;
            const istHover = hoverTaskId === task.id;
            const istDropTarget = dropIdx === idx;
            return (
            <div key={task.id}>
              {/* Drop-Indikator oben */}
              {istDropTarget && dragIdx !== null && dragIdx !== idx && (
                <div style={{ height: 2, background: "#2d7dbd", margin: "0 10px" }} />
              )}
              <div
                className={`task-row ${task.id === aktivTaskId ? "active" : ""}`}
                style={{ borderBottom: "1px solid #eef1f4", padding: "6px 10px", gap: 7,
                  background: task.id === aktivTaskId ? "#e8f2fa" : hatSelektierte ? "#f0f0f0" : undefined,
                  opacity: dragIdx === idx ? 0.4 : 1 }}
                onClick={() => onTaskClick(task.id)}
                onMouseEnter={() => setHoverTaskId(task.id)}
                onMouseLeave={() => setHoverTaskId(null)}
                onDragOver={e => { e.preventDefault(); setDropIdx(idx); }}
                onDrop={e => { e.preventDefault(); if (dragIdx !== null) taskVerschieben(dragIdx, idx); setDragIdx(null); setDropIdx(null); }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: task.typ === "neubau" ? "#6cc07a" : task.typ === "abbruch" ? "#edb94c" : task.typ === "temporaer" ? "#a0522d" : "#888" }} />
                <span className="task-row-name" style={{ fontSize: 13, flex: 1, color: task.id === aktivTaskId ? "#2d7dbd" : "#333", fontWeight: task.id === aktivTaskId || hatSelektierte ? 600 : 400 }}>{task.name}</span>

                {/* Datum — blau, untereinander, fixe Breite */}
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3, flexShrink: 0, minWidth: 80 }}
                  onClick={e => e.stopPropagation()}>
                  {!readOnly ? (
                    <>
                      <DatePicker value={formatDatum(task.start)} onChange={(val: string) => {
                        const norm = normalizeDatum(val);
                        if (norm) updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === task.id ? { ...t, start: norm } : t) });
                      }} />
                      <DatePicker value={formatDatum(task.end)} onChange={(val: string) => {
                        const norm = normalizeDatum(val);
                        if (norm) updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === task.id ? { ...t, end: norm } : t) });
                      }} />
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: "#2d7dbd" }}>{formatDatum(task.start)}</span>
                      <span style={{ fontSize: 11, color: "#2d7dbd" }}>{formatDatum(task.end)}</span>
                    </>
                  )}
                </span>

                {/* Rechts: Count oder Drag-Handle */}
                {!readOnly && istHover && !dragIdx ? (
                  <span
                    draggable
                    onDragStart={e => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                    style={{ cursor: "grab", color: "#8a9baa", fontSize: 14, padding: "0 2px", userSelect: "none", flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}
                    title="Ziehen zum Verschieben"
                  >☰</span>
                ) : (
                  <span className="task-row-count" style={{ fontSize: 12, marginLeft: 4, flexShrink: 0 }}>
                    {hatSelektierte
                      ? <span style={{ color: "#2d7dbd", fontWeight: 600 }}>{selAnzahl}/{task.objektGuids.length}</span>
                      : task.objektGuids.length > 0
                        ? <span style={{ color: "#8a9baa" }}>O {task.objektGuids.length}</span>
                        : <span style={{ color: "#d4dce4" }}>∅</span>}
                  </span>
                )}
              </div>
            </div>
            );
          });
          })()
        )}
        {/* Drop-Zone am Ende */}
        {dragIdx !== null && (
          <div style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#8a9baa" }}
            onDragOver={e => { e.preventDefault(); setDropIdx(aktiveSim.tasks.length); }}
            onDrop={e => { e.preventDefault(); if (dragIdx !== null) taskVerschieben(dragIdx, aktiveSim.tasks.length); setDragIdx(null); setDropIdx(null); }}>
            {dropIdx === aktiveSim.tasks.length ? <div style={{ height: 2, background: "#2d7dbd", width: "90%" }} /> : ""}
          </div>
        )}
        </div>
      </div>

      {/* Resize Handle */}
      <div
        style={{ height: 8, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}
        onMouseDown={e => {
          e.preventDefault();
          resizingRef.current = true;
          const startY = e.clientY;
          const startH = bauteilListHeight;
          const onMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            setBauteilListHeight(Math.max(150, Math.min(800, startH + ev.clientY - startY)));
          };
          const onUp = () => { resizingRef.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div style={{ width: 40, height: 3, background: "#ccc", borderRadius: 2 }} />
      </div>

      {/* Task-Detail */}
      {aktivTask ? (
        <div className="detail-section">
          <div className="detail-header">
            <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: aktivTask.typ === "neubau" ? "#22C55E" : aktivTask.typ === "abbruch" ? "#EAB308" : aktivTask.typ === "temporaer" ? "#a0522d" : "#999" }} />
            <span className="detail-task-name">{aktivTask.name}</span>
            <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>
              {totalObjekte != null ? `⬡ ${aktivTask.objektGuids.length} / ${totalObjekte}` : `⬡ ${aktivTask.objektGuids.length}`}
            </span>
            {!readOnly && <button className="tc-btn-ghost" style={{ color: "#333", fontSize: 12, padding: "0 4px", marginLeft: "auto" }}
              title="Task löschen"
              onClick={e => { e.stopPropagation(); if (confirm(`Task „${aktivTask.name}" löschen?`)) taskLoeschen(aktivTask.id); }}>🗑</button>}
          </div>

          {/* Task-Typ */}
          {!readOnly && (
          <div className="detail-block">
            <div className="detail-block-title">Task-Typ</div>
            <div className="typ-btns">
              {(["neubau", "bestand", "abbruch", "temporaer"] as TaskTyp[]).map(typ => {
                const farbe = typ === "neubau" ? "#6cc07a" : typ === "bestand" ? "#888" : typ === "abbruch" ? "#edb94c" : "#a0522d";
                const istAktiv = aktivTask.typ === typ;
                return (
                  <button key={typ} onClick={() => typAendern(aktivTask.id, typ)}
                    style={{
                      padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      borderRadius: 4, border: istAktiv ? `2px solid ${farbe}` : "1px solid #d4dce4",
                      background: istAktiv ? farbe : "#fff",
                      color: istAktiv ? "#fff" : "#555", fontFamily: "inherit",
                    }}>
                    {typ}
                  </button>
                );
              })}
            </div>
          </div>
          )}

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
                    {!readOnly && <button className="tc-btn-ghost" style={{ color: "#333" }} onClick={() => setLoeschenBestaetigen(true)}>🗑</button>}
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
                      {!readOnly && <button className="guid-row-x" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); guidEntfernen(aktivTask.id, g); }}>✕</button>}
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