// TabKalkulation.tsx — Menge→Tage-Kalkulation je Task (AVOR-Logik) mit Plausibilitätsvergleich
// zur geplanten Dauer aus dem Bauablauf.
import { useState, useEffect, useMemo, Fragment } from "react";
import type { SimProjekt, Task } from "../types";
import { istGruppe, berechneNummern, nsKey } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { arbeitstageZwischen, LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, alleKuerzel, gewerkeFuerKuerzel, dauerBerechnetTask, bezeichnungFuerKuerzel, ausschlussFilterListe, aktiveFilterIds, objektAusgeschlossen, mengenRelevanteSignatur } from "./stammdatenHelpers";
import type { Gewerk, Rate, Stammdaten } from "./stammdatenHelpers";
import { kuerzelVorschlag } from "./bauteilkatalogHelpers";
import { StatTile, CategoryBarChart, CockpitAbschnitt, useEingeklappt, FARBEN } from "./cockpitCharts";
import { ladeObjektAttribute, guidsZuBatch, zeigeBauteileImModell } from "./modelHelpers";
import { berechneMenge, mengeStatus } from "./formelHelpers";

interface Props { sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; api?: ApiInstance | null; projectId?: string | null; }

// Grid-Spalten der Tabelle — feste Breiten statt Flex, damit kein Inhalt nachfolgende Spalten
// verschiebt. Verstellbar per Drag, siehe startResize. Alle Zellen top-ausgerichtet (alignItems:
// "start"), damit sie in einer Flucht stehen, auch wenn die Mengen-Zelle mehrzeilig ist.
const ALLE_SPALTEN = ["nr", "auge", "task", "kuerzel", "mengen", "geplant", "berechnet", "differenz", "kranbereich"] as const;
type Spalte = typeof ALLE_SPALTEN[number];
const SPALTEN_LABEL: Record<Spalte, string> = {
  nr: "Nr.", task: "Task", kuerzel: "Kürzel", mengen: "Mengen", geplant: "Geplant", berechnet: "Berechnet",
  differenz: "Differenz", kranbereich: "Kranbereich", auge: "",
};
const DEFAULT_COL_W: Record<Spalte, number> = { nr: 30, task: 220, kuerzel: 64, mengen: 260, geplant: 76, berechnet: 88, differenz: 60, kranbereich: 110, auge: 30 };
const LS_COLW = "4d-kalk-colw";

// Spalten mit Sortier-/Filterfunktion im Header (Klick auf Titel = sortieren, ▾ = Filter-Popover).
const SORTIERBARE_SPALTEN = ["task", "kuerzel", "geplant", "berechnet"] as const;
type SortSpalte = typeof SORTIERBARE_SPALTEN[number];

type Zeile = { t: Task; geplant: number; berechnet: number; differenz: number; abweichung: boolean };

function spalteWert(z: Zeile, spalte: SortSpalte): string {
  switch (spalte) {
    case "task": return z.t.name;
    case "kuerzel": return z.t.bauteilKuerzel || "–";
    case "geplant": return `${z.geplant}d`;
    case "berechnet": return `${z.berechnet}d`;
  }
}

export default function TabKalkulation({ sim, updateSim, readOnly, api, projectId = null }: Props) {
  const [bulkLaeuft, setBulkLaeuft] = useState(false);
  const [bulkErgebnis, setBulkErgebnis] = useState<string | null>(null);
  const [mengenLaeuft, setMengenLaeuft] = useState(false);
  const [mengenErgebnis, setMengenErgebnis] = useState<string | null>(null);
  const [suchOffen, setSuchOffen] = useState(false);
  const [suchQuery, setSuchQuery] = useState("");
  const [sortSpalte, setSortSpalte] = useState<SortSpalte | null>(null);
  const [sortRichtung, setSortRichtung] = useState<"asc" | "desc">("asc");
  const [spaltenFilter, setSpaltenFilter] = useState<Partial<Record<SortSpalte, Set<string>>>>({});
  const [filterMenuOffen, setFilterMenuOffen] = useState<SortSpalte | null>(null);
  const [angezeigtTaskId, setAngezeigtTaskId] = useState<string | null>(null);
  const [mengenSortModus, setMengenSortModus] = useState<"fehler" | "leer" | "auto" | "manuell" | null>(null);
  const [expandedGewerk, setExpandedGewerk] = useState<Set<string>>(new Set());
  // Eingefrorene Zeilen-Reihenfolge (Task-IDs), während in einem Mengen-Feld getippt wird — siehe
  // Freeze-Block weiter unten, direkt vor der Zeilen-Ausgabe.
  const [bearbeitungEingefroren, setBearbeitungEingefroren] = useState<string[] | null>(null);

  function gewerkExpandToggle(key: string) {
    setExpandedGewerk(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const lsColwKey = nsKey(LS_COLW, projectId);
  const [colW, setColW] = useState<Record<Spalte, number>>(() => {
    try {
      const raw = localStorage.getItem(lsColwKey);
      return raw ? { ...DEFAULT_COL_W, ...JSON.parse(raw) } : { ...DEFAULT_COL_W };
    } catch { return { ...DEFAULT_COL_W }; }
  });
  useEffect(() => {
    try { localStorage.setItem(lsColwKey, JSON.stringify(colW)); } catch { /* ignore */ }
  }, [colW, lsColwKey]);

  // Baseline für den "Mengen veraltet"-Hinweis (siehe unten) einmalig setzen, falls noch keine
  // existiert (neues oder älteres Projekt ohne dieses Feld) — ohne Baseline gäbe es sonst sofort
  // einen falschen Alarm, obwohl noch gar keine Ressourcen-Änderung stattgefunden hat.
  useEffect(() => {
    if (sim && sim.mengenBerechnetSignatur === undefined) {
      updateSim({ ...sim, mengenBerechnetSignatur: mengenRelevanteSignatur(sim.stammdaten ?? LEERE_STAMMDATEN) });
    }
  }, [sim, updateSim]);

  const { eingeklappt, toggle: toggleEingeklappt } = useEingeklappt(projectId, "kalkulation");

  function startResize(spalte: Spalte, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sw = colW[spalte];
    const onMove = (ev: MouseEvent) => setColW(prev => ({ ...prev, [spalte]: Math.max(24, sw + ev.clientX - sx) }));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }

  const gridTemplate = ALLE_SPALTEN.map(s => `${colW[s]}px`).join(" ");

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const kuerzelListe = alleKuerzel(stammdaten);
  const kuerzelOptionen = kuerzelListe.map(k => {
    const bez = bezeichnungFuerKuerzel(stammdaten, k);
    return { k, label: bez ? `${k} – ${bez}` : k };
  });
  const nummern = berechneNummern(sim.tasks);
  // true, sobald sich Formeln/Ausschlussfilter in Tab Ressourcen seit dem letzten Lauf von
  // "Mengen aus Bauteilen berechnen" geändert haben — siehe mengenRelevanteSignatur().
  const mengenVeraltet = sim.mengenBerechnetSignatur !== undefined && sim.mengenBerechnetSignatur !== mengenRelevanteSignatur(stammdaten);

  function taskAendern(taskId: string, patch: Partial<Task>) {
    updateSim({ ...sim!, tasks: sim!.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t) });
  }

  // Manuelle Eingabe überschreibt eine Formel-Menge (Status "manuell", schwarz statt blau) — Leeren
  // setzt den Status zurück, damit "Mengen berechnen" die Zelle wieder automatisch befüllen kann.
  // Löscht auch etwaige Einzel-Bauteil-Überschreibungen (mengenObjekte) dieses Gewerks, da eine
  // direkte Eingabe im Summenfeld die feinere Bauteil-Liste bewusst ersetzt.
  function mengeAendern(task: Task, gewerkKey: string, wert: number | null) {
    const mengen = { ...(task.mengen ?? {}) };
    const mengenQuelle = { ...(task.mengenQuelle ?? {}) };
    const mengenInfo = { ...(task.mengenInfo ?? {}) };
    const mengenObjekte = { ...(task.mengenObjekte ?? {}) };
    delete mengenObjekte[gewerkKey];
    if (wert === null || wert === 0) { delete mengen[gewerkKey]; delete mengenQuelle[gewerkKey]; delete mengenInfo[gewerkKey]; }
    else { mengen[gewerkKey] = wert; mengenQuelle[gewerkKey] = "manuell"; delete mengenInfo[gewerkKey]; }
    taskAendern(task.id, { mengen, mengenQuelle, mengenInfo, mengenObjekte });
  }

  // Mengen aus Formeln (Tab Ressourcen) für alle Tasks berechnen. Ein Gewerk-Feld wird nur dann
  // komplett übersprungen, wenn es als Ganzes manuell im Summenfeld gesetzt wurde (mengenQuelle
  // "manuell" OHNE Einzel-Bauteil-Aufschlüsselung) — sobald mengenObjekte-Einträge existieren, läuft
  // die Berechnung normal weiter: berechneMenge() übernimmt die überschriebenen Bauteile 1:1 und
  // berechnet nur die übrigen (inkl. neu hinzugekommener Bauteile) neu.
  async function mengenBerechnen() {
    if (!api || !sim) return;
    setMengenLaeuft(true);
    setMengenErgebnis(null);
    const alleFilter = ausschlussFilterListe(stammdaten);
    let autoCount = 0, fehlerCount = 0, manuellCount = 0, taskCount = 0;
    const updatedTasks = [...sim.tasks];
    for (let i = 0; i < updatedTasks.length; i++) {
      const t = updatedTasks[i];
      if (t.isGroup || istGruppe(updatedTasks, i) || !t.bauteilKuerzel) continue;
      const gewerkeMitFormel = gewerkeFuerKuerzel(stammdaten, t.bauteilKuerzel)
        .map(g => ({ g, rate: g.raten.find(r => r.kuerzel === t.bauteilKuerzel) }))
        .filter((e): e is { g: typeof e.g; rate: NonNullable<typeof e.rate> } => !!e.rate?.formel?.trim());
      const zuBerechnen = gewerkeMitFormel.filter(e =>
        !(t.mengenQuelle?.[e.g.key] === "manuell" && !t.mengenObjekte?.[e.g.key]));
      if (zuBerechnen.length === 0) continue;
      taskCount++;

      let objektWerteMap = new Map<string, Record<string, string>>();
      if (t.objektGuids.length > 0) {
        try { objektWerteMap = await ladeObjektAttribute(api, t.objektGuids); } catch { /* unten als Fehler behandelt */ }
      }

      const mengen = { ...(t.mengen ?? {}) };
      const mengenQuelle = { ...(t.mengenQuelle ?? {}) };
      const mengenInfo = { ...(t.mengenInfo ?? {}) };
      for (const { g, rate } of zuBerechnen) {
        const aktiveIds = aktiveFilterIds(rate);
        const eintraege = t.objektGuids
          .map(guid => ({ guid, werte: objektWerteMap.get(guid) ?? {} }))
          .filter(e => aktiveIds.length === 0 || !objektAusgeschlossen(e.werte, alleFilter, aktiveIds));
        const overrides = t.mengenObjekte?.[g.key];
        const erg = berechneMenge(rate.formel!, eintraege, overrides);
        if (erg.wert !== null) mengen[g.key] = erg.wert; else delete mengen[g.key];

        const status = mengeStatus(erg, !!overrides && Object.keys(overrides).length > 0);
        mengenQuelle[g.key] = status.quelle;
        if (status.info) mengenInfo[g.key] = status.info; else delete mengenInfo[g.key];
        if (status.quelle === "auto") autoCount++; else if (status.quelle === "fehler") fehlerCount++; else manuellCount++;
      }
      updatedTasks[i] = { ...t, mengen, mengenQuelle, mengenInfo };
    }
    updateSim({ ...sim, tasks: updatedTasks, mengenBerechnetSignatur: mengenRelevanteSignatur(stammdaten) });
    setMengenLaeuft(false);
    setMengenErgebnis(taskCount === 0 ? "Keine Leistungspositionen mit Formel gefunden"
      : `${taskCount} Tasks aktualisiert · ${autoCount} Mengen berechnet, ${fehlerCount} mit Fehlern${manuellCount > 0 ? `, ${manuellCount} teilweise manuell` : ""}`);
  }

  async function alleUnzugeordnetenZuordnen() {
    if (!api) return;
    const kandidaten = sim!.tasks.filter((t, i) => !t.isGroup && !istGruppe(sim!.tasks, i) && !t.bauteilKuerzel && t.objektGuids.length > 0);
    if (kandidaten.length === 0) { setBulkErgebnis("Keine unzugeordneten Tasks mit Bauteilen gefunden."); return; }
    setBulkLaeuft(true);
    setBulkErgebnis(null);
    let zugeordnet = 0, uneindeutigN = 0, keinTreffer = 0;
    const zuordnungen = new Map<string, string>();
    for (const t of kandidaten) {
      const { kuerzel, uneindeutig } = await kuerzelVorschlag(api, t.objektGuids);
      if (kuerzel) { zuordnungen.set(t.id, kuerzel); zugeordnet++; }
      else if (uneindeutig.length > 0) uneindeutigN++;
      else keinTreffer++;
    }
    if (zuordnungen.size > 0) {
      updateSim({ ...sim!, tasks: sim!.tasks.map(t => zuordnungen.has(t.id) ? { ...t, bauteilKuerzel: zuordnungen.get(t.id) } : t) });
    }
    setBulkLaeuft(false);
    setBulkErgebnis(`${zugeordnet} zugeordnet, ${uneindeutigN} uneindeutig, ${keinTreffer} ohne Treffer`);
  }

  // Erneuter Klick auf dasselbe Auge setzt die 3D-Ansicht wieder zurück. zeigeBauteileImModell()
  // (modelHelpers.ts) blendet dafür alle Objekte aus und markiert danach nur den Task-Batch.
  async function bauteileImModellZeigen(t: Task) {
    if (!api) return;
    if (angezeigtTaskId === t.id) {
      try { await api.viewer.reset(); } catch { /* ignore */ }
      setAngezeigtTaskId(null);
      return;
    }
    const batch = guidsZuBatch(t.objektGuids);
    if (batch.length === 0) return;
    try {
      await zeigeBauteileImModell(api, batch);
      setAngezeigtTaskId(t.id);
    } catch { /* ignore */ }
  }

  if (kuerzelListe.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Stammdaten hinterlegt — im Tab Ressourcen zuerst Stammdaten anlegen oder Standardwerte laden.
      </div>
    );
  }

  const zeilen: Zeile[] = sim.tasks.map((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i)) return null;
    const geplant = arbeitstageZwischen(t.start, t.end, kalender);
    const berechnet = dauerBerechnetTask(t, stammdaten);
    const abweichung = berechnet > 0 && (berechnet > geplant * 1.5 || berechnet < geplant * 0.67);
    return { t, geplant, berechnet, differenz: berechnet - geplant, abweichung };
  }).filter((z): z is Zeile => z !== null);

  const tasksMitKuerzel = zeilen.filter(z => z.t.bauteilKuerzel).length;
  const anzahlAbweichung = zeilen.filter(z => z.abweichung).length;
  const abweichungsBasis = zeilen.filter(z => z.t.bauteilKuerzel && z.geplant > 0);
  const durchschnAbweichungProzent = abweichungsBasis.length > 0
    ? abweichungsBasis.reduce((s, z) => s + Math.abs(z.berechnet - z.geplant) / z.geplant, 0) / abweichungsBasis.length * 100
    : 0;
  const gesamtAbweichungTage = zeilen.filter(z => z.t.bauteilKuerzel).reduce((s, z) => s + z.differenz, 0);

  const summeProKuerzel = new Map<string, { geplant: number; berechnet: number }>();
  for (const z of zeilen) {
    if (!z.t.bauteilKuerzel) continue;
    const e = summeProKuerzel.get(z.t.bauteilKuerzel) ?? { geplant: 0, berechnet: 0 };
    e.geplant += z.geplant; e.berechnet += z.berechnet;
    summeProKuerzel.set(z.t.bauteilKuerzel, e);
  }
  const kuerzelKategorien = [...summeProKuerzel.keys()].sort();

  // Eindeutige Werte einer sortier-/filterbaren Spalte — Basis sind alle anderen aktiven Filter
  // (nicht der eigenen Spalte), damit das Filter-Popover wie in Tabellenkalkulationen üblich nur
  // noch erreichbare Werte zeigt.
  function eindeutigeWerte(spalte: SortSpalte): string[] {
    let basis = zeilen;
    if (suchQuery.trim()) {
      const q = suchQuery.trim().toLowerCase();
      basis = basis.filter(z => z.t.name.toLowerCase().includes(q) || (z.t.bauteilKuerzel ?? "").toLowerCase().includes(q));
    }
    for (const s of SORTIERBARE_SPALTEN) {
      if (s === spalte) continue;
      const erlaubt = spaltenFilter[s];
      if (erlaubt) basis = basis.filter(z => erlaubt.has(spalteWert(z, s)));
    }
    const werte = new Set(basis.map(z => spalteWert(z, spalte)));
    return [...werte].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  // Priorität für den Mengen-Sortmodus (0 = zuoberst), ausgelöst per Klick auf die Legende unter der
  // Tabelle (siehe unten) — "fehler"/"auto"/"manuell": mindestens ein Gewerk dieses Kürzels steht auf
  // der jeweiligen mengenQuelle; "leer": kein Kürzel gewählt ODER mindestens ein anwendbares Gewerk hat
  // noch gar keine Menge erfasst. Als stabiler Sortier-Pass NACH der Spalten-Sortierung angewendet,
  // damit die bisherige Reihenfolge innerhalb der beiden Gruppen erhalten bleibt.
  function mengenPrioritaet(z: Zeile): number {
    if (!z.t.bauteilKuerzel) return mengenSortModus === "leer" ? 0 : 1;
    const gewerke = gewerkeFuerKuerzel(stammdaten, z.t.bauteilKuerzel);
    if (mengenSortModus === "leer") return gewerke.some(g => z.t.mengen?.[g.key] === undefined) ? 0 : 1;
    return gewerke.some(g => z.t.mengenQuelle?.[g.key] === mengenSortModus) ? 0 : 1;
  }

  function filterWertToggeln(spalte: SortSpalte, wert: string, alleWerte: string[]) {
    setSpaltenFilter(prev => {
      const aktuell = prev[spalte] ?? new Set(alleWerte);
      const neu = new Set(aktuell);
      if (neu.has(wert)) neu.delete(wert); else neu.add(wert);
      const next = { ...prev };
      if (neu.size === alleWerte.length) delete next[spalte]; else next[spalte] = neu;
      return next;
    });
  }

  // Such- + Filter- + Sortier-Pipeline
  let zeilenGefiltert = zeilen;
  if (suchQuery.trim()) {
    const q = suchQuery.trim().toLowerCase();
    zeilenGefiltert = zeilenGefiltert.filter(z => z.t.name.toLowerCase().includes(q) || (z.t.bauteilKuerzel ?? "").toLowerCase().includes(q));
  }
  for (const spalte of SORTIERBARE_SPALTEN) {
    const erlaubt = spaltenFilter[spalte];
    if (erlaubt) zeilenGefiltert = zeilenGefiltert.filter(z => erlaubt.has(spalteWert(z, spalte)));
  }
  if (sortSpalte) {
    const richt = sortRichtung === "asc" ? 1 : -1;
    zeilenGefiltert = [...zeilenGefiltert].sort((a, b) => {
      if (sortSpalte === "geplant") return (a.geplant - b.geplant) * richt;
      if (sortSpalte === "berechnet") return (a.berechnet - b.berechnet) * richt;
      if (sortSpalte === "kuerzel") return (a.t.bauteilKuerzel ?? "").localeCompare(b.t.bauteilKuerzel ?? "") * richt;
      return a.t.name.localeCompare(b.t.name) * richt;
    });
  }
  if (mengenSortModus) {
    zeilenGefiltert = [...zeilenGefiltert].sort((a, b) => mengenPrioritaet(a) - mengenPrioritaet(b));
  }
  const zeilenSortiert = zeilenGefiltert; // natürliche, aktuelle Sortierung — Basis für den Freeze-Snapshot unten

  // Solange in einem Mengen-Feld (Summenfeld oder Bauteil-Liste) getippt wird, bleibt die einmal
  // beim Fokussieren erfasste Reihenfolge bestehen, statt bei jedem Tastendruck neu zu sortieren —
  // sonst springt z.B. ein gerade korrigierter Fehler bei aktivem "nach Fehler sortieren" sofort aus
  // der Fehlergruppe und der Nutzer verliert Scrollposition/Kontext mitten in der Eingabe. Erst
  // mengenBearbeitungEnde() (Blur/Enter/Wechsel des Feldes) gibt die Sortierung wieder frei.
  function mengenBearbeitungStart() {
    setBearbeitungEingefroren(prev => prev ?? zeilenSortiert.map(z => z.t.id));
  }
  function mengenBearbeitungEnde() {
    setBearbeitungEingefroren(null);
  }
  function mengenEnterCommit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
  }
  if (bearbeitungEingefroren) {
    const byId = new Map(zeilenGefiltert.map(z => [z.t.id, z] as const));
    const geordnet: Zeile[] = [];
    for (const id of bearbeitungEingefroren) { const z = byId.get(id); if (z) { geordnet.push(z); byId.delete(id); } }
    geordnet.push(...byId.values());
    zeilenGefiltert = geordnet;
  }

  function headerKlick(spalte: SortSpalte) {
    if (sortSpalte !== spalte) { setSortSpalte(spalte); setSortRichtung("asc"); }
    else if (sortRichtung === "asc") setSortRichtung("desc");
    else setSortSpalte(null);
  }

  function renderHeaderZelle(spalte: Spalte, idx: number) {
    const istSortierbar = (SORTIERBARE_SPALTEN as readonly string[]).includes(spalte);
    const sortSpalteTyp = istSortierbar ? spalte as SortSpalte : null;
    const aktivSort = sortSpalteTyp && sortSpalte === sortSpalteTyp;
    const gefiltert = sortSpalteTyp ? !!spaltenFilter[sortSpalteTyp] : false;
    const alleWerte = sortSpalteTyp && filterMenuOffen === sortSpalteTyp ? eindeutigeWerte(sortSpalteTyp) : [];
    return (
      <div key={spalte} style={{ position: "relative", display: "flex", alignItems: "center", gap: 3, paddingLeft: idx > 0 ? 8 : 0, overflow: "visible", whiteSpace: "nowrap" }}>
        <span
          onClick={() => sortSpalteTyp && headerKlick(sortSpalteTyp)}
          style={{ cursor: sortSpalteTyp ? "pointer" : "default", userSelect: "none", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
          {SPALTEN_LABEL[spalte]}
        </span>
        {aktivSort && (
          <span onClick={() => sortSpalteTyp && headerKlick(sortSpalteTyp)} style={{ cursor: "pointer", flexShrink: 0, fontSize: 9 }}>
            {sortRichtung === "asc" ? "▲" : "▼"}
          </span>
        )}
        {sortSpalteTyp && (
          <span onClick={() => setFilterMenuOffen(m => m === sortSpalteTyp ? null : sortSpalteTyp)}
            title="Filtern" style={{ cursor: "pointer", fontSize: 9, color: gefiltert ? "var(--tc-blue)" : "var(--tc-text-3)", flexShrink: 0 }}>
            ▾
          </span>
        )}
        {spalte === "task" && (
          <span onClick={() => setSuchOffen(o => !o)} title="Tasks suchen"
            style={{ cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", color: suchQuery ? "var(--tc-blue)" : "var(--tc-text-3)" }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6.5" cy="6.5" r="5" /><line x1="10.2" y1="10.2" x2="14.5" y2="14.5" /></svg>
          </span>
        )}
        {sortSpalteTyp && filterMenuOffen === sortSpalteTyp && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setFilterMenuOffen(null)} />
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, background: "#fff", border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 140, maxHeight: 220, overflowY: "auto", fontSize: 11, padding: 4, fontWeight: 400 }}>
              <div style={{ padding: "3px 6px", cursor: "pointer", color: "var(--tc-blue)", fontWeight: 600 }}
                onClick={() => setSpaltenFilter(prev => { const n = { ...prev }; delete n[sortSpalteTyp]; return n; })}>
                Alle anzeigen
              </div>
              {alleWerte.map(w => {
                const erlaubt = spaltenFilter[sortSpalteTyp];
                const checked = !erlaubt || erlaubt.has(w);
                return (
                  <label key={w} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 6px", cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={() => filterWertToggeln(sortSpalteTyp, w, alleWerte)} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
        {spalte === "task" && suchOffen && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setSuchOffen(false)} />
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, background: "#fff", border: "1px solid #d4dce4", boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, padding: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <input autoFocus placeholder="Task suchen…" value={suchQuery} onChange={e => setSuchQuery(e.target.value)}
                style={{ width: 160, padding: "3px 6px", fontSize: 11, border: "1px solid #d4dce4", fontFamily: "inherit", outline: "none" }}
                onKeyDown={e => { if (e.key === "Escape") setSuchOffen(false); }} />
              {suchQuery && (
                <span style={{ cursor: "pointer", fontSize: 12, color: "#8a9baa", flexShrink: 0 }} onClick={() => setSuchQuery("")}>✕</span>
              )}
            </div>
          </>
        )}
        {idx < ALLE_SPALTEN.length - 1 && (
          <div className="col-resize-handle" onMouseDown={e => startResize(spalte, e)}
            style={{ position: "absolute", top: -4, right: -3, width: 7, height: 18, cursor: "col-resize", zIndex: 2 }} />
        )}
      </div>
    );
  }

  function renderZelle(spalte: Spalte, z: Zeile) {
    switch (spalte) {
      case "nr":
        return <span style={{ fontSize: 10, color: "#666" }}>{nummern.get(z.t.id)}</span>;
      case "task":
        return <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 6 }}>{z.t.name}</span>;
      case "kuerzel":
        return (
          <select disabled={readOnly} value={z.t.bauteilKuerzel ?? ""} onChange={e => taskAendern(z.t.id, { bauteilKuerzel: e.target.value || undefined })}
            style={{ width: "90%", fontSize: 11, padding: "3px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
            <option value="">–</option>
            {kuerzelOptionen.map(o => <option key={o.k} value={o.k}>{o.label}</option>)}
          </select>
        );
      case "mengen": {
        const gewerke = z.t.bauteilKuerzel ? gewerkeFuerKuerzel(stammdaten, z.t.bauteilKuerzel) : [];
        return (
          <div style={{ display: "grid", gridTemplateColumns: gewerke.length >= 3 ? "1fr 1fr" : "1fr", columnGap: 10, rowGap: 3, minWidth: 0, paddingRight: 6 }}>
            {gewerke.map(g => {
              const quelle = z.t.mengenQuelle?.[g.key];
              const info = z.t.mengenInfo?.[g.key];
              const farbe = quelle === "auto" ? "var(--tc-blue)" : quelle === "fehler" ? "var(--tc-red)" : "#333";
              const rate = g.raten.find(r => r.kuerzel === z.t.bauteilKuerzel);
              const aufklappbar = !!rate?.formel?.trim();
              const offen = aufklappbar && expandedGewerk.has(`${z.t.id}::${g.key}`);
              return (
                <div key={g.key} style={{ fontSize: 9, color: "var(--tc-text-3)", display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                  <span
                    title={aufklappbar ? "Bauteil-Liste anzeigen" : undefined}
                    onClick={aufklappbar ? () => gewerkExpandToggle(`${z.t.id}::${g.key}`) : undefined}
                    style={{ minWidth: 50, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: aufklappbar ? "pointer" : "default", textDecoration: aufklappbar ? "underline dotted" : "none" }}>
                    {aufklappbar && (offen ? "▾ " : "▸ ")}{g.label}{quelle === "fehler" && " ⚠"}
                  </span>
                  <input type="number" className="no-spinner" disabled={readOnly} value={z.t.mengen?.[g.key] ?? ""}
                    title={info ? `${g.label} [${g.einheit}] — ${info}` : `${g.label} [${g.einheit}]`}
                    onChange={e => mengeAendern(z.t, g.key, e.target.value === "" ? null : Number(e.target.value))}
                    onFocus={mengenBearbeitungStart} onBlur={mengenBearbeitungEnde} onKeyDown={mengenEnterCommit}
                    style={{ width: 50, minWidth: 0, flex: 1, fontSize: 10, padding: "2px 4px", border: `1px solid ${quelle === "fehler" ? "var(--tc-red)" : "#d4dce4"}`, fontFamily: "inherit", color: farbe, fontWeight: quelle ? 600 : 400 }} />
                </div>
              );
            })}
            {gewerke.length === 0 && <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Kürzel wählen…</span>}
          </div>
        );
      }
      case "geplant":
        return <span style={{ fontSize: 11, color: "#888", paddingTop: 3 }}>{z.geplant}d</span>;
      case "berechnet":
        return (
          <span style={{ fontSize: 11, fontWeight: 600, color: z.abweichung ? "#d9622b" : "#333", paddingTop: 3 }}
            title={z.abweichung ? "Deutliche Abweichung von der geplanten Dauer" : ""}>
            {z.berechnet}d
          </span>
        );
      case "differenz": {
        const farbe = z.differenz > 0 ? "#d9622b" : z.differenz < 0 ? "#2e8b57" : "#888";
        return <span style={{ fontSize: 11, fontWeight: 600, color: farbe, paddingTop: 3 }}>{z.differenz > 0 ? "+" : ""}{z.differenz}d</span>;
      }
      case "kranbereich":
        return (
          <input type="text" disabled={readOnly} value={z.t.kranbereich ?? ""} onChange={e => taskAendern(z.t.id, { kranbereich: e.target.value || undefined })}
            style={{ width: "90%", fontSize: 10, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
        );
      case "auge": {
        const hatBauteile = z.t.objektGuids.length > 0;
        const aktiv = angezeigtTaskId === z.t.id;
        const disabled = !api || !hatBauteile;
        return (
          <span onClick={() => !disabled && bauteileImModellZeigen(z.t)}
            title={!api ? "3D-Modell nicht verbunden" : !hatBauteile ? "Keine Bauteile zugeordnet" : aktiv ? "3D-Ansicht zurücksetzen" : "Bauteile im 3D-Modell zeigen und markieren"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer", color: disabled ? "#c7d0d8" : aktiv ? "var(--tc-blue)" : "var(--tc-text-3)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
              <circle cx="12" cy="12" r="3" fill={aktiv ? "currentColor" : "none"} />
            </svg>
          </span>
        );
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: 12 }}>
      <div style={{ padding: "14px 14px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <StatTile label="Total Abweichung" wert={`${gesamtAbweichungTage > 0 ? "+" : ""}${gesamtAbweichungTage}d`} status={gesamtAbweichungTage !== 0 ? "warning" : "good"} sub="Berechnet − Geplant, alle Tasks" />
          <StatTile label="Tasks mit Kürzel" wert={`${tasksMitKuerzel}/${zeilen.length}`} />
          <StatTile label="Tasks mit Abweichung" wert={String(anzahlAbweichung)} status={anzahlAbweichung > 0 ? "warning" : "good"} />
          <StatTile label="Ø Abweichung" wert={`${durchschnAbweichungProzent.toFixed(0)}%`} />
        </div>
        {kuerzelKategorien.length > 0 && (
          <CockpitAbschnitt titel="Geplant vs. berechnet je Kürzel" eingeklappt={!!eingeklappt["kuerzel-chart"]} onToggle={() => toggleEingeklappt("kuerzel-chart")}>
            <CategoryBarChart einheit="Tage" kategorien={kuerzelKategorien}
              serien={[
                { key: "geplant", label: "Geplant", color: FARBEN.kategorial[0], werte: kuerzelKategorien.map(k => summeProKuerzel.get(k)!.geplant) },
                { key: "berechnet", label: "Berechnet", color: FARBEN.kategorial[1], werte: kuerzelKategorien.map(k => summeProKuerzel.get(k)!.berechnet) },
              ]} formatWert={v => v.toFixed(0)} />
          </CockpitAbschnitt>
        )}

        {!readOnly && api && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={bulkLaeuft} onClick={alleUnzugeordnetenZuordnen}>
                {bulkLaeuft ? "Wird zugeordnet…" : "Alle unzugeordneten automatisch zuordnen"}
              </button>
              <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={mengenLaeuft} onClick={mengenBerechnen}
                title="Berechnet Mengen aus den Formeln in Tab Ressourcen für alle Bauteile je Task — manuell überschriebene Werte bleiben unangetastet">
                {mengenLaeuft ? "Wird berechnet…" : "Mengen aus Bauteilen berechnen"}
              </button>
              {mengenVeraltet && (
                <span title="Formeln/Ausschlussfilter in Tab Ressourcen wurden seit der letzten Berechnung geändert — Mengen sind veraltet"
                  style={{ fontSize: 10, color: "#d9622b" }}>
                  ⚠
                </span>
              )}
            </div>
            {(bulkErgebnis || mengenErgebnis) && (
              <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                {bulkErgebnis && <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>{bulkErgebnis}</span>}
                {mengenErgebnis && <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>{mengenErgebnis}</span>}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, fontSize: 9, color: "var(--tc-text-3)", marginBottom: 6 }}>
          <span onClick={() => setMengenSortModus(m => m === "auto" ? null : "auto")} title="Automatisch berechnete Felder zuoberst"
            style={{ cursor: "pointer", fontWeight: mengenSortModus === "auto" ? 700 : 400, color: mengenSortModus === "auto" ? "var(--tc-blue)" : "var(--tc-text-3)" }}>
            <span style={{ color: "var(--tc-blue)", fontWeight: 700 }}>■</span> automatisch aus Formel
          </span>
          <span onClick={() => setMengenSortModus(m => m === "manuell" ? null : "manuell")} title="Manuell angepasste Felder zuoberst"
            style={{ cursor: "pointer", fontWeight: mengenSortModus === "manuell" ? 700 : 400, color: mengenSortModus === "manuell" ? "#333" : "var(--tc-text-3)" }}>
            <span style={{ color: "#333", fontWeight: 700 }}>■</span> manuell angepasst
          </span>
          <span onClick={() => setMengenSortModus(m => m === "fehler" ? null : "fehler")} title="Fehlerhafte Felder zuoberst"
            style={{ cursor: "pointer", fontWeight: mengenSortModus === "fehler" ? 700 : 400, color: mengenSortModus === "fehler" ? "var(--tc-red)" : "var(--tc-text-3)" }}>
            <span style={{ color: "var(--tc-red)", fontWeight: 700 }}>■</span> Fehler / fehlende Attribute
          </span>
          <span onClick={() => setMengenSortModus(m => m === "leer" ? null : "leer")} title="Leere Felder zuoberst"
            style={{ cursor: "pointer", fontWeight: mengenSortModus === "leer" ? 700 : 400, color: mengenSortModus === "leer" ? "var(--tc-blue)" : "var(--tc-text-3)" }}>
            <span style={{ display: "inline-block", width: 7, height: 7, background: "#fff", border: "1px solid #999", verticalAlign: "middle" }} /> Leere Felder
          </span>
        </div>
      </div>
      {/* flex:1 + minHeight:0 macht diesen Bereich zum echten, höhenbegrenzten Scrollcontainer
          (statt eines unbegrenzt mitwachsenden Blocks) — erst dadurch greift position:sticky auf
          der Kopfzeile und fixiert sie beim Scrollen. overflow:"auto" deckt zugleich das breite
          Grid horizontal ab; minHeight bei offenem Such-/Filterpopup verhindert, dass der Bereich
          bei 0 Treffern auf die Kopfzeile schrumpft und das Popup abschneidet. */}
      <div style={{ flex: 1, minHeight: (suchOffen || filterMenuOffen) ? 260 : 0, overflow: "auto", padding: "0 14px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: gridTemplate, fontSize: 9, color: "var(--tc-text-3)", fontWeight: 600, padding: "4px 0", position: "sticky", top: 0, background: "#fff", zIndex: 3 }}>
          {ALLE_SPALTEN.map((s, i) => renderHeaderZelle(s, i))}
        </div>
        {zeilenGefiltert.map(z => {
          const offeneGewerke = z.t.bauteilKuerzel
            ? gewerkeFuerKuerzel(stammdaten, z.t.bauteilKuerzel).filter(g => expandedGewerk.has(`${z.t.id}::${g.key}`))
            : [];
          return (
            <Fragment key={z.t.id}>
              <div style={{ display: "grid", gridTemplateColumns: gridTemplate, alignItems: "start", padding: "6px 0", borderBottom: offeneGewerke.length > 0 ? "none" : "1px solid var(--tc-border-light)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                {ALLE_SPALTEN.map((s, i) => (
                  <div key={s} style={{ minWidth: 0, paddingLeft: i > 0 ? 8 : 0 }}>{renderZelle(s, z)}</div>
                ))}
              </div>
              {offeneGewerke.map(g => (
                <GewerkObjektListe key={`${z.t.id}::${g.key}`} t={z.t} gewerk={g}
                  rate={g.raten.find(r => r.kuerzel === z.t.bauteilKuerzel)!} api={api} stammdaten={stammdaten}
                  readOnly={readOnly} taskAendern={taskAendern}
                  mengenBearbeitungStart={mengenBearbeitungStart} mengenBearbeitungEnde={mengenBearbeitungEnde} mengenEnterCommit={mengenEnterCommit} />
              ))}
              {offeneGewerke.length > 0 && <div style={{ borderBottom: "1px solid var(--tc-border-light)" }} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Aufklappbare Bauteil-Liste unter einem Gewerk-Feld (Klick auf z.B. "Beton") — zeigt für jedes
// zugeordnete Bauteil den ausgewerteten Formel-Wert samt Einheit und erlaubt, ihn pro Bauteil
// manuell zu übersteuern (task.mengenObjekte). Lädt die Attribute unabhängig vom Bulk-Lauf
// "Mengen aus Bauteilen berechnen" neu, sobald sie geöffnet wird oder sich die zugeordneten
// Bauteile ändern — damit neu hinzugekommene Bauteile sofort erscheinen.
function GewerkObjektListe({ t, gewerk, rate, api, stammdaten, readOnly, taskAendern, mengenBearbeitungStart, mengenBearbeitungEnde, mengenEnterCommit }: {
  t: Task; gewerk: Gewerk; rate: Rate; api?: ApiInstance | null; stammdaten: Stammdaten; readOnly?: boolean;
  taskAendern: (taskId: string, patch: Partial<Task>) => void;
  mengenBearbeitungStart: () => void; mengenBearbeitungEnde: () => void; mengenEnterCommit: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [attrMap, setAttrMap] = useState<Map<string, Record<string, string>> | null>(null);
  const [laden, setLaden] = useState(true);
  const [angezeigtGuid, setAngezeigtGuid] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    // setLaden(true) direkt im Effekt (statt nur im .then()) ist hier bewusst: t.objektGuids kann
    // sich ändern, während das Panel schon offen ist (z.B. neu zugeordnete Bauteile) — ohne diesen
    // Reset bliebe kurz der alte, jetzt veraltete attrMap-Stand sichtbar, bevor die neuen Daten da sind.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLaden(true);
    const promise = (!api || t.objektGuids.length === 0)
      ? Promise.resolve(new Map<string, Record<string, string>>())
      : ladeObjektAttribute(api, t.objektGuids).catch(() => new Map<string, Record<string, string>>());
    promise.then(map => { if (!abgebrochen) { setAttrMap(map); setLaden(false); } });
    return () => { abgebrochen = true; };
  }, [api, t.objektGuids]);

  const eintraege = useMemo(() => {
    if (!attrMap) return [];
    const alleFilter = ausschlussFilterListe(stammdaten);
    const aktiveIds = aktiveFilterIds(rate);
    return t.objektGuids
      .map(guid => ({ guid, werte: attrMap.get(guid) ?? {} }))
      .filter(e => aktiveIds.length === 0 || !objektAusgeschlossen(e.werte, alleFilter, aktiveIds));
  }, [attrMap, t.objektGuids, rate, stammdaten]);

  const overrides = t.mengenObjekte?.[gewerk.key];
  const erg = useMemo(() => berechneMenge(rate.formel ?? "", eintraege, overrides), [eintraege, rate.formel, overrides]);

  function overrideAendern(guid: string, wert: number | null) {
    const neueOverrides = { ...(overrides ?? {}) };
    if (wert === null) delete neueOverrides[guid]; else neueOverrides[guid] = wert;
    const neuErg = berechneMenge(rate.formel ?? "", eintraege, neueOverrides);

    const mengen = { ...(t.mengen ?? {}) };
    const mengenQuelle = { ...(t.mengenQuelle ?? {}) };
    const mengenInfo = { ...(t.mengenInfo ?? {}) };
    const mengenObjekte = { ...(t.mengenObjekte ?? {}) };
    if (Object.keys(neueOverrides).length === 0) delete mengenObjekte[gewerk.key]; else mengenObjekte[gewerk.key] = neueOverrides;

    if (neuErg.wert !== null) mengen[gewerk.key] = neuErg.wert; else delete mengen[gewerk.key];
    const status = mengeStatus(neuErg, Object.keys(neueOverrides).length > 0);
    mengenQuelle[gewerk.key] = status.quelle;
    if (status.info) mengenInfo[gewerk.key] = status.info; else delete mengenInfo[gewerk.key];

    taskAendern(t.id, { mengen, mengenQuelle, mengenInfo, mengenObjekte });
  }

  // Auge pro Bauteil-Zeile — dieselbe Zeigen/Zurücksetzen-Logik wie das Auge in der "auge"-Spalte
  // (bauteileImModellZeigen), nur für ein einzelnes Bauteil statt aller Bauteile des Tasks.
  async function bauteilImModellZeigen(guid: string) {
    if (!api) return;
    if (angezeigtGuid === guid) {
      try { await api.viewer.reset(); } catch { /* ignore */ }
      setAngezeigtGuid(null);
      return;
    }
    const batch = guidsZuBatch([guid]);
    if (batch.length === 0) return;
    try {
      await zeigeBauteileImModell(api, batch);
      setAngezeigtGuid(guid);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ background: "#fafbfc", border: "1px solid var(--tc-border-light)", borderTop: "none", padding: "6px 14px 10px", fontSize: 10 }}>
      <div style={{ fontWeight: 600, color: "var(--tc-text-2)", marginBottom: 6 }}>Bauteile {gewerk.label}</div>
      {laden ? (
        <div style={{ color: "var(--tc-text-3)", padding: "4px 0" }}>Lade Bauteile…</div>
      ) : eintraege.length === 0 ? (
        <div style={{ color: "var(--tc-text-3)", padding: "4px 0" }}>Keine Bauteile in der Auswertung von „{gewerk.label}".</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 90px 60px", columnGap: 10, rowGap: 3, alignItems: "center", maxWidth: 540 }}>
          <div />
          <div style={{ fontWeight: 600, color: "var(--tc-text-3)" }}>Bauteil</div>
          <div style={{ fontWeight: 600, color: "var(--tc-text-3)" }}>Wert</div>
          <div style={{ fontWeight: 600, color: "var(--tc-text-3)" }}>Einheit</div>
          {erg.objekte.map(o => {
            const werte = attrMap?.get(o.guid);
            const name = werte?.["Product||Product Name"] || werte?.["Reference Object||Common Type"] || `Bauteil ${o.guid.split(":::")[1] ?? o.guid}`;
            const farbe = o.quelle === "auto" ? "var(--tc-blue)" : o.quelle === "fehler" ? "var(--tc-red)" : "#333";
            const augeAktiv = angezeigtGuid === o.guid;
            const augeDisabled = !api;
            return (
              <Fragment key={o.guid}>
                <span onClick={() => !augeDisabled && bauteilImModellZeigen(o.guid)}
                  title={augeDisabled ? "3D-Modell nicht verbunden" : augeAktiv ? "3D-Ansicht zurücksetzen" : "Bauteil im 3D-Modell zeigen und markieren"}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: augeDisabled ? "default" : "pointer", color: augeDisabled ? "#c7d0d8" : augeAktiv ? "var(--tc-blue)" : "var(--tc-text-3)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" fill={augeAktiv ? "currentColor" : "none"} />
                  </svg>
                </span>
                <div title={o.grund} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: o.quelle === "fehler" ? "var(--tc-red)" : "var(--tc-text-2)" }}>
                  {name}{o.quelle === "fehler" && " ⚠"}
                </div>
                <input type="number" className="no-spinner" disabled={readOnly} value={o.wert ?? ""}
                  title={o.grund}
                  onChange={e => overrideAendern(o.guid, e.target.value === "" ? null : Number(e.target.value))}
                  onFocus={mengenBearbeitungStart} onBlur={mengenBearbeitungEnde} onKeyDown={mengenEnterCommit}
                  style={{ width: 70, fontSize: 10, padding: "2px 4px", border: `1px solid ${o.quelle === "fehler" ? "var(--tc-red)" : "#d4dce4"}`, fontFamily: "inherit", color: farbe, fontWeight: o.quelle !== "auto" ? 600 : 400 }} />
                <div style={{ color: "var(--tc-text-3)" }}>{gewerk.einheit}</div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
