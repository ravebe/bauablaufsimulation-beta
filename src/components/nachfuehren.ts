// nachfuehren.ts — "Auslastung optimieren" → «Automatisch nachführen» (SimProjekt.autoNachfuehren): nach jeder Änderung werden
// nur die Tasks neu optimiert, deren gespeicherter Ablauf (Task.tagesArbeit) nicht mehr gilt — Termine, Mengen, Tab Ressourcen oder
// Kräne & Personal geändert, oder neu — und alle ihre Nachfolger. Die übrigen behalten Termine und Ablauf; ihr Ablauf belegt beim
// Neuplanen Personal, Kolonnen und Kranzeit. Von Hand verschobene Tasks beginnen frühestens an ihrem neuen Start.
// Läuft in useUndo.ts zusammen mit der Änderung — ein Schritt, mit "Rückgängig" auf einmal zurückzunehmen.
import type { Task, Kran, SimProjekt } from "../types";
import { istGruppe, vorgaengerListe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, hatKalkulationsWerte, schritteFuerTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { startZeitpunkt, minZuZeit } from "./zeitHelpers";
import { gueltigeTagesArbeit } from "./avorHelpers";
import { kranSchluessel } from "./ablaufKern";
import { optimiereAuslastung, optimierungUebernehmen, terminSignatur } from "./auslastungOptimieren";
import { pruefeZeitplanBereitschaft } from "./zeitplanUebernahmeHelpers";

/** Tasks, die neu geplant werden müssen: planbar, aber ohne gültigen Ablauf — plus alle ihre Nachfolger (über alle Stufen). */
export function nachzufuehrendeTasks(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[]): Set<string> {
  const kraeneText = kranSchluessel(kraene);
  const ergebnis = new Set<string>();
  tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(tasks, i) || t.meilenstein || !t.start || !t.end || !hatKalkulationsWerte(t, stammdaten)) return;
    if (schritteFuerTask(t, stammdaten).length === 0) return; // nur Dauer, kein Ablauf
    if (!gueltigeTagesArbeit(t, stammdaten, kalender) || t.tagesArbeit!.kraene !== kraeneText) ergebnis.add(t.id);
  });
  if (ergebnis.size === 0) return ergebnis;
  const nachfolger = new Map<string, string[]>();
  for (const t of tasks) for (const v of vorgaengerListe(t)) nachfolger.set(v.id, [...(nachfolger.get(v.id) ?? []), t.id]);
  const stapel = [...ergebnis];
  while (stapel.length) for (const n of nachfolger.get(stapel.pop()!) ?? []) if (!ergebnis.has(n)) { ergebnis.add(n); stapel.push(n); }
  return ergebnis;
}

const zpText = (t: Task) => { const p = startZeitpunkt(t); return `${p.datum} ${minZuZeit(p.min)}`; };

/** Simulation nachführen, wenn «Automatisch nachführen» an ist und etwas neu zu planen ist — sonst unverändert (dasselbe Objekt). */
export function simNachfuehren(sim: SimProjekt): SimProjekt {
  const e = sim.autoNachfuehren;
  if (!e) return sim;
  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN, kalender = sim.kalender ?? LEERER_KALENDER, kraene = sim.kraene ?? [];
  if (!pruefeZeitplanBereitschaft(sim.tasks, stammdaten).bereit) return sim; // Tab Kalkulation noch mit Fehlern
  const nur = nachzufuehrendeTasks(sim.tasks, stammdaten, kalender, kraene);
  if (nur.size === 0) return sim;
  // von Hand verschoben (Start anders als beim Optimieren): frühestens am neuen Start
  const untergrenze = new Set(sim.tasks.filter(t => nur.has(t.id) && t.optimierung && zpText(t) !== t.optimierung.start).map(t => t.id));
  const ergebnis = optimiereAuslastung(sim.tasks, stammdaten, kalender, sim.zeiteinheit ?? "tage", kraene, e.reihenfolge, e.luecken, { nur, untergrenze });
  const tasks = optimierungUebernehmen(sim.tasks, ergebnis);
  return { ...sim, tasks, optimiertStand: terminSignatur(tasks) };
}
