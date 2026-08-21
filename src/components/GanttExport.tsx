import { useState } from "react";
import * as XLSX from "xlsx";
import type { Task } from "../types";
import { formatDatum, berechneNummern } from "../types";
import { generateMsProjectXml } from "./msProjectXml";

interface Props {
  tasks: Task[];
  simName: string;
}

export default function GanttExport({ tasks, simName }: Props) {
  const [offen, setOffen] = useState(false);

  if (tasks.length === 0) return null;

  function exportXlsx() {
    const nummern = berechneNummern(tasks);
    const rows = tasks.map(t => ({
      Name: t.name,
      Start: formatDatum(t.start),
      Ende: formatDatum(t.end),
      Typ: t.typ,
      Vorg\u00E4nger: t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "",
      Wartetage: t.predecessorId ? (t.lagDays ?? 0) : "",
      Bauteile: t.objektGuids.length,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gantt");
    XLSX.writeFile(wb, `${simName}_Gantt.xlsx`);
    setOffen(false);
  }

  function exportCsv() {
    const nummern = berechneNummern(tasks);
    const sep = ";";
    const header = ["Name", "Start", "Ende", "Typ", "Vorg\u00E4nger", "Wartetage", "Bauteile"].join(sep);
    const rows = tasks.map(t =>
      [t.name, formatDatum(t.start), formatDatum(t.end), t.typ,
        t.predecessorId ? nummern.get(t.predecessorId) ?? "" : "",
        t.predecessorId ? (t.lagDays ?? 0) : "",
        t.objektGuids.length].join(sep)
    );
    const csv = "\uFEFF" + [header, ...rows].join("\n"); // BOM for Excel
    download(csv, `${simName}_Gantt.csv`, "text/csv;charset=utf-8");
    setOffen(false);
  }

  function exportXml() {
    const nummern = berechneNummern(tasks);
    const tasksXml = tasks.map(t => {
      const vorgLines = t.predecessorId
        ? `\n    <Vorgaenger>${esc(nummern.get(t.predecessorId) ?? "")}</Vorgaenger>\n    <Wartetage>${t.lagDays ?? 0}</Wartetage>`
        : "";
      return `  <Task>\n    <Name>${esc(t.name)}</Name>\n    <Start>${formatDatum(t.start)}</Start>\n    <Finish>${formatDatum(t.end)}</Finish>\n    <Type>${t.typ}</Type>\n    <Objects>${t.objektGuids.length}</Objects>${vorgLines}\n  </Task>`;
    }).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Gantt>\n${tasksXml}\n</Gantt>`;
    download(xml, `${simName}_Gantt.xml`, "application/xml");
    setOffen(false);
  }

  function exportMsProject() {
    const xml = generateMsProjectXml(tasks, simName);
    download(xml, `${simName}_MSProject.xml`, "application/xml");
    setOffen(false);
  }

  function exportJson() {
    const nummern = berechneNummern(tasks);
    const data = tasks.map(t => ({
      name: t.name, start: formatDatum(t.start), end: formatDatum(t.end),
      typ: t.typ, bauteile: t.objektGuids.length, guids: t.objektGuids,
      vorgaenger: t.predecessorId ? nummern.get(t.predecessorId) ?? null : null,
      wartetage: t.predecessorId ? (t.lagDays ?? 0) : null,
    }));
    download(JSON.stringify(data, null, 2), `${simName}_Gantt.json`, "application/json");
    setOffen(false);
  }

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "3px 8px" }}
        onClick={e => { e.stopPropagation(); setOffen(o => !o); }}>
        ↓ Export
      </button>
      {offen && (
        <div style={{
          position: "absolute", right: 0, top: "100%", marginTop: 2, background: "#fff",
          border: "1px solid var(--tc-border)", boxShadow: "0 2px 8px rgba(0,0,0,.12)",
          zIndex: 100, minWidth: 140, fontSize: 11,
        }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eef1f4" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
            onClick={exportXlsx}>📊 Excel (.xlsx)</div>
          <div style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eef1f4" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
            onClick={exportCsv}>📄 CSV (.csv)</div>
          <div style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eef1f4" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
            onClick={exportXml}>📋 Einfaches XML (.xml)</div>
          <div style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid #eef1f4" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
            onClick={exportMsProject}>🗓️ MS Project (.xml)</div>
          <div style={{ padding: "6px 10px", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
            onClick={exportJson}>🔧 JSON (.json)</div>
        </div>
      )}
    </div>
  );
}
