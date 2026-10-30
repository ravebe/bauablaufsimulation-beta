// TabBauteile.tsx — Orchestrator mit Selektions-Tracking + Gantt-Toggle
import { useState, useEffect, useRef } from "react";
import { lsSet } from "../hooks/lokalSpeicher";
import type { SimProjekt, Task , VorgaengerLink, GruppenReihenfolge } from "../types";
import { parseDateUniversal, istGruppe, getKinder, getOutlineLevel, kaskadiereNachfolger, richteKettenNeuAus, vorgaengerZiele, setzeVorgaenger,
  taskVerschieben as verschiebeTaskBlock, nsKey, vorgaengerListe, mitVorgaengern } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getEchteBauteile, clearEchteBauteileCache } from "./modelHelpers";
import { useClickOutside } from "../hooks/useClickOutside";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER, ersterArbeitstagAb } from "./kalenderHelpers";
import { pruefeZeitplanBereitschaft, berechneZeitplanUebernahme, zeitplanAbweichendeTasks } from "./zeitplanUebernahmeHelpers";
import { optimiereAuslastung, terminSignatur, optimierungUebernehmen } from "./auslastungOptimieren";
import type { OptimierReihenfolge } from "./auslastungOptimieren";
import type { Zeiteinheit } from "./zeitHelpers";
import { feinerAls, ZEITEINHEIT_LABEL } from "./zeitHelpers";
import { hatKranPersonal, durchschnittlicheAuslastung } from "./kranHelpers";
import { fmtZahl } from "./zahlFormat";
import TabTasks from "./TabTasks";
import { UnbenutzteZeilen, UnbenutzteDetail } from "./UnbenutzteBauteile";
import { unbenutzteListen } from "./ausschlussHelpers";
import type { UnbenutztArt } from "./UnbenutzteBauteile";
import AttributeFilter from "./AttributeFilter";
import GanttChart from "./GanttChart";
import { useSelektionFokus } from "./listenScroll";
import Schwebend from "./Schwebend";
import Hinweis from "./Hinweis";
import { autoVorgaengerSetzen } from "./autoVorgaenger";
import type { AutoVorgaengerModus } from "./autoVorgaenger";
import { gruppenReihenfolgeAbgleichen } from "./gruppenReihenfolge";
import GruppenReihenfolgeEditor from "./GruppenReihenfolgeEditor";
import PunkteMenu from "./PunkteMenu";
import { exportEintraege } from "./exportEintraege";
import { useFreieTageAusblenden } from "../hooks/useFreieTageAusblenden";

interface Props {
  api: ApiInstance | null;
  projectId?: string | null;
  aktiveSim: SimProjekt | null;
  updateSim: (sim: SimProjekt) => void;
  selektion: number[];
  aktivesModellId: string | null;
  taskSort?: "gantt" | "datum" | "aktiv" | "name" | "nummer";
  /** Sortierung von aussen setzen (App) — bei Selektion mehrerer Bauteile automatisch "aktiv" */
  onTaskSort?: (s: "aktiv") => void;
  readOnly?: boolean;
  sharedNadelTag?: React.MutableRefObject<number>;
  sichtbar?: boolean;
  /** IFC-4D-Export der aktiven Simulation (Dialog in App.tsx) */
  onIfcExport?: () => void;
}

export default function TabBauteile({ onTaskSort, api, projectId = null, aktiveSim, updateSim, aktivesModellId, taskSort, readOnly, sharedNadelTag, sichtbar, onIfcExport }: Props) {
  const [freieTageAus, setFreieTageAus] = useFreieTageAusblenden(projectId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  // alle Bauteile der Modelle ("modelId:::runtimeId") — für "Noch nicht verknüpft" (UnbenutzteBauteile.tsx)
  const [alleGuids, setAlleGuids] = useState<string[] | null>(null);
  // statt eines Tasks gewählt: "Noch nicht verknüpft" bzw. "Aus Simulation entfernt"
  const [unbenutzt, setUnbenutzt] = useState<UnbenutztArt | null>(null);
  const [unbenutztOffen, setUnbenutztOffen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [ganttOffen, setGanttOffen] = useState(false);
  // mehrere Bauteile im Modell markiert → Sortierung automatisch auf "Aktive" (markierte Tasks oben)
  useSelektionFokus(selGuids, sichtbar !== false, guids => { if (guids.length > 1) onTaskSort?.("aktiv"); });
  const [nadelTag, setNadelTag] = useState(-1);
  const [ghostTag, setGhostTag] = useState(-1);
  const [filterOffen, setFilterOffen] = useState(true);
  const [suchOffen, setSuchOffen] = useState(false);
  const [suchQuery, setSuchQuery] = useState("");
  const [plusMenuOffen, setPlusMenuOffen] = useState(false);
  const [werkzeugOffen, setWerkzeugOffen] = useState(false);
  const [autoVorgaengerOffen, setAutoVorgaengerOffen] = useState(false); // Werkzeuge → Auto-Vorgänger: Varianten zeigen
  const [werkzeugBestaetigung, setWerkzeugBestaetigung] = useState<"ausrichten" | "entfernen" | null>(null); // Rückfrage vor dem Ausführen
  const [zeitplanHinweisOffen, setZeitplanHinweisOffen] = useState(false);
  // "Auslastung optimieren": Vorschau der neuen Termine, erst nach Bestätigung übernommen
  // je Zeiteinheit (aktuelle + feinere) ein Ergebnis — feinere erlauben Nachfolger am selben Tag, siehe auslastungVorschauOeffnen
  // modus "dauern" = nur berechnete Dauer übernehmen (früher eigener Menüpunkt "Berechnete Dauer übernehmen"): Reihenfolge und
  // Vorgänger bleiben, keine Personalplanung — siehe berechneZeitplanUebernahme
  const [auslastungVorschau, setAuslastungVorschau] = useState<{ modus: "optimieren" | "dauern"; reihenfolge: OptimierReihenfolge; luecken: boolean; gruppen: GruppenReihenfolge; ergebnisse: { einheit: Zeiteinheit; tasks: Task[] }[] } | null>(null);
  // «Automatisch nachführen» im Dialog (SimProjekt.autoNachfuehren, siehe nachfuehren.ts) — gilt beim Übernehmen
  const [autoNachfuehren, setAutoNachfuehren] = useState(false);
  const [neuInputOffen, setNeuInputOffen] = useState(false);
  const [neuTaskInput, setNeuTaskInput] = useState("");
  const [neuTyp, setNeuTyp] = useState<"task" | "gruppe">("task");
  const lsGanttHKey = nsKey("4d-gantt-height-bauteile", projectId);
  const [ganttH, setGanttH] = useState(() => {
    try { return Number(localStorage.getItem(lsGanttHKey)) || 260; } catch { return 260; }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastClickIdx = useRef<number>(-1);
  const plusMenuRef = useClickOutside<HTMLDivElement>(plusMenuOffen, () => setPlusMenuOffen(false));
  const werkzeugRef = useClickOutside<HTMLDivElement>(werkzeugOffen, () => { setWerkzeugOffen(false); setZeitplanHinweisOffen(false); });

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
  const totalTage = minDate && maxDate ? Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / 86400000)) : 0;

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
    setUnbenutzt(null);
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
    if (!api || !aktiveSim || aktiveSim.modelle.length === 0) { setTotalObjekte(null); setAlleGuids(null); return; }
    clearEchteBauteileCache();
    let abgebrochen = false;
    (async () => {
      const guids: string[] = [];
      const verknuepft = new Set(aktiveSim.tasks.flatMap(t => t.objektGuids));
      for (const modell of aktiveSim.modelle) {
        if (!modell.id) continue;
        const echte = await getEchteBauteile(api, aktiveSim.id, modell.id, verknuepft);
        for (const rId of echte) guids.push(`${modell.id}:::${rId}`);
      }
      if (abgebrochen) return;
      // doppelte Einträge (Viewer meldet ein Objekt mehrfach, Modell doppelt in der Simulation) sonst im
      // Total mitgezählt — "OFFEN" stimmte dann nicht mit "Noch nicht verknüpft" überein
      const eindeutig = [...new Set(guids)];
      if (eindeutig.length !== guids.length) console.log(`[Bauteile] ${guids.length - eindeutig.length} doppelte Objekte ignoriert`);
      setTotalObjekte(eindeutig.length > 0 ? eindeutig.length : null);
      setAlleGuids(eindeutig.length > 0 ? eindeutig : null);
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

  // "OFFEN" (Kopf der Task-Liste) = genau die Bauteile unter "Noch nicht verknüpft"
  const offenAnzahl = alleGuids ? unbenutzteListen(aktiveSim, alleGuids).offen?.length ?? null : null;

  // Eigener auf-/zuklappbarer Bereich unter "Bauteile zugewiesen": "Noch nicht verknüpft" / "Aus Simulation entfernt" —
  // wie Tasks wählbar, ihr Detail ersetzt dann das Task-Detail
  const unbenutztListen = aktiveSim ? unbenutzteListen(aktiveSim, alleGuids) : null;
  const unbenutztBereich = aktiveSim ? (
    <div className="detail-block">
      <div className="detail-block-title" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        onClick={() => setUnbenutztOffen(o => !o)}>
        <span style={{ display: "inline-block", transform: `scaleX(1.6) rotate(${unbenutztOffen ? 0 : -90}deg)`, transition: "transform .15s", fontSize: 9 }}>▼</span>
        Nicht verknüpft {unbenutztListen?.offen ? unbenutztListen.offen.length : "…"} · Aus Simulation entfernt {unbenutztListen?.entfernt.length ?? 0}
      </div>
      {unbenutztOffen && (
        <UnbenutzteZeilen sim={aktiveSim} alleGuids={alleGuids} aktiv={unbenutzt}
          onWaehlen={a => { setUnbenutzt(a); if (a) setSelectedIds([]); }} />
      )}
    </div>
  ) : null;
  const unbenutztDetail = unbenutzt ? (
    <UnbenutzteDetail api={api} sim={aktiveSim} alleGuids={alleGuids} art={unbenutzt} selGuids={selGuids}
      readOnly={readOnly} updateSim={updateSim} />
  ) : undefined;

  function ganttDateChange(taskId: string, newStart: string, newEnd: string, startZeit?: string, endZeit?: string) {
    if (!aktiveSim) return;
    const tasks = kaskadiereNachfolger(
      aktiveSim.tasks.map(t => t.id !== taskId ? t : t.meilenstein ? { ...t, start: newStart, end: newStart, startZeit, endZeit: undefined } : { ...t, start: newStart, end: newEnd, startZeit, endZeit }),
      taskId, aktiveSim.kalender ?? LEERER_KALENDER
    );
    updateSim({ ...aktiveSim, tasks });
  }

  function ganttSetPredecessor(taskId: string, liste: VorgaengerLink[]) {
    if (!aktiveSim) return;
    // Bei Mehrfachauswahl für alle markierten Tasks (siehe vorgaengerZiele/setzeVorgaenger in types.ts)
    const ziele = vorgaengerZiele(aktiveSim.tasks, selectedIds, taskId);
    updateSim({ ...aktiveSim, tasks: setzeVorgaenger(aktiveSim.tasks, ziele, liste, aktiveSim.kalender ?? LEERER_KALENDER) });
  }

  function neuErstellen() {
    if (!aktiveSim || !neuTaskInput.trim()) return;
    const heute = ersterArbeitstagAb(new Date().toISOString().slice(0, 10), aktiveSim.kalender ?? LEERER_KALENDER); // Tasks beginnen nur an Arbeitstagen
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

  // Werkzeuge → "Auslastung optimieren" (auch "Nur Dauern übernehmen", siehe zeitplanUebernahmeHelpers.ts) — erst möglich,
  // wenn Tab Kalkulation fehlerfrei ist (keine roten Mengen-Felder).
  const zeitplanStatus = aktiveSim ? pruefeZeitplanBereitschaft(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN) : null;
  // Hinweis statt Automatik: Termine im Gantt bleiben, bis im Dialog übernommen wird — wie viele Tasks von der berechneten Dauer
  // abweichen, zeigt der Zähler am Werkzeug-Knopf und der Hinweis im Menü.
  // Termine aus "Auslastung optimieren" (unverändert seither) weichen gewollt von der berechneten Dauer ab → nicht melden
  const ausOptimierung = !!aktiveSim?.optimiertStand && aktiveSim.optimiertStand === terminSignatur(aktiveSim.tasks);
  const abweichendeTasks = aktiveSim && zeitplanStatus?.bereit && !ausOptimierung
    ? zeitplanAbweichendeTasks(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN, aktiveSim.kalender ?? LEERER_KALENDER, aktiveSim.zeiteinheit)
    : [];
  const zeitplanAenderungen = abweichendeTasks.length > 0;
  // "Auslastung optimieren" — mit Kranpersonal (Tab Ressourcen → Kräne & Personal) arbeitet das Personal unter jedem Kran möglichst
  // voll (Pools je Unternehmer, siehe auslastungOptimierenKran.ts), sonst arbeitet jede Kolonne voll und nie an zwei Tasks gleichzeitig
  // (auslastungOptimieren.ts)
  const mitKranPersonal = hatKranPersonal(aktiveSim?.kraene ?? []);
  // Gerechnet wird in der aktuellen Zeiteinheit und in jeder feineren (Halbtage, Uhrzeit): darin dürfen Arbeiten innerhalb eines
  // Tages wechseln und Nachfolger noch am selben Tag beginnen. Ist das Bauende damit früher, schlägt die Vorschau die Umstellung vor.
  // luecken: Tasks ohne Vorgänger dürfen früher beginnen, wenn Personal unter dem Kran sonst untätig wäre (nur mit Kranpersonal)
  // gruppen: Reihenfolge «Nach Gruppen» (gruppenReihenfolge.ts) — gespeicherte mit dem aktuellen Gantt abgeglichen, im Dialog änderbar
  function auslastungVorschauOeffnen(reihenfolge: OptimierReihenfolge = "gruppen", luecken = true, modus: "optimieren" | "dauern" = "optimieren",
    gruppen?: GruppenReihenfolge) {
    if (!aktiveSim || !zeitplanStatus?.bereit) { setZeitplanHinweisOffen(o => !o); return; }
    if (!auslastungVorschau) setAutoNachfuehren(!!aktiveSim.autoNachfuehren);
    gruppen ??= auslastungVorschau?.gruppen ?? gruppenReihenfolgeAbgleichen(aktiveSim.gruppenReihenfolge, aktiveSim.tasks);
    const aktuell: Zeiteinheit = aktiveSim.zeiteinheit ?? "tage";
    if (modus === "dauern") {
      setAuslastungVorschau({ modus, reihenfolge, luecken, gruppen, ergebnisse: [{ einheit: aktuell,
        tasks: berechneZeitplanUebernahme(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN, aktiveSim.kalender ?? LEERER_KALENDER, aktiveSim.zeiteinheit) }] });
      return;
    }
    const einheiten = [aktuell, ...(["halbtage", "stunden"] as const).filter(e => feinerAls(e, aktuell))];
    setAuslastungVorschau({ modus, reihenfolge, luecken, gruppen, ergebnisse: einheiten.map(einheit => ({ einheit,
      tasks: optimiereAuslastung(aktiveSim.tasks, aktiveSim.stammdaten ?? LEERE_STAMMDATEN, aktiveSim.kalender ?? LEERER_KALENDER, einheit, aktiveSim.kraene ?? [],
        reihenfolge, luecken, { gruppen }) })) });
  }
  function auslastungUebernehmen(einheit: Zeiteinheit, tasks: Task[], optimiert = true) {
    if (!aktiveSim || !auslastungVorschau) return;
    // nur Termine, Vorgänger, Optimierungs-Stand und Ablauf je Tag in den aktuellen Stand übernehmen — Bauteile (auch aus der
    // Simulation entfernte), Mengen usw. bleiben, wie sie jetzt sind, selbst wenn sich seit dem Öffnen der Vorschau etwas geändert hat
    tasks = optimierungUebernehmen(aktiveSim.tasks, tasks);
    const auto = optimiert && autoNachfuehren ? { reihenfolge: auslastungVorschau.reihenfolge, luecken: auslastungVorschau.luecken } : undefined;
    updateSim({ ...aktiveSim, tasks, zeiteinheit: einheit === "tage" ? undefined : einheit, optimiertStand: optimiert ? terminSignatur(tasks) : undefined,
      autoNachfuehren: auto, ...(optimiert && auslastungVorschau.reihenfolge === "gruppen" ? { gruppenReihenfolge: auslastungVorschau.gruppen } : {}) });
    setAuslastungVorschau(null);
  }

  // "Folge-Tasks neu ausrichten" — jeder Nachfolger beginnt am Arbeitstag NACH dem Ende seines Vorgängers (+ Wartetage),
  // Dauer in Arbeitstagen bleibt; beseitigt Überlappungen aus älteren Plänen, in denen ein Nachfolger noch am Endtag begann.
  function folgeTasksNeuAusrichten() {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: richteKettenNeuAus(aktiveSim.tasks, aktiveSim.kalender ?? LEERER_KALENDER) });
  }

  // "Vorgänger entfernen" — alle Vorgänger aller Tasks (von Hand gesetzte, Auto-Vorgänger und vom Optimieren ergänzte); Termine bleiben
  function vorgaengerEntfernen() {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => vorgaengerListe(t).length === 0 ? t : {
      ...mitVorgaengern(t, []), autoVorgaenger: undefined, optimierung: t.optimierung ? { ...t.optimierung, vorgaenger: [] } : undefined }) });
  }

  // "Auto-Vorgänger" (autoVorgaenger.ts) — nach Gantt-Reihenfolge oder nach den aktuellen Terminen; ersetzt nur die Vorgänger eines
  // früheren Auto-Vorgänger, von Hand gesetzte und vom Optimieren ergänzte bleiben
  function autoVorgaenger(modus: AutoVorgaengerModus) {
    if (!aktiveSim) return;
    const neueTasks = autoVorgaengerSetzen(aktiveSim.tasks, modus);
    if (JSON.stringify(neueTasks) === JSON.stringify(aktiveSim.tasks)) return;
    updateSim({ ...aktiveSim, tasks: neueTasks });
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
            <div ref={plusMenuRef} style={{ position: "relative", display: "inline-flex" }}>
              <button className="tc-btn-secondary" style={{ color: "var(--tc-blue)" }}
                onClick={() => setPlusMenuOffen(m => !m)} title="Neuer Task / Neue Gruppe">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square"><path d="M7 1.5v11M1.5 7h11" /></svg>
              </button>
              {plusMenuOffen && (
                <Schwebend style={{ background: "#fff", border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", minWidth: 140, fontSize: 11 }}>
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
                </Schwebend>
              )}
            </div>
          )}
          {!readOnly && aktiveSim && (
            <div ref={werkzeugRef} style={{ position: "relative", display: "inline-flex" }}>
              <button className="tc-btn-secondary" style={{ fontSize: 12, padding: "2px 6px", position: "relative" }}
                title={zeitplanAenderungen ? `Werkzeuge — ${abweichendeTasks.length} Task${abweichendeTasks.length === 1 ? "" : "s"} weichen von der berechneten Dauer ab (Auslastung optimieren → Nur Dauern übernehmen)` : "Werkzeuge"}
                onClick={() => { setWerkzeugOffen(o => !o); setZeitplanHinweisOffen(false); }}>
                {zeitplanAenderungen && (
                  <span style={{ position: "absolute", top: -6, right: -8, minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7, background: "#d9622b", color: "#fff",
                    fontSize: 9, fontWeight: 700, lineHeight: "14px", textAlign: "center", pointerEvents: "none" }}>{abweichendeTasks.length}</span>
                )}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
              </button>
              {werkzeugOffen && (
                <Schwebend style={{ background: "#fff", border: "0.5px solid var(--tc-border)", borderRadius: 5, boxShadow: "0 2px 8px rgba(0,0,0,.12)", minWidth: 230 }}>
                  {aktiveSim.tasks.length > 1 && (
                    <div style={{ borderBottom: "0.5px solid #eef1f4" }}>
                      <button
                        style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
                        onClick={() => setAutoVorgaengerOffen(o => !o)}>
                        <Hinweis kopf={<div style={{ fontSize: 11, fontWeight: 500, color: "var(--tc-text)" }}>Auto-Vorgänger {autoVorgaengerOffen ? "▾" : "▸"}</div>}>
                          <div style={{ maxWidth: 300 }}>
                          Verknüpft Tasks und Gruppen automatisch — wahlweise der Gantt-Reihenfolge nach (Task 2 ← Task 1, Task 3 ← Task 2 …, alles
                          nacheinander) oder nach den aktuellen Terminen (jeder Task bekommt den Task, der als letzter vor seinem Start endet;
                          was gleichzeitig läuft, bleibt parallel; Tasks ohne Termine der Gantt-Reihenfolge nach). Gruppen nur mit ihren
                          Geschwistern. Automatische Vorgänger erscheinen blau und werden beim erneuten Ausführen neu bestimmt; von Hand
                          gesetzte (schwarz) und Tasks mit Vorgängern vom Optimieren bleiben unverändert.
                          </div>
                        </Hinweis>
                      </button>
                      {autoVorgaengerOffen && (
                        <div style={{ display: "flex", gap: 4, padding: "0 14px 8px" }}>
                          {([["gantt", "Nach Gantt-Reihenfolge"], ["daten", "Nach aktuellen Terminen"]] as const).map(([m, label]) => (
                            <button key={m} className="tc-btn-secondary" style={{ flex: 1, fontSize: 10, padding: "4px 6px" }}
                              onClick={() => { autoVorgaenger(m); setAutoVorgaengerOffen(false); setWerkzeugOffen(false); }}>{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {aktiveSim.tasks.some(t => t.predecessorId) && (<>
                    <button
                      style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                      onClick={() => { setWerkzeugBestaetigung("ausrichten"); setWerkzeugOffen(false); }}>
                      <Hinweis kopf={<div style={{ fontSize: 11, fontWeight: 500, color: "var(--tc-text)" }}>Folge-Tasks neu ausrichten</div>}>
                        <div style={{ maxWidth: 300 }}>
                        Jeder Nachfolger beginnt am Tag nach dem Ende seines Vorgängers plus Wartetage (Kalendertage, auch Wochenende/Feiertage/Ferien zählen als Wartezeit); fällt der Start auf einen freien Tag, rückt er auf den nächsten Arbeitstag. Die Dauer in Arbeitstagen bleibt. Mit Rückfrage.
                        </div>
                      </Hinweis>
                    </button>
                    <button
                      style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                      onClick={() => { setWerkzeugBestaetigung("entfernen"); setWerkzeugOffen(false); }}>
                      <Hinweis kopf={<div style={{ fontSize: 11, fontWeight: 500, color: "var(--tc-text)" }}>Vorgänger entfernen</div>}>
                        <div style={{ maxWidth: 300 }}>
                        Entfernt alle Vorgänger aller Tasks — von Hand gesetzte, Auto-Vorgänger und vom Optimieren ergänzte. Die Termine bleiben, wie sie sind. Mit Rückfrage.
                        </div>
                      </Hinweis>
                    </button>
                  </>)}
                  {zeitplanStatus && (
                    <div>
                      <button
                        style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", borderTop: "0.5px solid #eef1f4", textAlign: "left", cursor: "pointer" }}
                        onClick={() => { auslastungVorschauOeffnen(aktiveSim.autoNachfuehren?.reihenfolge, aktiveSim.autoNachfuehren?.luecken ?? true); if (zeitplanStatus.bereit) setWerkzeugOffen(false); }}>
                        {(() => {
                          const titel = <div style={{ fontSize: 11, fontWeight: 500, color: zeitplanStatus.bereit ? "var(--tc-text)" : "#9aa5b0" }}>Auslastung optimieren</div>;
                          return zeitplanStatus.bereit ? (
                            <Hinweis kopf={titel}>
                              <div style={{ maxWidth: 300 }}>
                              {mitKranPersonal
                                ? "Plant die Tasks so, dass das Personal unter jedem Kran (Tab Ressourcen → Kräne & Personal) möglichst voll arbeitet — Leute desselben Unternehmers als Allrounder, höchstens das Personal unter dem Kran (1–2 mehr nur, wenn sonst Leute untätig wären). Arbeitsablauf je Leistungsposition, Vorgänger und Wartetage bleiben massgebend. Mit Vorschau."
                                : "Je Gewerk + Unternehmer arbeitet eine Kolonne voll, immer an einer Arbeit gleichzeitig und am selben Tag weiter zur nächsten; was im Arbeitstag keinen Platz hat, geht am nächsten Tag weiter. Vorgänger und Wartetage bleiben massgebend. Mit Vorschau."}
                              {" Im Dialog auch «Nur Dauern übernehmen»: berechnete Dauer je Task, Reihenfolge und Vorgänger bleiben."}
                              </div>
                            </Hinweis>
                          ) : titel;
                        })()}
                        {!zeitplanStatus.bereit && <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 2 }}>Klicken für Details, was dafür noch fehlt.</div>}
                        {aktiveSim?.autoNachfuehren && <div style={{ fontSize: 9, marginTop: 2, color: "var(--tc-blue)", fontWeight: 600, whiteSpace: "normal", maxWidth: 320 }}>Automatisch nachführen ist an — Änderungen werden sofort neu optimiert (ausschalten im Dialog).</div>}
                        {zeitplanAenderungen && (
                          <div style={{ fontSize: 10, color: "#d9622b", marginTop: 4, maxWidth: 320, whiteSpace: "normal" }}>
                            {abweichendeTasks.length} Task{abweichendeTasks.length === 1 ? " weicht" : "s weichen"} von der berechneten Dauer ab: {abweichendeTasks.slice(0, 6).map(t => t.name).join(", ")}{abweichendeTasks.length > 6 ? ` … und ${abweichendeTasks.length - 6} weitere` : ""}
                          </div>
                        )}
                      </button>
                      {zeitplanHinweisOffen && !zeitplanStatus.bereit && (
                        <div style={{ padding: "8px 14px 10px", fontSize: 11, borderTop: "0.5px solid #eef1f4" }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Noch nicht möglich — es fehlt:</div>
                          {zeitplanStatus.keineTasks && <div style={{ color: "var(--tc-text-3)" }}>Keine Tasks im Bauablauf vorhanden.</div>}
                          {zeitplanStatus.fehlerTasks.length > 0 && (
                            <div>
                              <div style={{ color: "var(--tc-red)" }}>{zeitplanStatus.fehlerTasks.length} Task(s) mit Fehler in der Mengenermittlung (Tab Kalkulation):</div>
                              <div style={{ color: "var(--tc-text-3)", marginTop: 2 }}>{zeitplanStatus.fehlerTasks.map(t => t.name).join(", ")}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Schwebend>
              )}
            </div>
          )}
        </>)}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
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
        <PunkteMenu title="Optionen / Export" abschnitte={[
          ...(ganttOffen ? [{ titel: "Optionen", eintraege: [{
            label: freieTageAus ? "Wochenende, Ferien und Feiertage einblenden" : "Wochenende, Ferien und Feiertage ausblenden",
            title: "Arbeitsfreie Tage (graue Bänder) im Gantt einklappen bzw. wieder anzeigen",
            onClick: () => setFreieTageAus(!freieTageAus),
          }] }] : []),
          ...(exportEintraege(aktiveSim, onIfcExport).length > 0 ? [{ titel: "Export", eintraege: exportEintraege(aktiveSim, onIfcExport) }] : []),
        ]} />
        </div>
      </div>

      {werkzeugBestaetigung && aktiveSim && (() => {
        const entfernen = werkzeugBestaetigung === "entfernen";
        const anzahl = aktiveSim.tasks.filter(t => vorgaengerListe(t).length > 0).length;
        const schliessen = () => setWerkzeugBestaetigung(null);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
            onClick={schliessen}>
            <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", width: "min(420px, 100%)", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>{entfernen ? "Vorgänger entfernen" : "Folge-Tasks neu ausrichten"}</div>
                <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={schliessen} title="Schliessen">✕</button>
              </div>
              <div style={{ padding: "0 16px 12px", fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.5 }}>
                {entfernen
                  ? <>Bei <strong>{anzahl}</strong> Task{anzahl === 1 ? "" : "s"} werden alle Vorgänger entfernt — von Hand gesetzte, Auto-Vorgänger und vom Optimieren ergänzte. Die Termine bleiben, wie sie sind.</>
                  : <>Jeder Nachfolger beginnt am Tag nach dem Ende seines Vorgängers plus Wartetage; die Dauer in Arbeitstagen bleibt. Betrifft <strong>{anzahl}</strong> Task{anzahl === 1 ? "" : "s"} mit Vorgängern und deren Nachfolger.</>}
              </div>
              <div style={{ borderTop: "1px solid var(--tc-border-light)", padding: "10px 16px 12px", background: "#f5f9ff" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button className="tc-btn-primary" style={{ flex: "1 1 180px" }} autoFocus
                    title="Lässt sich mit «Rückgängig» oben in der Kopfzeile zurücknehmen (letzte 15 Schritte, bis zum Neuladen)"
                    onClick={() => { if (entfernen) vorgaengerEntfernen(); else folgeTasksNeuAusrichten(); schliessen(); }}>
                    {entfernen ? "Entfernen" : "Ausrichten"}
                  </button>
                  <button className="tc-btn-secondary" onClick={schliessen}>Abbrechen</button>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "var(--tc-text-3)" }}>Rückgängig oben in der Kopfzeile (letzte 15 Schritte).</div>
              </div>
            </div>
          </div>
        );
      })()}

      {auslastungVorschau && aktiveSim && (() => {
        const ende = (ts: Task[]) => ts.reduce((m, t) => (!t.isGroup && t.end && t.end > m ? t.end : m), "");
        const datum = (iso: string) => iso ? iso.split("-").reverse().join(".") : "–";
        // Vorschlag: gröbste Zeiteinheit mit dem frühesten Bauende (aktuelle Einheit, solange sie gleich früh fertig wird)
        const { ergebnisse, reihenfolge, luecken, modus } = auslastungVorschau;
        const nurDauern = modus === "dauern";
        const aktuellesErgebnis = ergebnisse[0];
        const fruehestesEnde = ergebnisse.map(e => ende(e.tasks)).reduce((a, b) => (b < a ? b : a));
        const vorschlag = ergebnisse.find(e => ende(e.tasks) === fruehestesEnde) ?? aktuellesErgebnis;
        const umstellen = vorschlag.einheit !== aktuellesErgebnis.einheit;
        const vorher = aktiveSim.tasks, nachher = vorschlag.tasks;
        // ergänzte/entfallende Vorgänger je Task (automatische eines früheren Optimierens werden neu bestimmt)
        const vorgaengerDiff = nachher.map((t, i) => {
          const a = new Set(vorgaengerListe(vorher[i]).map(v => v.id)), b = new Set(vorgaengerListe(t).map(v => v.id));
          return { neu: [...b].filter(id => !a.has(id)).length, weg: [...a].filter(id => !b.has(id)).length };
        });
        const neueVorgaenger = vorgaengerDiff.reduce((n, d) => n + d.neu, 0), wegVorgaenger = vorgaengerDiff.reduce((n, d) => n + d.weg, 0);
        const terminGeaendert = nachher.filter((t, i) => t.start !== vorher[i].start || t.end !== vorher[i].end || t.startZeit !== vorher[i].startZeit || t.endZeit !== vorher[i].endZeit);
        const geaendert = nachher.filter((t, i) => terminGeaendert.includes(t) || vorgaengerDiff[i].neu + vorgaengerDiff[i].weg > 0);
        // Ablauf je Tag (Task.tagesArbeit) neu, ohne dass sich Termine ändern — z.B. erstes Optimieren mit dem Rechenkern
        const ablaufNeu = nurDauern ? [] : nachher.filter((t, i) => !geaendert.includes(t) && JSON.stringify(t.tagesArbeit) !== JSON.stringify(vorher[i].tagesArbeit));
        const autoGeaendert = !nurDauern && autoNachfuehren !== !!aktiveSim.autoNachfuehren;
        const gruppenGeaendert = !nurDauern && reihenfolge === "gruppen" && JSON.stringify(auslastungVorschau.gruppen) !== JSON.stringify(aktiveSim.gruppenReihenfolge);
        const nichtsZuTun = geaendert.length === 0 && ablaufNeu.length === 0 && !autoGeaendert && !gruppenGeaendert;
        const endeVorher = ende(vorher), endeNachher = ende(nachher);
        const tageDiff = endeVorher && endeNachher ? Math.round((new Date(endeNachher).getTime() - new Date(endeVorher).getTime()) / 86400000) : 0;
        const sd = aktiveSim.stammdaten ?? LEERE_STAMMDATEN, kal = aktiveSim.kalender ?? LEERER_KALENDER, kr = aktiveSim.kraene ?? [];
        const auslastungVorher = durchschnittlicheAuslastung(vorher, kr, sd, kal), auslastungNachher = durchschnittlicheAuslastung(nachher, kr, sd, kal);
        const prozent = (v: number | null) => v == null ? "–" : `${fmtZahl(v * 100)} %`;
        const abschnitt: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".5px", color: "var(--tc-text-3)", margin: "14px 0 6px" };
        const wahl = (aktiv: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: "6px 8px", cursor: "pointer", minWidth: 0,
          border: `1px solid ${aktiv ? "var(--tc-blue)" : "var(--tc-border)"}`, background: aktiv ? "var(--tc-blue-bg)" : "#fff",
          color: aktiv ? "var(--tc-blue)" : "var(--tc-text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
        const optionZeile: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px", padding: "8px 10px",
          border: "1px solid var(--tc-border-light)", background: "#fff", marginBottom: 6 };
        // Ergebnis-Kachel: Wert vorher → nachher, grün = besser, orange = schlechter
        const kachel = (titel: string, inhalt: React.ReactNode, title?: string) => (
          <div title={title} style={{ padding: "6px 10px", background: "#fff", border: "1px solid #dbe4ee", minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--tc-text-3)", fontWeight: 600 }}>{titel}</div>
            <div style={{ fontSize: 12, color: "var(--tc-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inhalt}</div>
          </div>
        );
        const besser = (gut: boolean) => ({ color: gut ? "#2e8b57" : "#d9622b" });
        const keineHoehereAuslastung = !nurDauern && auslastungVorher != null && auslastungNachher != null && auslastungNachher <= auslastungVorher + 0.005 && endeNachher >= endeVorher;
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
          onClick={() => setAuslastungVorschau(null)}>
          <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", width: "min(560px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column",
            boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
            onClick={e => e.stopPropagation()}>
            {/* Kopf: bleibt immer sichtbar */}
            <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--tc-border-light)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <Hinweis style={{ flex: 1, minWidth: 0 }} kopf={<div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Auslastung optimieren</div>}>
                <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.55 }}>
                  {nurDauern ? <>
                    Jeder Task bekommt seine berechnete Dauer aus Tab Kalkulation (Menge × Leistungswert ÷ Min. Personen). Folge-Tasks rücken
                    entlang der bestehenden Vorgänger nach, Tasks ohne Vorgänger bleiben an ihrem Start. Reihenfolge und Vorgänger bleiben —
                    es wird nicht geprüft, ob Personal oder Kranzeit reichen. Gut, wenn das Gantt bewusst von Hand geordnet ist und nur die
                    Dauern zu den Mengen passen sollen.
                  </> : mitKranPersonal ? <>
                    Das Personal unter jedem Kran (Tab Ressourcen → Kräne & Personal) arbeitet möglichst voll: Leute desselben Unternehmers
                    sind Allrounder und besetzen jede seiner kranpflichtigen Leistungspositionen, freie Leute verstärken laufende Arbeiten
                    (höchstens doppelte Min. Personen) — so werden Tasks kürzer und mehr laufen parallel. Je Kran arbeiten höchstens so viele
                    Leute wie sein Personal, 1–2 mehr nur, wenn sonst Leute untätig wären. Arbeiten ohne Personal unter dem Kran (nicht
                    kranpflichtig, kein Unternehmer) macht je Gewerk + Unternehmer eine Kolonne mit den Min. Personen der jeweiligen Arbeit —
                    immer nur eine Arbeit gleichzeitig, am selben Tag weiter zur nächsten. Jeder Tag leistet Std./Tag; was keinen Platz hat,
                    geht am nächsten Tag weiter, höchstens 5 % der Arbeit eines Tasks werden am selben Tag in Überstunden fertig.
                    Arbeitsablauf je Leistungsposition, Vorgänger und Wartetage bleiben massgebend. Tasks ohne Mengen, Gruppen und
                    Meilensteine bleiben unverändert. Erneutes Optimieren ergibt dasselbe Ergebnis (früher ergänzte Vorgänger werden neu bestimmt).
                  </> : <>
                    Je Gewerk + Unternehmer arbeitet eine Kolonne mit den Min. Personen der jeweiligen Arbeit (Tab Ressourcen) — immer nur an
                    einer Arbeit gleichzeitig und am selben Tag weiter zur nächsten (z.B. Bewehrung Wand → Bewehrung Stütze, sobald diese
                    geschalt ist). Die Schritte innerhalb eines Tasks laufen nach dem Arbeitsablauf je Leistungsposition. Jeder Tag leistet
                    Std./Tag; was keinen Platz hat, geht am nächsten Tag weiter, höchstens 5 % der Arbeit eines Tasks werden am selben Tag in
                    Überstunden fertig. Vorgänger und Wartetage bleiben massgebend; Tasks ohne Vorgänger beginnen frühestens an ihrem bisherigen
                    Start. Tasks ohne Mengen, Gruppen und Meilensteine bleiben unverändert. Mit Personal unter den Kränen (Tab Ressourcen →
                    Kräne & Personal) arbeiten die Leute eines Unternehmers unter dem Kran zusätzlich als Allrounder.
                  </>}
                </div>
                </Hinweis>
                <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={() => setAuslastungVorschau(null)} title="Schliessen">✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {([["optimieren", "Optimieren", "Personal und Kranzeit planen: Reihenfolge, parallele Arbeiten und Verstärkung so, dass das Personal möglichst voll arbeitet"],
                  ["dauern", "Nur Dauern übernehmen", "Jeder Task bekommt seine berechnete Dauer aus Tab Kalkulation, Folge-Tasks rücken entlang der Vorgänger nach — Reihenfolge und Vorgänger bleiben, keine Personalplanung"]] as const).map(([m, label, title]) => (
                  <button key={m} title={title} onClick={() => auslastungVorschauOeffnen(reihenfolge, luecken, m)} style={wahl(modus === m)}>{label}</button>
                ))}
              </div>
            </div>

            {/* Einstellungen: scrollt, wenn der Platz nicht reicht */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 12px", fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.5, background: "#fafbfc" }}>
              {nurDauern ? (
                ausOptimierung && <div style={{ marginTop: 12, padding: "8px 10px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#8a5a00" }}>
                  Die Termine stammen aus «Optimieren» — Übernehmen ersetzt die Optimierung.</div>
              ) : (<>
                <div style={abschnitt}>REIHENFOLGE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                  {([["gruppen", "Nach Gruppen", "Zuerst nach den Gruppen des Gantts (z.B. Etappe, Geschoss) und der Bauteilart (z.B. Boden → Wände → Stützen → Decken) in der unten festgelegten Reihenfolge, bei Gleichstand der kritische Pfad — weich: hat die vordere Gruppe gerade keine Arbeit, geht das Personal zur nächsten"],
                    ["kritischerPfad", "Kritischer Pfad", "Wenn mehrere Arbeiten möglich sind, bekommen zuerst die Tasks mit der längsten Restkette (meiste Arbeit danach) das Personal — kürzestes Bauprogramm"],
                    ["startdatum", "Startdatum", "Wenn mehrere Arbeiten möglich sind, bekommen die Tasks mit dem frühesten aktuellen Start zuerst das Personal (bei gleichem Datum die Gantt-Reihenfolge) — z.B. wenn das Gantt nach Etappen statt nach Datum aufgebaut ist"],
                    ["gantt", "Gantt-Reihenfolge", "Wenn mehrere Arbeiten möglich sind, bekommen die Tasks in der Reihenfolge des Gantts das Personal — geordnetes Arbeiten, z.B. Achse für Achse"]] as const).map(([r, label, title]) => (
                    <button key={r} title={title} onClick={() => auslastungVorschauOeffnen(r, luecken)} style={wahl(reihenfolge === r)}>{label}</button>
                  ))}
                </div>
                {reihenfolge === "gruppen" && (
                  <GruppenReihenfolgeEditor wert={auslastungVorschau.gruppen} stammdaten={aktiveSim.stammdaten ?? LEERE_STAMMDATEN}
                    onChange={g => auslastungVorschauOeffnen(reihenfolge, luecken, modus, g)} />
                )}

                <div style={abschnitt}>OPTIONEN</div>
                {mitKranPersonal && (
                  <div style={optionZeile}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, color: "var(--tc-text)" }}>
                      <input type="checkbox" checked={luecken} onChange={e => auslastungVorschauOeffnen(reihenfolge, e.target.checked)} />
                      Lücken füllen
                    </label>
                    <Hinweis inZeile>
                      Wäre Personal unter dem Kran untätig, beginnen Tasks ohne Vorgänger früher als bisher geplant (frühester Start zuerst) —
                      sonst frühestens an ihrem bisherigen Start, und das Personal bleibt so lange untätig.
                    </Hinweis>
                  </div>
                )}
                <div style={optionZeile}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, color: "var(--tc-text)" }}>
                    <input type="checkbox" checked={autoNachfuehren} onChange={e => setAutoNachfuehren(e.target.checked)} />
                    Automatisch nachführen
                  </label>
                  <Hinweis inZeile>
                    Nach jeder Änderung (Termine, Mengen, Tab Ressourcen, Kräne & Personal) werden die betroffenen Tasks und ihre Nachfolger
                    sofort mit diesen Einstellungen neu optimiert — die übrigen behalten ihren Ablauf. Von Hand verschobene Tasks beginnen
                    frühestens am neuen Start, können aber später rutschen, wenn Personal oder Kran dann besetzt sind. Gilt für diese
                    Simulation, bis der Haken wieder entfernt wird; jede Änderung samt Nachführen ist ein Schritt — «Rückgängig» nimmt beides
                    zurück.
                  </Hinweis>
                </div>
              </>)}
              {umstellen && (
                <div style={{ marginTop: 10, padding: "8px 10px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#6b4a00" }}>
                  Arbeiten wechseln innerhalb eines Tages: Mit der Zeiteinheit <strong>«{ZEITEINHEIT_LABEL[vorschlag.einheit]}»</strong> beginnen
                  Nachfolger noch am selben Tag — Bauende {datum(endeNachher)} statt {datum(ende(aktuellesErgebnis.tasks))} mit
                  «{ZEITEINHEIT_LABEL[aktuellesErgebnis.einheit]}». Beim Übernehmen wird die Zeiteinheit der Simulation auf
                  «{ZEITEINHEIT_LABEL[vorschlag.einheit]}» umgestellt.
                </div>
              )}
            </div>

            {/* Ergebnis + Knöpfe: bleiben immer sichtbar */}
            <div style={{ borderTop: "1px solid var(--tc-border-light)", padding: "10px 16px 12px", flexShrink: 0, background: "#f5f9ff" }}>
              {geaendert.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--tc-text-2)", marginBottom: 10 }}>
                  {nurDauern ? "Der Bauablauf entspricht bereits der berechneten Dauer — nichts zu übernehmen." : <>Die Termine sind bereits optimal ausgelastet.
                    {ablaufNeu.length > 0 && <> Der Ablauf je Tag wird für <strong>{ablaufNeu.length}</strong> Task{ablaufNeu.length === 1 ? "" : "s"} neu gespeichert — Tab AVOR zeigt ihn dann genau so.</>}
                    {autoGeaendert && <> «Automatisch nachführen» wird {autoNachfuehren ? "eingeschaltet" : "ausgeschaltet"}.</>}
                    {gruppenGeaendert && <> Die Reihenfolge nach Gruppen wird gespeichert.</>}</>}
                </div>
              ) : (<>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginBottom: 8 }}>
                  {kachel("Neue Termine", <><strong>{terminGeaendert.length}</strong> Task{terminGeaendert.length === 1 ? "" : "s"}</>)}
                  {kachel("Bauende", <>{datum(endeVorher)} → <strong>{datum(endeNachher)}</strong>
                    {tageDiff !== 0 && <span style={besser(tageDiff < 0)}> ({tageDiff > 0 ? "+" : ""}{tageDiff} T.)</span>}</>, "Kalendertage Unterschied in Klammern")}
                  {kachel("Ø Auslastung Personal", <>{prozent(auslastungVorher)} → <strong style={auslastungVorher != null && auslastungNachher != null && Math.abs(auslastungNachher - auslastungVorher) > 0.0005 ? besser(auslastungNachher > auslastungVorher) : undefined}>{prozent(auslastungNachher)}</strong></>,
                    "Arbeit aller Tage ÷ (eingeplantes Personal × Std./Tag) — eingeplant wie die Linie Perfekte Auslastung in Tab AVOR (Personal unter dem Kran + Personen ohne Kran)")}
                  {(neueVorgaenger > 0 || wegVorgaenger > 0) && kachel("Vorgänger", <><strong>+{neueVorgaenger}</strong>{wegVorgaenger > 0 && <> / −{wegVorgaenger}</>} automatisch</>,
                    "Tasks, die auf freies Personal warten mussten, bekommen den Task als zusätzlichen Vorgänger, nach dem diese Leute frei wurden — so bleibt der Ablauf beim Ausrichten der Folge-Tasks erhalten. Eigene (von Hand gesetzte) Vorgänger bleiben; automatisch ergänzte eines früheren Optimierens werden neu bestimmt.")}
                </div>
                {keineHoehereAuslastung && (
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 8px", marginBottom: 8, fontSize: 12, color: "#8a5a00" }}>
                    <span>Keine höhere Auslastung möglich.</span>
                    <Hinweis inZeile>
                      Es sind nicht genug Arbeiten gleichzeitig frei — Vorgänger und Wartetage
                      {luecken || !mitKranPersonal ? "" : ", bisherige Starttermine (→ «Lücken füllen»)"} halten das Personal zurück.
                      Die Tagesangaben in Tab AVOR zeigen, an welchen Tagen Leute untätig sind.
                    </Hinweis>
                  </div>
                )}
              </>)}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button className="tc-btn-primary" style={{ flex: "1 1 180px" }} disabled={nichtsZuTun}
                  title="Lässt sich mit «Rückgängig» oben in der Kopfzeile zurücknehmen (letzte 15 Schritte, bis zum Neuladen)"
                  onClick={() => auslastungUebernehmen(vorschlag.einheit, vorschlag.tasks, !nurDauern)}>
                  {umstellen ? `Übernehmen und auf «${ZEITEINHEIT_LABEL[vorschlag.einheit]}» umstellen` : "Übernehmen"}
                </button>
                {umstellen && (
                  <button className="tc-btn-secondary" title="Ohne Umstellung der Zeiteinheit — Nachfolger beginnen dann erst am nächsten Tag/Halbtag"
                    onClick={() => auslastungUebernehmen(aktuellesErgebnis.einheit, aktuellesErgebnis.tasks, !nurDauern)}>
                    Mit «{ZEITEINHEIT_LABEL[aktuellesErgebnis.einheit]}»
                  </button>
                )}
                <button className="tc-btn-secondary" onClick={() => setAuslastungVorschau(null)}>Abbrechen</button>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: "var(--tc-text-3)" }}>Rückgängig oben in der Kopfzeile (letzte 15 Schritte).</div>
            </div>
          </div>
        </div>
        );
      })()}

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
            freieTageAusblenden={freieTageAus}
            projectId={projectId}
            zeiteinheit={aktiveSim?.zeiteinheit}
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
            selektionFokus="alle"
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
              lsSet(lsGanttHKey, String(newH));
            };
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }} style={{ height: 6, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 40, height: 3, background: "#d4dce4", borderRadius: 2 }} />
          </div>
          <TabTasks
            detailErsatz={unbenutztDetail}
            api={api}
            projectId={projectId}
            aktiveSim={aktiveSim}
            aktivTask={combinedTask}
            aktivTaskId={aktivTaskId}
            selectedIds={selectedIds}
            totalObjekte={totalObjekte}
            offenAnzahl={offenAnzahl}
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
          detailErsatz={unbenutztDetail}
          api={api}
          projectId={projectId}
          aktiveSim={aktiveSim}
          aktivTask={combinedTask}
          aktivTaskId={aktivTaskId}
          selectedIds={selectedIds}
          totalObjekte={totalObjekte}
          offenAnzahl={offenAnzahl}
          updateSim={updateSim}
          onTaskClick={taskAnklicken}
          selGuids={selGuids}
          taskSort={taskSort}
          readOnly={readOnly}
          suchQuery={suchQuery}
        />
      )}
      {unbenutztBereich}
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
