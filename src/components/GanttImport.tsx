import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Task, TaskTyp } from "../types";
import { isValidDatum, normalizeDatum } from "../types";
import { istMsProjectXml, parseMsProjectXml } from "./msProjectXml";
import { baueImportTasks, leseGruppenFlag } from "./ganttTabelle";
import type { ImportZeile } from "./ganttTabelle";

interface Props {
  onImport: (tasks: Task[], dateiname: string) => void;
  taskCount: number;
  ganttInfo?: { dateiname: string; version: number } | null;
  /** "x Tasks geladen" nur zeigen, wenn per Klick auf den geladenen Gantt aufgeklappt (ohne Gantt immer) */
  detailsOffen?: boolean;
  onInfoKlick?: () => void;
}

interface ImportFehler {
  zeile: number;
  name: string;
  feld: string;
  wert: string;
}

export default function GanttImport({ onImport, taskCount, ganttInfo, detailsOffen, onInfoKlick }: Props) {
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
    if (s === "temporaer" || s === "temporär" || s === "bauhilfsmassnahme" || s === "bauhilfsmaßnahme") return "temporaer";
    if (s === "baustelleneinrichtung") return "baustelleneinrichtung";
    if (s === "drittprojekt") return "drittprojekt";
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
  const STANDARD = new Set(["name","start","startdatum","ende","enddatum","end","finish","fertig","anfang","begin","von","bis","typ","type","kategorie","vorgangsname","vorgang","task","bezeichnung","vorgänger","vorganger","predecessor","wartetage","lag","lagdays","lag days","kürzel","kuerzel","bauteil-kürzel","bauteil-kuerzel","bauteile","nr","nr.","nummer","gruppe","ebene","gliederungsebene","outlinelevel","reihenfolge","gantt-reihenfolge"]);
  const VORGAENGER_SPALTEN = ["Vorgänger", "vorgänger", "Vorganger", "Predecessor", "predecessor"];
  const WARTETAGE_SPALTEN = ["Wartetage", "wartetage", "Lag", "lag", "Lag Days", "LagDays"];
  const KUERZEL_SPALTEN = ["Kürzel", "kürzel", "Kuerzel", "kuerzel", "Bauteil-Kürzel", "bauteil-kürzel"];
  // Gruppen/Untergruppen + Nummer, auf die sich "Vorgänger" bezieht — ausgewertet in baueImportTasks() (ganttTabelle.ts)
  const NR_SPALTEN = ["Nr", "Nr.", "Nummer"];
  const GRUPPE_SPALTEN = ["Gruppe"];
  const EBENE_SPALTEN = ["Ebene", "Gliederungsebene", "OutlineLevel"];
  // Position im Gantt — stellt beim Import die Reihenfolge wieder her, auch wenn die Datei in Excel umsortiert wurde
  const REIHENFOLGE_SPALTEN = ["Gantt-Reihenfolge", "Reihenfolge"];

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
    const nrCol = findHeader(NR_SPALTEN);
    const gruppeCol = findHeader(GRUPPE_SPALTEN);
    const ebeneCol = findHeader(EBENE_SPALTEN);
    const reihenCol = findHeader(REIHENFOLGE_SPALTEN);

    const rows: ImportZeile[] = [];
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
        nrRoh: nrCol ? getCachedValue(ws, nrCol, r) : "",
        gruppeRoh: gruppeCol ? getCachedValue(ws, gruppeCol, r) : "",
        ebeneRoh: ebeneCol ? getCachedValue(ws, ebeneCol, r) : "",
        reihenfolgeRoh: reihenCol ? getCachedValue(ws, reihenCol, r) : "",
      });
    }
    return baueImportTasks(rows);
  }

  function parseCsv(text: string): Task[] {
    const wb = XLSX.read(text, { type: "string", cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const rows: ImportZeile[] = rawRows.map((row, i) => ({
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
      nrRoh: String(findCol(row, NR_SPALTEN) ?? ""),
      gruppeRoh: findCol(row, GRUPPE_SPALTEN) ?? "",
      ebeneRoh: String(findCol(row, EBENE_SPALTEN) ?? ""),
      reihenfolgeRoh: String(findCol(row, REIHENFOLGE_SPALTEN) ?? ""),
    })).filter(r => r.task.name.trim() !== "");
    return baueImportTasks(rows);
  }

  const XML_STANDARD_TAGS = new Set(["name","start","earlystart","finish","end","ende","typ","type","kuerzel","kürzel","objects","bauteile","vorgaenger","vorgänger","predecessor","wartetage","lag","nr","gruppe","ebene","reihenfolge","gantt_reihenfolge"]);

  function parseXml(text: string): Task[] {
    if (istMsProjectXml(text)) return parseMsProjectXml(text);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const rows: ImportZeile[] = [];
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
        nrRoh: g("Nr"),
        gruppeRoh: g("Gruppe"),
        ebeneRoh: g("Ebene"),
        reihenfolgeRoh: g("Gantt_Reihenfolge") || g("Reihenfolge"),
      });
    });
    return baueImportTasks(rows);
  }

  // JSON aus dem eigenen Export (Array von Tasks, oder { tasks: [...] })
  const JSON_STANDARD = new Set(["reihenfolge", "gantt_reihenfolge", "nr", "gruppe", "ebene", "name", "start", "end", "ende", "typ", "kuerzel", "bauteile", "guids", "vorgaenger", "wartetage"]);

  function parseJson(text: string): Task[] {
    const roh: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // BOM entfernen
    const liste = Array.isArray(roh) ? roh : (roh as { tasks?: unknown })?.tasks;
    if (!Array.isArray(liste)) throw new Error("JSON enthält keine Task-Liste");
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    const rows: ImportZeile[] = liste.filter(o => o && typeof o === "object").map((o: Record<string, unknown>, i) => {
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        if (JSON_STANDARD.has(k.toLowerCase()) || v === null || typeof v === "object") continue;
        if (s(v).trim()) extra[k] = s(v).trim();
      }
      const istGrp = leseGruppenFlag(o.gruppe) === true;
      return {
        task: {
          id: crypto.randomUUID(),
          name: s(o.name) || `Task ${i + 1}`,
          start: parseDatum(o.start),
          end: parseDatum(o.end ?? o.ende),
          typ: parseTyp(o.typ),
          objektGuids: !istGrp && Array.isArray(o.guids) ? o.guids.map(String) : [],
          bauteilKuerzel: s(o.kuerzel).trim() || undefined,
          extraSpalten: Object.keys(extra).length > 0 ? extra : undefined,
        },
        vorgRoh: s(o.vorgaenger),
        lagRoh: s(o.wartetage) || "0",
        nrRoh: s(o.nr),
        gruppeRoh: o.gruppe ?? "",
        ebeneRoh: s(o.ebene),
        reihenfolgeRoh: s(o.gantt_reihenfolge ?? o.reihenfolge),
      };
    });
    return baueImportTasks(rows);
  }

  function validiere(tasks: Task[]): ImportFehler[] {
    const errs: ImportFehler[] = [];
    tasks.forEach((t, i) => {
      if (t.isGroup) return; // Termine von Gruppen ergeben sich aus ihren Tasks
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
      } else if (ext === "json") {
        tasks = parseJson(await file.text());
      } else if (ext === "mpp") {
        setMsg(".mpp wird nicht unterstützt — bitte in MS Project über Datei → Speichern unter → XML-Format exportieren und diese Datei importieren.");
        return;
      } else {
        setMsg("Unterstützte Formate: .xlsx, .xls, .csv, .xml (auch MS-Project-XML), .json");
        return;
      }

      if (tasks.length === 0) {
        setMsg("Keine Tasks gefunden");
        return;
      }

      const errs = validiere(tasks);
      setFehler(errs);

      onImport(tasks, file.name);
      const gruppen = tasks.filter(t => t.isGroup).length;
      setMsg(`${tasks.length - gruppen} Tasks${gruppen > 0 ? ` in ${gruppen} Gruppen` : ""} importiert${errs.length > 0 ? ` · ${errs.length} Datumsfehler` : ""}`);
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
          <span className="gantt-upload-text">xlsx, csv, xml, json oder MS-Project-XML importieren</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.xml,.msp,.mpp,.json"
            style={{ display: "none" }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>

        {ganttInfo && (
          <div className={`gantt-info-box klickbar${detailsOffen ? " offen" : ""}`} title={ganttInfo.dateiname} onClick={onInfoKlick}>
            <span className="gantt-info-name">{ganttName}<span className="gantt-info-ext">{ganttExt}</span></span>
            <span className="gantt-info-version">Version {ganttInfo.version}</span>
          </div>
        )}
      </div>

      {taskCount > 0 && !msg && (!ganttInfo || detailsOffen) && (
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