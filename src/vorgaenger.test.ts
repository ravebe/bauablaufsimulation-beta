import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import { berechneNummern, kaskadiereNachfolger, mitVorgaengern, parseVorgaengerText, vorgaengerListe, vorgaengerStart, vorgaengerText,
  massgebenderVorgaenger, istZirkular, letzterVorgaengerEintrag, ersetzeLetztenVorgaengerEintrag, MAX_VORGAENGER } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import { exportZeilen, baueImportTasks } from "./components/ganttTabelle";
import type { ImportZeile } from "./components/ganttTabelle";
import { generateMsProjectXml } from "./components/msProjectXml";

const KAL: Kalender = { feiertage: [], ferien: [] };
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });

// A: Mo 9.11.–Di 10.11., B: Mo 9.11.–Do 12.11., C hat A und B als Vorgänger
const plan = () => [
  task("A", "2026-11-09", "2026-11-10"),
  task("B", "2026-11-09", "2026-11-12"),
  task("C", "2026-11-09", "2026-11-10"),
];

describe("mehrere Vorgänger", () => {
  it("mitVorgaengern / vorgaengerListe: erster in predecessorId, Rest in weitereVorgaenger, ohne Doppelte und ohne sich selbst", () => {
    const c = mitVorgaengern(plan()[2], [{ id: "A", lagDays: 0 }, { id: "B", lagDays: 2 }, { id: "A", lagDays: 5 }, { id: "C", lagDays: 0 }]);
    expect(c.predecessorId).toBe("A");
    expect(c.weitereVorgaenger).toEqual([{ id: "B", lagDays: 2 }]);
    expect(vorgaengerListe(c)).toEqual([{ id: "A", lagDays: 0 }, { id: "B", lagDays: 2 }]);
    expect(mitVorgaengern(c, []).predecessorId).toBeUndefined();
  });
  it("höchstens 30 Vorgänger", () => {
    const viele = Array.from({ length: 35 }, (_, i) => ({ id: `P${i}`, lagDays: 0 }));
    expect(vorgaengerListe(mitVorgaengern(task("X", "2026-11-09", "2026-11-09"), viele))).toHaveLength(MAX_VORGAENGER);
  });
  it("Start = spätester Folge-Start aller Vorgänger, Kaskade richtet danach aus", () => {
    const tasks = plan().map(t => t.id === "C" ? mitVorgaengern(t, [{ id: "A", lagDays: 0 }, { id: "B", lagDays: 0 }]) : t);
    expect(vorgaengerStart(tasks, tasks[2], KAL)).toEqual({ datum: "2026-11-13", min: 480 });             // nach B (Do) → Fr
    expect(massgebenderVorgaenger(tasks, tasks[2], KAL)).toBe("B");
    const r = kaskadiereNachfolger(tasks, "A", KAL);
    expect(r[2]).toMatchObject({ start: "2026-11-13", end: "2026-11-16" });       // 2 Arbeitstage Fr–Mo
  });
  it("Wartetage pro Vorgänger: A+5 schlägt B", () => {
    const tasks = plan().map(t => t.id === "C" ? mitVorgaengern(t, [{ id: "A", lagDays: 5 }, { id: "B", lagDays: 0 }]) : t);
    expect(vorgaengerStart(tasks, tasks[2], KAL)).toEqual({ datum: "2026-11-16", min: 480 });             // Di + 1 + 5 = Mo
    expect(massgebenderVorgaenger(tasks, tasks[2], KAL)).toBe("A");
  });
  it("Text und Eingabe wie MS Project: \"1, 2+2\"", () => {
    const tasks = plan().map(t => t.id === "C" ? mitVorgaengern(t, [{ id: "A", lagDays: 0 }, { id: "B", lagDays: 2 }]) : t);
    const nummern = berechneNummern(tasks);
    expect(vorgaengerText(tasks[2], nummern)).toBe("1, 2+2");
    const r = parseVorgaengerText("1, 2+2; 9", tasks, nummern, 1);
    expect(r.liste).toEqual([{ id: "A", lagDays: 1 }, { id: "B", lagDays: 2 }]);  // ohne +n gilt der Standard
    expect(r.unbekannt).toEqual(["9"]);
    expect(letzterVorgaengerEintrag("1, 2+")).toBe("2");
    expect(ersetzeLetztenVorgaengerEintrag("1, 2", "3")).toBe("1, 3");
  });
  it("Zirkelbezug über einen weiteren Vorgänger wird erkannt", () => {
    const tasks = plan().map(t => t.id === "C" ? mitVorgaengern(t, [{ id: "A", lagDays: 0 }, { id: "B", lagDays: 0 }]) : t);
    expect(istZirkular(tasks, "B", "C")).toBe(true);
  });
  it("Excel/CSV: Export \"1, 2+2\" und Re-Import ergeben dieselben Vorgänger", () => {
    const tasks = plan().map(t => t.id === "C" ? mitVorgaengern(t, [{ id: "A", lagDays: 1 }, { id: "B", lagDays: 2 }]) : t);
    const z = exportZeilen(tasks, KAL);
    expect(z[2].vorgaenger).toBe("1, 2+2");
    expect(z[2].wartetage).toBe(1);
    const zeilen: ImportZeile[] = z.map((x, i) => ({ task: { ...tasks[i], id: `n${i}`, predecessorId: undefined, lagDays: undefined, weitereVorgaenger: undefined },
      vorgRoh: String(x.vorgaenger), lagRoh: String(x.wartetage), nrRoh: x.nr }));
    const imp = baueImportTasks(zeilen);
    expect(vorgaengerListe(imp[2])).toEqual([{ id: "n0", lagDays: 1 }, { id: "n1", lagDays: 2 }]);
  });
});

describe("MS-Project-Export", () => {
  const tasks = [
    task("A", "2026-11-09", "2026-11-09"),
    mitVorgaengern(task("B", "2026-11-13", "2026-11-16"), [{ id: "A", lagDays: 3 }]),
  ];
  const xml = generateMsProjectXml(tasks, "Test", { feiertage: [{ datum: "2026-12-25", name: "Weihnachten" }], ferien: [] });
  it("1-Tages-Vorgang ist kein Meilenstein; ohne Vorgänger manuell geplant, mit Vorgänger über die Verknüpfung", () => {
    expect(xml).not.toContain("<Milestone>1</Milestone>");
    const block = (name: string) => xml.slice(xml.indexOf(`<Name>${name}</Name>`), xml.indexOf("</Task>", xml.indexOf(`<Name>${name}</Name>`)));
    expect(block("A")).toContain("<Manual>1</Manual>");
    expect(block("B")).toContain("<Manual>0</Manual>");
    expect(xml).not.toContain("<ConstraintType>4</ConstraintType>"); // B liegt genau dort, wo die Verknüpfung ihn hinsetzt
  });
  it("liegt ein verknüpfter Vorgang bewusst später, kommt 'Anfang nicht früher als' dazu", () => {
    const spaet = [tasks[0], { ...tasks[1], start: "2026-11-16", end: "2026-11-17" }];
    const x = generateMsProjectXml(spaet, "Test", { feiertage: [], ferien: [] });
    expect(x).toContain("<ConstraintType>4</ConstraintType>");
    expect(x).toContain("<ConstraintDate>2026-11-16T08:00:00</ConstraintDate>");
  });
  it("Wartetage als verstrichene Tage (LagFormat 8)", () => {
    expect(xml).toContain("<LinkLag>43200</LinkLag>");
    expect(xml).toContain("<LagFormat>8</LagFormat>");
  });
  it("Kalender mit Wochenende frei und Feiertag als Ausnahme", () => {
    expect(xml).toContain("<CalendarUID>1</CalendarUID>");
    expect(xml).toMatch(/<DayType>1<\/DayType>\s*<DayWorking>0<\/DayWorking>/);
    expect(xml).toContain("<Name>Weihnachten</Name>");
  });
  it("Schalter aus: alle Wochentage Arbeitstage, keine Ausnahmen", () => {
    const x = generateMsProjectXml(tasks, "Test", { feiertage: [{ datum: "2026-12-25", name: "Weihnachten" }], ferien: [], freieTageGelten: false });
    expect(x).toMatch(/<DayType>1<\/DayType>\s*<DayWorking>1<\/DayWorking>/);
    expect(x).not.toContain("<Exceptions>");
  });
});
