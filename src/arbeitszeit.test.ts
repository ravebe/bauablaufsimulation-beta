import { describe, it, expect, afterEach } from "vitest";
import type { Task } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import {
  setzeArbeitszeit, arbeitszeitAusStunden, arbeitszeitStunden, pruefeArbeitszeit, STANDARD_ARBEITSZEIT,
  dauerTage, endeAusArbeitsMinuten, startAusArbeitsMinuten, tagesAnteil, zeitOptionen, rundeAufEinheit, fmtDauer,
  arbeitsAnteilAmTag, MIN_PRO_ARBEITSTAG, MITTAG_VON_MIN,
} from "./components/zeitHelpers";
import { effektiveArbeitszeit, mitArbeitszeit, LEERE_STAMMDATEN } from "./components/stammdatenHelpers";
import { generateMsProjectXml } from "./components/msProjectXml";

const KAL: Kalender = { feiertage: [], ferien: [] };
// 2026-11-09 = Montag
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
// 8,5 h mit ungleichen Hälften: Vormittag 5 h, Nachmittag 3,5 h
const AZ = { beginn: "07:00", mittagVon: "12:00", mittagBis: "13:00", ende: "16:30" };

afterEach(() => setzeArbeitszeit(undefined));

describe("Arbeitszeit aus Tab Ressourcen", () => {
  it("Std./Tag ergeben sich aus den Uhrzeiten", () => {
    expect(arbeitszeitStunden(AZ)).toBe(8.5);
    expect(arbeitszeitStunden(STANDARD_ARBEITSZEIT)).toBe(8);
    expect(mitArbeitszeit(LEERE_STAMMDATEN, AZ).arbeitszeitStdProTag).toBe(8.5);
  });

  it("alte Projekte ohne Uhrzeiten: aus den bisherigen Std./Tag abgeleitet, Ende 17:00", () => {
    expect(arbeitszeitAusStunden(8.5)).toEqual({ beginn: "07:30", mittagVon: "12:00", mittagBis: "13:00", ende: "17:00" });
    expect(arbeitszeitAusStunden(8)).toEqual(STANDARD_ARBEITSZEIT);
    expect(effektiveArbeitszeit({ ...LEERE_STAMMDATEN, arbeitszeitStdProTag: 9 }).beginn).toBe("07:00");
    expect(effektiveArbeitszeit({ ...LEERE_STAMMDATEN, arbeitszeit: AZ })).toEqual(AZ);
  });

  it("ungültige Uhrzeiten werden erkannt", () => {
    expect(pruefeArbeitszeit({ ...AZ, mittagVon: "06:00" })).toMatch(/Beginn/);
    expect(pruefeArbeitszeit({ ...AZ, ende: "12:30" })).toMatch(/Ende/);
    expect(pruefeArbeitszeit(AZ)).toBeNull();
  });

  it("gerechnet wird in echten Stunden: Nachmittag 3,5 h = 3,5/8,5 Tag", () => {
    setzeArbeitszeit(AZ, "stunden");
    expect(MIN_PRO_ARBEITSTAG).toBe(510);
    expect(dauerTage(task("A", "2026-11-09", "2026-11-09"), KAL)).toBe(1);
    const nm = task("B", "2026-11-09", "2026-11-09", { startZeit: "13:00" });
    expect(dauerTage(nm, KAL)).toBeCloseTo(3.5 / 8.5);
    expect(arbeitsAnteilAmTag(nm, "2026-11-09", KAL)).toBeCloseTo(3.5 / 8.5);
  });

  it("Uhrzeit: eine Stunde ist eine echte Stunde", () => {
    setzeArbeitszeit(AZ, "stunden");
    expect(endeAusArbeitsMinuten({ datum: "2026-11-09", min: 7 * 60 }, 120, KAL)).toEqual({ datum: "2026-11-09", min: 9 * 60 });
    expect(rundeAufEinheit(1.5 / 8.5, "stunden")).toBeCloseTo(2 / 8.5);
    expect(fmtDauer(1 + 2 / 8.5, "stunden")).toBe("1d 2h");
  });

  it("wählbare Uhrzeiten folgen der Arbeitszeit", () => {
    setzeArbeitszeit({ beginn: "07:30", mittagVon: "12:00", mittagBis: "13:00", ende: "17:00" }, "stunden");
    expect(zeitOptionen("stunden", "start")).toEqual([450, 480, 540, 600, 660, 780, 840, 900, 960]);
    expect(zeitOptionen("stunden", "ende").slice(-2)).toEqual([960, 1020]);
  });

  it("Halbtage: Mittag liegt in der Tagesmitte der Darstellung, auch bei ungleichen Hälften", () => {
    setzeArbeitszeit(AZ, "halbtage");
    expect(tagesAnteil(MITTAG_VON_MIN)).toBe(0.5);
  });

  it("Halbtage: ein Vormittag (5 h), auf den Nachmittag (3,5 h) gelegt, bleibt genau ein Halbtag", () => {
    setzeArbeitszeit(AZ, "halbtage");
    expect(endeAusArbeitsMinuten({ datum: "2026-11-09", min: 13 * 60 }, 300, KAL)).toEqual({ datum: "2026-11-09", min: 16 * 60 + 30 });
    // und umgekehrt: Nachmittag (3,5 h) auf den nächsten Vormittag → endet am Mittag
    expect(endeAusArbeitsMinuten({ datum: "2026-11-10", min: 7 * 60 }, 210, KAL)).toEqual({ datum: "2026-11-10", min: 12 * 60 });
    expect(startAusArbeitsMinuten({ datum: "2026-11-10", min: 12 * 60 }, 210, KAL)).toEqual({ datum: "2026-11-10", min: 7 * 60 });
  });

  it("MS-Project-Export übernimmt Arbeitszeit und Minuten pro Tag", () => {
    setzeArbeitszeit(AZ, "tage");
    const xml = generateMsProjectXml([task("A", "2026-11-09", "2026-11-10")], "P", KAL);
    expect(xml).toContain("<MinutesPerDay>510</MinutesPerDay>");
    expect(xml).toContain("<FromTime>07:00:00</FromTime><ToTime>12:00:00</ToTime>");
    expect(xml).toContain("<FromTime>13:00:00</FromTime><ToTime>16:30:00</ToTime>");
    expect(xml).toContain("<Duration>PT17H0M0S</Duration>");
  });
});
