// syncHelpers.ts — reine Logik für das Zusammenführen von lokaler Kopie und Cloud-Stand beim Laden
// (ohne React/Netz, damit testbar). Siehe Ladeablauf in App.tsx.
import type { SimProjekt } from "../types";

export const CLOUD_IDS_KEY = "4d-sims-cloudids-v3"; // + "::projectId" — welche Sims zuletzt in der Cloud waren
export const CLOUD_VERSION_KEY = "4d-sims-cloudversion"; // + "::projectId" — Cloud-Version, zu der die lokale Kopie gehört

export interface LadeErgebnis {
  sims: SimProjekt[];
  /** nur lokal vorhanden und noch nie in der Cloud gewesen → bleiben und werden beim nächsten Speichern hochgeladen */
  nurLokalBehalten: string[];
  /** lokal vorhanden, waren schon in der Cloud, fehlen dort jetzt → wurden (von jemand anderem) gelöscht */
  geloeschtVerworfen: string[];
}

/**
 * Cloud ist massgebend. Simulationen, die nur in der lokalen Kopie stehen, werden nur behalten, wenn sie
 * nachweislich noch nie in der Cloud waren (z.B. offline angelegt / Speichern war blockiert) — sonst hat
 * jemand sie inzwischen gelöscht, und ein Behalten würde sie beim nächsten Speichern wiederbeleben.
 * Ohne Wissen, was in der Cloud war (bekannteCloudIds = null, z.B. erster Start nach dem Update), werden
 * nur-lokale Sims vorsichtshalber behalten (kein Datenverlust, wie bisher).
 */
export function fuehreZusammen(lokal: SimProjekt[], cloud: SimProjekt[], bekannteCloudIds: string[] | null): LadeErgebnis {
  const cloudIds = new Set(cloud.map(s => s.id));
  const bekannt = bekannteCloudIds ? new Set(bekannteCloudIds) : null;
  const nurLokalBehalten: string[] = [];
  const geloeschtVerworfen: string[] = [];
  const behalten: SimProjekt[] = [];
  for (const s of lokal) {
    if (cloudIds.has(s.id)) continue;
    if (bekannt?.has(s.id)) { geloeschtVerworfen.push(s.id); continue; }
    nurLokalBehalten.push(s.id);
    behalten.push(s);
  }
  return { sims: [...cloud, ...behalten], nurLokalBehalten, geloeschtVerworfen };
}

/**
 * Simulation aus einem früheren Stand (Versionsgeschichte) zurückholen — betrifft nur diese eine Sim,
 * nie das ganze Projekt. "kopie": als neue Sim daneben (Name mit Zeitstempel, Ersteller = wer
 * wiederherstellt), "ersetzen": die heutige Sim gleicher ID durch den früheren Stand ersetzen (fehlt sie
 * inzwischen, wird sie wieder angelegt).
 */
export function stelleSimWiederHer(sims: SimProjekt[], frueher: SimProjekt, modus: "kopie" | "ersetzen",
  standZeit: number, userId: string | null, neueId: () => string = () => crypto.randomUUID()): { sims: SimProjekt[]; id: string } {
  if (modus === "ersetzen") {
    const idx = sims.findIndex(s => s.id === frueher.id);
    if (idx < 0) return { sims: [...sims, frueher], id: frueher.id };
    return { sims: sims.map((s, i) => (i === idx ? frueher : s)), id: frueher.id };
  }
  const d = new Date(standZeit);
  const stempel = `${d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`;
  const kopie: SimProjekt = { ...frueher, id: neueId(), name: `${frueher.name} (Stand ${stempel})`, erstellerId: userId ?? frueher.erstellerId };
  return { sims: [...sims, kopie], id: kopie.id };
}

/** Aktive Simulation ist persönlich: eigene Wahl vor der in der Cloud gespeicherten, sonst die erste */
export function waehleAktivId(lokal: string | null, cloud: string | null, sims: SimProjekt[]): string | null {
  const gibt = (id: string | null) => !!id && sims.some(s => s.id === id);
  if (gibt(lokal)) return lokal;
  if (gibt(cloud)) return cloud;
  return sims[0]?.id ?? null;
}
