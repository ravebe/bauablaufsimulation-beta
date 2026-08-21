// ganttExportFormate.ts — gemeinsame Export-Funktionen für Tasks (Excel/CSV/XML/MS-Project/JSON),
// genutzt von GanttExport.tsx (Tab Projekte) und dem Optionen-Menü (App.tsx)
import * as XLSX from "xlsx";
import type { Task } from "../types";
import { formatDatum, berechneNummern } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { generateMsProjectXml } from "./msProjectXml";

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function exportXlsx(tasks: Task[], simName: string) {
  const nummern = berechneNummern(tasks);
  const rows = tasks.map(t => ({
    Name: t.name,
    Start: formatDatum(t.start),
    Ende: formatDatum(t.end),
    Typ: t.typ,
    Vorgänger: t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "",
    Wartetage: t.predecessorId ? (t.lagDays ?? 0) : "",
    Kürzel: t.bauteilKuerzel ?? "",
    Bauteile: t.objektGuids.length,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gantt");
  XLSX.writeFile(wb, `${simName}_Gantt.xlsx`);
}

export function exportCsv(tasks: Task[], simName: string) {
  const nummern = berechneNummern(tasks);
  const sep = ";";
  const header = ["Name", "Start", "Ende", "Typ", "Vorgänger", "Wartetage", "Kürzel", "Bauteile"].join(sep);
  const rows = tasks.map(t =>
    [t.name, formatDatum(t.start), formatDatum(t.end), t.typ,
      t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "",
      t.predecessorId ? (t.lagDays ?? 0) : "",
      t.bauteilKuerzel ?? "",
      t.objektGuids.length].join(sep)
  );
  const csv = "﻿" + [header, ...rows].join("\n"); // BOM for Excel
  download(csv, `${simName}_Gantt.csv`, "text/csv;charset=utf-8");
}

export function exportXml(tasks: Task[], simName: string) {
  const nummern = berechneNummern(tasks);
  const tasksXml = tasks.map(t => {
    const vorgLines = t.predecessorId
      ? `\n    <Vorgaenger>${esc(nummern.get(t.predecessorId) ?? "")}</Vorgaenger>\n    <Wartetage>${t.lagDays ?? 0}</Wartetage>`
      : "";
    return `  <Task>\n    <Name>${esc(t.name)}</Name>\n    <Start>${formatDatum(t.start)}</Start>\n    <Finish>${formatDatum(t.end)}</Finish>\n    <Type>${t.typ}</Type>\n    <Kuerzel>${esc(t.bauteilKuerzel ?? "")}</Kuerzel>\n    <Objects>${t.objektGuids.length}</Objects>${vorgLines}\n  </Task>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Gantt>\n${tasksXml}\n</Gantt>`;
  download(xml, `${simName}_Gantt.xml`, "application/xml");
}

export function exportMsProject(tasks: Task[], simName: string, kalender: Kalender = LEERER_KALENDER) {
  const xml = generateMsProjectXml(tasks, simName, kalender);
  download(xml, `${simName}_MSProject.xml`, "application/xml");
}

export function exportJson(tasks: Task[], simName: string) {
  const nummern = berechneNummern(tasks);
  const data = tasks.map(t => ({
    name: t.name, start: formatDatum(t.start), end: formatDatum(t.end),
    typ: t.typ, kuerzel: t.bauteilKuerzel ?? null, bauteile: t.objektGuids.length, guids: t.objektGuids,
    vorgaenger: t.predecessorId ? nummern.get(t.predecessorId) ?? null : null,
    wartetage: t.predecessorId ? (t.lagDays ?? 0) : null,
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
