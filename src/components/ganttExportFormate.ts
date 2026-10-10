// ganttExportFormate.ts — gemeinsame Export-Funktionen für Tasks (Excel/CSV/XML/MS-Project/JSON),
// genutzt von GanttExport.tsx (Tab Projekte) und dem Optionen-Menü (App.tsx). Gruppen/Untergruppen
// stehen in den Spalten "Gruppe"/"Ebene" (siehe ganttTabelle.ts) und werden beim Import wieder erkannt.
import * as XLSX from "xlsx";
import type { Task } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { generateMsProjectXml } from "./msProjectXml";
import { exportZeilen, GRUPPEN_SPALTEN } from "./ganttTabelle";
import type { ExportZeile } from "./ganttTabelle";

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Reihenfolge wie in der Gantt-Vorlage (SimKebabMenu.tsx), zusätzliche Spalten alphabetisch dahinter
const VORLAGE_SPALTEN = ["Bauabschnitt", "Geschoss", "Etappe", "Objektname", "Layer"];

function sammleExtraSpalten(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) if (t.extraSpalten) for (const k of Object.keys(t.extraSpalten)) set.add(k);
  for (const k of [...set]) if (GRUPPEN_SPALTEN.some(g => g.toLowerCase() === k.toLowerCase())) set.delete(k);
  const vorlage = VORLAGE_SPALTEN.filter(k => set.has(k));
  const rest = [...set].filter(k => !VORLAGE_SPALTEN.includes(k)).sort();
  return [...vorlage, ...rest];
}

// XML-Tag-Namen dürfen keine Leer-/Sonderzeichen enthalten
function xmlTag(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(?=\d)/, "_");
}

/** Tabellenzeile (Excel/CSV) in Spaltenreihenfolge; einzug = Name je Ebene optisch einrücken */
function tabellenZeile(z: ExportZeile, extraSpalten: string[], einzug: boolean, reihenfolge: number): Record<string, string | number> {
  return {
    "Gantt-Reihenfolge": reihenfolge,
    Nr: z.nr,
    Gruppe: z.gruppe ? "x" : "",
    Ebene: z.ebene,
    Name: einzug ? "   ".repeat(z.ebene - 1) + z.name : z.name,
    Start: z.start,
    Ende: z.ende,
    Typ: z.typ,
    Vorgänger: z.vorgaenger,
    Wartetage: z.wartetage,
    ...Object.fromEntries(extraSpalten.map(k => [k, z.extra[k] ?? ""])),
    Kürzel: z.kuerzel,
    Bauteile: z.bauteile,
  };
}

export function exportXlsx(tasks: Task[], simName: string, kalender?: Kalender) {
  const extraSpalten = sammleExtraSpalten(tasks);
  const rows = exportZeilen(tasks, kalender).map((z, i) => tabellenZeile(z, extraSpalten, true, i + 1));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 17 }, { wch: 5 }, { wch: 7 }, { wch: 6 }, { wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, ...extraSpalten.map(() => ({ wch: 14 })), { wch: 8 }, { wch: 10 }];
  if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] }; // Filterpfeile in der Titelzeile
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gantt");
  XLSX.writeFile(wb, `${simName}_Gantt.xlsx`);
}

export function exportCsv(tasks: Task[], simName: string, kalender?: Kalender) {
  const extraSpalten = sammleExtraSpalten(tasks);
  const sep = ";";
  const feld = (v: string | number) => {
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = exportZeilen(tasks, kalender).map((z, i) => tabellenZeile(z, extraSpalten, false, i + 1));
  const header = Object.keys(tabellenZeile(leereZeile(), extraSpalten, false, 0));
  const lines = [header.map(feld).join(sep), ...rows.map(r => header.map(h => feld(r[h] ?? "")).join(sep))];
  const csv = "﻿" + lines.join("\n"); // BOM for Excel
  download(csv, `${simName}_Gantt.csv`, "text/csv;charset=utf-8");
}

function leereZeile(): ExportZeile {
  return { nr: "", gruppe: false, ebene: 1, name: "", start: "", ende: "", typ: "", vorgaenger: "", wartetage: "", kuerzel: "", bauteile: "", extra: {} };
}

export function exportXml(tasks: Task[], simName: string, kalender?: Kalender) {
  const extraSpalten = sammleExtraSpalten(tasks);
  const tasksXml = exportZeilen(tasks, kalender).map((z, i) => {
    const vorgLines = z.vorgaenger
      ? `\n    <Vorgaenger>${esc(z.vorgaenger)}</Vorgaenger>\n    <Wartetage>${z.wartetage}</Wartetage>`
      : "";
    const extraLines = extraSpalten.map(k => `\n    <${xmlTag(k)}>${esc(z.extra[k] ?? "")}</${xmlTag(k)}>`).join("");
    const taskLines = z.gruppe ? "" : `\n    <Type>${z.typ}</Type>\n    <Kuerzel>${esc(z.kuerzel)}</Kuerzel>\n    <Objects>${z.bauteile}</Objects>`;
    return `  <Task>\n    <Gantt_Reihenfolge>${i + 1}</Gantt_Reihenfolge>\n    <Nr>${esc(z.nr)}</Nr>\n    <Gruppe>${z.gruppe ? 1 : 0}</Gruppe>\n    <Ebene>${z.ebene}</Ebene>\n    <Name>${esc(z.name)}</Name>\n    <Start>${z.start}</Start>\n    <Finish>${z.ende}</Finish>${taskLines}${vorgLines}${extraLines}\n  </Task>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Gantt>\n${tasksXml}\n</Gantt>`;
  download(xml, `${simName}_Gantt.xml`, "application/xml");
}

export function exportMsProject(tasks: Task[], simName: string, kalender: Kalender = LEERER_KALENDER) {
  const xml = generateMsProjectXml(tasks, simName, kalender);
  download(xml, `${simName}_MSProject.xml`, "application/xml");
}

export function exportJson(tasks: Task[], simName: string, kalender?: Kalender) {
  const data = exportZeilen(tasks, kalender).map((z, i) => ({
    gantt_reihenfolge: i + 1, nr: z.nr, gruppe: z.gruppe, ebene: z.ebene,
    name: z.name, start: z.start, end: z.ende,
    typ: z.gruppe ? null : z.typ, kuerzel: z.kuerzel || null,
    bauteile: z.gruppe ? 0 : z.bauteile, guids: z.gruppe ? [] : tasks[i].objektGuids,
    vorgaenger: z.vorgaenger || null,
    wartetage: z.vorgaenger ? z.wartetage : null,
    ...Object.fromEntries(Object.entries(z.extra).filter(([k]) => !GRUPPEN_SPALTEN.some(g => g.toLowerCase() === k.toLowerCase()))),
  }));
  download(JSON.stringify(data, null, 2), `${simName}_Gantt.json`, "application/json");
}

export interface ExportFormat { key: string; label: string; run: (tasks: Task[], simName: string, kalender?: Kalender) => void; }

export const EXPORT_FORMATE: ExportFormat[] = [
  { key: "xlsx", label: "Excel (.xlsx)", run: exportXlsx },
  { key: "csv", label: "CSV (.csv)", run: exportCsv },
  { key: "xml", label: "Einfaches XML (.xml)", run: exportXml },
  { key: "msp", label: "MS Project (.xml)", run: exportMsProject },
  { key: "json", label: "JSON (.json)", run: exportJson },
];
