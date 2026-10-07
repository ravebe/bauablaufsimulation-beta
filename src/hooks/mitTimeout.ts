// mitTimeout.ts — Zeitlimits für alles, was hängen kann (Workspace-API, eigene Endpunkte, TC-Dateien).
// Ein hängender Aufruf liess früher Lade-Hinweise endlos drehen bzw. blockierte das Speichern; vorher
// stand an jeder Stelle ein eigenes Promise.race/AbortController-Konstrukt.

export class Zeitueberschreitung extends Error {
  constructor(was: string, ms: number) {
    super(`${was}: keine Antwort innerhalb von ${Math.round(ms / 1000)} s`);
    this.name = "Zeitueberschreitung";
  }
}

/** Wie p, aber spätestens nach ms abgelehnt (Zeitueberschreitung). */
export function mitTimeout<T>(p: Promise<T>, ms: number, was = "Anfrage"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Zeitueberschreitung(was, ms)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Wie p, aber nach ms (oder bei Fehler) mit `ersatz` aufgelöst — für optionale Abfragen. */
export function mitTimeoutOder<T>(p: Promise<T>, ms: number, ersatz: T): Promise<T> {
  return mitTimeout(p, ms).catch(() => ersatz);
}

/** fetch mit Zeitlimit — bricht die Anfrage wirklich ab (AbortController), nicht nur das Warten. */
export async function fetchMitTimeout(url: string, init: RequestInit = {}, ms = 30000, was = "Server"): Promise<Response> {
  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: abbruch.signal });
  } catch (e) {
    if (abbruch.signal.aborted) throw new Zeitueberschreitung(was, ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** fn bis zu `versuche` Mal ausführen, dazwischen `pauseMs` warten; wirft den letzten Fehler. */
export async function mitWiederholung<T>(fn: (versuch: number) => Promise<T>,
  { versuche = 3, pauseMs = 3000, onFehler }: { versuche?: number; pauseMs?: number; onFehler?: (e: unknown, versuch: number) => void } = {}): Promise<T> {
  let letzter: unknown;
  for (let v = 1; v <= versuche; v++) {
    try { return await fn(v); }
    catch (e) {
      letzter = e;
      onFehler?.(e, v);
      if (v < versuche) await new Promise(r => setTimeout(r, pauseMs));
    }
  }
  throw letzter;
}
