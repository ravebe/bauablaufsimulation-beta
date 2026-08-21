// kalenderHelpers.ts — Arbeitstage-Kalender (Wochenenden + Feiertage), Grundlage für
// kalenderbewusste Dauer-Berechnung bei Aufgaben/Export sowie künftige Ressourcen-/Kostenplanung.
import { parseDateUniversal } from "../types";

export type Feiertag = { datum: string; name: string }; // YYYY-MM-DD
export type Kalender = { feiertage: Feiertag[] };
export const LEERER_KALENDER: Kalender = { feiertage: [] };

/** Ist dieses Datum ein Arbeitstag (kein Wochenende, kein Feiertag im Kalender)? */
export function istArbeitstag(datum: string, kalender: Kalender): boolean {
  const d = parseDateUniversal(datum);
  if (!d) return true;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !kalender.feiertage.some(f => f.datum === datum);
}

/** Anzahl Arbeitstage zwischen start und end (inklusive beider Enden), mindestens 1. */
export function arbeitstageZwischen(start: string, end: string, kalender: Kalender): number {
  const s = parseDateUniversal(start);
  const e = parseDateUniversal(end);
  if (!s || !e) return 1;
  let count = 0;
  const cur = new Date(s.getTime());
  while (cur.getTime() <= e.getTime()) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    if (istArbeitstag(iso, kalender)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Ostersonntag nach der Gauß'schen Osterformel. */
function ostersonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, monat - 1, tag);
}

/** Schweizer Standard-Feiertage (national/weitverbreitet) für ein Jahr — danach frei editierbar. */
export function schweizerFeiertage(jahr: number): Feiertag[] {
  const ostern = ostersonntag(jahr);
  const plusTage = (basis: Date, tage: number) => {
    const d = new Date(basis.getTime());
    d.setDate(d.getDate() + tage);
    return d;
  };
  return [
    { datum: `${jahr}-01-01`, name: "Neujahr" },
    { datum: `${jahr}-01-02`, name: "Berchtoldstag" },
    { datum: toIso(plusTage(ostern, -2)), name: "Karfreitag" },
    { datum: toIso(plusTage(ostern, 1)), name: "Ostermontag" },
    { datum: `${jahr}-05-01`, name: "Tag der Arbeit" },
    { datum: toIso(plusTage(ostern, 39)), name: "Auffahrt" },
    { datum: toIso(plusTage(ostern, 50)), name: "Pfingstmontag" },
    { datum: `${jahr}-08-01`, name: "Bundesfeier" },
    { datum: `${jahr}-12-25`, name: "Weihnachten" },
    { datum: `${jahr}-12-26`, name: "Stephanstag" },
  ];
}
