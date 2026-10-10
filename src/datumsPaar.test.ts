import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import { datumsPaarVerschieben, kaskadiereNachfolger, richteKettenNeuAus, verschiebeAufStart, normalisiereAufArbeitstage } from "./types";
import { folgeStart, arbeitstagPlus, startDatumAusArbeitstagen, arbeitstageVersatz, arbeitstageZwischen, ersterArbeitstagAb, arbeitsBloecke } from "./components/kalenderHelpers";
import type { Kalender } from "./components/kalenderHelpers";

const KAL: Kalender = { feiertage: [], ferien: [] };
// 2026-11-09 = Montag
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });

describe("datumsPaarVerschieben (Dauer in Arbeitstagen bleibt)", () => {
  it("Start verschieben → Ende wandert mit, Wochenende wird übersprungen", () => {
    // Mo 9.11.–Mi 11.11. (3 Arbeitstage) → Start Do 12.11. → Ende Mo 16.11.
    expect(datumsPaarVerschieben("2026-11-09", "2026-11-11", "2026-11-12", "start", KAL)).toEqual({ start: "2026-11-12", end: "2026-11-16" });
  });
  it("Ende verschieben → Start wandert mit", () => {
    expect(datumsPaarVerschieben("2026-11-09", "2026-11-11", "2026-11-20", "end", KAL)).toEqual({ start: "2026-11-18", end: "2026-11-20" });
  });
  it("Fr–Mo (2 Arbeitstage) bleibt 2 Arbeitstage", () => {
    expect(datumsPaarVerschieben("2026-10-30", "2026-11-02", "2026-11-04", "start", KAL)).toEqual({ start: "2026-11-04", end: "2026-11-05" });
  });
  it("1 Arbeitstag bleibt 1 Arbeitstag", () => {
    expect(datumsPaarVerschieben("2026-11-09", "2026-11-09", "2026-11-11", "end", KAL)).toEqual({ start: "2026-11-11", end: "2026-11-11" });
  });
  it("fehlerhaftes Paar (Ende vor Start) wird auf einen Tag gebracht", () => {
    expect(datumsPaarVerschieben("2026-12-01", "2026-11-06", "2026-12-03", "start", KAL)).toEqual({ start: "2026-12-03", end: "2026-12-03" });
  });
  it("nicht lesbare Daten: nur das geänderte Datum wird gesetzt", () => {
    expect(datumsPaarVerschieben("", "2026-11-01", "2026-11-09", "start", KAL)).toEqual({ start: "2026-11-09", end: "2026-11-01" });
  });
});

describe("Arbeitstag-Arithmetik", () => {
  it("Nachfolger startet am Arbeitstag NACH dem Ende des Vorgängers", () => {
    expect(folgeStart("2026-10-28", 0, KAL)).toBe("2026-10-29");   // Mi → Do
    expect(folgeStart("2026-10-30", 0, KAL)).toBe("2026-11-02");   // Fr → Mo
  });
  it("Wartetage zählen als Kalendertage ab dem Tag nach dem Ende; Start rückt auf den nächsten Arbeitstag", () => {
    // Vorgänger endet Freitag 30.10.
    expect(folgeStart("2026-10-30", 0, KAL)).toBe("2026-11-02"); // Mo
    expect(folgeStart("2026-10-30", 1, KAL)).toBe("2026-11-02"); // Mo
    expect(folgeStart("2026-10-30", 2, KAL)).toBe("2026-11-02"); // Mo
    expect(folgeStart("2026-10-30", 3, KAL)).toBe("2026-11-03"); // Di
    expect(folgeStart("2026-10-30", 4, KAL)).toBe("2026-11-04"); // Mi
    expect(folgeStart("2026-10-30", 5, KAL)).toBe("2026-11-05"); // Do
    expect(folgeStart("2026-10-28", 2, KAL)).toBe("2026-11-02"); // Mi + 1 + 2 = Sa → Mo
  });
  it("Feiertage und Ferien zählen als Wartezeit und werden beim Start übersprungen", () => {
    const mitFeiertag: Kalender = { feiertage: [{ datum: "2026-11-02", name: "frei" }], ferien: [] };
    expect(folgeStart("2026-10-30", 0, mitFeiertag)).toBe("2026-11-03");   // Mo frei → Di
    const mitFerien: Kalender = { feiertage: [], ferien: [{ von: "2026-11-02", bis: "2026-11-13", name: "Ferien" }] };
    expect(folgeStart("2026-10-30", 0, mitFerien)).toBe("2026-11-16");     // Ferien bis Fr 13.11. → Mo 16.11.
    expect(folgeStart("2026-10-30", 5, mitFerien)).toBe("2026-11-16");     // Wartetage laufen in den Ferien ab
  });
  it("Umkehrungen und Differenzen", () => {
    expect(startDatumAusArbeitstagen("2026-11-02", 2, KAL)).toBe("2026-10-30");
    expect(arbeitstagPlus("2026-10-30", 1, KAL)).toBe("2026-11-02");
    expect(arbeitstagPlus("2026-11-02", -1, KAL)).toBe("2026-10-30");
    expect(arbeitstageVersatz("2026-10-30", "2026-11-04", KAL)).toBe(3);
    expect(arbeitstageVersatz("2026-11-04", "2026-10-30", KAL)).toBe(-3);
    expect(arbeitstageZwischen("2026-10-30", "2026-11-02", KAL)).toBe(2);
  });
});

describe("Kette: Nachfolger überlappt nie mit dem Vorgänger", () => {
  const kette = () => [
    task("A", "2026-10-29", "2026-10-30"),                                              // Do–Fr, 2 Arbeitstage
    task("B", "2026-10-30", "2026-11-02", { predecessorId: "A", lagDays: 0 }),            // beginnt (alt) noch am Ende von A
    task("C", "2026-11-02", "2026-11-04", { predecessorId: "B", lagDays: 0 }),
  ];
  it("verschiebeAufStart erhält die Arbeitstage-Dauer", () => {
    const r = verschiebeAufStart(kette(), "B", "2026-11-02", KAL);
    expect(r[1]).toMatchObject({ start: "2026-11-02", end: "2026-11-03" });               // 2 Arbeitstage
  });
  it("Kaskade ab A richtet B und C neu aus", () => {
    const r = kaskadiereNachfolger(kette(), "A", KAL);
    expect(r[1]).toMatchObject({ start: "2026-11-02", end: "2026-11-03" });
    expect(r[2]).toMatchObject({ start: "2026-11-04", end: "2026-11-06" });               // 3 Arbeitstage Mi–Fr
  });
  it("richteKettenNeuAus bringt die ganze Kette in Ordnung", () => {
    const r = richteKettenNeuAus(kette(), KAL);
    expect(r.map(t => [t.start, t.end])).toEqual([["2026-10-29", "2026-10-30"], ["2026-11-02", "2026-11-03"], ["2026-11-04", "2026-11-06"]]);
  });
});

describe("Tasks starten und enden nur an Arbeitstagen", () => {
  it("Datumswahl: Samstag als Start → Montag, Sonntag als Ende → Freitag davor", () => {
    // 2026-11-07 = Samstag, 2026-11-08 = Sonntag
    expect(datumsPaarVerschieben("2026-11-09", "2026-11-11", "2026-11-07", "start", KAL)).toEqual({ start: "2026-11-09", end: "2026-11-11" });
    expect(datumsPaarVerschieben("2026-11-09", "2026-11-11", "2026-11-15", "end", KAL)).toEqual({ start: "2026-11-11", end: "2026-11-13" });
  });
  it("verschiebeAufStart rückt einen freien Starttag auf den nächsten Arbeitstag", () => {
    const r = verschiebeAufStart([task("A", "2026-11-09", "2026-11-10")], "A", "2026-11-07", KAL);
    expect(r[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-10" });
  });
  it("Ausrichten: Task Sa–So (ohne Vorgänger) behält seine 2 Tage → Mo–Di", () => {
    const r = richteKettenNeuAus([task("A", "2026-11-07", "2026-11-08")], KAL);
    expect(r[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-10" });
  });
  it("Ausrichten: Task Sa bis So der Folgewoche (5 Arbeitstage) wird Mo–Fr", () => {
    const r = richteKettenNeuAus([task("A", "2026-11-07", "2026-11-15")], KAL);
    expect(r[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-13" });
  });
  it("Task komplett in den Ferien (Mo–Mi = 3 Tage) behält 3 Tage und rückt hinter die Ferien", () => {
    const ferien: Kalender = { feiertage: [], ferien: [{ von: "2026-11-09", bis: "2026-11-13", name: "Ferien" }] };
    const r = richteKettenNeuAus([task("A", "2026-11-09", "2026-11-11")], ferien);
    expect(r[0]).toMatchObject({ start: "2026-11-16", end: "2026-11-18" });
  });
});

describe("Schalter aus: Wochenendarbeit erlaubt (jeder Tag ist ein Arbeitstag)", () => {
  const ALLE: Kalender = { feiertage: [{ datum: "2026-11-03", name: "frei" }], ferien: [{ von: "2026-11-09", bis: "2026-11-13", name: "Ferien" }], freieTageGelten: false };
  it("Dauer zählt Kalendertage: Fr–Mo = 4 Tage, 9 Tage = 9 Arbeitstage", () => {
    expect(arbeitstageZwischen("2026-10-30", "2026-11-02", ALLE)).toBe(4);
    expect(arbeitstageZwischen("2026-11-02", "2026-11-10", ALLE)).toBe(9); // trotz Feiertag und Ferien
  });
  it("Nachfolger startet am Tag nach dem Ende + Wartetage, nichts rückt auf einen Werktag", () => {
    expect(folgeStart("2026-10-30", 0, ALLE)).toBe("2026-10-31"); // Sa
    expect(folgeStart("2026-10-30", 3, ALLE)).toBe("2026-11-03"); // Di (Feiertag zählt als Arbeitstag)
    expect(ersterArbeitstagAb("2026-11-07", ALLE)).toBe("2026-11-07");
  });
  it("Ausrichten und Datumswahl lassen Samstag/Sonntag stehen", () => {
    expect(richteKettenNeuAus([task("A", "2026-11-07", "2026-11-08")], ALLE)[0]).toMatchObject({ start: "2026-11-07", end: "2026-11-08" });
    expect(datumsPaarVerschieben("2026-11-02", "2026-11-04", "2026-11-07", "start", ALLE)).toEqual({ start: "2026-11-07", end: "2026-11-09" });
  });
});

describe("Wochenenden aus langen Spannen schneiden, Arbeitsblöcke, Import", () => {
  it("Task über 3 Wochen (21 Kalendertage) = 15 Arbeitstage, endet am Freitag der 3. Woche", () => {
    const r = normalisiereAufArbeitstage([task("A", "2026-11-09", "2026-11-29")], KAL);
    expect(r.tasks[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-27" });
    expect(r.geaendert).toBe(1);
  });
  it("Import mit 15 Kalendertagen (Mo–Mo+2 Wochen) → 11 Arbeitstage, Wochenenden weggeschnitten", () => {
    const r = normalisiereAufArbeitstage([task("A", "2026-11-09", "2026-11-23")], KAL);
    expect(arbeitstageZwischen(r.tasks[0].start, r.tasks[0].end, KAL)).toBe(11);
    expect(r.tasks[0]).toMatchObject({ start: "2026-11-09", end: "2026-11-23" });
  });
  it("bereits passende Tasks werden nicht angefasst", () => {
    const r = normalisiereAufArbeitstage([task("A", "2026-11-09", "2026-11-11")], KAL);
    expect(r.geaendert).toBe(0);
  });
  it("arbeitsBloecke: ein Block je Arbeitswoche, Lücke am Wochenende", () => {
    expect(arbeitsBloecke("2026-11-12", "2026-11-17", KAL)).toEqual([{ von: 0, bis: 1 }, { von: 4, bis: 5 }]); // Do, Fr | Mo, Di
    expect(arbeitsBloecke("2026-11-09", "2026-11-11", KAL)).toEqual([{ von: 0, bis: 2 }]);
  });
});
