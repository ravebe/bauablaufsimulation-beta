// ganttTabelle.ts — gemeinsame Zeilen-Logik für den tabellarischen Gantt-Export/-Import (Excel, CSV,
// einfaches XML, JSON). Gruppen und Untergruppen werden über die Spalten "Gruppe" (x = Gruppe) und
// "Ebene" (1 = Hauptebene, 2 = darunter …) abgebildet, die Spalte "Nr" enthält die Nummer wie in der App
// (Gruppen A, B, C… / Tasks 1, 2, 3…), auf die sich die Spalte "Vorgänger" bezieht.
// MS-Project-XML hat dafür eigene Felder (OutlineLevel/Summary), siehe msProjectXml.ts.
import type { Task } from "../types";
import { berechneNummern, formatDatum, getOutlineLevel, gruppenDaten, istGruppe, isValidDatum } from "../types";
import type { Kalender } from "./kalenderHelpers";

/** Spalten mit fester Bedeutung — gleichnamige Zusatzspalten werden nicht exportiert (Doppelbelegung). */
export const GRUPPEN_SPALTEN = ["Nr", "Gruppe", "Ebene"];

export interface ExportZeile {
  nr: string;
  gruppe: boolean;
  ebene: number;
  name: string;
  start: string; // dd.mm.yyyy
  ende: string;
  typ: string;   // leer bei Gruppen
  vorgaenger: string;
  wartetage: number | "";
  kuerzel: string;
  bauteile: number | "";
  extra: Record<string, string>;
}

/** Tasks → Exportzeilen; Gruppen erhalten Start/Ende aus ihren Tasks (wie in der App angezeigt). */
export function exportZeilen(tasks: Task[], kalender?: Kalender): ExportZeile[] {
  const nummern = berechneNummern(tasks);
  return tasks.map((t, i) => {
    const gruppe = istGruppe(tasks, i);
    const zeitraum = gruppe ? gruppenDaten(tasks, i, kalender) : { start: t.start, end: t.end };
    return {
      nr: nummern.get(t.id) ?? "",
      gruppe,
      ebene: getOutlineLevel(t),
      name: t.name,
      start: zeitraum.start ? formatDatum(zeitraum.start) : "",
      ende: zeitraum.end ? formatDatum(zeitraum.end) : "",
      typ: gruppe ? "" : t.typ,
      vorgaenger: t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "",
      wartetage: t.predecessorId ? (t.lagDays ?? 0) : "",
      kuerzel: gruppe ? "" : t.bauteilKuerzel ?? "",
      bauteile: gruppe ? "" : t.objektGuids.length,
      extra: t.extraSpalten ?? {},
    };
  });
}

/** Wert der Spalte "Gruppe" deuten: true/false, oder null wenn es kein Gruppen-Kennzeichen ist
 *  (dann ist es eine gewöhnliche Zusatzspalte gleichen Namens). */
export function leseGruppenFlag(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["", "-", "nein", "no", "0", "false", "task", "vorgang"].includes(s)) return false;
  if (["x", "ja", "yes", "j", "y", "1", "true", "wahr", "gruppe", "group", "summary", "sammelvorgang"].includes(s)) return true;
  return null;
}

export interface ImportZeile {
  task: Task;
  vorgRoh: string;
  lagRoh: string;
  nrRoh?: string;
  gruppeRoh?: unknown;
  ebeneRoh?: string;
}

/**
 * Importierte Zeilen → Tasks: Ebenen und Gruppen setzen, Gruppen ohne Termine aus ihren Tasks
 * berechnen und die Vorgänger auflösen. Die Vorgänger-Spalte darf eine Nummer aus der Spalte "Nr",
 * eine Nummer wie in der App (A, B… / 1, 2…) oder einen Task-Namen enthalten.
 */
export function baueImportTasks(zeilen: ImportZeile[]): Task[] {
  const flags = zeilen.map(z => leseGruppenFlag(z.gruppeRoh));
  const hatEbene = zeilen.some(z => (z.ebeneRoh ?? "").trim() !== "");
  const hatGruppen = flags.some(f => f === true);

  // 1. Ebenen — ohne Ebene-Spalte, aber mit markierten Gruppen: alles nach einer Gruppe gehört zu ihr
  let vorherEbene = 0;
  let inGruppe = false;
  const tasks: Task[] = zeilen.map((z, i) => {
    const flag = flags[i] === true;
    let ebene = 1;
    if (hatEbene) {
      const n = parseInt(String(z.ebeneRoh ?? "").trim(), 10);
      ebene = Number.isFinite(n) && n >= 1 ? n : Math.max(1, vorherEbene);
      ebene = Math.min(ebene, vorherEbene + 1); // keine Ebene überspringen
    } else if (hatGruppen) {
      if (flag) { ebene = 1; inGruppe = true; } else ebene = inGruppe ? 2 : 1;
    }
    vorherEbene = ebene;
    const t: Task = { ...z.task, name: z.task.name.trim(), outlineLevel: ebene };
    // Nicht als Kennzeichen lesbarer Wert → war eine gewöhnliche Spalte "Gruppe"
    if (flags[i] === null) t.extraSpalten = { ...t.extraSpalten, Gruppe: String(z.gruppeRoh).trim() };
    return t;
  });

  // 2. Gruppen: markiert ODER die nächste Zeile liegt eine Ebene tiefer
  for (let i = 0; i < tasks.length; i++) {
    const naechste = tasks[i + 1];
    const gruppe = flags[i] === true || (!!naechste && getOutlineLevel(naechste) > getOutlineLevel(tasks[i]));
    if (gruppe) tasks[i] = { ...tasks[i], isGroup: true, objektGuids: [], bauteilKuerzel: undefined };
  }

  // 3. Gruppen ohne gültige Termine → aus ihren Tasks
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.isGroup || (isValidDatum(t.start) && isValidDatum(t.end))) continue;
    const d = gruppenDaten(tasks, i);
    tasks[i] = { ...t, start: isValidDatum(t.start) ? t.start : d.start, end: isValidDatum(t.end) ? t.end : d.end };
  }

  // 4. Vorgänger
  const schluessel = (s: string) => s.trim().toUpperCase();
  const idByNr = new Map<string, string>();
  zeilen.forEach((z, i) => { const nr = schluessel(z.nrRoh ?? ""); if (nr && !idByNr.has(nr)) idByNr.set(nr, tasks[i].id); });
  const idByAppNr = new Map([...berechneNummern(tasks)].map(([id, nr]) => [nr, id]));
  const idByName = new Map(tasks.map(t => [t.name.toLowerCase(), t.id]));
  return tasks.map((t, i) => {
    const roh = zeilen[i].vorgRoh.trim();
    if (!roh) return t;
    const predId = idByNr.get(schluessel(roh)) ?? idByAppNr.get(schluessel(roh)) ?? idByName.get(roh.toLowerCase());
    if (!predId || predId === t.id) return t;
    const lag = Number(String(zeilen[i].lagRoh ?? "0").replace(",", ".")) || 0;
    return { ...t, predecessorId: predId, lagDays: lag };
  });
}
