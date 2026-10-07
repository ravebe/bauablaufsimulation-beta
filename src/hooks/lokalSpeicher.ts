// lokalSpeicher.ts — localStorage-Zugriff, der nie wirft. localStorage fasst je Herkunft nur ca. 5 MB
// (für ALLE Trimble-Connect-Projekte zusammen) und kann im iframe auch ganz gesperrt sein; ein
// ungefangener QuotaExceededError in einem Effect legt sonst die ganze Oberfläche lahm bzw. blockierte
// früher die Speicher-Queue (siehe App.tsx). Alles hier ist nur Cache/Komfort — massgebend ist die Cloud.
import { SIMS_KEY } from "../types";

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** true = gespeichert */
export function lsSet(key: string, wert: string): boolean {
  try { localStorage.setItem(key, wert); return true; } catch { return false; }
}

export function lsRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** JSON lesen; bei fehlendem/kaputtem Eintrag → fallback */
export function lsGetJson<T>(key: string, fallback: T): T {
  const raw = lsGet(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * Lokale Kopie der Simulationen eines Projekts. Ist der Speicher voll, werden die Kopien der anderen
 * Projekte geräumt (die liegen in der Cloud) und es wird nochmals versucht; reicht es dann immer noch
 * nicht, wird die eigene (sonst veraltete) Kopie entfernt.
 */
export function lsSetSimsCache(key: string, wert: string) {
  if (lsSet(key, wert)) return;
  let andere: string[] = [];
  try { andere = Object.keys(localStorage).filter(k => k !== key && k.startsWith(`${SIMS_KEY}::`)); } catch { /* gesperrt */ }
  andere.forEach(lsRemove);
  if (lsSet(key, wert)) {
    console.warn(`[CloudSync] localStorage voll — ${andere.length} lokale Kopie(n) anderer Projekte entfernt`);
    return;
  }
  lsRemove(key);
  console.warn("[CloudSync] Lokale Kopie nicht möglich (localStorage voll), nur Cloud");
}
