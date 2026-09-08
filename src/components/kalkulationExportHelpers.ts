// kalkulationExportHelpers.ts — Export/Import der in Tab Kalkulation gepflegten Task-Zuordnungen
// (Bauteil-Kürzel, Kranbereich, Mengen je Gewerk) als CSV (Excel-bearbeitbar, Zuordnung über den
// Tasknamen) oder JSON (exakter Restore über die Task-ID). Gegenstück zu stammdatenAlsCsv/
// parseStammdatenCsv in stammdatenHelpers.ts, dort aber für die Stammdaten (Raten) statt die Tasks.
import type { Task } from "../types";
import { istGruppe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { csvZelle, parseCsvZeilen } from "./stammdatenHelpers";

const CSV_SPALTEN_FIX = ["Nr", "Task", "Kürzel", "Kranbereich"];

function nichtGruppenTasks(tasks: Task[]): Task[] {
  return tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i));
}

/** Kalkulations-Zuordnungen aller Tasks als CSV (Semikolon-getrennt, UTF-8-BOM für Excel) — "Nr" nur
 *  zur Orientierung beim Bearbeiten, der Reimport ordnet ausschliesslich über den Tasknamen zu (siehe
 *  parseKalkulationCsv). Je Gewerk aus den Stammdaten eine eigene Spalte mit dem aktuellen Mengen-Wert. */
export function kalkulationAlsCsv(tasks: Task[], stammdaten: Stammdaten): string {
  const zeilen: string[][] = [[...CSV_SPALTEN_FIX, ...stammdaten.gewerke.map(g => g.label || g.key)]];
  nichtGruppenTasks(tasks).forEach((t, i) => {
    zeilen.push([
      String(i + 1), t.name, t.bauteilKuerzel ?? "", t.kranbereich ?? "",
      ...stammdaten.gewerke.map(g => t.mengen?.[g.key] != null ? String(t.mengen[g.key]) : ""),
    ]);
  });
  return "﻿" + zeilen.map(z => z.map(csvZelle).join(";")).join("\r\n");
}

export interface KalkulationCsvErgebnis {
  tasks: Task[];
  aktualisiert: number;
  nichtGefunden: string[]; // Tasknamen aus der CSV, zu denen kein Task gefunden wurde
  mehrdeutig: string[]; // Tasknamen, die mehrfach vorkommen — nur der erste Treffer wird aktualisiert
}

/** Parst eine zuvor exportierte (in Excel bearbeitete) Kalkulations-CSV und wendet Kürzel/Kranbereich/
 *  Mengen auf die übergebenen Tasks an — Zuordnung über den Tasknamen (exakt, Gross-/Kleinschreibung
 *  zählt). Leere Zellen lassen den bestehenden Wert unangetastet, damit ein Export mit nur teilweise
 *  ausgefüllten Spalten beim Reimport nichts löscht. Importierte Mengen gelten als "manuell" (siehe
 *  Task.mengenQuelle) — eine spätere "Mengen aus Bauteilen berechnen" überschreibt sie nicht automatisch. */
export function parseKalkulationCsv(text: string, tasks: Task[], stammdaten: Stammdaten): KalkulationCsvErgebnis {
  const zeilen = parseCsvZeilen(text.replace(/^﻿/, ""));
  if (zeilen.length === 0) throw new Error("Leere CSV-Datei");
  const header = zeilen[0];
  const iTask = header.findIndex(h => h.trim().toLowerCase() === "task");
  const iKuerzel = header.findIndex(h => h.trim().toLowerCase() === "kürzel");
  const iKranbereich = header.findIndex(h => h.trim().toLowerCase() === "kranbereich");
  if (iTask === -1) throw new Error('Ungültiges CSV-Format — Spalte "Task" erwartet');

  // Gewerk-Spalten über den Label-Text in der Kopfzeile finden (funktioniert auch bei geänderter
  // Spaltenreihenfolge, da über den Namen statt die Position gesucht wird).
  const gewerkSpalten = stammdaten.gewerke
    .map(g => ({ gewerk: g, idx: header.findIndex(h => h.trim().toLowerCase() === (g.label || g.key).trim().toLowerCase()) }))
    .filter(gs => gs.idx !== -1);

  const parseNum = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };

  const nameVorkommen = new Map<string, number>();
  for (const t of tasks) nameVorkommen.set(t.name, (nameVorkommen.get(t.name) ?? 0) + 1);
  const mehrdeutig = new Set<string>();
  const bereitsAktualisiert = new Set<string>();
  const nichtGefunden: string[] = [];
  let aktualisiert = 0;

  const neueTasks = tasks.map(t => ({ ...t }));
  for (let i = 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.every(c => !c.trim())) continue;
    const name = (z[iTask] ?? "").trim();
    if (!name) continue;
    if ((nameVorkommen.get(name) ?? 0) > 1) mehrdeutig.add(name);
    if (bereitsAktualisiert.has(name)) continue; // nur den ersten Treffer je Name aktualisieren
    const idx = neueTasks.findIndex(t => t.name === name);
    if (idx === -1) { nichtGefunden.push(name); continue; }
    bereitsAktualisiert.add(name);

    const t = neueTasks[idx];
    if (iKuerzel !== -1 && (z[iKuerzel] ?? "").trim()) t.bauteilKuerzel = z[iKuerzel].trim();
    if (iKranbereich !== -1 && (z[iKranbereich] ?? "").trim()) t.kranbereich = z[iKranbereich].trim();
    for (const { gewerk, idx: gi } of gewerkSpalten) {
      const wert = parseNum(z[gi] ?? "");
      if (wert === null) continue;
      const mengenObjekte = { ...(t.mengenObjekte ?? {}) };
      delete mengenObjekte[gewerk.key]; // Summenwert per Import ersetzt eine feinere Bauteil-Aufschlüsselung, analog mengeAendern()
      t.mengen = { ...(t.mengen ?? {}), [gewerk.key]: wert };
      t.mengenQuelle = { ...(t.mengenQuelle ?? {}), [gewerk.key]: "manuell" };
      const mengenInfo = { ...(t.mengenInfo ?? {}) };
      delete mengenInfo[gewerk.key];
      t.mengenInfo = mengenInfo;
      t.mengenObjekte = mengenObjekte;
    }
    neueTasks[idx] = t;
    aktualisiert++;
  }

  return { tasks: neueTasks, aktualisiert, nichtGefunden, mehrdeutig: [...mehrdeutig] };
}

interface KalkulationJsonEintrag {
  id: string;
  name: string; // nur zur Lesbarkeit beim manuellen Anschauen der Datei — der Import ordnet über "id" zu
  bauteilKuerzel?: string;
  kranbereich?: string;
  mengen?: Record<string, number>;
  mengenQuelle?: Record<string, "auto" | "manuell" | "fehler">;
  mengenInfo?: Record<string, string>;
  mengenObjekte?: Record<string, Record<string, number>>;
}

/** Kalkulations-Zuordnungen aller Tasks als JSON — 1:1 über die Task-ID, für einen exakten Restore
 *  innerhalb desselben Projekts (z.B. vor einem riskanten Bulk-Vorgang). Für Excel-Bearbeitung siehe
 *  kalkulationAlsCsv(). */
export function kalkulationAlsJson(tasks: Task[]): string {
  const eintraege: KalkulationJsonEintrag[] = nichtGruppenTasks(tasks).map(t => ({
    id: t.id, name: t.name, bauteilKuerzel: t.bauteilKuerzel, kranbereich: t.kranbereich,
    mengen: t.mengen, mengenQuelle: t.mengenQuelle, mengenInfo: t.mengenInfo, mengenObjekte: t.mengenObjekte,
  }));
  return JSON.stringify(eintraege, null, 2);
}

export interface KalkulationJsonErgebnis { tasks: Task[]; aktualisiert: number; nichtGefunden: number }

/** Parst eine zuvor exportierte Kalkulations-JSON-Datei und ERSETZT bei jedem per "id" gefundenen
 *  Task die Kürzel-/Kranbereich-/Mengen-Felder vollständig (kein Zusammenführen wie bei der CSV) —
 *  ids aus der Datei ohne passenden Task im aktuellen Projekt werden gezählt, aber ignoriert. */
export function parseKalkulationJson(text: string, tasks: Task[]): KalkulationJsonErgebnis {
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("Ungültiges Format — keine Kalkulations-Exportdatei");
  const eintraege = raw.filter((e): e is KalkulationJsonEintrag => !!e && typeof e === "object" && typeof e.id === "string");
  const byId = new Map(eintraege.map(e => [e.id, e]));
  let aktualisiert = 0;
  const neueTasks = tasks.map(t => {
    const e = byId.get(t.id);
    if (!e) return t;
    aktualisiert++;
    return {
      ...t,
      bauteilKuerzel: e.bauteilKuerzel, kranbereich: e.kranbereich,
      mengen: e.mengen, mengenQuelle: e.mengenQuelle, mengenInfo: e.mengenInfo, mengenObjekte: e.mengenObjekte,
    };
  });
  return { tasks: neueTasks, aktualisiert, nichtGefunden: eintraege.length - aktualisiert };
}
