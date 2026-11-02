import { describe, it, expect } from "vitest";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, stammdatenAlsCsv, parseStammdatenCsv, istRateKranpflichtig } from "./stammdatenHelpers";

const rate = (kuerzel: string, kranpflichtig?: boolean, kranzeitProzent?: number) =>
  ({ kuerzel, bezeichnung: kuerzel, leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: null, kranpflichtig, kranzeitProzent });

describe("Ressourcen-CSV: Kranpflichtig je Leistungsposition", () => {
  // Kategorie ohne Kran-Flag, Positionen einzeln angehakt (wie Bewehrung: BPL ✓ 5 %, UZ ohne Haken)
  const sd: Stammdaten = { ...LEERE_STAMMDATEN, gewerke: [
    { key: "bew", label: "Bewehrung", einheit: "kg", raten: [rate("BPL", true, 5), rate("UZ", false)] },
  ] } as Stammdaten;

  it("Export schreibt den Haken der Leistungsposition, nicht das Flag der Kategorie", () => {
    const zeilen = stammdatenAlsCsv(sd, []).split("\r\n").slice(1).map(z => z.split(";"));
    expect(zeilen.map(z => [z[4], z[3], z[14]])).toEqual([["BPL", "ja", "5"], ["UZ", "nein", ""]]);
  });

  it("Import liest den Haken je Zeile — hin und zurück unverändert", () => {
    const ohneHaken: Stammdaten = { ...sd, gewerke: [{ ...sd.gewerke[0], raten: sd.gewerke[0].raten.map(r => ({ ...r, kranpflichtig: false })) }] };
    const zurueck = parseStammdatenCsv(stammdatenAlsCsv(sd, []), ohneHaken);
    const g = zurueck.gewerke[0];
    expect(g.raten.map(r => [r.kuerzel, istRateKranpflichtig(r, g), r.kranzeitProzent])).toEqual([["BPL", true, 5], ["UZ", false, undefined]]);
  });
});
