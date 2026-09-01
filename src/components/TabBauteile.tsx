// TabBauteile.tsx — Orchestrator mit Selektions-Tracking + Gantt-Toggle
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task } from "../types";
import { parseDateUniversal, istGruppe, getKinder, getOutlineLevel, kaskadiereNachfolger, verschiebeAufStart, gruppenDaten, datumPlusTage,
  taskVerschieben as verschiebeTaskBlock, nsKey } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile, clearEchteBauteileCache } from "./modelHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { pruefeZeitplanBereitschaft, berechneZeitplanUebernahme, zeitplanHatAenderungen } from "./zeitplanUebernahmeHelpers";
import TabTasks from "./TabTasks";
import AttributeFilter from "./AttributeFilter";
import GanttChart from "./GanttChart";

interface Props {
  api: ApiInstance | null;
  projectId?: string | null;
  aktiveSim: SimProjekt | null;
  updateSim: (sim: SimProjekt) => void;
  selektion: number[];
  aktivesModellId: string | null;
  taskSort?: "gantt" | "datum" | "aktiv" | "name" | "nummer";
  readOnly?: boolean;
  sharedNadelTag?: React.MutableRefObject<number>;
  sichtbar?: boolean;
}

export default function TabBauteile({ api, projectId = null, aktiveSim, updateSim, aktivesModellId, taskSort, readOnly, sharedNadelTag, sichtbar }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [ganttOffen, setGanttOffen] = useState(false);
  const [nadelTag, setNadelTag] = useState(-1);
  const [ghostTag, setGhostTag] = useState(-1);
  const [filterOffen, setFilterOffen] = useState(true);
  const [suchOffen, setSuchOffen] = useState(false);
  const [suchQuery, setSuchQuery] = useState("");
  const [plusMenuOffen, setPlusMenuOffen] = useState(false);
  const [zeitplanHinweisOffen, setZeitplanHinweisOffen] = useState(false);
  const [zeitplanBestaetigenOffen, setZeitplanBestaetigenOffen] = useState(false);
  const [neuInputOffen, setNeuInputOffen] = useState(false);
  const [neuTaskInput, setNeuTaskInput] = useState("");
  const [neuTyp, setNeuTyp] = useState<"task" | "gruppe">("task");
  const lsGanttHKey = nsKey("4d-gantt-height-bauteile", projectId);
  const [ganttH, setGanttH] = useState(() => {
    try { return Number(localStorage.getItem(lsGanttHKey)) || 260; } catch { return 260; }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastClickIdx = useRef<number>(-1);

  const aktivTaskId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;
  // Kombinierte Objekte aller ausgewählten Tasks
  const allTasksForSel = aktiveSim?.tasks ?? [];
  const selectedTasks = allTasksForSel.filter(t => selectedIds.includes(t.id));
  const selectedGroupCount = selectedTasks.filter(t => {
    const idx = allTasksForSel.findIndex(x => x.id === t.id);
    return idx >= 0 && (t.isGroup || istGruppe(allTasksForSel, idx));
  }).length;
  const combinedGuids = selectedTasks.flatMap(t => t.objektGuids);
  // Virtueller kombinierter Task für Detail-Panel
  const combinedTask = selectedTasks.length > 0 ? {
    ...selectedTasks[0],
    objektGuids: [...new Set(combinedGuids)],
    name: selectedTasks.length === 1 ? selectedTasks[0].name
      : `${selectedTasks.length} Tasks ausgewählt${selectedGroupCount > 0 ? ` · ${selectedGroupCount} ${selectedGroupCount === 1 ? "Gruppe" : "Gruppen"}` : ""}`,
  } : null;

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

  function taskAnklicken(taskId: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) {
    const tasks = aktiveSim?.tasks ?? [];
    const idx = tasks.findIndex(t => t.id === taskId);
    if (event?.shiftKey && lastClickIdx.current >= 0) {
      // Shift: Bereich auswählen
      const from = Math.min(lastClickIdx.current, idx);
      const to = Math.max(lastClickIdx.current, idx);
      const rangeIds = tasks.slice(from, to + 1).map(t => t.id);
      setSelectedIds(rangeIds);
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd: einzeln umschalten
      setSelectedIds(prev => prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]);
    } else {
      // Normal: dieser Task — bei einer Gruppe alle enthaltenen Tasks/Untergruppen mit auswählen
      const istGrp = idx >= 0 && (tasks[idx].isGroup || istGruppe(tasks, idx));
      const idsZuWaehlen = istGrp ? [taskId, ...getKinder(tasks, idx).map(i => tasks[i].id)] : [taskId];
      setSelectedIds(prev => {
        const gleich = prev.length === idsZuWaehlen.length && idsZuWaehlen.every(id => prev.includes(id));
        return gleich ? [] : idsZuWaehlen;
      });
    }
    lastClickIdx.current = idx;
    setResetSignal(s => s + 1);
    if (suchQuery) { setSuchOffen(false); setSuchQuery(""); }
  }

  // Gesamtzählung
  useEffect(() => {
    if (!api || !aktiveSim || aktiveSim.modelle.length === 0) { setTotalObjekte(null); return; }
    clearEchteBauteileCache();
    let abgebrochen = false;
    (async () => {
      let gesamt = 0;
      for (const modell of aktiveSim.modelle) {
        if (!modell.id) continue;
        const echte = await getEchteBauteile(api, aktiveSim.id, modell.id);
        gesamt += echte.length;
      }
      if (abgebrochen) return;
      setTotalObjekte(gesamt > 0 ? gesamt : null);
    })();
    return () => { abgebrochen = true; };
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
    const tasks = kaskadiereNachfolger(
      aktiveSim.tasks.map(t => t.id === taskId ? { ...t, start: newStart, end: newEnd } : t),
      taskId
    );
    updateSim({ ...aktiveSim, tasks });
  }

  function ganttSetPredecessor(taskId: string, predId: string | null, lagDays: number) {
    if (!aktiveSim) return;
    let tasks = aktiveSim.tasks.map(t => t.id === taskId ? { ...t, predecessorId: predId ?? undefined, lagDays } : t);
    if (predId) {
      const predIdx = tasks.findIndex(t => t.id === predId);
      const pred = tasks[predIdx];
      const predEnd = pred?.isGroup ? gruppenDaten(tasks, predIdx).end : pred?.end;
      if (predEnd) tasks = verschiebeAufStart(tasks, taskId, datumPlusTage(predEnd, lagDays));
    }
    tasks = kaskadiereNachfolger(tasks, taskId);
    updateSim({ ...aktiveSim, tasks });
  }

  function neuErstellen() {
    if (!aktiveSim || !neuTaskInput.trim()) return;
    const heute = new Date().toISOString().slice(0, 10);
    const idx = aktivTaskId
      ? aktiveSim.tasks.findIndex(t => t.id === aktivTaskId)
      : (neuTyp === "gruppe" ? 0 : aktiveSim.tasks.length);
    const refTask = idx >= 0 ? aktiveSim.tasks[idx] : null;
    const refLevel = refTask ? getOutlineLevel(refTask) : 1;
    const neuerTask: Task = {
      id: crypto.randomUUID(), name: neuTaskInput.trim(), start: heute, end: heute,
      typ: "neubau", objektGuids: [],
      outlineLevel: neuTyp === "gruppe" ? refLevel : (refLevel + (refTask && istGruppe(aktiveSim.tasks, idx) ? 1 : 0)),
      isGroup: neuTyp === "gruppe" ? true : undefined,
    };
    const tasks = [...aktiveSim.tasks];
    if (neuTyp === "gruppe") tasks.splice(Math.max(0, idx), 0, neuerTask);
    else tasks.splice(idx >= 0 ? idx + 1 : tasks.length, 0, neuerTask);
    updateSim({ ...aktiveSim, tasks });
    setNeuTaskInput(""); setPlusMenuOffen(false); setNeuInputOffen(false);
  }

  function ganttTaskReorder(fromIdx: number, toIdx: number) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: verschiebeTaskBlock(aktiveSim.tasks, fromIdx, toIdx, selectedIds) });
  }

  // "Berechnete Dauer übernehmen" — überträgt die Kalkulations-Dauer jedes Tasks auf den Bauablauf,
  // siehe zeitplanUebernahmeHelpers.ts. Erst möglich, wenn Tab Kalkulation fehlerfrei ist (keine roten
  // Mengen-Felder).
  const zeitplanStatus = aktiveSim ? pruefeZeitplanBereitschaft(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN) : null;
  const zeitplanAenderungen = aktiveSim && zeitplanStatus?.bereit
    ? zeitplanHatAenderungen(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN, aktiveSim.kalender ?? LEERER_KALENDER)
    : false;
  function zeitplanButtonKlick() {
    if (!zeitplanStatus?.bereit) { setZeitplanHinweisOffen(o => !o); return; }
    setZeitplanBestaetigenOffen(true);
  }
  function zeitplanUebernehmen() {
    if (!aktiveSim) return;
    const stammdaten = aktiveSim.stammdaten ?? LEERE_STAMMDATEN;
    const kalender = aktiveSim.kalender ?? LEERER_KALENDER;
    updateSim({ ...aktiveSim, tasks: berechneZeitplanUebernahme(aktiveSim.tasks, stammdaten, kalender) });
    setZeitplanBestaetigenOffen(false);
  }

  return (
    <div className="tasklist-wrap">
      {/* Suche + Toggle */}
      <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: 4 }}>
        {suchOffen ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#8a9baa", flexShrink: 0, cursor: "pointer" }}
              onClick={() => { setSuchOffen(false); setSuchQuery(""); }}>✕</span>
            <input autoFocus placeholder="Task suchen…" value={suchQuery}
              onChange={e => setSuchQuery(e.target.value)}
              style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d4dce4", fontFamily: "inherit", outline: "none" }}
              onKeyDown={e => { if (e.key === "Escape") { setSuchOffen(false); setSuchQuery(""); } }} />
          </div>
        ) : (<>
          <button className="tc-btn-secondary" style={{ fontSize: 12, padding: "2px 6px" }}
            onClick={() => setSuchOffen(true)} title="Tasks suchen">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#333" strokeWidth="1.8"><circle cx="6.5" cy="6.5" r="5"/><line x1="10.2" y1="10.2" x2="14.5" y2="14.5"/></svg>
          </button>
          {!readOnly && (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <button className="tc-btn-primary" style={{ fontSize: 16, padding: "2px 10px", fontWeight: 700, lineHeight: 1 }}
                onClick={() => setPlusMenuOffen(m => !m)}>+</button>
              {plusMenuOffen && (
                <div style={{ position: "absolute", left: 0, top: "100%", marginTop: 2, background: "#fff", border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 140, fontSize: 11 }}>
                  <div style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eef1f4" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                    onClick={() => { setNeuTyp("task"); setPlusMenuOffen(false); setNeuInputOffen(true); }}>
                    + Neuer Task
                  </div>
                  <div style={{ padding: "6px 10px", cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                    onClick={() => { setNeuTyp("gruppe"); setPlusMenuOffen(false); setNeuInputOffen(true); }}>
                    📁 Neue Gruppe
                  </div>
                </div>
              )}
            </div>
          )}
        </>)}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          {!readOnly && aktiveSim && zeitplanStatus && (
            <div style={{ position: "relative" }}>
              <button
                className={zeitplanStatus.bereit && !zeitplanAenderungen ? "tc-btn-secondary" : undefined}
                style={{
                  fontSize: 12, padding: "4px 12px", fontWeight: 600, borderRadius: 0, cursor: "pointer",
                  ...(!zeitplanStatus.bereit
                    ? { background: "#eef1f4", color: "#9aa5b0", border: "1px solid #d4dce4" }
                    : zeitplanAenderungen
                      ? { background: "var(--tc-blue-light)", color: "var(--tc-blue)", border: "1px solid var(--tc-blue)" }
                      : {}),
                }}
                title={
                  !zeitplanStatus.bereit ? "Klicken für Details, was dafür noch fehlt"
                    : zeitplanAenderungen ? "Berechnete Dauer aus Tab Kalkulation auf den Bauablauf übernehmen"
                      : "Bauablauf entspricht bereits der berechneten Dauer — nichts zu übernehmen"
                }
                onClick={zeitplanButtonKlick}>
                Berechnete Dauer übernehmen
              </button>
              {zeitplanHinweisOffen && !zeitplanStatus.bereit && (
                <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #d4dce4",
                  boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, width: 280, padding: "10px 12px", fontSize: 11 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Noch nicht möglich — es fehlt:</div>
                  {zeitplanStatus.keineTasks && <div style={{ color: "var(--tc-text-3)" }}>Keine Tasks im Bauablauf vorhanden.</div>}
                  {zeitplanStatus.fehlerTasks.length > 0 && (
                    <div>
                      <div style={{ color: "var(--tc-red)" }}>{zeitplanStatus.fehlerTasks.length} Task(s) mit Fehler in der Mengenermittlung (Tab Kalkulation):</div>
                      <div style={{ color: "var(--tc-text-3)", marginTop: 2 }}>{zeitplanStatus.fehlerTasks.map(t => t.name).join(", ")}</div>
                    </div>
                  )}
                  <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "3px 8px", marginTop: 8 }}
                    onClick={() => setZeitplanHinweisOffen(false)}>Schliessen</button>
                </div>
              )}
            </div>
          )}
          <button className="tc-btn-secondary" style={{ fontSize: 12, padding: "4px 12px", fontWeight: 600 }}
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
      </div>

      {zeitplanBestaetigenOffen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setZeitplanBestaetigenOffen(false)}>
          <div style={{ background: "#fff", width: 420, maxWidth: "92vw", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)", fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>
              Berechnete Dauer übernehmen
            </div>
            <div style={{ padding: "16px 18px", fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.6 }}>
              Für jeden Task wird die in Tab Kalkulation berechnete Dauer als neuer Start-/Endtermin
              übernommen, entlang der bestehenden Vorgänger-Kette — bestehende Termine werden dabei
              überschrieben. Das lässt sich nicht rückgängig machen.
              <div style={{ marginTop: 10, fontWeight: 600 }}>
                Empfehlung: Zuerst das komplette Projekt kopieren (⋮-Menü der Simulation), dann die
                Übernahme in der Kopie durchführen.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "0 18px 18px" }}>
              <button className="tc-btn-primary" style={{ flex: 1 }} onClick={zeitplanUebernehmen}>Übernehmen</button>
              <button className="tc-btn-secondary" onClick={() => setZeitplanBestaetigenOffen(false)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {neuInputOffen && (
        <div style={{ display: "flex", gap: 4, padding: "4px 8px", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#8a9baa", flexShrink: 0 }}>{neuTyp === "gruppe" ? "📁" : "+"}</span>
          <input autoFocus placeholder={neuTyp === "gruppe" ? "Gruppenname…" : "Task-Name…"}
            value={neuTaskInput} onChange={e => setNeuTaskInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") neuErstellen(); if (e.key === "Escape") { setNeuInputOffen(false); setNeuTaskInput(""); } }}
            style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d4dce4", fontFamily: "inherit", outline: "none" }} />
          <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "2px 6px" }}
            onClick={() => { setNeuInputOffen(false); setNeuTaskInput(""); }}>✕</button>
        </div>
      )}

      {ganttOffen ? (
        <>
          <GanttChart
            projectId={projectId}
            tasks={tasks}
            currentTag={ghostTag >= 0 ? ghostTag : nadelTag}
            totalTage={totalTage}
            minDate={minDate}
            laeuft={false}
            onTaskClick={(idx, e) => { if (tasks[idx]) taskAnklicken(tasks[idx].id, e); }}
            onNadelClick={tag => { setGhostTag(-1); setNadelTag(tag); }}
            selTaskId={aktivTaskId}
            selectedIds={selectedIds}
            selGuids={selGuids}
            taskSort={taskSort}
            height={ganttH}
            editable={!readOnly}
            onDateChange={ganttDateChange}
            onTaskReorder={ganttTaskReorder}
            onSetPredecessor={ganttSetPredecessor}
            onTaskRename={(id, name) => { if (aktiveSim) updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === id ? { ...t, name } : t) }); }}
            showObjektCount
            suchQuery={suchQuery}
            nadelStil={ghostTag >= 0 ? "ghost" : "normal"}
            kalender={aktiveSim?.kalender}
          />
          <div onMouseDown={e => {
            e.preventDefault();
            const sy = e.clientY, sh = ganttH;
            const onMove = (ev: MouseEvent) => {
              const newH = Math.max(120, sh + ev.clientY - sy);
              setGanttH(newH);
              localStorage.setItem(lsGanttHKey, String(newH));
            };
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }} style={{ height: 6, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 40, height: 3, background: "#d4dce4", borderRadius: 2 }} />
          </div>
          <TabTasks
            api={api}
            projectId={projectId}
            aktiveSim={aktiveSim}
            aktivTask={combinedTask}
            aktivTaskId={aktivTaskId}
            selectedIds={selectedIds}
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
          projectId={projectId}
          aktiveSim={aktiveSim}
          aktivTask={combinedTask}
          aktivTaskId={aktivTaskId}
          selectedIds={selectedIds}
          totalObjekte={totalObjekte}
          updateSim={updateSim}
          onTaskClick={taskAnklicken}
          selGuids={selGuids}
          taskSort={taskSort}
          readOnly={readOnly}
          suchQuery={suchQuery}
        />
      )}
      {combinedTask && !readOnly && !combinedTask.isGroup && (
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
        </>
      )}
    </div>
  );
}
