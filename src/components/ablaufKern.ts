// ablaufKern.ts — Gemeinsamer Rechenkern für "Auslastung optimieren" (auslastungOptimierenKran.ts) und den Tagesablauf in Tab AVOR
// (tagesplan.ts): wer in einem Zeitschritt welche Arbeit bekommt. Beide rechnen mit genau diesen Regeln, demselben Zeitschritt
// (slotsProTag) und derselben Arbeit je Zeitschritt — so gibt es zwischen den Tabs keine Unterschiede.
//  - Personal unter dem Kran (Tab Ressourcen → Kräne & Personal): je Kran ein Pool je Unternehmer, Allrounder für alle seine
//    kranpflichtigen Leistungspositionen an Tasks dieses Krans. Eine Arbeit bekommt mindestens ihre Min. Personen (bzw. den ganzen
//    Pool, wenn er kleiner ist), freie Leute verstärken bis auf MAX_VERSTAERKUNG × Min. Personen. Je Kran höchstens sein Personal
//    (MAX_UEBERZUG mehr nur, wenn sonst Leute untätig wären).
//  - Ohne Pool (nicht kranpflichtig, Task ohne Kran, Unternehmer ohne Personal unter dem Kran): je Gewerk + Unternehmer eine
//    Kolonne, die immer nur an einer Arbeit gleichzeitig arbeitet, mit den Min. Personen dieser Leistungsposition — sie geht von
//    Arbeit zu Arbeit (z.B. Bewehrung Wand → Bewehrung Stütze, sobald diese geschalt ist).
//  - Kranzeit: eine kranpflichtige Arbeit belegt ihren Kran mit Leute ÷ Min. Personen × Kranzeit % (bei mehreren verfügbaren
//    Kränen des Tasks aufgeteilt); je Zeitschritt hat jeder Kran höchstens einen Zeitschritt Kranzeit.
import type { Kran } from "../types";
import { MIN_PRO_ARBEITSTAG } from "./zeitHelpers";
import { kranPersonalAmTag, kranPersonalTotalAmTag, istKranVerfuegbarAn, kolonnenSchluessel } from "./kranHelpers";
export { kolonnenSchluessel };

/** Eine Arbeit bekommt höchstens so viele Leute: Min. Personen × MAX_VERSTAERKUNG (mehr Leute an einem Bauteil behindern sich). */
export const MAX_VERSTAERKUNG = 2;
/** So viele Leute darf ein Kran in einem Zeitschritt höchstens über seinem Personal haben — nur wenn sonst Leute untätig wären,
 *  weil die nächste Arbeit mehr Min. Personen braucht als frei sind (z.B. 2 frei, Min. 4 → 2 zusätzlich). */
export const MAX_UEBERZUG = 2;
/** Bleibt einem Task am Tagesende höchstens dieser Anteil seiner Arbeit, wird er am selben Tag in Überstunden fertig. */
export const UEBERSTUNDEN_ANTEIL = 0.05;
const EPS = 1e-6;

/** Zeitschritte je Arbeitstag (rund eine halbe Stunde) — ein Zeitschritt leistet je Person Std./Tag ÷ slotsProTag Stunden. */
export function slotsProTag(): number { return Math.max(1, Math.round(MIN_PRO_ARBEITSTAG / 30)); }


/** Kräne & Personal als Text — ein gespeicherter Ablauf (Task.tagesArbeit) gilt nur, solange er gleich bleibt */
export function kranSchluessel(kraene: Kran[]): string {
  const text = JSON.stringify(kraene.map(k => [k.id, k.verfuegbarVon ?? "", k.verfuegbarBis ?? "", k.personal ?? []]));
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Eine Arbeit im Kern: rest in Personenstunden */
export interface KernPhase { position: string; gewerkKey: string; unternehmer: string; kranpflichtig: boolean; kolonne: number; kranAnteil: number; rest: number }
/** Arbeiten eines Tasks, die jetzt laufen dürfen (aktueller Schritt), mit den Kränen des Tasks (kraeneDesTasks) */
export interface KernAufgabe<T> { ref: T; phasen: KernPhase[]; kranIds: string[] }
export interface KernVergabe<T> {
  ref: T; p: KernPhase; leute: number;
  ressource: string; // Pool "kranId|Unternehmer" oder Kolonne (kolonnenSchluessel)
  ausPool: boolean; kranId: string | null; kranIds: string[]; // kranIds = heute verfügbare Kräne der Arbeit
  kranBegrenzt: boolean; // Verstärkung durch die Kranzeit begrenzt
}

/** Ressourcen eines Zeitschritts an einem Tag. kranWarten: eine kranpflichtige Arbeit, deren Kran heute nicht, aber später
 *  verfügbar ist, wartet (Optimieren); sonst arbeitet sie ohne Kran (Tagesablauf mit fester Arbeit des Tages). */
export class Zeitschritt<T> {
  private kranFrei = new Map<string, number>();
  private pool = new Map<string, number>();
  private poolGroesse = new Map<string, number>();
  private kranTotal = new Map<string, number>();
  private ueberzug = new Map<string, number>();
  private kranZeit = new Map<string, number>();
  private kolonneBelegt = new Set<string>();
  private kranById: Map<string, Kran>;
  readonly vergabe: KernVergabe<T>[] = [];
  private besetzt = new Set<KernPhase>();
  /** Arbeiten, die in diesem Zeitschritt wegen der Kranzeit nicht anfangen konnten */
  readonly kranWartend = new Set<KernPhase>();

  private iso: string;
  private slotStd: number;
  private kranWarten: boolean;

  constructor(iso: string, kraene: Kran[], slotStd: number, kranWarten: boolean) {
    this.iso = iso;
    this.slotStd = slotStd;
    this.kranWarten = kranWarten;
    this.kranById = new Map(kraene.map(k => [k.id, k]));
    for (const k of kraene) {
      if (!istKranVerfuegbarAn(k, iso)) continue;
      this.kranZeit.set(k.id, 1);
      const total = kranPersonalTotalAmTag(k, iso);
      this.kranTotal.set(k.id, total > 0 ? total : Infinity);
      this.kranFrei.set(k.id, total > 0 ? total : Infinity);
      for (const [u, n] of kranPersonalAmTag(k, iso)) { this.pool.set(`${k.id}|${u}`, n); this.poolGroesse.set(`${k.id}|${u}`, n); }
    }
  }

  /** Heute verfügbare Kräne einer Arbeit */
  kraeneHeute(p: KernPhase, kranIds: string[]): string[] { return p.kranpflichtig ? kranIds.filter(id => this.kranFrei.has(id)) : []; }
  /** Pool, aus dem die Arbeit besetzt wird (null = Kolonne ohne Pool) */
  poolDer(p: KernPhase, kranIds: string[]): { key: string; kid: string } | null {
    if (!p.unternehmer) return null;
    for (const kid of this.kraeneHeute(p, kranIds)) {
      const key = `${kid}|${p.unternehmer}`;
      if (this.poolGroesse.has(key)) return { key, kid };
    }
    return null;
  }

  private reicht(frei: number, noetig: number, kid: string, mitUeberzug: boolean) {
    return frei >= noetig || (mitUeberzug && frei > 0 && noetig - frei <= MAX_UEBERZUG - (this.ueberzug.get(kid) ?? 0));
  }
  private abziehen(kid: string, n: number) {
    const frei = this.kranFrei.get(kid)!;
    if (n > frei && isFinite(frei)) this.ueberzug.set(kid, (this.ueberzug.get(kid) ?? 0) + n - Math.max(0, frei));
    this.kranFrei.set(kid, frei - n);
  }
  /** Kranzeit, die leute an dieser Arbeit je Kran belegen (auf die verfügbaren Kräne aufgeteilt) */
  private kranBelegung(ids: string[], p: KernPhase, leute: number) { return ids.length > 0 ? leute / Math.max(1, p.kolonne) * p.kranAnteil / ids.length : 0; }
  private kranZeitReicht(ids: string[], p: KernPhase, leute: number) { return ids.every(id => (this.kranZeit.get(id) ?? 0) + EPS >= this.kranBelegung(ids, p, leute)); }
  private kranZeitAbziehen(ids: string[], p: KernPhase, leute: number) { for (const id of ids) this.kranZeit.set(id, (this.kranZeit.get(id) ?? 0) - this.kranBelegung(ids, p, leute)); }
  /** So viele Leute passen zusätzlich an diese Arbeit, bevor die Kranzeit ausgeht */
  private kranZeitPlatz(ids: string[], p: KernPhase) {
    return ids.length === 0 || p.kranAnteil <= 0 ? Infinity : Math.floor(Math.min(...ids.map(id => this.kranZeit.get(id) ?? 0)) / this.kranBelegung(ids, p, 1) + EPS);
  }

  /** Mindestbesetzung einer Arbeit vergeben (nichts vergeben = kann in diesem Zeitschritt nicht arbeiten). */
  besetzen(a: KernAufgabe<T>, p: KernPhase, mitUeberzug: boolean, nurPool = false) {
    const braucht = Math.max(1, Math.ceil(p.rest / this.slotStd - EPS));
    const kranIds = p.kranpflichtig ? a.kranIds : [];
    const heute = this.kraeneHeute(p, a.kranIds);
    // Kran der Arbeit: verfügbar heute? Sonst warten, solange er später noch verfügbar wird
    if (this.kranWarten && kranIds.length > 0 && heute.length === 0
      && kranIds.some(id => { const b = this.kranById.get(id)?.verfuegbarBis; return !b || b > this.iso; })) return;
    // 1) Pool desselben Unternehmers unter einem Kran des Tasks
    const pool = this.poolDer(p, a.kranIds);
    if (pool) {
      const mindest = Math.min(p.kolonne, braucht, this.poolGroesse.get(pool.key)!);
      const frei = Math.min(this.pool.get(pool.key) ?? 0, this.kranFrei.get(pool.kid) ?? 0);
      if (!this.reicht(frei, mindest, pool.kid, mitUeberzug)) return;
      if (!this.kranZeitReicht(heute, p, mindest)) { this.kranWartend.add(p); return; }
      this.pool.set(pool.key, this.pool.get(pool.key)! - mindest);
      this.abziehen(pool.kid, mindest);
      this.kranZeitAbziehen(heute, p, mindest);
      this.vergabe.push({ ref: a.ref, p, leute: mindest, ressource: pool.key, ausPool: true, kranId: pool.kid, kranIds: heute, kranBegrenzt: false });
      this.besetzt.add(p);
      return; // Unternehmer hat Personal unter diesem Kran → nur aus dem Pool
    }
    if (nurPool) return;
    // 2) Kolonne ohne Pool (Gewerk + Unternehmer, eine Arbeit gleichzeitig); kranpflichtige zählen zum Personal eines Krans des Tasks
    const kolonne = kolonnenSchluessel(p.gewerkKey, p.unternehmer);
    if (this.kolonneBelegt.has(kolonne)) return;
    let kranId: string | null = null;
    if (heute.length > 0) {
      if (!this.kranZeitReicht(heute, p, p.kolonne)) { this.kranWartend.add(p); return; }
      kranId = heute.find(kid => this.reicht(this.kranFrei.get(kid) ?? 0, Math.min(p.kolonne, this.kranTotal.get(kid)!), kid, mitUeberzug)) ?? null;
      if (!kranId) return;
      this.abziehen(kranId, Math.min(p.kolonne, this.kranTotal.get(kranId)!));
      this.kranZeitAbziehen(heute, p, p.kolonne);
    }
    this.kolonneBelegt.add(kolonne);
    this.vergabe.push({ ref: a.ref, p, leute: p.kolonne, ressource: kolonne, ausPool: false, kranId, kranIds: heute, kranBegrenzt: false });
    this.besetzt.add(p);
  }

  /** Übriges Personal der Pools auf laufende Arbeiten desselben Unternehmers/Krans (grösster Rest zuerst) */
  verstaerken() {
    for (const v of [...this.vergabe].filter(v => v.ausPool).sort((a, b) => b.p.rest - a.p.rest)) {
      const sinnvoll = Math.max(1, Math.ceil(v.p.rest / this.slotStd - EPS));
      const wunsch = Math.min(this.pool.get(v.ressource) ?? 0, this.kranFrei.get(v.kranId!) ?? 0, MAX_VERSTAERKUNG * v.p.kolonne - v.leute, sinnvoll - v.leute);
      if (wunsch <= 0) continue;
      const extra = Math.min(wunsch, this.kranZeitPlatz(v.kranIds, v.p));
      if (extra < wunsch) v.kranBegrenzt = true;
      if (extra <= 0) continue;
      v.leute += extra;
      this.kranZeitAbziehen(v.kranIds, v.p, extra);
      this.pool.set(v.ressource, this.pool.get(v.ressource)! - extra);
      this.kranFrei.set(v.kranId!, this.kranFrei.get(v.kranId!)! - extra);
    }
  }

  /** Schon feststehende Arbeit (gespeicherter Ablauf eines Tasks) belegt Personal, Kolonne und Kranzeit dieses Zeitschritts. */
  vorbelegen(p: KernPhase, kranIds: string[], leute: number, anteil = 1) {
    const heute = this.kraeneHeute(p, kranIds);
    const pool = this.poolDer(p, kranIds);
    if (pool) {
      this.pool.set(pool.key, (this.pool.get(pool.key) ?? 0) - leute);
      this.abziehen(pool.kid, leute);
    } else {
      this.kolonneBelegt.add(kolonnenSchluessel(p.gewerkKey, p.unternehmer));
      if (heute.length > 0) this.abziehen(heute[0], Math.min(leute, this.kranTotal.get(heute[0])!));
    }
    this.kranZeitAbziehen(heute, p, leute * anteil);
  }

  istBesetzt(p: KernPhase) { return this.besetzt.has(p); }
}

/** Vergabe eines Zeitschritts: zuerst die Mindestbesetzung der Kandidaten (in ihrer Reihenfolge), dann Verstärkung; sind danach
 *  noch Leute eines Pools frei, Lückenfüller (nur aus dem Pool) und nochmals Verstärkung; zuletzt startet eine Arbeit trotzdem,
 *  wenn ihr höchstens MAX_UEBERZUG Leute fehlen. */
export function vergebeZeitschritt<T>(z: Zeitschritt<T>, kandidaten: KernAufgabe<T>[], fueller: KernAufgabe<T>[] = []): KernVergabe<T>[] {
  for (const a of kandidaten) for (const p of a.phasen) if (p.rest > EPS) z.besetzen(a, p, false);
  z.verstaerken();
  if (fueller.length > 0) {
    for (const a of fueller) for (const p of a.phasen) if (p.rest > EPS) z.besetzen(a, p, false, true);
    z.verstaerken();
  }
  for (const a of kandidaten) for (const p of a.phasen) if (p.rest > EPS && !z.istBesetzt(p)) z.besetzen(a, p, true);
  return z.vergabe;
}
