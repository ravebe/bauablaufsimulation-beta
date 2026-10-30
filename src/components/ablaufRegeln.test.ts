import { describe, it, expect } from "vitest";
import type { Task, AblaufRegel } from "../types";
import { vorgaengerListe, automatischeVorgaenger, setzeVorgaenger } from "../types";
import { regelnAnwenden, regelnAlsJson, parseRegelnJson } from "./ablaufRegeln";

const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
const gruppe = (id: string, level: number): Task => task(id, "", "", { isGroup: true, outlineLevel: level });
const vorg = (ts: Task[]) => Object.fromEntries(ts.filter(t => !t.isGroup).map(t => [t.id, vorgaengerListe(t).map(v => v.id).sort().join(",")]));
const regel = (p: Partial<AblaufRegel>): AblaufRegel => ({ id: "r", name: "r", aktiv: true, vor: [], nach: [], bezug: "ueberall", wartetage: 0, ...p });

// Etappe A / B (Ebene 1), darin UG / EG (Ebene 2); Bauteilarten DE = Decke, ST = Stütze
const gantt = (): Task[] => [
  task("KAN-A", "2026-11-02", "2026-11-03", { name: "Kanalisation A" }),
  task("MB-A", "2026-11-02", "2026-11-03", { name: "Magerbeton A" }),
  gruppe("Etappe A", 1),
  gruppe("UG", 2),
  task("A-UG-DE", "2026-11-09", "2026-11-10", { bauteilKuerzel: "DE", outlineLevel: 3 }),
  gruppe("EG", 2),
  task("A-EG-ST", "2026-11-09", "2026-11-09", { bauteilKuerzel: "ST", outlineLevel: 3 }),
  task("A-EG-DE", "2026-11-09", "2026-11-09", { bauteilKuerzel: "DE", outlineLevel: 3 }),
  gruppe("Etappe B", 1),
  gruppe("UG", 2),
  task("B-UG-DE", "2026-11-09", "2026-11-09", { bauteilKuerzel: "DE", outlineLevel: 3 }),
  gruppe("EG", 2),
  task("B-EG-ST", "2026-11-09", "2026-11-09", { bauteilKuerzel: "ST", outlineLevel: 3 }),
];
const platteDarunter = regel({ id: "platte", vor: [{ feld: "kuerzel", werte: ["DE"] }], bezug: "darunter", ebene: 2 });

describe("Ablaufregeln", () => {
  it("Platte darunter: EG wartet auf die Decke UG derselben Etappe, nicht auf die andere Etappe", () => {
    const { tasks } = regelnAnwenden(gantt(), [platteDarunter]);
    const v = vorg(tasks);
    expect(v["A-EG-ST"]).toBe("A-UG-DE");
    expect(v["A-EG-DE"]).toBe("A-UG-DE");
    expect(v["B-EG-ST"]).toBe("B-UG-DE");
    expect(v["A-UG-DE"]).toBe("");
    expect([...automatischeVorgaenger(tasks.find(t => t.id === "A-EG-ST")!)]).toEqual(["A-UG-DE"]);
  });

  it("«ausser»: Wände auf der Bodenplatte warten nicht auf die Decke darunter", () => {
    const ts = gantt().map(t => t.id === "A-EG-DE" ? { ...t, name: "Stütze EG Bopla", bauteilKuerzel: "ST" } : t);
    const r = { ...platteDarunter, nach: [{ feld: "kuerzel" as const, werte: ["ST"] }, { feld: "name" as const, werte: ["bopla"], nicht: true }] };
    const v = vorg(regelnAnwenden(ts, [r]).tasks);
    expect(v["A-EG-ST"]).toBe("A-UG-DE");
    expect(v["A-EG-DE"]).toBe("");
  });

  it("unvollständige Regel (Bedingung ohne Wert) wirkt nicht", () => {
    const leer = { ...platteDarunter, vor: [{ feld: "kuerzel" as const, werte: [] }] };
    expect(regelnAnwenden(gantt(), [leer]).tasks).toEqual(gantt());
  });

  it("zu früh beginnende Tasks rücken hinter den Regel-Vorgänger (nie nach vorne)", () => {
    const { tasks } = regelnAnwenden(gantt(), [platteDarunter]);
    expect(tasks.find(t => t.id === "A-EG-ST")!.start).toBe("2026-11-11");
    expect(tasks.find(t => t.id === "KAN-A")!.start).toBe("2026-11-02");
  });

  it("Name enthält + Wartetage: Kanalisation vor Magerbeton", () => {
    const r = regel({ vor: [{ feld: "name", werte: ["kanalisation"] }], nach: [{ feld: "name", werte: ["Magerbeton"] }], wartetage: 2 });
    const { tasks } = regelnAnwenden(gantt(), [r]);
    const mb = tasks.find(t => t.id === "MB-A")!;
    expect(vorgaengerListe(mb)).toEqual([{ id: "KAN-A", lagDays: 2 }]);
  });

  it("gleiche Gruppe: nur innerhalb derselben Etappe", () => {
    const r = regel({ vor: [{ feld: "kuerzel", werte: ["DE"] }], nach: [{ feld: "kuerzel", werte: ["ST"] }], bezug: "gleich", ebene: 1 });
    const v = vorg(regelnAnwenden(gantt(), [r]).tasks);
    expect(v["A-EG-ST"]).toBe("A-EG-DE,A-UG-DE");
    expect(v["B-EG-ST"]).toBe("B-UG-DE");
  });

  it("unnötige Verknüpfungen entfallen: ist A über einen anderen Vorgänger schon gesichert, keine direkte Verknüpfung", () => {
    // A-EG-ST hat von Hand A-EG-DE als Vorgänger, A-EG-DE bekommt aus der Regel A-UG-DE → A-EG-ST braucht A-UG-DE nicht direkt
    const ts = setzeVorgaenger(gantt(), ["A-EG-ST"], [{ id: "A-EG-DE", lagDays: 0 }]);
    const v = vorg(regelnAnwenden(ts, [platteDarunter]).tasks);
    expect(v["A-EG-ST"]).toBe("A-EG-DE");
    expect(v["A-EG-DE"]).toBe("A-UG-DE");
  });

  it("Zirkelbezug wird übersprungen und gezählt", () => {
    const hin = regel({ id: "1", vor: [{ feld: "name", werte: ["Kanalisation"] }], nach: [{ feld: "name", werte: ["Magerbeton"] }] });
    const zurueck = regel({ id: "2", vor: [{ feld: "name", werte: ["Magerbeton"] }], nach: [{ feld: "name", werte: ["Kanalisation"] }] });
    const e = regelnAnwenden(gantt(), [hin, zurueck]);
    expect(e.zirkel).toBe(1);
    expect(vorg(e.tasks)["KAN-A"]).toBe("");
  });

  it("Regel ausschalten entfernt ihre Vorgänger, von Hand gesetzte bleiben; unverändert = dasselbe Array", () => {
    const mitHand = setzeVorgaenger(gantt(), ["MB-A"], [{ id: "KAN-A", lagDays: 0 }]);
    const erst = regelnAnwenden(mitHand, [platteDarunter]).tasks;
    expect(regelnAnwenden(erst, [platteDarunter]).tasks).toBe(erst);
    const aus = regelnAnwenden(erst, [{ ...platteDarunter, aktiv: false }]).tasks;
    expect(vorg(aus)["A-EG-ST"]).toBe("");
    expect(vorg(aus)["MB-A"]).toBe("KAN-A");
  });

  it("Export/Import ergibt dieselben Regeln, fremde Dateien werden abgelehnt", () => {
    const regeln = [platteDarunter, regel({ id: "x", name: "Kanal", nach: [{ feld: "name", werte: ["Magerbeton"] }], wartetage: 3 })];
    expect(parseRegelnJson(regelnAlsJson(regeln))).toEqual(regeln.map(r => ({ ...r, ebene: r.bezug === "ueberall" ? undefined : r.ebene })));
    expect(() => parseRegelnJson(JSON.stringify({ gewerke: [] }))).toThrow();
  });
});
