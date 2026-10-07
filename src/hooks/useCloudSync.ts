// useCloudSync.ts — Laden und Speichern der Simulationen (Cloud via api/sync.js + lokale Kopie als Cache).
//  Laden:     lokale Kopie + Cloud in EINEM Ablauf zusammenführen (fuehreZusammen, syncHelpers.ts). Früher
//             zwei Effekte — die lokale Kopie konnte den Cloud-Stand überschreiben bzw. von anderen
//             gelöschte Sims wiederbeleben. Cloud nicht erreichbar → lokaler Stand, Speichern pausiert.
//  Speichern: 400 ms nach jeder Änderung, strikt nacheinander (Queue) — sich überschneidende Vorgänge
//             blockierten sich sonst als "Konflikt". Ein Fehler darf die Queue nie abbrechen (sonst wird
//             nie wieder gespeichert, siehe QuotaExceededError 2026-10-07). Beim Verlassen sofort speichern.
//  Konflikt:  jemand anderes hat gespeichert → pausieren, Nutzer entscheidet ("Neu laden").
import { useCallback, useEffect, useRef, useState } from "react";
import type { SimProjekt } from "../types";
import { SIMS_KEY, AKTIV_KEY, nsKey } from "../types";
import type { ApiInstance } from "./useApi";
import { cloudSave, cloudLoad, cloudLaden } from "./useApi";
import { lsGet, lsGetJson, lsSet, lsSetSimsCache } from "./lokalSpeicher";
import { CLOUD_IDS_KEY, fuehreZusammen, waehleAktivId } from "./syncHelpers";
import { fehlerMelden } from "./fehlerMelden";

export type SyncStatus = "idle" | "saving" | "saved" | "error";

interface Optionen {
  api: ApiInstance | null;
  ready: boolean;
  projectId: string | null;
  sims: SimProjekt[];
  setSims: (s: SimProjekt[]) => void;
  aktivId: string | null;
  setAktivId: (id: string | null) => void;
  /** Stand wurde von aussen ersetzt (Laden, Konflikt) — z.B. Rückgängig-Verlauf leeren */
  onStandErsetzt?: () => void;
}

export function useCloudSync({ api, ready, projectId, sims, setSims, aktivId, setAktivId, onStandErsetzt }: Optionen) {
  const onStandErsetztRef = useRef(onStandErsetzt);
  useEffect(() => { onStandErsetztRef.current = onStandErsetzt; });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncFehler, setSyncFehler] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [konflikt, setKonflikt] = useState(false);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [ladeVersuch, setLadeVersuch] = useState(0);
  const cloudVersion = useRef(0);
  const projektIdRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  // --- Laden ---
  useEffect(() => {
    if (!api || !ready) return;
    let abgebrochen = false;
    (async () => {
      const r = await cloudLaden(api);
      if (abgebrochen) return;
      const pid = r.projectId ?? projectId;
      projektIdRef.current = pid;
      const lokal = lsGetJson<SimProjekt[]>(nsKey(SIMS_KEY, pid), []);
      const lokalAid = lsGet(nsKey(AKTIV_KEY, pid));
      if (r.status === "fehler") {
        // Cloud nicht erreichbar: lokalen Stand anzeigen, aber NICHT speichern (würde sonst als Konflikt
        // enden oder einen veralteten Stand hochladen) — Hinweis mit "Erneut laden"
        setSims(lokal);
        onStandErsetztRef.current?.();
        setAktivId(waehleAktivId(lokalAid, null, lokal));
        setLadeFehler(r.fehler);
        fehlerMelden("Cloud-Laden", r.fehler);
        return;
      }
      const cloudSims = r.status === "ok" && Array.isArray(r.data.sims) ? r.data.sims as SimProjekt[] : [];
      const bekannt = lsGetJson<string[] | null>(nsKey(CLOUD_IDS_KEY, pid), null);
      const erg = fuehreZusammen(lokal, cloudSims, bekannt);
      if (erg.geloeschtVerworfen.length) console.log("[CloudSync] In der Cloud gelöscht, lokale Kopie verworfen:", erg.geloeschtVerworfen.length);
      if (erg.nurLokalBehalten.length) console.log("[CloudSync] Nur lokal vorhanden, wird hochgeladen:", erg.nurLokalBehalten.length);
      lsSet(nsKey(CLOUD_IDS_KEY, pid), JSON.stringify(cloudSims.map(s => s.id)));
      cloudVersion.current = r.version;
      setSims(erg.sims);
      onStandErsetztRef.current?.();
      setAktivId(waehleAktivId(lokalAid, r.status === "ok" ? (r.data.aktivId as string | null) ?? null : null, erg.sims));
      setLadeFehler(null);
      setGeladen(true);
    })();
    return () => { abgebrochen = true; };
    // projectId nur als Fallback-Schlüssel — kein Neuladen, wenn er später nachkommt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ready, ladeVersuch]);

  // --- Konflikt: aktuelle Cloud-Version übernehmen und weiterarbeiten ---
  const konfliktAufloesen = useCallback(async () => {
    if (!api) return;
    try {
      const data = await cloudLoad(api);
      if (data) {
        if (Array.isArray(data.sims)) {
          setSims(data.sims as SimProjekt[]);
          onStandErsetztRef.current?.();
          const pid = projektIdRef.current ?? projectId;
          lsSetSimsCache(nsKey(SIMS_KEY, pid), JSON.stringify(data.sims));
          lsSet(nsKey(CLOUD_IDS_KEY, pid), JSON.stringify((data.sims as SimProjekt[]).map(s => s.id)));
        }
        if (data.aktivId) setAktivId(data.aktivId as string);
        if (typeof data.version === "number") cloudVersion.current = data.version;
      }
    } catch { /* ignore */ }
    setKonflikt(false);
  }, [api, projectId, setSims, setAktivId]);

  // --- Speichern ---
  const speichern = useCallback((simsData: SimProjekt[], aid: string | null) => {
    saveQueue.current = saveQueue.current.then(async () => {
      // Lokale Kopie ist nur ein Cache — darf das Cloud-Speichern nie verhindern (localStorage voll)
      const pid = projektIdRef.current ?? projectId;
      lsSetSimsCache(nsKey(SIMS_KEY, pid), JSON.stringify(simsData));
      if (aid) lsSet(nsKey(AKTIV_KEY, pid), aid);
      if (!api) return;
      setSyncStatus("saving");
      try {
        // Sicherheitsnetz: ein leerer Zustand darf bestehende Cloud-Daten nie stillschweigend
        // überschreiben (Schutz gegen Timing-Bugs, fehlgeschlagenes Laden etc.)
        if (simsData.length === 0) {
          const bestehend = await cloudLoad(api);
          if (bestehend && Array.isArray(bestehend.sims) && bestehend.sims.length > 0) {
            console.warn("[CloudSync] Speichern übersprungen — Cloud hat noch Daten, lokal aber leer");
            setSyncStatus("idle");
            return;
          }
        }
        const result = await cloudSave(api, { sims: simsData, aktivId: aid }, cloudVersion.current);
        if (result.ok) {
          cloudVersion.current = result.version;
          lsSet(nsKey(CLOUD_IDS_KEY, pid), JSON.stringify(simsData.map(s => s.id))); // diese Sims sind jetzt in der Cloud
          setSyncFehler(null);
          setSyncStatus("saved");
          setTimeout(() => setSyncStatus("idle"), 2000);
        } else if (result.conflict) {
          setKonflikt(true);
          setSyncFehler("Konflikt — jemand anderes hat inzwischen gespeichert");
          setSyncStatus("error");
        } else {
          setSyncFehler(result.fehler);
          setSyncStatus("error");
          fehlerMelden("Cloud-Speichern", result.fehler);
        }
      } catch (e) { setSyncFehler(e instanceof Error ? e.message : String(e)); setSyncStatus("error"); fehlerMelden("Cloud-Speichern", e); }
    }).catch(e => {
      // Eine abgelehnte Queue überspringt jeden weiteren .then() — danach würde nie wieder gespeichert
      console.error("[CloudSync] Speichern fehlgeschlagen:", e);
      fehlerMelden("Speicher-Queue", e);
      setSyncFehler(e instanceof Error ? e.message : String(e));
      setSyncStatus("error");
    });
  }, [api, projectId]);

  useEffect(() => {
    // Erst speichern, wenn das Laden abgeschlossen ist — sonst überschreibt der leere Startzustand echte
    // Cloud-Daten. Bei ungelöstem Konflikt pausieren, bis der Nutzer neu geladen hat.
    if (!ready || !geladen || konflikt) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => speichern(sims, aktivId), 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [sims, aktivId, speichern, ready, geladen, konflikt]);

  // Beim Tab-Wechsel/Schliessen sofort speichern statt auf die Verzögerung zu warten
  useEffect(() => {
    const sofortSpeichern = () => {
      if (document.visibilityState === "visible") return; // nur beim Verlassen/Verstecken
      if (konflikt) return; // bei ungelöstem Konflikt nicht blind weiterspeichern
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; speichern(sims, aktivId); }
    };
    document.addEventListener("visibilitychange", sofortSpeichern);
    window.addEventListener("pagehide", sofortSpeichern);
    return () => {
      document.removeEventListener("visibilitychange", sofortSpeichern);
      window.removeEventListener("pagehide", sofortSpeichern);
    };
  }, [sims, aktivId, speichern, konflikt]);

  return {
    syncStatus, syncFehler, geladen, konflikt, konfliktAufloesen, ladeFehler,
    erneutLaden: () => { setLadeFehler(null); setLadeVersuch(v => v + 1); },
  };
}
