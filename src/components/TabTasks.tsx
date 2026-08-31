// TabTasks.tsx — Task-Liste + Task-Detail + Visibility-Buttons + Guid-Liste
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { SimProjekt, Task, TaskTyp } from "../types";
import { formatDatum, normalizeDatum, parseDateUniversal, getOutlineLevel, istGruppe, gruppenDaten, getKinder,
  berechneNummern, gueltigeVorgaenger, verschiebeAufStart, kaskadiereNachfolger, datumPlusTage,
  taskVerschieben as verschiebeTaskBlock, sucheSortiereTasks, nsKey } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchGetProperties, batchConvertToObjectIds } from "../hooks/useApi";
import DatePicker from "./DatePicker";
import SelectionTools from "./SelectionTools";

// Alle Werte eines Objekts flach sammeln
interface ObjWerte { [key: string]: string; } // "PSet||PropName" → value

interface Props {
  api: ApiInstance | null;
  projectId?: string | null;
  aktiveSim: SimProjekt;
  aktivTask: Task | null;
  aktivTaskId: string | null;
  selectedIds?: string[];
  totalObjekte: number | null;
  updateSim: (sim: SimProjekt) => void;
  onTaskClick: (id: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  selGuids: Set<string>;
  taskSort?: "gantt" | "datum" | "aktiv" | "name" | "nummer";
  readOnly?: boolean;
  detailOnly?: boolean;
  suchQuery?: string;
}

const STORAGE_PREFIX = "4d-guid-display-";

function ladeDisplayConfig(simId: string, projectId: string | null): { zeile1: string; zeile2: string } {
  try {
    const raw = localStorage.getItem(nsKey(STORAGE_PREFIX + simId, projectId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { zeile1: "Layer||Layer", zeile2: "Reference Object||Common Type" };
}

export default function TabTasks({ api, projectId = null, aktiveSim, aktivTask, aktivTaskId, selectedIds = [], totalObjekte, updateSim, onTaskClick, selGuids, taskSort = "gantt", readOnly = false, detailOnly = false, suchQuery = "" }: Props) {
  const [guidWerte, setGuidWerte] = useState<Map<string, ObjWerte>>(new Map());
  const [verfuegbareAttrs, setVerfuegbareAttrs] = useState<string[]>([]);
  const [displayConfig, setDisplayConfig] = useState(() => ladeDisplayConfig(aktiveSim.id, projectId));
  const [settingsOffen, setSettingsOffen] = useState(false);
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [loeschDialogOffen, setLoeschDialogOffen] = useState(false);
  const [typOffen, setTypOffen] = useState(true);
  const [bauteileOffen, setBauteileOffen] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameVal, setEditingNameVal] = useState("");
  const [settingsQuery1, setSettingsQuery1] = useState("");
  const [settingsQuery2, setSettingsQuery2] = useState("");
  const [settingsFocus, setSettingsFocus] = useState<1 | 2 | null>(null);
  // Drag & Drop
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  // Vorgänger-Auswahl (Popover per Portal, damit es nicht vom Listen-Scrollcontainer abgeschnitten wird)
  const [predPickerTaskId, setPredPickerTaskId] = useState<string | null>(null);
  const [predPos, setPredPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [predInput, setPredInput] = useState("");
  const [lagInput, setLagInput] = useState("0");
  const [predListOffen, setPredListOffen] = useState(false);
  const predPopoverRef = useRef<HTMLDivElement>(null);
  const predDropdownRef = useRef<HTMLDivElement>(null);
  const nummern = useMemo(() => berechneNummern(aktiveSim.tasks), [aktiveSim.tasks]);
  // Für die Detail-Kopfzeile: wie viele Tasks sind markiert und wie viele davon Gruppen (für den 2-Optionen-Lösch-Dialog)
  const selInfo = useMemo(() => {
    if (!aktivTask) return { total: 0, groups: 0, ids: [] as string[] };
    const ids = selectedIds.length > 0 ? selectedIds : [aktivTask.id];
    let groups = 0;
    for (const id of ids) {
      const idx = aktiveSim.tasks.findIndex(t => t.id === id);
      if (idx >= 0 && istGruppe(aktiveSim.tasks, idx)) groups++;
    }
    return { total: ids.length, groups, ids };
  }, [selectedIds, aktivTask, aktiveSim.tasks]);

  // Für die Detail-Ansicht: ist der aktive Task strukturell eine Gruppe (Flag oder Kinder-Hierarchie)?
  const aktivIsGroup = useMemo(() => {
    if (!aktivTask) return false;
    const idx = aktiveSim.tasks.findIndex(t => t.id === aktivTask.id);
    return idx >= 0 && (!!aktivTask.isGroup || istGruppe(aktiveSim.tasks, idx));
  }, [aktivTask, aktiveSim.tasks]);
  // Bei Gruppen/Untergruppen: Bauteile aller (rekursiv) untergeordneten Tasks aggregieren, damit
  // das Detail-Panel beim Anwählen einer Gruppe die zugewiesenen Bauteile anzeigt statt leer zu bleiben.
  const bauteilGuids = useMemo(() => {
    if (!aktivTask) return [];
    if (!aktivIsGroup) return aktivTask.objektGuids;
    const idx = aktiveSim.tasks.findIndex(t => t.id === aktivTask.id);
    if (idx < 0) return aktivTask.objektGuids;
    const level = getOutlineLevel(aktivTask);
    const ids = [...aktivTask.objektGuids];
    for (let ci = idx + 1; ci < aktiveSim.tasks.length; ci++) {
      if (getOutlineLevel(aktiveSim.tasks[ci]) <= level) break;
      ids.push(...aktiveSim.tasks[ci].objektGuids);
    }
    return [...new Set(ids)];
  }, [aktivTask, aktivIsGroup, aktiveSim.tasks]);

  useEffect(() => {
    if (!predPickerTaskId) return;
    const onDocMouseDown = (e: MouseEvent) => {
      // composedPath() statt e.target/contains(): eine Vorgänger-Auswahl entfernt die Dropdown-Liste
      // (und damit das geklickte Element) noch während desselben Klicks aus dem DOM — ein bereits
      // entferntes Element gilt bei contains() fälschlich als "außerhalb", was das Popover sofort schloss.
      const pfad = e.composedPath ? e.composedPath() : [];
      if (predPopoverRef.current && !pfad.includes(predPopoverRef.current)) setPredPickerTaskId(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [predPickerTaskId]);

  // Vorgänger-Popover nach dem Rendern an den Bildschirmrand klemmen, damit er nie abgeschnitten wird
  useLayoutEffect(() => {
    if (!predPickerTaskId) return;
    const el = predPopoverRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 4;
    let left = r.left, top = r.top;
    if (r.right > window.innerWidth - pad) left -= r.right - (window.innerWidth - pad);
    if (left < pad) left = pad;
    if (r.bottom > window.innerHeight - pad) top -= r.bottom - (window.innerHeight - pad);
    if (top < pad) top = pad;
    if (left !== r.left || top !== r.top) setPredPos({ left, top });
  }, [predPickerTaskId]);

  // Vorgänger-Liste beim Öffnen so scrollen, dass der bestehende bzw. naheliegende Vorgänger mittig sichtbar ist
  useLayoutEffect(() => {
    if (!predPickerTaskId || !predListOffen) return;
    const container = predDropdownRef.current;
    const task = aktiveSim.tasks.find(t => t.id === predPickerTaskId);
    if (!container || !task) return;
    let zielId = task.predecessorId;
    if (!zielId) {
      const eigeneNr = Number(nummern.get(task.id));
      if (!isNaN(eigeneNr)) {
        const kandidat = gueltigeVorgaenger(aktiveSim.tasks, task.id).find(c => Number(nummern.get(c.id)) === eigeneNr - 1);
        zielId = kandidat?.id;
      }
    }
    if (!zielId) return;
    const el = container.querySelector(`[data-cid="${zielId}"]`) as HTMLElement | null;
    if (el) container.scrollTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
  }, [predPickerTaskId, predListOffen]);

  // Safety: dragIdx zurücksetzen wenn Drag abbricht (z.B. Drop ausserhalb)
  useEffect(() => {
    if (dragIdx === null) return;
    const reset = () => { setDragIdx(null); setDropIdx(null); };
    window.addEventListener("dragend", reset);
    window.addEventListener("mouseup", reset);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("mouseup", reset); };
  }, [dragIdx]);
  // Task hinzufügen
  const lsBauteilListHKey = nsKey("4d-list-height-bauteile", projectId);
  const [bauteilListHeight, setBauteilListHeight] = useState(() => {
    try { return Number(localStorage.getItem(lsBauteilListHKey)) || 350; } catch { return 350; }
  });
  const resizingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll zum aktiven Task wenn er sich ändert (z.B. nach Suche)
  useEffect(() => {
    if (!aktivTaskId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-taskid="${aktivTaskId}"]`) as HTMLElement;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [aktivTaskId]);

  useEffect(() => { localStorage.setItem(lsBauteilListHKey, String(bauteilListHeight)); }, [lsBauteilListHKey, bauteilListHeight]);

  // Display-Config neu laden wenn Sim wechselt
  useEffect(() => {
    setDisplayConfig(ladeDisplayConfig(aktiveSim.id, projectId));
  }, [aktiveSim.id, projectId]);

  // Alle Properties für Task-Objekte laden
  useEffect(() => {
    setGuidWerte(new Map());
    setVerfuegbareAttrs([]);
    setLoeschenBestaetigen(false);
    setLoeschDialogOffen(false);
    if (!api || bauteilGuids.length === 0) return;
    let abgebrochen = false;
    (async () => {
      const werte = new Map<string, ObjWerte>();
      const allKeys = new Set<string>();

      function sammelWerte(obj: ObjWerte, pset: any, psetName: string) {
        for (const p of pset?.properties ?? []) {
          if (!p?.name) continue;
          const sub = p?.properties ?? p?.items;
          if (Array.isArray(sub) && sub.length > 0) {
            sammelWerte(obj, p, p.name);
          } else {
            const v = String(p?.value ?? "").trim();
            if (v && v !== "null" && v !== "undefined") {
              const key = `${psetName}||${p.name}`;
              obj[key] = v;
              allKeys.add(key);
            }
          }
        }
      }

      // Nach Modell gruppieren: getLayers/convertToObjectIds/getObjectProperties je Modell nur einmal
      // (gebatcht statt bisher pro Objekt) statt sequentiell für jedes einzelne Objekt aufzurufen
      const nachModell = new Map<string, { g: string; rId: number }[]>();
      for (const g of bauteilGuids) {
        if (!g.includes(":::")) continue;
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        if (!nachModell.has(mid)) nachModell.set(mid, []);
        nachModell.get(mid)!.push({ g, rId });
        werte.set(g, {});
      }

      for (const [mid, eintraege] of nachModell) {
        const rIds = eintraege.map(e => e.rId);
        const objByRId = new Map(eintraege.map(e => [e.rId, e.g]));

        // IFC GUIDs gebatcht statt pro Objekt einzeln
        const guidById = await batchConvertToObjectIds(api, mid, rIds);
        for (const [rId, ifcGuid] of guidById) {
          const g = objByRId.get(rId);
          if (g) {
            werte.get(g)!["Reference Object||GUID (IFC)"] = ifcGuid;
            allKeys.add("Reference Object||GUID (IFC)");
          }
        }

        // Properties gebatcht (Chunks von 10, mit Einzel-Fallback bei Chunk-Fehler)
        try {
          const props = await batchGetProperties(api, mid, rIds);
          for (const entry of props) {
            const g = objByRId.get(entry.id);
            if (!g) continue;
            const obj = werte.get(g)!;
            sammelWerte(obj, entry, (entry as any)?.name || "Eigenschaften");
            if (entry.product) {
              const p = entry.product;
              if (p.name) { obj["Product||Product Name"] = String(p.name); allKeys.add("Product||Product Name"); }
              if (p.objectType) { obj["Reference Object||Common Type"] = String(p.objectType); allKeys.add("Reference Object||Common Type"); }
              if (p.description) { obj["Product||Description"] = String(p.description); allKeys.add("Product||Description"); }
            }
          }
        } catch {}

        // Layer: pro Modell nur einmal laden (Ergebnis hängt nicht vom Objekt ab) statt pro Objekt neu
        try {
          const layers = await api.viewer.getLayers(mid) as any[];
          if (Array.isArray(layers)) {
            for (const l of layers) {
              if (!l?.name) continue;
              const memberIds: number[] = l?.objectRuntimeIds ?? [];
              for (const rId of memberIds) {
                const g = objByRId.get(rId);
                if (g) { werte.get(g)!["Layer||Layer"] = String(l.name); allKeys.add("Layer||Layer"); }
              }
            }
          }
        } catch {}
      }

      if (abgebrochen) return;
      setGuidWerte(werte);
      setVerfuegbareAttrs([...allKeys].sort());
    })();
    return () => { abgebrochen = true; };
  }, [aktivTask?.id, bauteilGuids, api]);

  function saveDisplayConfig(cfg: { zeile1: string; zeile2: string }) {
    setDisplayConfig(cfg);
    localStorage.setItem(nsKey(STORAGE_PREFIX + aktiveSim.id, projectId), JSON.stringify(cfg));
  }

  function typAendern(taskId: string, typ: TaskTyp) {
    const idsToChange = selectedIds.length > 1 ? new Set(selectedIds) : new Set([taskId]);
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => idsToChange.has(t.id) ? { ...t, typ } : t) });
  }

  function taskVerschieben(fromIdx: number, toIdx: number) {
    updateSim({ ...aktiveSim, tasks: verschiebeTaskBlock(aktiveSim.tasks, fromIdx, toIdx, selectedIds) });
  }

  // modus "mitKindern": alle markierten Ids (inkl. Kinder von Gruppen) werden entfernt
  // modus "nurGruppe": nur die Gruppen-Zeilen selbst werden entfernt, ihre Kinder bleiben (eine Ebene zurückgestuft)
  function tasksLoeschen(ids: string[], modus: "mitKindern" | "nurGruppe") {
    if (modus === "mitKindern") {
      const idSet = new Set(ids);
      updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.filter(t => !idSet.has(t.id)) });
    } else {
      const groupIds = ids.filter(id => {
        const idx = aktiveSim.tasks.findIndex(t => t.id === id);
        return idx >= 0 && istGruppe(aktiveSim.tasks, idx);
      });
      let tasks = aktiveSim.tasks;
      for (const gid of groupIds) {
        const idx = tasks.findIndex(t => t.id === gid);
        if (idx < 0) continue;
        const kinderIds = new Set(getKinder(tasks, idx).map(ci => tasks[ci].id));
        tasks = tasks.filter(t => t.id !== gid).map(t => kinderIds.has(t.id) ? { ...t, outlineLevel: Math.max(1, getOutlineLevel(t) - 1) } : t);
      }
      updateSim({ ...aktiveSim, tasks });
    }
    setLoeschDialogOffen(false);
  }

  function oeffnePredPicker(task: Task, e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const POPOVER_W = 190;
    setPredPos({ top: r.bottom + 2, left: Math.min(r.right - POPOVER_W, window.innerWidth - POPOVER_W - 4) });
    setPredPickerTaskId(task.id);
    setPredInput(task.predecessorId ? nummern.get(task.predecessorId) ?? "" : "");
    setLagInput(String(task.lagDays ?? 0));
    // Bei bereits gesetztem Vorgänger gleich Wartetage zeigen statt der Liste (nur bei neuer Auswahl automatisch aufklappen)
    setPredListOffen(!task.predecessorId);
  }

  function vorgängerSetzen(taskId: string, predId: string | null, lagDays: number) {
    let tasks = aktiveSim.tasks.map(t => t.id === taskId ? { ...t, predecessorId: predId ?? undefined, lagDays } : t);
    if (predId) {
      const predIdx = tasks.findIndex(t => t.id === predId);
      const pred = tasks[predIdx];
      const predEnd = pred?.isGroup ? gruppenDaten(tasks, predIdx).end : pred?.end;
      if (predEnd) tasks = verschiebeAufStart(tasks, taskId, datumPlusTage(predEnd, lagDays));
    }
    tasks = kaskadiereNachfolger(tasks, taskId);
    updateSim({ ...aktiveSim, tasks });
    setPredPickerTaskId(null);
  }

  function taskUmbenennen(taskId: string, neuerName: string) {
    if (!neuerName.trim()) { setEditingNameId(null); return; }
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, name: neuerName.trim() } : t) });
    setEditingNameId(null);
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
      {/* Task-Liste — nur wenn nicht detailOnly */}
      {!detailOnly && (<>
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
              ) : null;
            })()}
          </div>
        </div>

        <div ref={scrollRef} style={{ maxHeight: bauteilListHeight, overflowY: "auto" }}
          onScroll={() => setPredPickerTaskId(null)}>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "#8a9baa", textAlign: "center" }}>
            Noch keine Tasks — „+" oder Gantt importieren
          </div>
        ) : (
          (() => {
            // Sortierte Anzeige basierend auf taskSort
            let tasksWithIdx = aktiveSim.tasks.map((task, idx) => ({ task, idx }));
            const istSuche = suchQuery.trim().length > 0;
            if (istSuche) {
              // Suche: nur Tasks bei denen ALLE Suchwörter vorkommen, beste Treffer zuerst
              tasksWithIdx = sucheSortiereTasks(tasksWithIdx, e => e.task, suchQuery);
            } else if (taskSort === "datum") {
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
            } else if (taskSort === "name") {
              tasksWithIdx.sort((a, b) => a.task.name.localeCompare(b.task.name, "de"));
            } else if (taskSort === "nummer") {
              const extractNum = (s: string): number => {
                const nums = s.match(/\d+/g);
                return nums ? parseInt(nums[nums.length - 1], 10) : Infinity;
              };
              tasksWithIdx.sort((a, b) => {
                const na = extractNum(a.task.name), nb = extractNum(b.task.name);
                if (na !== nb) return na - nb;
                return a.task.name.localeCompare(b.task.name, "de");
              });
            }
            // Gruppen: eingeklappte Kinder ausblenden — bei aktiver Suche übersprungen,
            // damit Treffer aus eingeklappten Gruppen trotzdem angezeigt werden
            const sichtbar = istSuche ? tasksWithIdx : tasksWithIdx.filter(({ idx }) => {
              let level = getOutlineLevel(aktiveSim.tasks[idx]);
              // Prüfen ob irgendeine Eltern-Gruppe (auf jeder Ebene) zugeklappt ist
              for (let p = idx - 1; p >= 0; p--) {
                const pLevel = getOutlineLevel(aktiveSim.tasks[p]);
                if (pLevel < level) {
                  if (collapsedGroups.has(aktiveSim.tasks[p].id)) return false;
                  level = pLevel;
                }
              }
              return true;
            });
            return sichtbar.map(({ task, idx }) => {
            const hatSelektierte = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
            const selAnzahl = hatSelektierte ? task.objektGuids.filter(g => selGuids.has(g)).length : 0;
            const istHover = hoverTaskId === task.id;
            const istDropTarget = dropIdx === idx;
            const isGroup = task.isGroup || istGruppe(aktiveSim.tasks, idx);
            const canDrag = !readOnly && (taskSort === "gantt" || taskSort === "aktiv");
            const level = getOutlineLevel(task);
            const indent = level * 16;
            const gDaten = isGroup ? gruppenDaten(aktiveSim.tasks, idx) : null;
            const collapsed = collapsedGroups.has(task.id);
            return (
            <div key={task.id}>
              {istDropTarget && dragIdx !== null && dragIdx !== idx && (
                <div style={{ height: 2, background: "#2d7dbd", margin: "0 10px" }} />
              )}
              <div
                data-taskid={task.id}
                className={`task-row ${selectedIds.includes(task.id) ? "active" : ""}`}
                style={{ borderBottom: "1px solid #eef1f4", padding: "6px 10px", paddingLeft: 10 + indent, gap: 7,
                  background: isGroup && istDropTarget && dragIdx !== null ? "#dbeafe" : selectedIds.includes(task.id) ? "#e8f2fa" : hatSelektierte ? "#f0f0f0" : undefined,
                  opacity: dragIdx !== null && selectedIds.includes(task.id) ? 0.4 : 1, fontWeight: isGroup ? 700 : undefined }}
                onClick={(e) => onTaskClick(task.id, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })}
                onMouseEnter={() => setHoverTaskId(task.id)}
                onMouseLeave={() => setHoverTaskId(null)}
                onDragOver={e => { e.preventDefault(); setDropIdx(idx); }}
                onDrop={e => { e.preventDefault(); if (dragIdx !== null) taskVerschieben(dragIdx, idx); setDragIdx(null); setDropIdx(null); }}
              >
                {/* Typ-Punkt/Auf-Zuklapp-Dreieck — beim Hover bzw. während des Ziehens vom Drag-Handle überblendet */}
                <span style={{ width: 14, height: 14, flexShrink: 0, marginRight: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {canDrag && (dragIdx === idx || (istHover && dragIdx === null)) ? (
                    <span
                      draggable
                      onDragStart={e => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                      onClick={e => { e.stopPropagation(); if (isGroup) setCollapsedGroups(s => { const n = new Set(s); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n; }); }}
                      style={{ cursor: "grab", color: "#8a9baa", fontSize: 14, userSelect: "none" }}
                      title="Ziehen zum Verschieben"
                    >☰</span>
                  ) : isGroup ? (
                    <span onClick={e => { e.stopPropagation(); setCollapsedGroups(s => { const n = new Set(s); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n; }); }}
                      style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${collapsed ? -90 : 0}deg)`, transition: "transform .15s", fontSize: 9, cursor: "pointer", color: "#555" }}>▼</span>
                  ) : (
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: task.typ === "neubau" ? "#6cc07a" : task.typ === "abbruch" ? "#edb94c" : task.typ === "temporaer" ? "#a0522d" : "#888" }} />
                  )}
                </span>
                {!readOnly && editingNameId === task.id ? (
                  <input autoFocus value={editingNameVal}
                    onChange={e => setEditingNameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") taskUmbenennen(task.id, editingNameVal); if (e.key === "Escape") setEditingNameId(null); }}
                    onBlur={() => taskUmbenennen(task.id, editingNameVal)}
                    onClick={e => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 13, padding: "1px 4px", border: "1px solid #2d7dbd", outline: "none", fontFamily: "inherit", fontWeight: isGroup ? 700 : 400 }} />
                ) : (
                  <span className="task-row-name"
                    onDoubleClick={!readOnly ? (e) => { e.stopPropagation(); setEditingNameId(task.id); setEditingNameVal(task.name); } : undefined}
                    style={{ fontSize: 13, flex: 1, cursor: !readOnly ? "text" : "default", color: selectedIds.includes(task.id) ? "#2d7dbd" : "#333", fontWeight: selectedIds.includes(task.id) || hatSelektierte || isGroup ? 600 : 400 }}>{task.name}</span>
                )}

                {/* Nummer | Vorgänger — Klick auf den ganzen Bereich öffnet Vorgänger-Auswahl */}
                <span style={{ flexShrink: 0, fontSize: 11, marginRight: 6, minWidth: 34, textAlign: "right", cursor: !readOnly ? "pointer" : "default" }}
                  onClick={!readOnly ? (e) => { e.stopPropagation(); oeffnePredPicker(task, e); } : (e) => e.stopPropagation()}
                  title={!readOnly ? "Vorgänger festlegen" : undefined}>
                  <span style={{ fontWeight: 500, color: "#666" }}>
                    {nummern.get(task.id) ?? ""}
                  </span>
                  {task.predecessorId && (
                    <span style={{ color: "#999", fontStyle: "italic" }}> | {nummern.get(task.predecessorId) ?? "?"}</span>
                  )}
                  {predPickerTaskId === task.id && (() => {
                    const predUebernehmen = () => {
                      const treffer = gueltigeVorgaenger(aktiveSim.tasks, task.id)
                        .find(c => (nummern.get(c.id) ?? "").toLowerCase() === predInput.trim().toLowerCase());
                      if (treffer) vorgängerSetzen(task.id, treffer.id, Number(lagInput) || 0);
                      else setPredPickerTaskId(null);
                    };
                    return createPortal(
                    <div ref={predPopoverRef}
                      style={{ position: "fixed", top: predPos.top, left: predPos.left, zIndex: 1000, background: "#fff",
                        border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", padding: 8, width: 190, fontWeight: 400, fontSize: 11 }}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); predUebernehmen(); } }}>
                      <div style={{ position: "relative" }}>
                        <div style={{ fontSize: 9, color: "#8a9baa", marginBottom: 2 }}>Vorgänger (Nummer)</div>
                        <input className="ac-input" style={{ fontSize: 11, padding: "3px 6px", width: "100%" }}
                          placeholder="— kein Vorgänger —"
                          value={predInput}
                          onFocus={() => setPredListOffen(true)}
                          onChange={e => { setPredInput(e.target.value); setPredListOffen(true); }} />
                        {predListOffen && (
                          <div className="ac-dropdown" ref={predDropdownRef} style={{ maxHeight: 120 }}>
                            {gueltigeVorgaenger(aktiveSim.tasks, task.id)
                              .filter(c => {
                                const lbl = nummern.get(c.id) ?? "";
                                return !predInput || lbl.toLowerCase().startsWith(predInput.trim().toLowerCase()) || c.name.toLowerCase().includes(predInput.trim().toLowerCase());
                              })
                              .map(c => (
                                <div key={c.id} data-cid={c.id} className="ac-item" style={{ fontSize: 11, padding: "3px 6px" }}
                                  onMouseDown={() => { setPredInput(nummern.get(c.id) ?? ""); setPredListOffen(false); }}>
                                  <span style={{ fontWeight: 600 }}>{nummern.get(c.id)}</span> — {c.name}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: "#8a9baa", marginTop: 6 }}>Wartetage nach Vorgänger-Ende</div>
                      <input type="number" className="ac-input" style={{ fontSize: 11, padding: "3px 6px", width: "100%", marginTop: 2 }}
                        value={lagInput}
                        onChange={e => setLagInput(e.target.value)} />
                      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                        <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 10 }}
                          onClick={() => vorgängerSetzen(task.id, null, 0)}>Entfernen</button>
                        <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10 }}
                          onClick={predUebernehmen}>Übernehmen</button>
                      </div>
                    </div>,
                    document.body
                  );
                  })()}
                </span>

                {/* Datum — blau, untereinander */}
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3, flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}>
                  {isGroup && gDaten ? (
                    <>
                      <span style={{ fontSize: 11, color: "#888" }}>{formatDatum(gDaten.start)}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{formatDatum(gDaten.end)}</span>
                    </>
                  ) : !readOnly ? (
                    <>
                      <DatePicker value={formatDatum(task.start)} onChange={(val: string) => {
                        const norm = normalizeDatum(val);
                        if (norm) updateSim({ ...aktiveSim, tasks: kaskadiereNachfolger(aktiveSim.tasks.map(t => t.id === task.id ? { ...t, start: norm } : t), task.id) });
                      }} />
                      <DatePicker value={formatDatum(task.end)} onChange={(val: string) => {
                        const norm = normalizeDatum(val);
                        if (norm) updateSim({ ...aktiveSim, tasks: kaskadiereNachfolger(aktiveSim.tasks.map(t => t.id === task.id ? { ...t, end: norm } : t), task.id) });
                      }} />
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: "#2d7dbd" }}>{formatDatum(task.start)}</span>
                      <span style={{ fontSize: 11, color: "#2d7dbd" }}>{formatDatum(task.end)}</span>
                    </>
                  )}
                </span>

                {/* Rechts: Count/Tage */}
                <span className="task-row-count" style={{ fontSize: 12, marginLeft: 4, flexShrink: 0, minWidth: 33, textAlign: "right" }}>
                  {isGroup && gDaten
                    ? (() => { const childIds = []; for (let ci = idx + 1; ci < aktiveSim.tasks.length; ci++) { if (getOutlineLevel(aktiveSim.tasks[ci]) <= getOutlineLevel(task)) break; childIds.push(...aktiveSim.tasks[ci].objektGuids); } const cnt = new Set(childIds).size; return cnt > 0 ? <span style={{ color: "#888" }}>O {cnt}</span> : <span style={{ color: "#d4dce4" }}>∅</span>; })()
                    : hatSelektierte
                    ? <span style={{ color: "#2d7dbd", fontWeight: 600 }}>{selAnzahl}/{task.objektGuids.length}</span>
                    : task.objektGuids.length > 0
                      ? <span style={{ color: "#8a9baa" }}>O {task.objektGuids.length}</span>
                      : <span style={{ color: "#d4dce4" }}>∅</span>}
                </span>
              </div>
              {isGroup && istDropTarget && dragIdx !== null && dragIdx !== idx && (
                <div style={{ height: 2, background: "#2d7dbd", margin: "0 10px" }} />
              )}
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
            setBauteilListHeight(Math.max(150, startH + ev.clientY - startY));
          };
          const onUp = () => { resizingRef.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div style={{ width: 40, height: 3, background: "#ccc", borderRadius: 2 }} />
      </div>
      </>)}

      {/* Task-Detail */}
      {aktivTask ? (
        <div className="detail-section">
          <div className="detail-header">
            {!aktivIsGroup && <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: aktivTask.typ === "neubau" ? "#22C55E" : aktivTask.typ === "abbruch" ? "#EAB308" : aktivTask.typ === "temporaer" ? "#a0522d" : "#999" }} />}
            {aktivIsGroup && <span style={{ fontSize: 11, color: "#555", marginRight: 2 }}>📁</span>}
            <span className="detail-task-name">{aktivTask.name}</span>
            <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>
              {!aktivIsGroup && totalObjekte != null ? `⬡ ${bauteilGuids.length} / ${totalObjekte}` : `⬡ ${bauteilGuids.length}`}
            </span>
            {!readOnly && <button className="tc-btn-ghost" style={{ color: "#333", fontSize: 12, padding: "0 4px", marginLeft: "auto" }}
              title="Löschen"
              onClick={e => {
                e.stopPropagation();
                if (selInfo.groups > 0) setLoeschDialogOffen(true);
                else if (confirm(selInfo.total > 1 ? `${selInfo.total} Tasks löschen?` : `„${aktivTask.name}" löschen?`)) tasksLoeschen(selInfo.ids, "mitKindern");
              }}><svg width="12" height="12" viewBox="0 0 16 16" fill="#333" stroke="none"><path d="M5 1h6v1H5zM2 3h12v1H2zm1.5 1l.8 11h7.4l.8-11h-9zm2.5 2h1v7H6zm3 0h1v7H9z"/></svg></button>}
          </div>

          {/* Lösch-Auswahl bei Gruppen in der Markierung: Gruppe+Tasks oder nur Gruppe */}
          {loeschDialogOffen && (
            <div style={{ background: "var(--tc-blue-bg)", border: "1px solid #b0d4f0", padding: 8, fontSize: 11 }}>
              <div style={{ fontWeight: 600, color: "var(--tc-blue)", marginBottom: 6 }}>
                {selInfo.total > 1 ? `${selInfo.total} Tasks markiert, davon ${selInfo.groups} ${selInfo.groups === 1 ? "Gruppe" : "Gruppen"}` : "Gruppe"} — was löschen?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button className="tc-btn-primary" style={{ fontSize: 11 }}
                  onClick={() => tasksLoeschen(selInfo.ids, "nurGruppe")}>Nur Gruppe/n löschen</button>
                <button className="tc-btn-secondary" style={{ fontSize: 11 }}
                  onClick={() => tasksLoeschen(selInfo.ids, "mitKindern")}>Gruppe/n und Tasks löschen</button>
                <button className="tc-btn-ghost" style={{ fontSize: 11 }}
                  onClick={() => setLoeschDialogOffen(false)}>Abbrechen</button>
              </div>
            </div>
          )}

          {/* Objekte hinzufügen — immer sichtbar, ohne Titel/Klappbereich */}
          {!readOnly && !aktivIsGroup && (
            <SelectionTools aktivTask={aktivTask} aktiveSim={aktiveSim} api={api} updateSim={updateSim} selGuids={selGuids} />
          )}

          {/* Task-Typ — nur für Tasks, nicht Gruppen */}
          {!readOnly && !aktivIsGroup && (
          <div className="detail-block">
            <div className="detail-block-title" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setTypOffen(o => !o)}>
              <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${typOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
              Task-Typ
            </div>
            {typOffen && (
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
            )}
          </div>
          )}

          {/* Zugewiesene Bauteile — bei Gruppen/Untergruppen aggregiert aus allen Kindern */}
          <div className="detail-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <div className="detail-block-title" style={{ margin: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                onClick={() => setBauteileOffen(o => !o)}>
                <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${bauteileOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
                {bauteilGuids.length > 0 ? `${bauteilGuids.length} Bauteile zugewiesen` : "Noch keine Bauteile zugewiesen"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {bauteilGuids.length > 0 && (
                  <>
                    <button className="tc-btn-primary" title="Nur diese anzeigen" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => nurAnzeigen(bauteilGuids)}>👁 Nur diese</button>
                    {!readOnly && !aktivIsGroup && <button className="tc-btn-ghost" style={{ color: "#333" }} onClick={() => setLoeschenBestaetigen(true)}><svg width="12" height="12" viewBox="0 0 16 16" fill="#333" stroke="none"><path d="M5 1h6v1H5zM2 3h12v1H2zm1.5 1l.8 11h7.4l.8-11h-9zm2.5 2h1v7H6zm3 0h1v7H9z"/></svg></button>}
                  </>
                )}
                <button className="tc-btn-ghost" title="Anzeige-Einstellungen" style={{ fontSize: 12 }}
                  onClick={() => setSettingsOffen(s => !s)}>⚙</button>
              </div>
            </div>

            {bauteileOffen && (<>
            {/* Lösch-Bestätigung */}
            {loeschenBestaetigen && !aktivIsGroup && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", padding: 8, marginBottom: 6, fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: "#DC2626", marginBottom: 4 }}>
                  ⚠ Alle {bauteilGuids.length} Bauteile von „{aktivTask.name}" entfernen?
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
            {bauteilGuids.length > 0 && (
              <div className="guid-list">
                {bauteilGuids.map((g, i) => {
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
                      {!readOnly && !aktivIsGroup && <button className="guid-row-x" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); guidEntfernen(aktivTask.id, g); }}>✕</button>}
                    </div>
                  );
                })}
              </div>
            )}
            </>)}
          </div>
        </div>
      ) : (
        <div className="detail-empty">↑ Task anklicken</div>
      )}
    </>
  );
}