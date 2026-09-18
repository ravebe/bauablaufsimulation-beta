import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { kalkulationAlsCsv, parseKalkulationCsv, kalkulationAlsJson, parseKalkulationJson } from "./kalkulationExportHelpers";

const kraene: Kran[] = [
  { id: "k1", name: "Kran 1" },
  { id: "k2", name: "Kran 2" },
  { id: "k3", name: "Kran 3" },
];

function task(id: string, name: string, kraeneIds?: string[]): Task {
  return { id, name, start: "2026-01-01", end: "2026-01-05", typ: "neubau", objektGuids: [], kraene: kraeneIds };
}

describe("Kraene-Export/Import CSV", () => {
  it("serialisiert mehrere Kräne als 'Kran 1+Kran 2'", () => {
    const csv = kalkulationAlsCsv([task("t1", "Task A", ["k1", "k2"])], LEERE_STAMMDATEN, kraene);
    expect(csv).toContain("Kran 1+Kran 2");
  });

  it("parst '1+2'-artige Kran-Kombinationen zurück in IDs (2 Kräne)", () => {
    const csv = kalkulationAlsCsv([task("t1", "Task A", ["k1", "k2"])], LEERE_STAMMDATEN, kraene);
    const erg = parseKalkulationCsv(csv, [task("t1", "Task A")], LEERE_STAMMDATEN, kraene);
    expect(erg.tasks[0].kraene).toEqual(["k1", "k2"]);
  });

  it("parst drei Kräne (1+2+3)", () => {
    const csv = kalkulationAlsCsv([task("t1", "Task A", ["k1", "k2", "k3"])], LEERE_STAMMDATEN, kraene);
    const erg = parseKalkulationCsv(csv, [task("t1", "Task A")], LEERE_STAMMDATEN, kraene);
    expect(erg.tasks[0].kraene).toEqual(["k1", "k2", "k3"]);
  });

  it("lässt bestehende Kräne unangetastet, wenn die Zelle leer ist", () => {
    const csv = kalkulationAlsCsv([task("t1", "Task A")], LEERE_STAMMDATEN, kraene); // keine Kräne im Export
    const erg = parseKalkulationCsv(csv, [task("t1", "Task A", ["k1"])], LEERE_STAMMDATEN, kraene);
    expect(erg.tasks[0].kraene).toEqual(["k1"]);
  });

  it("alte CSV ohne Kraene-Spalte bleibt lesbar (Rückwärtskompatibilität)", () => {
    const alteCsv = "﻿Nr;Task;Kürzel;Kranbereich;Personal (Soll)\r\n1;Task A;WB;Bereich 1;4";
    const erg = parseKalkulationCsv(alteCsv, [task("t1", "Task A")], LEERE_STAMMDATEN, kraene);
    expect(erg.tasks[0].kranbereich).toBe("Bereich 1");
    expect(erg.tasks[0].kraene).toBeUndefined();
  });
});

describe("Kraene-Export/Import JSON", () => {
  it("Roundtrip: Export → Import liefert dieselben Kran-IDs", () => {
    const json = kalkulationAlsJson([task("t1", "Task A", ["k2", "k3"])], kraene);
    const erg = parseKalkulationJson(json, [task("t1", "Task A")], kraene);
    expect(erg.tasks[0].kraene).toEqual(["k2", "k3"]);
  });
});
