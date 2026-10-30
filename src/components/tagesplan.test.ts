import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { tagesplan } from "./tagesplan";

const KAL = { feiertage: [], ferien: [] };
const TAG = "2026-11-09";
const task = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start: TAG, end: TAG, typ: "neubau", objektGuids: [], bauteilKuerzel: "B", ...p });
// 8 h/Tag; Beton B: Bau AG, Min. 4 Personen, 1 h/m³, kranpflichtig mit Kranzeit kz
const sd = (kz: number): Stammdaten => ({
  ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 8,
  gewerke: [{ key: "bet", label: "Beton", einheit: "m3", raten: [{ kuerzel: "B", bezeichnung: "Beton", leistungswertHProEinheit: 1, anzahlPersonen: 4,
    chfProEinheit: null, unternehmer: "Bau AG", kranpflichtig: true, kranzeitProzent: kz }] }],
} as Stammdaten);
const kran = (n: number): Kran[] => [{ id: "k1", name: "Kran 1", personal: [{ id: "1", unternehmer: "Bau AG", personen: n }] }];

describe("Tagesplan", () => {
  it("Team unter dem Kran verstärkt bis auf die doppelten Min. Personen — 32 h mit 8 statt 10 Personen = 4 h", () => {
    const p = tagesplan(TAG, [task("A", { mengen: { bet: 32 } })], sd(25), KAL, kran(10));
    expect(p.tasks[0].phasen[0].personen).toBe(8);
    expect(p.dauer).toBeCloseTo(4);
    expect(p.tasks[0].phasen[0].kranBegrenzt).toBe(false);
  });

  it("Kranzeit 90 %: der Kran lässt nur 4 Personen zu — 36 h dauern 9 h, durch den Kran begrenzt", () => {
    const p = tagesplan(TAG, [task("A", { mengen: { bet: 36 } })], sd(90), KAL, kran(10));
    expect(p.tasks[0].phasen[0].personen).toBe(4);
    expect(p.dauer).toBeCloseTo(9);
    expect(p.tasks[0].phasen[0].kranBegrenzt).toBe(true);
  });

  it("Überstunden: 1 h nach Arbeitsende mit 4 Personen = 4 Personenstunden Bau AG, Kran 90 % belegt = 0.9 Kranstunden", () => {
    const p = tagesplan(TAG, [task("A", { mengen: { bet: 36 } })], sd(90), KAL, kran(10));
    expect(p.ueberstunden.jeUnternehmer.get("Bau AG")).toBeCloseTo(4);
    expect(p.ueberstunden.jeKran.get("k1")).toBeCloseTo(0.9);
  });

  it("keine Überstunden, wenn die Arbeit im Arbeitstag fertig ist", () => {
    const p = tagesplan(TAG, [task("A", { mengen: { bet: 32 } })], sd(25), KAL, kran(10));
    expect(p.ueberstunden.jeUnternehmer.size).toBe(0);
    expect(p.ueberstunden.jeKran.size).toBe(0);
  });

  it("Im Einsatz: Höchstzahl gleichzeitig arbeitender Personen, mit Zeitpunkt und Verteilung auf die Gewerke", () => {
    // parallel: zwei Arbeiten mit je 4 Leuten → 8 gleichzeitig
    const parallel = tagesplan(TAG, [task("A", { mengen: { bet: 16 } }), task("B", { mengen: { bet: 16 } })], sd(25), KAL, kran(8));
    expect(parallel.imEinsatz.anzahl).toBe(8);
    expect(parallel.imEinsatz.um).toBe(0);
    expect(parallel.imEinsatz.jeGewerkAnSpitze.get("bet")).toBe(8);
    expect(parallel.arbeitJeGewerk.get("bet")).toBeCloseTo(32);
    // nacheinander (ohne Kran-Pool: eine Kolonne je Gewerk + Unternehmer) → nie mehr als 4 gleichzeitig
    const nacheinander = tagesplan(TAG, [task("A", { mengen: { bet: 12 } }), task("B", { mengen: { bet: 16 } })], sd(25), KAL, []);
    expect(nacheinander.dauer).toBeCloseTo(7);
    expect(nacheinander.imEinsatz.anzahl).toBe(4);
    expect(nacheinander.imEinsatz.maxJeGewerk.get("bet")).toBe(4);
  });

  it("zwei Arbeiten teilen sich das Team und den Kran", () => {
    const p = tagesplan(TAG, [task("A", { mengen: { bet: 16 } }), task("B", { mengen: { bet: 16 } })], sd(25), KAL, kran(8));
    expect(p.tasks.map(t => t.phasen[0].personen)).toEqual([4, 4]); // je Min. 4, keine Leute übrig
    expect(p.dauer).toBeCloseTo(4);
  });
});
