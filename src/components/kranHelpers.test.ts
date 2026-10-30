import { describe, it, expect } from "vitest";
import type { Task, Kran } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import {
  zeitrasterBuckets, kranAktivInBucket, istKranVerfuegbarAn, kranVerfuegbareArbeitstage, neuerKran,
  kranAnteil, kranAusTasksEntfernen, kranstundenProKranUndBucket, kranLuecken, kranVerlaengernVorschlag, kranVerlaengern,
} from "./kranHelpers";

function task(start: string, end: string): Task {
  return { id: "t1", name: "T", start, end, typ: "neubau", objektGuids: [] };
}

describe("zeitrasterBuckets", () => {
  it("liefert Monats-Buckets über den ganzen Projektzeitraum", () => {
    const buckets = zeitrasterBuckets([task("2026-01-15", "2026-03-05")], "monat");
    expect(buckets.map(b => b.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(buckets[0].start).toBe("2026-01-01");
    expect(buckets[0].end).toBe("2026-01-31");
  });

  it("liefert Wochen-Buckets (Montag-Start) über den ganzen Projektzeitraum", () => {
    const buckets = zeitrasterBuckets([task("2026-01-12", "2026-01-20")], "woche"); // Mo 12.1. - Di 20.1.
    expect(buckets.length).toBe(2);
    expect(buckets[0].start).toBe("2026-01-12");
    expect(buckets[0].end).toBe("2026-01-18");
  });

  it("leer ohne Tasks mit Terminen", () => {
    expect(zeitrasterBuckets([], "monat")).toEqual([]);
  });
});

describe("Kran-Verfügbarkeit", () => {
  const bucket = { start: "2026-02-01", end: "2026-02-28" };

  it("Kran ohne von/bis ist immer verfügbar", () => {
    const k: Kran = { id: "k1", name: "Kran 1" };
    expect(kranAktivInBucket(k, bucket)).toBe(true);
    expect(istKranVerfuegbarAn(k, "2026-02-15")).toBe(true);
  });

  it("Kran mit von/bis ausserhalb des Buckets ist inaktiv", () => {
    const k: Kran = { id: "k1", name: "Kran 1", verfuegbarVon: "2026-03-01", verfuegbarBis: "2026-03-31" };
    expect(kranAktivInBucket(k, bucket)).toBe(false);
    expect(istKranVerfuegbarAn(k, "2026-02-15")).toBe(false);
  });

  it("Kran mit teilweiser Überlappung ist im Bucket aktiv", () => {
    const k: Kran = { id: "k1", name: "Kran 1", verfuegbarVon: "2026-02-20" };
    expect(kranAktivInBucket(k, bucket)).toBe(true);
  });

  it("kranVerfuegbareArbeitstage clippt auf den Verfügbarkeitszeitraum (0 wenn ausserhalb)", () => {
    const kalender = LEERER_KALENDER; // nur Wochenenden zählen als frei
    const nichtVerfuegbar: Kran = { id: "k1", name: "Kran 1", verfuegbarVon: "2026-03-01" };
    expect(kranVerfuegbareArbeitstage(nichtVerfuegbar, bucket, kalender)).toBe(0);

    const halberMonat: Kran = { id: "k2", name: "Kran 2", verfuegbarVon: "2026-02-16" };
    const voll = kranVerfuegbareArbeitstage({ id: "k3", name: "Kran 3" }, bucket, kalender);
    const halb = kranVerfuegbareArbeitstage(halberMonat, bucket, kalender);
    expect(halb).toBeLessThan(voll);
    expect(halb).toBeGreaterThan(0);
  });
});

describe("neuerKran", () => {
  it("vergibt fortlaufende Namen und überspringt belegte", () => {
    expect(neuerKran([]).name).toBe("Kran 1");
    expect(neuerKran([{ id: "a", name: "Kran 1" }]).name).toBe("Kran 2");
    expect(neuerKran([{ id: "a", name: "Kran 1" }, { id: "b", name: "Kran 3" }]).name).toBe("Kran 4");
  });
});

describe("kranAnteil — gleichmässige Anteilsverteilung bei geteilten Kränen", () => {
  it("1 Kran = voller Anteil", () => expect(kranAnteil(1)).toBe(1));
  it("2 Kräne = je 0.5", () => expect(kranAnteil(2)).toBe(0.5));
  it("3 Kräne = je 1/3 (~0.33)", () => expect(kranAnteil(3)).toBeCloseTo(0.3333, 4));
  it("0 Kräne = 0 (kein Bezug, keine Division durch 0)", () => expect(kranAnteil(0)).toBe(0));
});

describe("kranAusTasksEntfernen", () => {
  it("entfernt nur die gelöschte Kran-ID, andere Zuordnungen bleiben", () => {
    const tasks: Task[] = [
      { ...task("2026-01-01", "2026-01-05"), id: "t1", kraene: ["k1", "k2"] },
      { ...task("2026-01-01", "2026-01-05"), id: "t2", kraene: ["k2"] },
    ];
    const neu = kranAusTasksEntfernen(tasks, "k1");
    expect(neu.find(t => t.id === "t1")?.kraene).toEqual(["k2"]);
    expect(neu.find(t => t.id === "t2")?.kraene).toEqual(["k2"]);
  });

  it("leert kraene komplett (undefined), wenn der letzte zugeordnete Kran entfernt wird", () => {
    const tasks: Task[] = [{ ...task("2026-01-01", "2026-01-05"), id: "t1", kraene: ["k1"] }];
    const neu = kranAusTasksEntfernen(tasks, "k1");
    expect(neu[0].kraene).toBeUndefined();
  });
});

describe("kranstundenProKranUndBucket", () => {
  const stammdaten: Stammdaten = {
    arbeitszeitStdProTag: 8,
    gewerke: [{
      key: "beton", label: "Beton", einheit: "m3",
      raten: [{ kuerzel: "WB", bezeichnung: "Wand", leistungswertHProEinheit: 1, anzahlPersonen: 2, chfProEinheit: null, kranpflichtig: true }],
    }],
  };
  const k1: Kran = { id: "k1", name: "Kran 1" };
  const k2: Kran = { id: "k2", name: "Kran 2" };
  // Mo 5.1.2026 – Fr 9.1.2026, eine volle Arbeitswoche (5 Werktage)
  const taskWoche: Task = { id: "t1", name: "T", start: "2026-01-05", end: "2026-01-09", typ: "neubau", objektGuids: [],
    bauteilKuerzel: "WB", mengen: { beton: 5 }, kraene: ["k1", "k2"] };

  it("verteilt den Bedarf gleichmässig auf die zugeordneten Kräne (2 Kräne → je 0.5)", () => {
    const { buckets, serien } = kranstundenProKranUndBucket([taskWoche], [k1, k2], stammdaten, LEERER_KALENDER, "woche");
    expect(buckets.length).toBe(1);
    // 5 m3 × 1 h = 5 Personenstunden ÷ Kolonne 2 = 2,5 Kranstunden × Anteil 0.5 = 1,25 h je Kran
    expect(serien.find(s => s.kranId === "k1")?.bedarf[0]).toBeCloseTo(1.25);
    expect(serien.find(s => s.kranId === "k2")?.bedarf[0]).toBeCloseTo(1.25);
  });

  it("Kranstunden = Aufwand ÷ Kolonne, unabhängig von der Dauer im Gantt (Stütze 1 Tag statt 2 h)", () => {
    const stuetze: Task = { ...taskWoche, id: "s", start: "2026-01-05", end: "2026-01-05", mengen: { beton: 4 }, kraene: ["k1"] };
    const { serien } = kranstundenProKranUndBucket([stuetze], [k1], stammdaten, LEERER_KALENDER, "woche");
    expect(serien[0].bedarf[0]).toBeCloseTo(2); // 4 h ÷ 2 Personen, nicht 8 h (ganzer Tag)
  });

  it("Kapazität = verfügbare Arbeitstage × Arbeitszeit — kein Engpass, wenn beide Kräne durchgehend verfügbar sind", () => {
    const { serien } = kranstundenProKranUndBucket([taskWoche], [k1, k2], stammdaten, LEERER_KALENDER, "woche");
    const s1 = serien.find(s => s.kranId === "k1")!;
    expect(s1.kapazitaet[0]).toBe(40); // 5 Arbeitstage × 8h
    expect(s1.bedarf[0]).toBeLessThanOrEqual(s1.kapazitaet[0]);
  });

  it("Kran im Bucket nicht verfügbar: Bedarf geht an den verfügbaren Kran des Tasks, ohne jeden Kran an «Ohne Kran»", () => {
    const nichtVerfuegbar: Kran = { id: "k2", name: "Kran 2", verfuegbarBis: "2026-01-04" }; // vor Taskbeginn
    const beide = kranstundenProKranUndBucket([taskWoche], [k1, nichtVerfuegbar], stammdaten, LEERER_KALENDER, "woche");
    expect(beide.serien.find(s => s.kranId === "k2")!.bedarf[0]).toBe(0);
    expect(beide.serien.find(s => s.kranId === "k1")!.bedarf[0]).toBeGreaterThan(0);
    const keiner = kranstundenProKranUndBucket([{ ...taskWoche, kraene: ["k2"] }], [k1, nichtVerfuegbar], stammdaten, LEERER_KALENDER, "woche");
    expect(keiner.ohneKran[0]).toBeGreaterThan(0);
    expect(keiner.serien.every(s => s.bedarf[0] === 0)).toBe(true);
    const luecken = kranLuecken([{ ...taskWoche, kraene: ["k2"] }], [k1, nichtVerfuegbar], stammdaten, LEERER_KALENDER);
    expect(luecken.ohneKran.taskIds).toEqual(["t1"]);
  });

  it("kein Bedarf, wenn kein Gewerk am Task kranpflichtig ist", () => {
    const nichtKranpflichtig: Stammdaten = { ...stammdaten, gewerke: [{ ...stammdaten.gewerke[0], raten: [{ ...stammdaten.gewerke[0].raten[0], kranpflichtig: false }] }] };
    const { serien } = kranstundenProKranUndBucket([taskWoche], [k1, k2], nichtKranpflichtig, LEERER_KALENDER, "woche");
    expect(serien.every(s => s.bedarf.every(v => v === 0))).toBe(true);
  });
});

describe("Kran fehlt direkt beheben (Kran verlängern)", () => {
  const t = (id: string, kraene?: string[]): Task => ({ id, name: id, start: "2026-12-14", end: "2026-12-22", typ: "neubau", objektGuids: [], kraene });
  const k1: Kran = { id: "k1", name: "Kran 1", verfuegbarVon: "2026-10-05", verfuegbarBis: "2026-12-12",
    personal: [{ id: "p1", unternehmer: "Baumeister", personen: 10, von: "2026-10-05", bis: "2026-12-12" }, { id: "p2", unternehmer: "Eisen", personen: 2, bis: "2026-11-30" }] };
  const luecke = { tage: ["2026-12-14", "2026-12-22"], taskIds: ["A", "B"] };

  it("ein Kran: bis zum letzten fehlenden Tag verlängern, Personal-Zeilen am alten Ende mit", () => {
    const v = kranVerlaengernVorschlag([t("A"), t("B")], [k1], luecke);
    expect(v).toEqual({ kranId: "k1", von: undefined, bis: "2026-12-22" });
    const neu = kranVerlaengern([k1], v!)[0];
    expect(neu.verfuegbarBis).toBe("2026-12-22");
    expect(neu.personal?.map(p => p.bis)).toEqual(["2026-12-22", "2026-11-30"]); // Eisen endete vorher → bleibt
  });

  it("mehrere Kräne: der Kran, dem die Tasks zugewiesen sind; ohne Zuweisung kein Vorschlag", () => {
    const k2: Kran = { id: "k2", name: "Kran 2", verfuegbarVon: "2026-10-05", verfuegbarBis: "2026-12-01" };
    expect(kranVerlaengernVorschlag([t("A", ["k2"]), t("B", ["k2"])], [k1, k2], luecke)?.kranId).toBe("k2");
    expect(kranVerlaengernVorschlag([t("A"), t("B")], [k1, k2], luecke)).toBeNull();
  });

  it("Lücke vor der Verfügbarkeit: früher verfügbar machen", () => {
    expect(kranVerlaengernVorschlag([t("A")], [k1], { tage: ["2026-10-01"], taskIds: ["A"] })).toEqual({ kranId: "k1", von: "2026-10-01", bis: undefined });
  });
});
