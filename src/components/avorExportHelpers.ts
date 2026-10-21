// avorExportHelpers.ts — CSV-Exporte der Auswertungen in Tab AVOR (⋮ → Export). Semikolon-getrennt mit BOM wie die übrigen
// CSV-Exporte (Excel). Zahlen auf 2 Nachkommastellen gerundet mit Punkt als Dezimaltrennzeichen, ohne Tausendertrennung,
// damit Excel damit weiterrechnen kann.
import type { Task } from "../types";
import type { Kalender } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { csvZelle } from "./stammdatenHelpers";
import { personalbedarfJeLeistungsposition } from "./avorHelpers";
import { fmtTageStunden } from "./zahlFormat";

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const csvZahl = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export function datumCh(iso: string): string {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}
const wochentag = (iso: string) => { const [j, m, t] = iso.split("-").map(Number); return WOCHENTAG[new Date(j, m - 1, t).getDay()]; };

export function alsCsv(zeilen: string[][]): string {
  return "﻿" + zeilen.map(z => z.map(csvZelle).join(";")).join("\r\n");
}

/** Personalbedarf je Arbeitstag: Personen total (Vollzeit-Äquivalent), Personenstunden total (auch als Tage + Stunden), Personen
 *  je Gewerk und Personenstunden je Leistungsposition (Gewerk + Kürzel). Letzte Zeile: Summen über den ganzen Zeitraum. */
export function personalbedarfAlsCsv(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): string {
  const std = stammdaten.arbeitszeitStdProTag;
  const { positionen, tage } = personalbedarfJeLeistungsposition(tasks, stammdaten, kalender);
  const gewerke = stammdaten.gewerke.filter(g => positionen.some(p => p.gewerkKey === g.key));
  const kopf = [
    "Datum", "Wochentag", "Personen total", "Personenstunden total [h]", "Personenstunden total (Tage + Stunden)",
    ...gewerke.map(g => `${g.label || g.key} [Pers.]`),
    ...positionen.map(p => `${p.gewerk} · ${p.kuerzel}${p.bezeichnung ? ` ${p.bezeichnung}` : ""} [h]`),
  ];
  const zeilen: string[][] = [kopf];
  const summe: Record<string, number> = {};
  let summeTotal = 0;
  for (const { tag, stunden } of tage) {
    const total = Object.values(stunden).reduce((s, v) => s + v, 0);
    summeTotal += total;
    for (const [k, v] of Object.entries(stunden)) summe[k] = (summe[k] ?? 0) + v;
    const jeGewerk = (gk: string) => positionen.filter(p => p.gewerkKey === gk).reduce((s, p) => s + (stunden[p.key] ?? 0), 0);
    zeilen.push([
      datumCh(tag), wochentag(tag), csvZahl(std > 0 ? total / std : 0), csvZahl(total), fmtTageStunden(total, std),
      ...gewerke.map(g => csvZahl(std > 0 ? jeGewerk(g.key) / std : 0)),
      ...positionen.map(p => csvZahl(stunden[p.key] ?? 0)),
    ]);
  }
  // Summenzeile nur für Stunden — Personen pro Tag lassen sich nicht sinnvoll über Tage addieren
  zeilen.push([
    "Total", "", "", csvZahl(summeTotal), fmtTageStunden(summeTotal, std),
    ...gewerke.map(() => ""),
    ...positionen.map(p => csvZahl(summe[p.key] ?? 0)),
  ]);
  zeilen.push([]);
  zeilen.push([`Personen = Personenstunden des Tages ÷ ${csvZahl(std)} h/Tag (Arbeitszeit Tab Ressourcen). Personenstunden = Menge × Leistungswert, je Task Gewerke nacheinander.`]);
  return alsCsv(zeilen);
}
