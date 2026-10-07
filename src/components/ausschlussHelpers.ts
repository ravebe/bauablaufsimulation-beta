// ausschlussHelpers.ts — Bauteile aus einer Simulation entfernen und wieder aufnehmen (reine Logik, testbar).
// Ein entferntes Bauteil wird aus seinem Task genommen — dadurch fällt es automatisch aus allen Berechnungen
// (Kalkulation, Kosten, Kräne, IFC-Export …), ohne dass jede Berechnung es einzeln filtern muss. Der
// bisherige Task wird gemerkt, damit "Wieder aufnehmen" es genau dorthin zurücklegt. Ausgeblendet wird es
// über hooks/useAusgeschlosseneAusblenden.ts; Auto-Verknüpfung, Attribut-Tasks, IFC-Import, Attribut-Filter
// und manuelles Hinzufügen überspringen es (ausgeschlosseneGuids). Versionswechsel: mitAusschlussTask +
// ausschluesseUmstellen. Oberfläche: UnbenutzteBauteile.tsx. Bauteile = "modelId:::runtimeId".
import type { Ausschluss, SimProjekt, Task } from "../types";

export function ausgeschlosseneGuids(sim: Pick<SimProjekt, "ausgeschlossen">): Set<string> {
  return new Set((sim.ausgeschlossen ?? []).map(a => a.guid));
}

/** Bauteile aus der Simulation entfernen: aus allen Tasks nehmen, mit bisherigem Task merken */
export function bauteileAusschliessen(sim: SimProjekt, guids: string[]): SimProjekt {
  const neu = new Set(guids.filter(Boolean));
  for (const g of ausgeschlosseneGuids(sim)) neu.delete(g);
  if (neu.size === 0) return sim;
  const taskVon = new Map<string, string>();
  for (const t of sim.tasks) for (const g of t.objektGuids) if (neu.has(g) && !taskVon.has(g)) taskVon.set(g, t.id);
  const tasks = sim.tasks.map(t => t.objektGuids.some(g => neu.has(g)) ? { ...t, objektGuids: t.objektGuids.filter(g => !neu.has(g)) } : t);
  const eintraege: Ausschluss[] = [...neu].map(g => (taskVon.has(g) ? { guid: g, taskId: taskVon.get(g) } : { guid: g }));
  return { ...sim, tasks, ausgeschlossen: [...(sim.ausgeschlossen ?? []), ...eintraege] };
}

/** Wieder aufnehmen: zurück in den bisherigen Task (falls es ihn noch gibt und er keine Gruppe ist),
 *  sonst einfach wieder "noch nicht verknüpft". */
export function bauteileWiederAufnehmen(sim: SimProjekt, guids: string[]): { sim: SimProjekt; zurueckInTask: number } {
  const weg = new Set(guids);
  const zurueck = new Map<string, string[]>(); // taskId → guids
  const bleiben: Ausschluss[] = [];
  const taskIds = new Set(sim.tasks.filter(t => !t.isGroup).map(t => t.id));
  for (const a of sim.ausgeschlossen ?? []) {
    if (!weg.has(a.guid)) { bleiben.push(a); continue; }
    if (a.taskId && taskIds.has(a.taskId)) zurueck.set(a.taskId, [...(zurueck.get(a.taskId) ?? []), a.guid]);
  }
  if (bleiben.length === (sim.ausgeschlossen ?? []).length) return { sim, zurueckInTask: 0 };
  let zurueckInTask = 0;
  const tasks = sim.tasks.map(t => {
    const dazu = zurueck.get(t.id);
    if (!dazu) return t;
    const vorhanden = new Set(t.objektGuids);
    const neu = dazu.filter(g => !vorhanden.has(g));
    zurueckInTask += neu.length;
    return neu.length ? { ...t, objektGuids: [...t.objektGuids, ...neu] } : t;
  });
  return { sim: { ...sim, tasks, ausgeschlossen: bleiben }, zurueckInTask };
}

/** Bauteile, die weder einem Task zugeordnet noch ausgeschlossen sind */
export function unverknuepfteGuids(alle: string[], sim: SimProjekt): string[] {
  const belegt = ausgeschlosseneGuids(sim);
  for (const t of sim.tasks) for (const g of t.objektGuids) belegt.add(g);
  return alle.filter(g => !belegt.has(g));
}

/** Inhalt der zwei Zeilen in Tab Bauteile; offen = null, solange die Bauteile noch gezählt werden */
export function unbenutzteListen(sim: SimProjekt, alleGuids: string[] | null): { offen: string[] | null; entfernt: string[] } {
  return { offen: alleGuids ? unverknuepfteGuids(alleGuids, sim) : null, entfernt: (sim.ausgeschlossen ?? []).map(a => a.guid) };
}

/** Für automatische Zuordnungen (Auto-Verknüpfung, Attribut-Tasks, IFC-Import): ausgeschlossene weglassen */
export function ohneAusgeschlossene(guids: string[], sim: Pick<SimProjekt, "ausgeschlossen">): string[] {
  const aus = ausgeschlosseneGuids(sim);
  return aus.size === 0 ? guids : guids.filter(g => !aus.has(g));
}

/** Tasks + ausgeschlossene Bauteile als interner Hilfs-Task — für Versionswechsel/IFC-Übernahme, damit auch
 *  die Ausschlüsse auf die neuen Runtime-IDs umgestellt werden (Ergebnis mit ausschluesseUmstellen anwenden) */
export function mitAusschlussTask(sim: Pick<SimProjekt, "tasks" | "ausgeschlossen">): Task[] {
  if (!sim.ausgeschlossen?.length) return sim.tasks;
  return [...sim.tasks, { id: "__ausgeschlossen__", name: "", start: "", end: "", typ: "neubau", objektGuids: sim.ausgeschlossen.map(a => a.guid) }];
}

/** Nach einem Modell-Versionswechsel (Runtime-IDs ändern sich): Ausschlüsse mit derselben Zuordnung umstellen */
export function ausschluesseUmstellen(ausgeschlossen: Ausschluss[] | undefined, mapping: Map<string, string>): Ausschluss[] | undefined {
  if (!ausgeschlossen || mapping.size === 0) return ausgeschlossen;
  return ausgeschlossen.map(a => (mapping.has(a.guid) ? { ...a, guid: mapping.get(a.guid)! } : a));
}
