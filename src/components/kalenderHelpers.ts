// kalenderHelpers.ts — Arbeitstage-Kalender (Wochenenden + Feiertage), Grundlage für
// kalenderbewusste Dauer-Berechnung bei Aufgaben/Export sowie künftige Ressourcen-/Kostenplanung.
import { parseDateUniversal } from "../types";

export type Feiertag = { datum: string; name: string }; // YYYY-MM-DD
export type Ferienzeitraum = { von: string; bis: string; name: string }; // YYYY-MM-DD, inklusive
export type Kalender = { feiertage: Feiertag[]; ferien?: Ferienzeitraum[] };
export const LEERER_KALENDER: Kalender = { feiertage: [], ferien: [] };

/** ISO-8601-Kalenderwoche (Mo–So, KW1 enthält den ersten Donnerstag des Jahres). */
export function getKW(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

/** Ist dieses Datum ein Arbeitstag (kein Wochenende, kein Feiertag, keine Ferien im Kalender)? */
export function istArbeitstag(datum: string, kalender: Kalender): boolean {
  const d = parseDateUniversal(datum);
  if (!d) return true;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  if (kalender.feiertage.some(f => f.datum === datum)) return false;
  if ((kalender.ferien ?? []).some(f => datum >= f.von && datum <= f.bis)) return false;
  return true;
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

/** Enddatum, das ab `start` genau `dauerArbeitstage` Arbeitstage ergibt (mindestens 1) — die exakte
 *  Umkehrung von arbeitstageZwischen(). Fällt `start` selbst auf einen Nicht-Arbeitstag, zählt er
 *  nicht mit; das Enddatum verschiebt sich entsprechend nach hinten. */
export function endDatumAusArbeitstagen(start: string, dauerArbeitstage: number, kalender: Kalender): string {
  const s = parseDateUniversal(start);
  if (!s) return start;
  const dauer = Math.max(1, dauerArbeitstage);
  const cur = new Date(s.getTime());
  let count = 0;
  let end = toIso(cur);
  for (;;) {
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) { count++; end = iso; }
    if (count >= dauer) break;
    cur.setDate(cur.getDate() + 1);
  }
  return end;
}

/** Erster Arbeitstag NACH dem Datum. */
export function naechsterArbeitstag(datum: string, kalender: Kalender): string {
  const d = parseDateUniversal(datum);
  if (!d) return datum;
  const cur = new Date(d.getTime());
  for (let i = 0; i < 4000; i++) {
    cur.setDate(cur.getDate() + 1);
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) return iso;
  }
  return datum;
}

/** n Arbeitstage weiter (n < 0: zurück). Fällt das Datum selbst auf einen Nicht-Arbeitstag, gilt bei n >= 0 der nächste, bei n < 0 der vorherige Arbeitstag als Ausgangspunkt. */
export function arbeitstagPlus(datum: string, n: number, kalender: Kalender): string {
  const d = parseDateUniversal(datum);
  if (!d) return datum;
  const cur = new Date(d.getTime());
  const schritt = n < 0 ? -1 : 1;
  // Ausgangspunkt auf einen Arbeitstag rücken
  for (let i = 0; i < 4000 && !istArbeitstag(toIso(cur), kalender); i++) cur.setDate(cur.getDate() + schritt);
  let rest = Math.abs(Math.round(n));
  for (let i = 0; rest > 0 && i < 40000; i++) {
    cur.setDate(cur.getDate() + schritt);
    if (istArbeitstag(toIso(cur), kalender)) rest--;
  }
  return toIso(cur);
}

/** Startdatum, das bei Ende `ende` genau `dauerArbeitstage` Arbeitstage ergibt (Umkehrung von endDatumAusArbeitstagen). */
export function startDatumAusArbeitstagen(ende: string, dauerArbeitstage: number, kalender: Kalender): string {
  return arbeitstagPlus(ende, -(Math.max(1, dauerArbeitstage) - 1), kalender);
}

/** Vorzeichenbehaftete Anzahl Arbeitstage von a nach b (b später → positiv). */
export function arbeitstageVersatz(a: string, b: string, kalender: Kalender): number {
  const da = parseDateUniversal(a), db = parseDateUniversal(b);
  if (!da || !db) return 0;
  const vor = da.getTime() <= db.getTime();
  const von = new Date((vor ? da : db).getTime()), bis = (vor ? db : da).getTime();
  let n = 0;
  for (let i = 0; i < 40000; i++) {
    von.setDate(von.getDate() + 1);
    if (von.getTime() > bis) break;
    if (istArbeitstag(toIso(von), kalender)) n++;
  }
  return vor ? n : -n;
}

/** Erster Arbeitstag am oder NACH dem Datum (ist es selbst ein Arbeitstag, bleibt es unverändert). */
export function ersterArbeitstagAb(datum: string, kalender: Kalender): string {
  const d = parseDateUniversal(datum);
  if (!d) return datum;
  const cur = new Date(d.getTime());
  for (let i = 0; i < 4000; i++) {
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) return iso;
    cur.setDate(cur.getDate() + 1);
  }
  return datum;
}

/** Startdatum eines Nachfolgers: Tag nach dem Ende des Vorgängers plus Wartetage — die Wartetage zählen als normale Kalendertage
 *  (Wochenenden, Feiertage und Ferien sind Wartezeit mit). Fällt der Start auf einen freien Tag, rückt er auf den nächsten Arbeitstag.
 *  Beispiel Vorgänger endet Freitag: 0 oder 1 oder 2 Wartetage → Montag, 3 → Dienstag, 4 → Mittwoch. Zwei aufeinanderfolgende Tasks belegen nie denselben Tag. */
export function folgeStart(vorgaengerEnde: string, wartetage: number, kalender: Kalender): string {
  const d = parseDateUniversal(vorgaengerEnde);
  if (!d) return vorgaengerEnde;
  const roh = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1 + Math.round(wartetage));
  return ersterArbeitstagAb(toIso(roh), kalender);
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
