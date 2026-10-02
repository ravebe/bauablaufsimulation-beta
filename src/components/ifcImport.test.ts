import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { erzeuge4dIfc, fuegeIfcEin } from "./ifcExport";
import { leseBauablaufAusIfc, enthaeltBauablauf, stepTextLesen } from "./ifcImport";

const WAND = "2RStUXPRzDTODhQYCAgNtz";
const DECKE = "0abcdefghijklmnopqrstu";

function ifc(schema: string): string {
  return [
    "ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION((''),'2;1');", "FILE_NAME('t.ifc','',(''),(''),'','','');",
    `FILE_SCHEMA(('${schema}'));`, "ENDSEC;", "DATA;",
    "#1=IFCOWNERHISTORY(#2,#3,$,.ADDED.,$,$,$,0);",
    "#10=IFCPROJECT('3abcdefghijklmnopqrstu',#1,'P',$,$,$,$,$,$);",
    `#20=IFCWALL('${WAND}',#1,'Wand',$,$,$,$,$,$);`,
    `#21=IFCSLAB('${DECKE}',#1,'Decke',$,$,$,$,$,$);`,
    "ENDSEC;", "END-ISO-10303-21;", "",
  ].join("\n");
}

const tasks: Task[] = [
  { id: "g", name: "Rohbau EG", start: "2026-03-02", end: "2026-03-13", typ: "neubau", objektGuids: [], isGroup: true, outlineLevel: 1 },
  { id: "a", name: "Abbruch Decke", start: "2026-03-02", end: "2026-03-06", typ: "abbruch", objektGuids: [], outlineLevel: 2, bauteilKuerzel: "AB" },
  { id: "b", name: "Wände 'Süd'", start: "2026-03-09", end: "2026-03-13", typ: "neubau", objektGuids: [], outlineLevel: 2,
    predecessorId: "a", lagDays: 2, kranbereich: "Kran 1", kraene: ["k1"], personalSoll: 4 },
  { id: "c", name: "Gerüst", start: "2026-03-16", end: "2026-03-20", typ: "temporaer", objektGuids: [], outlineLevel: 1 },
];

function roundtrip(schema: string) {
  const text = ifc(schema);
  const erg = erzeuge4dIfc({
    ifcText: text, simId: "s", simName: "Sim", modellId: "m", tasks,
    bauteilGuidsJeTask: new Map([["a", [DECKE]], ["b", [WAND]]]),
    kraene: [{ id: "k1", name: "Kran Nord" }],
    kalender: { feiertage: [{ datum: "2026-03-10", name: "Feiertag" }], ferien: [{ von: "2026-07-01", bis: "2026-07-14", name: "Sommer" }] },
  });
  let n = 0;
  return leseBauablaufAusIfc(fuegeIfcEin(text, erg), () => `id${++n}`);
}

describe("ifcImport", () => {
  it("dekodiert STEP-Strings", () => {
    expect(stepTextLesen("W\\X2\\00E4\\X0\\nde ''A''")).toBe("Wände 'A'");
    expect(stepTextLesen("D\\X\\E4mmung")).toBe("Dämmung");
  });

  for (const schema of ["IFC4", "IFC2X3"]) {
    it(`liest den eigenen Export zurück (${schema})`, () => {
      const r = roundtrip(schema);
      expect(r.terminplanName).toBe("Sim");
      expect(r.tasks.map(t => [t.name, t.start, t.end, t.typ, t.outlineLevel, !!t.isGroup])).toEqual([
        ["Rohbau EG", "2026-03-02", "2026-03-13", "neubau", 1, true],
        ["Abbruch Decke", "2026-03-02", "2026-03-06", "abbruch", 2, false],
        ["Wände 'Süd'", "2026-03-09", "2026-03-13", "neubau", 2, false],
        ["Gerüst", "2026-03-16", "2026-03-20", "temporaer", 1, false],
      ]);
      const [, a, b] = r.tasks;
      expect(b.predecessorId).toBe(a.id);
      expect(b.lagDays).toBe(2);
      expect(r.bauteilGuids.get(a.id)).toEqual([DECKE]);
      expect(r.bauteilGuids.get(b.id)).toEqual([WAND]);
      expect(a.bauteilKuerzel).toBe("AB");
      expect(b.kranbereich).toBe("Kran 1");
      expect(b.personalSoll).toBe(4);
      expect(r.kraene.map(k => k.name)).toEqual(["Kran Nord"]);
      expect(b.kraene).toEqual([r.kraene[0].id]);
      if (schema === "IFC4") {
        expect(r.kalender).toEqual({ feiertage: [{ datum: "2026-03-10", name: "Feiertag" }], ferien: [{ von: "2026-07-01", bis: "2026-07-14", name: "Sommer" }] });
      }
    });
  }

  it("erkennt den Bauablauf am Dateiende, nicht in leeren Dateien", () => {
    const text = ifc("IFC4");
    expect(enthaeltBauablauf(text)).toBe(false);
    const erg = erzeuge4dIfc({ ifcText: text, simId: "s", simName: "S", modellId: "m", tasks, bauteilGuidsJeTask: new Map() });
    expect(enthaeltBauablauf(fuegeIfcEin(text, erg).slice(-2000))).toBe(true);
    expect(() => leseBauablaufAusIfc(text)).toThrow(/kein Bauablauf/);
  });
});
