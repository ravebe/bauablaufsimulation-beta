// simInfo.ts — Kennzahlen für die Info-Box einer Simulation (⋮ der Simulationskarte → Info), siehe SimInfoBox.tsx
import type { SimProjekt, TaskTyp } from "../types";
import { istGruppe, parseDateUniversal, vorgaengerListe } from "../types";
import { arbeitstageZwischen, LEERER_KALENDER } from "./kalenderHelpers";

export interface SimInfoDaten {
  anzahlTasks: number;        // ohne Gruppen
  anzahlGruppen: number;
  start: string | null;       // frühester Start / spätestes Ende der Tasks (ISO)
  ende: string | null;
  arbeitstage: number | null;
  bauteile: number;           // verschiedene zugeordnete Bauteile
  tasksOhneBauteile: number;
  tasksMitKuerzel: number;
  ausgeschlossen: number;
  kraene: number;
  tasksMitVorgaenger: number;  // Tasks/Gruppen mit mindestens einem Vorgänger
  meilensteine: number;
  typen: Partial<Record<TaskTyp, number>>; // Tasks je Bauteil-Typ (Neubau, Bestand …)
  feiertage: number;
  ferien: number;
}

export function simInfoDaten(sim: SimProjekt): SimInfoDaten {
  const tasks = sim.tasks;
  let anzahlGruppen = 0, tasksOhneBauteile = 0, tasksMitKuerzel = 0, tasksMitVorgaenger = 0, meilensteine = 0;
  const typen: Partial<Record<TaskTyp, number>> = {};
  let start: Date | null = null, ende: Date | null = null;
  const bauteile = new Set<string>();
  tasks.forEach((t, i) => {
    if (vorgaengerListe(t).length > 0) tasksMitVorgaenger++;
    if (t.isGroup || istGruppe(tasks, i)) { anzahlGruppen++; return; }
    if (t.objektGuids.length === 0) tasksOhneBauteile++;
    for (const g of t.objektGuids) bauteile.add(g);
    if (t.bauteilKuerzel) tasksMitKuerzel++;
    if (t.meilenstein) meilensteine++;
    typen[t.typ] = (typen[t.typ] ?? 0) + 1;
    const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end) ?? s;
    if (s && (!start || s < start)) start = s;
    if (e && (!ende || e > ende)) ende = e;
  });
  const iso = (d: Date | null) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
  const s = iso(start), e = iso(ende);
  return {
    anzahlTasks: tasks.length - anzahlGruppen, anzahlGruppen,
    start: s, ende: e,
    arbeitstage: s && e ? arbeitstageZwischen(s, e, sim.kalender ?? LEERER_KALENDER) : null,
    bauteile: bauteile.size, tasksOhneBauteile, tasksMitKuerzel,
    ausgeschlossen: sim.ausgeschlossen?.length ?? 0,
    kraene: sim.kraene?.length ?? 0,
    tasksMitVorgaenger, meilensteine, typen,
    feiertage: sim.kalender?.feiertage.length ?? 0,
    ferien: sim.kalender?.ferien?.length ?? 0,
  };
}
