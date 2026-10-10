// mengenBerechnung.ts — Mengen aus den Formeln (Tab Ressourcen) für alle Tasks berechnen; genutzt von
// Tab Kalkulation und Tab Ressourcen (je Menüpunkt "Mengen aus Bauteilen berechnen").
import type { SimProjekt, Task } from "../types";
import { istGruppe } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { gewerkeFuerKuerzel, ausschlussFilterListe, aktiveFilterIds, objektAusgeschlossen } from "./stammdatenHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { ladeObjektAttribute } from "./modelHelpers";
import { berechneMenge, mengeStatus } from "./formelHelpers";

export type MeldungStufe = "ok" | "teil" | "fehler";

export interface MengenErgebnis {
  tasks: Task[];
  taskCount: number; autoCount: number; fehlerCount: number; manuellCount: number;
  stufe: MeldungStufe;
  text: string;
}

/**
 * Ein Gewerk-Feld wird nur dann komplett übersprungen, wenn es als Ganzes manuell im Summenfeld gesetzt wurde
 * (mengenQuelle "manuell" OHNE Einzel-Bauteil-Aufschlüsselung) — sobald mengenObjekte-Einträge existieren, läuft
 * die Berechnung normal weiter: berechneMenge() übernimmt die überschriebenen Bauteile 1:1 und berechnet nur
 * die übrigen (inkl. neu hinzugekommener Bauteile) neu.
 */
export async function berechneAlleMengen(api: ApiInstance, sim: SimProjekt, stammdaten: Stammdaten): Promise<MengenErgebnis> {
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
  return {
    tasks: updatedTasks, taskCount, autoCount, fehlerCount, manuellCount,
    stufe: taskCount === 0 ? "fehler" : fehlerCount === 0 ? "ok" : autoCount > 0 ? "teil" : "fehler",
    text: taskCount === 0 ? "Keine Leistungspositionen mit Formel gefunden"
      : `${taskCount} Tasks aktualisiert · ${autoCount} Mengen berechnet, ${fehlerCount} mit Fehlern${manuellCount > 0 ? `, ${manuellCount} teilweise manuell` : ""}`,
  };
}
