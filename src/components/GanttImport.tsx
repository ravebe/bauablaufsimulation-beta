import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Task, TaskTyp } from "../types";
import { isValidDatum, normalizeDatum } from "../types";

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

  // Datum aus beliebigem Format → YYYY-MM-DD normalisieren
  function parseDatum(v: unknown): string {
    if (typeof v === "number") {
      // Excel Seriennummer → Datum
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const t = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${t}`;
    }
    const s = String(v ?? "").trim();
    if (!s) return "";
    return normalizeDatum(s); // dd.mm.yyyy, yyyy-mm-dd, mm/dd/yyyy → yyyy-mm-dd
  }

  function parseTyp(v: unknown): TaskTyp {
    const s = String(v ?? "").toLowerCase().trim();
    if (s === "bestand") return "bestand";
    if (s === "abbruch") return "abbruch";
    return "neubau";
  }

  // Spaltenname flexibel finden
  function findCol(row: Record<string, unknown>, namen: string[]): unknown {
    for (const n of namen) {
      if (row[n] !== undefined && row[n] !== "") return row[n];
      // Case-insensitive
      const key = Object.keys(row).find(k => k.toLowerCase() === n.toLowerCase());
      if (key && row[key] !== undefined && row[key] !== "") return row[key];
    }
    return undefined;
  }

  // Standard-Spaltennamen die NICHT als Extra gelten
  const STANDARD = new Set(["name","start","ende","end","finish","fertig","anfang","begin","von","bis","typ","type","kategorie","vorgangsname","vorgang","task","bezeichnung"]);

  function extraSpalten(row: Record<string, unknown>): Record<string, string> {
    const extra: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      if (STANDARD.has(key.toLowerCase())) continue;
      const v = String(val ?? "").trim();
      if (v && v !== "null" && v !== "undefined" && v !== "") extra[key] = v;
    }
    return extra;
  }

  function parseXlsx(buf: ArrayBuffer): Task[] {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return rows.map((row, i) => ({
      id: crypto.randomUUID(),
      name: String(findCol(row, ["Name", "name", "Vorgangsname", "Vorgang", "Task", "Bezeichnung"]) ?? `Task ${i + 1}`),
      start: parseDatum(findCol(row, ["Start", "start", "Anfang", "Begin", "Von"])),
      end: parseDatum(findCol(row, ["Ende", "end", "Finish", "Fertig", "Bis", "End"])),
      typ: parseTyp(findCol(row, ["Typ", "typ", "Type", "type", "Kategorie"])),
      objektGuids: [],
      extraSpalten: extraSpalten(row),
    }));
  }

  function parseCsv(text: string): Task[] {
    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return rows.map((row, i) => ({
      id: crypto.randomUUID(),
      name: String(findCol(row, ["Name", "name", "Vorgangsname", "Vorgang", "Task", "Bezeichnung"]) ?? `Task ${i + 1}`),
      start: parseDatum(findCol(row, ["Start", "start", "Anfang", "Begin", "Von"])),
      end: parseDatum(findCol(row, ["Ende", "end", "Finish", "Fertig", "Bis", "End"])),
      typ: parseTyp(findCol(row, ["Typ", "typ", "Type", "type", "Kategorie"])),
      objektGuids: [],
      extraSpalten: extraSpalten(row),
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
        start: parseDatum(g("Start") || g("start") || g("EarlyStart") || ""),
        end: parseDatum(g("Finish") || g("finish") || g("Ende") || g("End") || g("EarlyFinish") || ""),
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
      if (t.end && !isValidDatum(t.end)) errs.push({ zeile: i + 1, name: t.name, feld: "Ende", wert: t.end });
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
      } else if (ext === "csv" || ext === "tsv") {
        const text = await file.text();
        tasks = parseCsv(text);
      } else if (ext === "xml" || ext === "msp") {
        const text = await file.text();
        tasks = parseXml(text);
      } else {
        setMsg("Unterstützte Formate: .xlsx, .xls, .csv, .xml, .msp");
        return;
      }

      if (tasks.length === 0) {
        setMsg("Keine Tasks gefunden");
        return;
      }

      const errs = validiere(tasks);
      setFehler(errs);

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
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.xml,.msp"
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
              ! Zeile {f.zeile} „{f.name}" — {f.feld}: ungültiges Datum „{f.wert}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
