import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Task, TaskTyp, isValidDatum } from "../types";

interface Props {
  onImport: (tasks: Task[]) => void;
  taskCount: number;
}

interface ImportFehler {
  zeile: number;
  name: string;
  feld: string;
  wert: string;
}

export default function GanttImport({ onImport, taskCount }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fehler, setFehler] = useState<ImportFehler[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // Excel Seriennummer → YYYY-MM-DD
  function excelDatum(v: unknown): string {
    if (typeof v === "number") {
      // Excel epoch: 1899-12-30
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const t = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${t}`;
    }
    if (typeof v === "string") return v.trim();
    return String(v ?? "");
  }

  function parseTyp(v: unknown): TaskTyp {
    const s = String(v ?? "").toLowerCase().trim();
    if (s === "bestand") return "bestand";
    if (s === "abbruch") return "abbruch";
    return "neubau";
  }

  function parseXlsx(buf: ArrayBuffer): Task[] {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return rows.map((row, i) => ({
      id: crypto.randomUUID(),
      name: String(row["Name"] ?? row["name"] ?? row["Vorgangsname"] ?? `Task ${i + 1}`),
      start: excelDatum(row["Start"] ?? row["start"] ?? row["Anfang"] ?? ""),
      end: excelDatum(row["Ende"] ?? row["end"] ?? row["Finish"] ?? row["Fertig"] ?? ""),
      typ: parseTyp(row["Typ"] ?? row["typ"] ?? row["Type"] ?? "neubau"),
      objektGuids: [],
    }));
  }

  function parseXml(text: string): Task[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const tasks: Task[] = [];
    doc.querySelectorAll("Task, task").forEach((el, i) => {
      const g = (tag: string) => el.querySelector(tag)?.textContent?.trim() ?? "";
      tasks.push({
        id: crypto.randomUUID(),
        name: g("Name") || g("name") || `Task ${i + 1}`,
        start: g("Start") || g("start") || g("EarlyStart") || "",
        end: g("Finish") || g("finish") || g("Ende") || g("End") || "",
        typ: parseTyp(g("Typ") || g("typ") || g("Type") || "neubau"),
        objektGuids: [],
      });
    });
    return tasks;
  }

  function validiere(tasks: Task[]): ImportFehler[] {
    const errs: ImportFehler[] = [];
    tasks.forEach((t, i) => {
      if (!isValidDatum(t.start)) errs.push({ zeile: i + 1, name: t.name, feld: "Start", wert: t.start });
      if (!isValidDatum(t.end)) errs.push({ zeile: i + 1, name: t.name, feld: "Ende", wert: t.end });
    });
    return errs;
  }

  async function handleFile(file: File) {
    setFehler([]);
    setMsg(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let tasks: Task[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        tasks = parseXlsx(buf);
      } else if (ext === "xml") {
        const text = await file.text();
        tasks = parseXml(text);
      } else {
        setMsg("Nur .xlsx oder .xml Dateien");
        return;
      }

      if (tasks.length === 0) {
        setMsg("Keine Tasks gefunden");
        return;
      }

      const errs = validiere(tasks);
      setFehler(errs);

      // Ungültige Tasks trotzdem importieren, aber markieren
      onImport(tasks);
      setMsg(`${tasks.length} Tasks importiert${errs.length > 0 ? ` · ${errs.length} Datumsfehler` : ""}`);
    } catch (e) {
      setMsg(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div>
      <label
        className="gantt-upload"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="gantt-upload-icon">📂</span>
        <span className="gantt-upload-text">xlsx oder xml importieren</span>
        <span className="gantt-upload-hint">Klicken oder Datei hierher ziehen</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xml"
          style={{ display: "none" }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {taskCount > 0 && !msg && (
        <div className="alert ok" style={{ marginTop: 5 }}>✓ {taskCount} Tasks geladen</div>
      )}

      {msg && (
        <div className={`alert ${fehler.length > 0 ? "err" : "ok"}`} style={{ marginTop: 5 }}>
          {fehler.length > 0 ? "⚠" : "✓"} {msg}
        </div>
      )}

      {fehler.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {fehler.map((f, i) => (
            <div key={i} className="alert err" style={{ fontSize: 9, marginTop: 3 }}>
              ! Zeile {f.zeile} „{f.name}" — {f.feld}: ungültiges Datum „{f.wert}" (erwartet YYYY-MM-DD)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
