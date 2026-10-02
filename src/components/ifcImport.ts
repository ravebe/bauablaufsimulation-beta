// ifcImport.ts — liest einen in der IFC-Datei hinterlegten Bauablauf (IfcTask & Co.) zurück in Tasks der
// Simulation — Gegenstück zu ifcExport.ts, versteht aber auch 4D-Daten anderer Programme:
//  IFC4:   IfcTask + IfcTaskTime, IfcRelNests, IfcRelSequence (+ IfcLagTime), Bauteile über
//          IfcRelAssignsToProduct (Output) und IfcRelAssignsToProcess (Input), IfcWorkCalendar
//  IFC2X3: IfcTask, Termine über IfcRelAssignsTasks → IfcScheduleTimeControl (IfcDateAndTime/
//          IfcCalendarDate), IfcRelNests, IfcRelSequence (TimeLag in Sekunden), IfcRelAssignsToProcess
// Zusätzlich das Vorgangs-Pset "Bauablauf_Vorgang" (Kürzel, Bauphase, Kran, Personal) aus dem Export.
// Bauteile kommen als IFC-GUIDs zurück — die Umsetzung in Viewer-Runtime-IDs macht der Aufrufer.
import type { Task, TaskTyp, Kran } from "../types";
import type { Kalender, Feiertag, Ferienzeitraum } from "./kalenderHelpers";
import { erkenneIfcSchema } from "./ifcExport";
import type { IfcSchemaFamilie } from "./ifcExport";

/** Schnelltest auf dem Dateiende (z.B. letzte 1–2 MB): unsere angehängten 4D-Daten liegen dort. */
export function enthaeltBauablauf(text: string): boolean {
  return /IFC(TASK|WORKSCHEDULE|RELASSIGNSTOPROCESS|RELASSIGNSTASKS|RELSEQUENCE)\s*\(/i.test(text)
    || text.includes("'Bauablauf_Vorgang'") || text.includes("'Bauablauf'");
}

// --- STEP-Hilfen ---
/** STEP-String-Literal (ohne äussere Hochkommas) → Text: '' , \X2\…\X0\, \X4\…\X0\, \X\hh, \S\c */
export function stepTextLesen(s: string): string {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_, h: string) => String.fromCharCode(...h.match(/.{4}/g)!.map(x => parseInt(x, 16))))
    .replace(/\\X4\\((?:[0-9A-Fa-f]{8})+)\\X0\\/g, (_, h: string) => String.fromCodePoint(...h.match(/.{8}/g)!.map(x => parseInt(x, 16))))
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, "\\");
}

/** Argumentliste auf oberster Ebene trennen (Strings und Klammern beachten) */
function args(a: string): string[] {
  const out: string[] = [];
  let tiefe = 0, inStr = false, cur = "";
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    if (inStr) {
      cur += c;
      if (c === "'") { if (a[i + 1] === "'") { cur += "'"; i++; } else inStr = false; }
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === "(") tiefe++;
    else if (c === ")") tiefe--;
    if (c === "," && tiefe === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
const refsIn = (s: string | undefined) => s ? [...s.matchAll(/#(\d+)/g)].map(m => Number(m[1])) : [];
const ref1 = (s: string | undefined) => refsIn(s)[0];
const str = (s: string | undefined) => { const m = s?.match(/^'([\s\S]*)'$/); return m ? stepTextLesen(m[1]) : undefined; };
/** Wert aus IFCLABEL('x') / IFCINTEGER(5) / 'x' / 5. */
function wert(s: string | undefined): string | undefined {
  if (!s || s === "$") return undefined;
  const typed = s.match(/^[A-Z0-9_]+\(([\s\S]*)\)$/i);
  const inner = typed ? typed[1].trim() : s;
  return str(inner) ?? inner.replace(/\.$/, "");
}

type Ent = { typ: string; a: string };

/** Alle Entitäten der gewünschten Typen (bzw. IDs) — ein Regex-Durchlauf über die Datei */
function scan(text: string, nimm: (id: number, typ: string, a: string) => boolean): Map<number, Ent> {
  const out = new Map<number, Ent>();
  const re = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;(?=\s*(?:#\d+\s*=|ENDSEC;|\/\*))/g;
  for (const m of text.matchAll(re)) {
    const id = Number(m[1]), typ = m[2].toUpperCase();
    if (nimm(id, typ, m[3])) out.set(id, { typ, a: m[3] });
  }
  return out;
}

const TYPEN = new Set([
  "IFCTASK", "IFCTASKTIME", "IFCSCHEDULETIMECONTROL", "IFCRELASSIGNSTASKS", "IFCRELNESTS", "IFCRELSEQUENCE",
  "IFCLAGTIME", "IFCRELASSIGNSTOPROCESS", "IFCRELASSIGNSTOPRODUCT", "IFCWORKSCHEDULE", "IFCWORKPLAN",
  "IFCWORKCALENDAR", "IFCWORKTIME", "IFCDATEANDTIME", "IFCCALENDARDATE", "IFCRELASSIGNSTOCONTROL",
]);

const TYP_AUS_LABEL: Record<string, TaskTyp> = {
  neubau: "neubau", bestand: "bestand", abbruch: "abbruch", bauhilfsmassnahme: "temporaer", "bauhilfsmaßnahme": "temporaer",
  temporaer: "temporaer", baustelleneinrichtung: "baustelleneinrichtung", drittprojekt: "drittprojekt",
};
const TYP_AUS_ENUM: Record<string, TaskTyp> = {
  CONSTRUCTION: "neubau", INSTALLATION: "neubau", RENOVATION: "neubau",
  DEMOLITION: "abbruch", DISMANTLE: "abbruch", REMOVAL: "abbruch", DISPOSAL: "abbruch",
  LOGISTIC: "baustelleneinrichtung", MOVE: "baustelleneinrichtung",
};

export interface IfcImportErgebnis {
  schema: string;
  familie: IfcSchemaFamilie;
  terminplanName?: string;
  tasks: Task[];
  /** taskId → IFC-GlobalIds der zugeordneten Bauteile */
  bauteilGuids: Map<string, string[]>;
  kalender?: Kalender;
  kraene: Kran[];
}

export function leseBauablaufAusIfc(text: string, neueId: () => string = () => crypto.randomUUID()): IfcImportErgebnis {
  const { familie, roh } = erkenneIfcSchema(text);
  if (!familie) throw new Error(roh ? `IFC-Schema "${roh}" wird nicht unterstützt.` : "Keine gültige IFC-Datei.");
  const ist4 = familie === "IFC4";

  // 1. Prozess-Entitäten
  const e = scan(text, (_, typ) => TYPEN.has(typ));
  const tasksE = [...e].filter(([, x]) => x.typ === "IFCTASK").sort((a, b) => a[0] - b[0]);
  if (tasksE.length === 0) throw new Error("In dieser IFC-Datei ist kein Bauablauf (IfcTask) hinterlegt.");
  const taskIds = new Set(tasksE.map(([id]) => id));

  // Datum aus IFC4-String oder IFC2X3-IfcDateAndTime/IfcCalendarDate
  const datum = (s: string | undefined): string | undefined => {
    const t = str(s);
    if (t) return t.slice(0, 10);
    const r = e.get(ref1(s) ?? -1);
    if (r?.typ === "IFCDATEANDTIME") return datum(args(r.a)[0]);
    if (r?.typ === "IFCCALENDARDATE") {
      const [d, m, y] = args(r.a).map(Number);
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return undefined;
  };

  // 2. Termine
  const termin = new Map<number, { start?: string; ende?: string }>();
  if (ist4) {
    for (const [id, t] of tasksE) {
      const tt = e.get(ref1(args(t.a)[11]) ?? -1);
      if (tt?.typ === "IFCTASKTIME") { const a = args(tt.a); termin.set(id, { start: datum(a[5]), ende: datum(a[6]) }); }
    }
  } else {
    for (const [, r] of e) {
      if (r.typ !== "IFCRELASSIGNSTASKS") continue;
      const a = args(r.a);
      const tc = e.get(ref1(a[7]) ?? -1);
      if (!tc) continue;
      const ta = args(tc.a);
      for (const tid of refsIn(a[4])) termin.set(tid, { start: datum(ta[8]), ende: datum(ta[12]) });
    }
  }

  // 3. Hierarchie, Vorgänger, Bauteile
  const kinder = new Map<number, number[]>();
  const hatEltern = new Set<number>();
  const vorg = new Map<number, { pred: number; lag: number }>();
  const bauteilRefs = new Map<number, number[]>();
  const add = (tid: number, el: number) => { if (!bauteilRefs.has(tid)) bauteilRefs.set(tid, []); bauteilRefs.get(tid)!.push(el); };
  let terminplanName: string | undefined;
  let kalenderE: Ent | undefined;
  for (const [, r] of e) {
    const a = args(r.a);
    if (r.typ === "IFCRELNESTS" && taskIds.has(ref1(a[4]))) {
      const ks = refsIn(a[5]).filter(k => taskIds.has(k));
      kinder.set(ref1(a[4]), [...(kinder.get(ref1(a[4])) ?? []), ...ks]);
      ks.forEach(k => hatEltern.add(k));
    } else if (r.typ === "IFCRELSEQUENCE") {
      let lag = 0;
      if (ist4) {
        const lt = e.get(ref1(a[6]) ?? -1);
        const d = lt ? wert(args(lt.a)[3])?.match(/^(-?)P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?/) : null;
        if (d) lag = (d[1] ? -1 : 1) * (Number(d[2] ?? 0) * 7 + Number(d[3] ?? 0));
      } else {
        lag = Math.round(Number(wert(a[6]) ?? 0) / 86400);
      }
      vorg.set(ref1(a[5]), { pred: ref1(a[4]), lag });
    } else if (r.typ === "IFCRELASSIGNSTOPROCESS" && taskIds.has(ref1(a[6]))) {
      refsIn(a[4]).forEach(el => add(ref1(a[6]), el));
    } else if (r.typ === "IFCRELASSIGNSTOPRODUCT") {
      refsIn(a[4]).filter(t => taskIds.has(t)).forEach(t => add(t, ref1(a[6])));
    } else if (r.typ === "IFCWORKSCHEDULE" && !terminplanName) {
      terminplanName = str(a[2]);
    } else if (r.typ === "IFCWORKCALENDAR" && !kalenderE) {
      kalenderE = r;
    }
  }

  // 4. GUIDs der Bauteile + Vorgangs-Psets (zweiter Durchlauf nur für die benötigten IDs)
  const elIds = new Set([...bauteilRefs.values()].flat());
  const relDefs = scan(text, (id, typ, a) => elIds.has(id)
    || (typ === "IFCRELDEFINESBYPROPERTIES" && refsIn(args(a)[4]).some(t => taskIds.has(t))));
  const guidVon = new Map<number, string>();
  const psetVonTask = new Map<number, number>();
  for (const [id, x] of relDefs) {
    if (x.typ === "IFCRELDEFINESBYPROPERTIES") {
      const a = args(x.a);
      for (const t of refsIn(a[4])) if (taskIds.has(t)) psetVonTask.set(t, ref1(a[5]));
    } else {
      const g = x.a.match(/^\s*'([0-9A-Za-z_$]{22})'/);
      if (g) guidVon.set(id, g[1]);
    }
  }
  const psetIds = new Set(psetVonTask.values());
  const psets = scan(text, (id, typ) => psetIds.has(id) && typ === "IFCPROPERTYSET");
  const propIds = new Set([...psets.values()].flatMap(p => refsIn(args(p.a)[4])));
  const props = scan(text, (id, typ) => propIds.has(id) && typ === "IFCPROPERTYSINGLEVALUE");
  const psetWerte = (tid: number): Record<string, string> => {
    const p = psets.get(psetVonTask.get(tid) ?? -1);
    if (!p || str(args(p.a)[2]) !== "Bauablauf_Vorgang") return {};
    const r: Record<string, string> = {};
    for (const pid of refsIn(args(p.a)[4])) {
      const v = props.get(pid);
      if (!v) continue;
      const a = args(v.a);
      const name = str(a[0]), w = wert(a[2]);
      if (name && w !== undefined) r[name] = w;
    }
    return r;
  };

  // 5. Reihenfolge: Tiefensuche ab den obersten Tasks (je Ebene in Datei-Reihenfolge)
  const reihenfolge: { id: number; level: number }[] = [];
  const besucht = new Set<number>();
  const besuche = (id: number, level: number) => {
    if (besucht.has(id)) return;
    besucht.add(id);
    reihenfolge.push({ id, level });
    for (const k of [...(kinder.get(id) ?? [])].sort((a, b) => a - b)) besuche(k, level + 1);
  };
  for (const [id] of tasksE) if (!hatEltern.has(id)) besuche(id, 1);
  for (const [id] of tasksE) besuche(id, 1); // Zyklen/Reste

  const kraene: Kran[] = [];
  const kranId = (name: string) => {
    let k = kraene.find(x => x.name === name);
    if (!k) { k = { id: neueId(), name }; kraene.push(k); }
    return k.id;
  };
  const idVon = new Map<number, string>();
  for (const { id } of reihenfolge) idVon.set(id, neueId());

  const heute = new Date().toISOString().slice(0, 10);
  const tasks: Task[] = [];
  const bauteilGuids = new Map<string, string[]>();
  for (const { id, level } of reihenfolge) {
    const a = args(e.get(id)!.a);
    const objType = str(a[4]) ?? "";
    const enumTyp = ist4 ? a[12]?.replace(/\./g, "") : undefined;
    const gruppe = (kinder.get(id)?.length ?? 0) > 0;
    const typ = TYP_AUS_LABEL[objType.toLowerCase()] ?? TYP_AUS_ENUM[enumTyp ?? ""] ?? "neubau";
    const t = termin.get(id) ?? {};
    const pw = psetWerte(id);
    const v = vorg.get(id);
    const task: Task = {
      id: idVon.get(id)!,
      name: str(a[2]) || "Vorgang",
      start: t.start ?? t.ende ?? heute,
      end: t.ende ?? t.start ?? heute,
      typ,
      objektGuids: [],
      outlineLevel: level,
      ...(gruppe ? { isGroup: true } : {}),
      ...(v && idVon.has(v.pred) ? { predecessorId: idVon.get(v.pred), lagDays: v.lag } : {}),
      ...(pw.Kuerzel ? { bauteilKuerzel: pw.Kuerzel } : {}),
      ...(pw.Bauphase ? { kranbereich: pw.Bauphase } : {}),
      ...(pw.Kran ? { kraene: pw.Kran.split(" | ").filter(Boolean).map(kranId) } : {}),
      ...(pw.Personal_Soll && !isNaN(Number(pw.Personal_Soll)) ? { personalSoll: Number(pw.Personal_Soll) } : {}),
    };
    tasks.push(task);
    const guids = [...new Set((bauteilRefs.get(id) ?? []).map(el => guidVon.get(el)).filter((g): g is string => !!g))];
    if (guids.length) bauteilGuids.set(task.id, guids);
  }

  // 6. Kalender (nur IFC4): Ausnahmen → eintägig = Feiertag, mehrtägig = Ferien
  let kalender: Kalender | undefined;
  if (kalenderE) {
    const ausnahmen = refsIn(args(kalenderE.a)[7]);
    const wt = scan(text, (id, typ) => typ === "IFCWORKTIME" && ausnahmen.includes(id));
    const feiertage: Feiertag[] = [], ferien: Ferienzeitraum[] = [];
    for (const x of wt.values()) {
      const a = args(x.a);
      const name = str(a[0]) ?? "", von = str(a[4]), bis = str(a[5]) ?? von;
      if (!von || !bis) continue;
      if (von === bis) feiertage.push({ datum: von, name }); else ferien.push({ von, bis, name });
    }
    if (feiertage.length || ferien.length) kalender = { feiertage, ferien };
  }

  return { schema: roh, familie, terminplanName, tasks, bauteilGuids, kalender, kraene };
}
