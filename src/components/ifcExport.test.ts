import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { erkenneIfcSchema, erzeuge4dIfc, fuegeIfcEin, komprimiereGuid, ifcGuidAus, stepText } from "./ifcExport";

const WAND = "2RStUXPRzDTODhQYCAgNtz";
const ALT = "0abcdefghijklmnopqrstu";

function ifc(schema: string): string {
  return [
    "ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('t.ifc','2026-01-01T00:00:00',(''),(''),'','','');", `FILE_SCHEMA(('${schema}'));`, "ENDSEC;", "DATA;",
    "#1=IFCOWNERHISTORY(#2,#3,$,.ADDED.,$,$,$,0);",
    "#10=IFCPROJECT('3abcdefghijklmnopqrstu',#1,'P',$,$,$,$,$,$);",
    `#20=IFCWALL('${WAND}',#1,'Wand',$,$,$,$,$,$);`,
    `#21=IFCSLAB('${ALT}',#1,'Decke',$,$,$,$,$,$);`,
    "ENDSEC;", "END-ISO-10303-21;", "",
  ].join("\n");
}

const tasks: Task[] = [
  { id: "g", name: "Rohbau", start: "2026-03-02", end: "2026-03-13", typ: "neubau", objektGuids: [], isGroup: true, outlineLevel: 1 },
  { id: "a", name: "Abbruch Decke", start: "2026-03-02", end: "2026-03-06", typ: "abbruch", objektGuids: ["m:::2"], outlineLevel: 2 },
  { id: "b", name: "Wände EG", start: "2026-03-09", end: "2026-03-13", typ: "neubau", objektGuids: ["m:::1"], outlineLevel: 2, predecessorId: "a", lagDays: 2 },
];
const guids = new Map([["a", [ALT]], ["b", [WAND]]]);
const eingabe = (schema: string) => ({
  ifcText: ifc(schema), simId: "sim1", simName: "Test Ü", modellId: "m", tasks, bauteilGuidsJeTask: guids,
  kalender: { feiertage: [{ datum: "2026-03-10", name: "Feiertag" }], ferien: [] }, jetzt: new Date(2026, 0, 1, 12, 0, 0),
  meta: { geaendertAm: new Date(2026, 1, 3, 9, 30, 0).toISOString(), geaendertVon: "Max", exportiertVon: "Max" },
});

describe("ifcExport", () => {
  it("erkennt das Schema", () => {
    expect(erkenneIfcSchema(ifc("IFC4")).familie).toBe("IFC4");
    expect(erkenneIfcSchema(ifc("IFC4X3_ADD2")).familie).toBe("IFC4");
    expect(erkenneIfcSchema(ifc("IFC2X3")).familie).toBe("IFC2X3");
    expect(erkenneIfcSchema("nix").familie).toBeNull();
  });

  it("GUIDs sind 22 Zeichen, gültiger Zeichensatz, deterministisch", () => {
    expect(komprimiereGuid(new Uint8Array(16))).toBe("0000000000000000000000");
    expect(komprimiereGuid(new Uint8Array(16).fill(255))).toBe("3$$$$$$$$$$$$$$$$$$$$$");
    const x = ifcGuidAus("abc");
    expect(x).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(ifcGuidAus("abc")).toBe(x);
  });

  it("kodiert Strings STEP-konform", () => {
    expect(stepText("Wände 'A'")).toBe("'W\\X2\\00E4\\X0\\nde ''A'''");
  });

  it("IFC4: Terminplan, Tasks, Sequenz, Kalender, Output/Input", () => {
    const erg = erzeuge4dIfc(eingabe("IFC4"));
    const t = erg.einfuegeText;
    expect(t.split(/\r?\n/)[0]).toMatch(/^\/\* BAUABLAUFSIMULATION-4D .* \*\/$/);
    expect(t.split(/\r?\n/)[1]).toMatch(/^#22=/);
    expect(t).toContain("IFCWORKSCHEDULE(");
    expect(t).toContain("IFCWORKPLAN(");
    expect(t).toContain("IFCRELDECLARES(");
    expect(t).toMatch(/IFCTASK\('[^']{22}',#1,'W\\X2\\00E4\\X0\\nde EG',\$,'Neubau','2',\$,\$,\$,\.F\.,\$,#\d+,\.CONSTRUCTION\.\)/);
    expect(t).toContain(".DEMOLITION.");
    expect(t).toContain("IFCTASKTIME($,$,$,.WORKTIME.,'P4D','2026-03-09T08:00:00','2026-03-13T17:00:00'");
    expect(t).toContain("IFCLAGTIME($,$,$,IFCDURATION('P2D'),.ELAPSEDTIME.)");
    expect(t).toMatch(/IFCRELSEQUENCE\('[^']{22}',#1,\$,\$,#\d+,#\d+,#\d+,\.FINISH_START\.,\$\)/);
    expect(t).toContain("IFCWORKCALENDAR(");
    expect(t).toContain("IFCWORKTIME('Feiertag',$,$,$,'2026-03-10','2026-03-10')");
    expect(t).toMatch(/IFCRELASSIGNSTOPRODUCT\('[^']{22}',#1,\$,\$,\(#\d+\),\$,#20\)/);
    expect(t).toMatch(/IFCRELASSIGNSTOPROCESS\('[^']{22}',#1,\$,\$,\(#21\),\$,#\d+,\$\)/);
    expect(t).toMatch(/IFCRELNESTS\('[^']{22}',#1,\$,\$,#\d+,\(#\d+,#\d+\)\)/);
    expect(t).toContain("IFCDATE('2026-03-09')");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Start_KW',$,IFCLABEL('2026-KW11'),$)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Gruppe',$,IFCLABEL('Rohbau'),$)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Vorgaenger',$,IFCLABEL('1 Abbruch Decke'),$)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Wartetage',$,IFCLABEL('2'),$)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Simulation_geaendert_am',$,IFCDATETIME('2026-02-03T09:30:00'),$)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Exportiert_von',$,IFCLABEL('Max'),$)");
    expect(erg.anzahl).toMatchObject({ tasks: 3, verknuepfteBauteile: 2, nichtGefunden: 0, sequenzen: 1 });
    // nur ASCII, Original unverändert davor/dahinter
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(t)).toBe(true);
    const neu = fuegeIfcEin(ifc("IFC4"), erg);
    expect(neu.endsWith("ENDSEC;\nEND-ISO-10303-21;\n")).toBe(true);
    expect(neu.startsWith(ifc("IFC4").slice(0, erg.einfuegePos))).toBe(true);
  });

  it("IFC2X3: IfcScheduleTimeControl/IfcRelAssignsTasks, kein Kalender", () => {
    const erg = erzeuge4dIfc(eingabe("IFC2X3"));
    const t = erg.einfuegeText;
    expect(t).not.toContain("IFCTASKTIME");
    expect(t).not.toContain("IFCWORKCALENDAR");
    expect(t).toMatch(/IFCTASK\('[^']{22}',#1,'W\\X2\\00E4\\X0\\nde EG',\$,'Neubau','2',\$,\$,\.F\.,\$\)/);
    expect(t).toContain("IFCSCHEDULETIMECONTROL(");
    expect(t).toContain("IFCRELASSIGNSTASKS(");
    expect(t).toMatch(/IFCRELSEQUENCE\('[^']{22}',#1,\$,\$,#\d+,#\d+,172800\.,\.FINISH_START\.\)/);
    expect(t).toMatch(/IFCRELASSIGNSTOPROCESS\('[^']{22}',#1,\$,\$,\(#20\),\$,#\d+,\$\)/);
    expect(t).toContain("IFCCALENDARDATE(9,3,2026)");
    expect(t).toContain("IFCPROPERTYSINGLEVALUE('Simulation_geaendert_am',$,IFCLABEL('2026-02-03 09:30'),$)");
    expect(erg.hinweise.some(h => h.includes("Kalender"))).toBe(true);
  });

  it("erneuter Export ersetzt den alten Bauablauf (auch ohne Änderung und bei alten Dateien ohne Marker); fremde Schemas werden abgelehnt", () => {
    const erg = erzeuge4dIfc(eingabe("IFC4"));
    const mit4d = fuegeIfcEin(ifc("IFC4"), erg);
    // mit Marker
    const neu = erzeuge4dIfc({ ...eingabe("IFC4"), ifcText: mit4d });
    expect(neu.ersetzt).toBe(true);
    expect(fuegeIfcEin(mit4d, neu)).toBe(mit4d); // identisches Ergebnis, nichts doppelt
    // alter Export ohne Marker-Zeile
    const ohneMarker = mit4d.replace(/\/\* BAUABLAUFSIMULATION-4D [^\n]*\*\/\r?\n/, "");
    const neu2 = erzeuge4dIfc({ ...eingabe("IFC4"), ifcText: ohneMarker });
    expect(neu2.ersetzt).toBe(true);
    expect(fuegeIfcEin(ohneMarker, neu2)).toBe(mit4d);
    expect(() => erzeuge4dIfc({ ...eingabe("IFC4"), ifcText: ifc("IFC5") })).toThrow(/nicht unterst/);
  });
});
