import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Task, TaskTyp } from "../types";
import { isValidDatum, normalizeDatum } from "../types";
import { istMsProjectXml, parseMsProjectXml } from "./msProjectXml";

interface Props {
  onImport: (tasks: Task[], dateiname: string) => void;
  taskCount: number;
  ganttInfo?: { dateiname: string; version: number } | null;
}

interface ImportFehler {
  zeile: number;
  name: string;
  feld: string;
  wert: string;
}

export default function GanttImport({ onImport, taskCount, ganttInfo }: Props) {
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
  const STANDARD = new Set(["name","start","startdatum","ende","enddatum","end","finish","fertig","anfang","begin","von","bis","typ","type","kategorie","vorgangsname","vorgang","task","bezeichnung","vorgänger","vorganger","predecessor","wartetage","lag","lagdays","lag days","kürzel","kuerzel","bauteil-kürzel","bauteil-kuerzel","bauteile"]);
  const VORGAENGER_SPALTEN = ["Vorgänger", "vorgänger", "Vorganger", "Predecessor", "predecessor"];
  const WARTETAGE_SPALTEN = ["Wartetage", "wartetage", "Lag", "lag", "Lag Days", "LagDays"];
  const KUERZEL_SPALTEN = ["Kürzel", "kürzel", "Kuerzel", "kuerzel", "Bauteil-Kürzel", "bauteil-kürzel"];

  // Vorgänger-Spalte (Nummer wie in der App, oder Task-Name) → predecessorId auflösen.
  // Import erzeugt keine Gruppen, daher entspricht die Nummer 1,2,3… exakt der Zeilenreihenfolge
  // (dieselbe Logik wie berechneNummern() für eine reine Task-Liste ohne Gruppen).
  function loeseVorgaenger(rows: { task: Task; vorgRoh: string; lagRoh: string }[]): Task[] {
    const idByNummer = new Map(rows.map((r, i) => [String(i + 1), r.task.id]));
    const idByName = new Map(rows.map(r => [r.task.name.trim().toLowerCase(), r.task.id]));
    return rows.map(r => {
      const roh = r.vorgRoh.trim();
      if (!roh) return r.task;
      const predId = idByNummer.get(roh) ?? idByName.get(roh.toLowerCase());
      if (!predId || predId === r.task.id) return r.task;
      const lag = Number(String(r.lagRoh ?? "0").replace(",", ".")) || 0;
      return { ...r.task, predecessorId: predId, lagDays: lag };
    });
  }

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

    // Cached Werte aus Formelzellen lesen
    function getCachedValue(ws: any, col: string, row: number): string {
      const cell = ws[col + row];
      if (!cell) return "";
      // cell.v = cached value (auch bei Formeln), cell.w = formatted text
      if (cell.v != null) return String(cell.v);
      if (cell.w != null) return String(cell.w);
      return "";
    }

    // Header-Zeile lesen um Spalten-Mapping zu bauen
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const headers: { col: string; name: string }[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const colLetter = XLSX.utils.encode_col(c);
      const headerCell = ws[colLetter + "1"];
      if (headerCell) headers.push({ col: colLetter, name: String(headerCell.v ?? headerCell.w ?? "") });
    }

    function findHeader(namen: string[]): string | null {
      for (const n of namen) {
        const h = headers.find(h => h.name.toLowerCase() === n.toLowerCase());
        if (h) return h.col;
      }
      return null;
    }

    const nameCol = findHeader(["Name", "Vorgangsname", "Vorgang", "Task", "Bezeichnung"]);
    const startCol = findHeader(["Start", "Startdatum", "Anfang", "Begin", "Von"]);
    const endCol = findHeader(["Ende", "Enddatum", "End", "Finish", "Fertig", "Bis"]);
    const typCol = findHeader(["Typ", "Type", "Kategorie"]);
    const vorgCol = findHeader(VORGAENGER_SPALTEN);
    const lagCol = findHeader(WARTETAGE_SPALTEN);
    const kuerzelCol = findHeader(KUERZEL_SPALTEN);

    const rows: { task: Task; vorgRoh: string; lagRoh: string }[] = [];
    for (let r = 2; r <= range.e.r + 1; r++) {
      const name = nameCol ? getCachedValue(ws, nameCol, r) : "";
      if (!name.trim()) continue;

      const startRaw = startCol ? getCachedValue(ws, startCol, r) : "";
      const endRaw = endCol ? getCachedValue(ws, endCol, r) : "";
      // Excel Seriennummer oder Text
      const startCell = startCol ? ws[startCol + r] : null;
      const endCell = endCol ? ws[endCol + r] : null;

      const extra: Record<string, string> = {};
      for (const h of headers) {
        if (STANDARD.has(h.name.toLowerCase())) continue;
        const v = getCachedValue(ws, h.col, r);
        if (v && v !== "null" && v !== "undefined") extra[h.name] = v;
      }

      rows.push({
        task: {
          id: crypto.randomUUID(),
          name,
          start: parseDatum(startCell?.v ?? startRaw),
          end: parseDatum(endCell?.v ?? endRaw),
          typ: parseTyp(typCol ? getCachedValue(ws, typCol, r) : "neubau"),
          objektGuids: [],
          bauteilKuerzel: kuerzelCol ? (getCachedValue(ws, kuerzelCol, r).trim() || undefined) : undefined,
          extraSpalten: Object.keys(extra).length > 0 ? extra : undefined,
        },
        vorgRoh: vorgCol ? getCachedValue(ws, vorgCol, r) : "",
        lagRoh: lagCol ? getCachedValue(ws, lagCol, r) : "0",
      });
    }
    return loeseVorgaenger(rows);
  }

  function parseCsv(text: string): Task[] {
    const wb = XLSX.read(text, { type: "string", cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const rows = rawRows.map((row, i) => ({
      task: {
        id: crypto.randomUUID(),
        name: String(findCol(row, ["Name", "name", "Vorgangsname", "Vorgang", "Task", "Bezeichnung"]) ?? `Task ${i + 1}`),
        start: parseDatum(findCol(row, ["Start", "start", "Startdatum", "startdatum", "Anfang", "Begin", "Von"])),
        end: parseDatum(findCol(row, ["Ende", "end", "Enddatum", "enddatum", "Finish", "Fertig", "Bis", "End"])),
        typ: parseTyp(findCol(row, ["Typ", "typ", "Type", "type", "Kategorie"])),
        objektGuids: [] as string[],
        bauteilKuerzel: String(findCol(row, KUERZEL_SPALTEN) ?? "").trim() || undefined,
        extraSpalten: extraSpalten(row),
      },
      vorgRoh: String(findCol(row, VORGAENGER_SPALTEN) ?? ""),
      lagRoh: String(findCol(row, WARTETAGE_SPALTEN) ?? "0"),
    })).filter(r => r.task.name.trim() !== "");
    return loeseVorgaenger(rows);
  }

  const XML_STANDARD_TAGS = new Set(["name","start","earlystart","finish","end","ende","typ","type","kuerzel","kürzel","objects","bauteile","vorgaenger","vorgänger","predecessor","wartetage","lag"]);

  function parseXml(text: string): Task[] {
    if (istMsProjectXml(text)) return parseMsProjectXml(text);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const rows: { task: Task; vorgRoh: string; lagRoh: string }[] = [];
    doc.querySelectorAll("Task, task").forEach((el, i) => {
      const g = (tag: string) => el.querySelector(tag)?.textContent?.trim() ?? "";
      const extra: Record<string, string> = {};
      for (const child of Array.from(el.children)) {
        if (XML_STANDARD_TAGS.has(child.tagName.toLowerCase())) continue;
        const v = (child.textContent ?? "").trim();
        if (v) extra[child.tagName] = v;
      }
      rows.push({
        task: {
          id: crypto.randomUUID(),
          name: g("Name") || g("name") || `Task ${i + 1}`,
          start: parseDatum(g("Start") || g("start") || g("EarlyStart") || ""),
          end: parseDatum(g("Finish") || g("finish") || g("Ende") || g("End") || g("EarlyFinish") || ""),
          typ: parseTyp(g("Typ") || g("typ") || g("Type") || "neubau"),
          objektGuids: [],
          bauteilKuerzel: (g("Kuerzel") || g("Kürzel") || g("kuerzel")) || undefined,
          extraSpalten: Object.keys(extra).length > 0 ? extra : undefined,
        },
        vorgRoh: g("Vorgaenger") || g("Vorgänger") || g("Predecessor") || "",
        lagRoh: g("Wartetage") || g("Lag") || "0",
      });
    });
    return loeseVorgaenger(rows);
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
      } else if (ext === "mpp") {
        setMsg(".mpp wird nicht unterstützt — bitte in MS Project über Datei → Speichern unter → XML-Format exportieren und diese Datei importieren.");
        return;
      } else {
        setMsg("Unterstützte Formate: .xlsx, .xls, .csv, .xml (auch MS-Project-XML)");
        return;
      }

      if (tasks.length === 0) {
        setMsg("Keine Tasks gefunden");
        return;
      }

      const errs = validiere(tasks);
      setFehler(errs);

      onImport(tasks, file.name);
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

  const punkt = ganttInfo ? ganttInfo.dateiname.lastIndexOf(".") : -1;
  const ganttName = ganttInfo ? (punkt > 0 ? ganttInfo.dateiname.slice(0, punkt) : ganttInfo.dateiname) : "";
  const ganttExt = ganttInfo && punkt > 0 ? ganttInfo.dateiname.slice(punkt) : "";

  return (
    <div>
      <div className={ganttInfo ? "gantt-upload-row" : undefined}>
        <label
          className="gantt-upload"
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <span className="gantt-upload-text">xlsx, xml oder MS-Project-XML importieren</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.xml,.msp,.mpp"
            style={{ display: "none" }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>

        {ganttInfo && (
          <div className="gantt-info-box" title={ganttInfo.dateiname}>
            <span className="gantt-info-name">{ganttName}<span className="gantt-info-ext">{ganttExt}</span></span>
            <span className="gantt-info-version">Version {ganttInfo.version}</span>
          </div>
        )}
      </div>

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