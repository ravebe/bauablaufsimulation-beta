import { useEffect, useRef, useState } from "react";
import type { TcModel, TcObjectWithProps, TcSelectionEvent } from "../types";
import { parseObjectIds } from "../types";
import { tcEventHandler, syncHeaders, syncTokenVerwerfen } from "./tcDateien";
import { fetchMitTimeout, mitTimeout, mitTimeoutOder } from "./mitTimeout";

// Entspricht ModelSpec der Trimble Connect Workspace API (viewer.getModels())
export interface TcModelSpec {
  id: string;
  name: string;
  type?: string;
  state?: string;
  versionId: string;
  isLatestVersion?: boolean;
}

// Entspricht ModelVersionIdentifier der Trimble Connect Workspace API
export interface TcModelVersionIdentifier {
  id: string;
  versionId?: string;
}

export interface ApiInstance {
  viewer: {
    getModels: () => Promise<TcModelSpec[]>;
    getLoadedModel: () => Promise<TcModel[]>;
    getObjects: (modelId: string) => Promise<unknown>;
    getObjectProperties: (modelId: string, ids: number[]) => Promise<TcObjectWithProps[]>;
    getLayers: (modelId: string) => Promise<{ name: string; visible: boolean }[]>;
    getHierarchyParents: (modelId: string, entityId: number) => Promise<number[]>;
    convertToObjectIds: (modelId: string, ids: number[]) => Promise<string[]>;
    convertToObjectRuntimeIds: (modelId: string, externalIds: string[]) => Promise<number[]>;
    setSelection: (ids: number[]) => Promise<void>;
    // Achtung: erwartet einen Selektor { modelObjectIds: [...] } — ein nacktes Array wird vom Viewer nicht als
    // Auswahl erkannt und wirkt auf ALLE Objekte (blendete z.B. beim Entfernen eines Bauteils das ganze Modell aus)
    setObjectState: (
      selector: { modelObjectIds: { modelId: string; objectRuntimeIds?: number[] }[] },
      state: { visible?: boolean; color?: { r: number; g: number; b: number; a: number } | null }
    ) => Promise<void>;
    isolateEntities: (
      entities: { modelId: string; objectRuntimeIds?: number[] }[]
    ) => Promise<boolean>;
    reset: () => Promise<void>;
    toggleModelVersion: (
      modelId: TcModelVersionIdentifier | TcModelVersionIdentifier[],
      load: boolean,
      fitToView?: boolean
    ) => Promise<void>;
    onSelectionChanged: {
      addListener: (cb: (event: TcSelectionEvent) => void) => void;
      removeListener: (cb: (event: TcSelectionEvent) => void) => void;
    };
  };
  extension: {
    requestPermission: (type: string) => Promise<string>;
    getSettings?: () => Promise<Record<string, unknown>>;
    setSettings?: (settings: Record<string, unknown>) => Promise<void>;
  };
  project: {
    getProject: () => Promise<{ id: string; name: string }>;
    getMembers?: () => Promise<TcProjectMember[]>;
  };
}

export interface TcProjectMember {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  status?: "ACTIVE" | "PENDING" | "REMOVED";
}

interface UseApiReturn {
  api: ApiInstance | null;
  ready: boolean;
  fehler: string | null;
  selektion: number[];
  aktivesModellId: string | null;
  geladeneModelle: { id: string; name: string }[];
  projectId: string | null;
}

export function useApi(): UseApiReturn {
  const [api, setApi] = useState<ApiInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [selektion, setSelektion] = useState<number[]>([]);
  const [aktivesModellId, setAktivesModellId] = useState<string | null>(null);
  const [geladeneModelle, setGeladeneModelle] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const selCbRef = useRef<((e: TcSelectionEvent) => void) | null>(null);

  useEffect(() => {
    let apiInst: ApiInstance | null = null;

    async function init() {
      try {
        let wapi = (window as any).TrimbleConnectWorkspace;
        if (!wapi) {
          await new Promise(r => setTimeout(r, 1500));
          wapi = (window as any).TrimbleConnectWorkspace;
        }
        if (!wapi) {
          setFehler("TC Workspace API nicht gefunden");
          return;
        }

        apiInst = (await wapi.connect(window.parent, tcEventHandler)) as ApiInstance;
        setApi(apiInst);

        // Projekt-ID laden — darf "ready" niemals blockieren, falls getProject()
        // in einzelnen Projekten hängt oder sehr lange braucht
        const projPromise = apiInst.project.getProject()
          .then(proj => { if (proj?.id) setProjectId(proj.id); return proj; })
          .catch(() => null);
        await mitTimeoutOder(projPromise, 2500, null);

        // Ab hier gilt die App als einsatzbereit — alles Folgende ist Zusatzfunktionalität
        // (Modell-/Selektions-Sync) und darf "ready" nicht mehr blockieren, falls sie fehlschlägt.
        // Vorher hing "ready" (und damit das Speichern!) am ungeschützten addListener weiter
        // unten — schlug der fehl, blieb ready für die ganze Sitzung lautlos false.
        setReady(true);
        setFehler(null);

        const ladeModelle = async () => {
          for (let i = 0; i < 8; i++) {
            try {
              const geladen = await apiInst!.viewer.getLoadedModel() as any;
              const arr = Array.isArray(geladen) ? geladen : geladen ? [geladen] : [];
              if (arr.length > 0) {
                setAktivesModellId(arr[0].id || arr[0].modelId);
                setGeladeneModelle(arr.map((m: any) => ({
                  id: m.id || m.modelId,
                  name: m.name || m.fileName || m.id
                })));
                return;
              }
            } catch { /* ignore */ }
            try {
              const modelle = await apiInst!.viewer.getModels() as any[];
              const geladen = modelle.filter((m: any) => m.state === 'loaded');
              const aktiv = geladen.length > 0 ? geladen : [];
              if (aktiv.length > 0) {
                setAktivesModellId(aktiv[0].id || aktiv[0].modelId);
                setGeladeneModelle(aktiv.map((m: any) => ({
                  id: m.id || m.modelId,
                  name: m.name || m.fileName || m.id
                })));
                return;
              }
            } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, i === 0 ? 0 : 100));
          }
        };
        ladeModelle();

        try {
          (apiInst.viewer as any).onModelStateChanged?.addListener((event: any) => {
            const data = event?.data;
            if (data?.state === 'loaded' && (data?.id || data?.modelId)) {
              setAktivesModellId(data.id || data.modelId);
            }
          });
        } catch (e) { console.error("[useApi] onModelStateChanged-Listener fehlgeschlagen:", e); }

        try {
          const cb = (event: TcSelectionEvent) => {
            const ids: number[] = [];
            const data = (event as any)?.data;
            if (Array.isArray(data)) {
              for (const item of data) {
                if (!item) continue;
                if (item.modelId) setAktivesModellId(item.modelId);
                const rIds = item.objectRuntimeIds ?? item.runtimeIds ?? item.ids ?? item.objectIds;
                if (Array.isArray(rIds)) {
                  ids.push(...rIds.map(Number).filter((n: number) => !isNaN(n)));
                } else if (Array.isArray(item.objects)) {
                  for (const o of item.objects) {
                    const n = Number(o?.id ?? o);
                    if (!isNaN(n)) ids.push(n);
                  }
                }
              }
            }
            setSelektion(ids);
          };
          selCbRef.current = cb;
          apiInst.viewer.onSelectionChanged.addListener(cb);
        } catch (e) { console.error("[useApi] onSelectionChanged-Listener fehlgeschlagen:", e); }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useApi] Init Fehler:", e);
        setFehler(`API Init Fehler: ${msg}`);
      }
    }

    init();

    return () => {
      if (apiInst && selCbRef.current) {
        try {
          apiInst.viewer.onSelectionChanged.removeListener(selCbRef.current);
        } catch { /* ignore */ }
      }
    };
  }, []);

  return { api, ready, fehler, selektion, aktivesModellId, geladeneModelle, projectId };
}

// --- Cloud Sync via Vercel API + Upstash Redis ---
async function getProjectId(api: ApiInstance): Promise<string | null> {
  try {
    const proj = await mitTimeoutOder(api.project.getProject(), 4000, null);
    return proj?.id || null;
  } catch { return null; }
}

export type CloudSaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverData: Record<string, unknown> | null }
  | { ok: false; conflict: false; fehler: string };

// Gzip + Base64: grosse Projekte (hunderte Tasks mit tausenden Bauteil-IDs) sprengten unkomprimiert das
// 4.5-MB-Limit von Vercel für Request-Bodies — das Speichern scheiterte dann bei jeder Änderung.
async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzipBase64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
/** Server-Antwort ({ data } alt oder { gz } komprimiert) → Daten inkl. version */
async function entpacke(json: { data?: Record<string, unknown> | null; gz?: string; version?: number } | null): Promise<Record<string, unknown> | null> {
  if (json?.gz) return { ...JSON.parse(await gunzipBase64(json.gz)), version: json.version };
  return json?.data ?? null;
}

const MAX_BODY_BYTES = 4_400_000; // Vercel-Limit 4.5 MB minus Reserve
const SPEICHER_TIMEOUT_MS = 60000;

export async function cloudSave(api: ApiInstance, data: Record<string, unknown>, baseVersion: number): Promise<CloudSaveResult> {
  try {
    const projectId = await getProjectId(api);
    if (!projectId) { console.warn("[CloudSync] Keine Projekt-ID"); return { ok: false, conflict: false, fehler: "Keine Projekt-ID von Trimble Connect erhalten" }; }
    const roh = JSON.stringify(data);
    const body = JSON.stringify({ projectId, gz: await gzipBase64(roh), baseVersion });
    const mb = (n: number) => (n / 1048576).toFixed(1);
    if (body.length > MAX_BODY_BYTES) {
      return { ok: false, conflict: false, fehler: `Daten zu gross (${mb(roh.length)} MB, komprimiert ${mb(body.length)} MB — Limit 4.4 MB)` };
    }
    const headers = { "Content-Type": "application/json", ...await syncHeaders(api) };
    const res = await fetchMitTimeout(`/api/sync?projectId=${projectId}`, { method: "POST", headers, body }, SPEICHER_TIMEOUT_MS, "Cloud-Speichern");
    if (res.status === 401) syncTokenVerwerfen();
    if (res.status === 409) {
      const json = await res.json().catch(() => null);
      console.warn("[CloudSync] Konflikt — jemand anderes hat inzwischen gespeichert");
      return { ok: false, conflict: true, serverData: await entpacke(json).catch(() => null) };
    }
    if (!res.ok) {
      const json = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(`HTTP ${res.status}${json?.error ? ` — ${json.error}` : ""}`);
    }
    const json = await res.json();
    console.log(`[CloudSync] ✓ Gespeichert in Cloud (Projekt: ${projectId}, ${mb(roh.length)} MB → ${mb(body.length)} MB)`);
    return { ok: true, version: json.version };
  } catch (e) {
    console.warn("[CloudSync] Speichern fehlgeschlagen:", e);
    const fehler = e instanceof Error ? e.message : String(e); // inkl. Zeitueberschreitung ("… keine Antwort innerhalb von 60 s")
    return { ok: false, conflict: false, fehler };
  }
}

export interface PresenceEntry { name: string; simId: string; ts: number; }

// --- Anwesenheit ("wer bearbeitet gerade mit") — leichter Heartbeat, kein Polling nebenher ---
export async function sendPresence(api: ApiInstance, simId: string, userId: string, name: string): Promise<Record<string, PresenceEntry>> {
  try {
    const projectId = await getProjectId(api);
    if (!projectId) return {};
    const res = await fetchMitTimeout(`/api/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await syncHeaders(api) },
      body: JSON.stringify({ projectId, simId, userId, name }),
    }, 10000, "Anwesenheit");
    if (!res.ok) return {};
    const json = await res.json();
    return json.presence || {};
  } catch { return {}; }
}

/** Ergebnis des Cloud-Ladens — "leer" (Projekt hat noch keine Daten) und "fehler" (Server/Netz nicht
 *  erreichbar) müssen unterschieden werden: bei "fehler" darf der lokale Stand nicht als Wahrheit gelten. */
export type CloudLadeErgebnis =
  | { status: "ok"; projectId: string; data: Record<string, unknown>; version: number }
  | { status: "leer"; projectId: string; version: number }
  | { status: "fehler"; projectId: string | null; fehler: string };

export async function cloudLaden(api: ApiInstance): Promise<CloudLadeErgebnis> {
  const projectId = await getProjectId(api);
  if (!projectId) { console.warn("[CloudSync] Keine Projekt-ID"); return { status: "fehler", projectId: null, fehler: "Keine Projekt-ID von Trimble Connect erhalten" }; }
  try {
    // Zeitlimit: hängt das Laden, startet das Speichern nie (App.tsx wartet auf das Lade-Ergebnis)
    const headers = await syncHeaders(api);
    const res = await fetchMitTimeout(`/api/sync?projectId=${projectId}`, { headers }, SPEICHER_TIMEOUT_MS, "Cloud-Laden");
    console.log("[Auth] Server-Prüfung:", res.headers.get("X-Sync-Auth") ?? "(keine — Server noch alte Version)", headers.Authorization ? "· Token gesendet" : "· OHNE Token");
    if (res.status === 401) syncTokenVerwerfen();
    if (!res.ok) {
      const json = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(`HTTP ${res.status}${json?.error ? ` — ${json.error}` : ""}`);
    }
    const data = await entpacke(await res.json());
    const version = typeof data?.version === "number" ? data.version : 0;
    if (data && Array.isArray(data.sims)) {
      console.log("[CloudSync] ✓ Geladen aus Cloud:", data.sims.length, "Simulationen (Projekt:", projectId + ")");
      return { status: "ok", projectId, data, version };
    }
    console.log("[CloudSync] Keine Cloud-Daten für Projekt", projectId);
    return { status: "leer", projectId, version };
  } catch (e) {
    console.warn("[CloudSync] Laden fehlgeschlagen:", e);
    const fehler = e instanceof Error ? e.message : String(e); // inkl. Zeitueberschreitung ("… keine Antwort innerhalb von 60 s")
    return { status: "fehler", projectId, fehler };
  }
}

// --- Versionsgeschichte (Schnappschüsse, angelegt beim Speichern — siehe SPEICHERN_LUA in api/sync.js) ---
export interface VerlaufEintrag { index: number; ts: number; version: number; bytes: number; }

async function verlaufAbruf(api: ApiInstance, verlauf: string): Promise<Record<string, unknown>> {
  const projectId = await getProjectId(api);
  if (!projectId) throw new Error("Keine Projekt-ID von Trimble Connect erhalten");
  const res = await fetchMitTimeout(`/api/sync?projectId=${projectId}&verlauf=${verlauf}`, { headers: await syncHeaders(api) }, SPEICHER_TIMEOUT_MS, "Versionsgeschichte");
  if (res.status === 401) syncTokenVerwerfen();
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(`HTTP ${res.status}${json?.error ? ` — ${json.error}` : ""}`);
  return json ?? {};
}

/** Schnappschüsse des Projekts, neueste zuerst. ts = Zeitpunkt, bis zu dem dieser Stand galt. */
export async function cloudVerlaufListe(api: ApiInstance): Promise<VerlaufEintrag[]> {
  return ((await verlaufAbruf(api, "liste")).eintraege as VerlaufEintrag[] | undefined) ?? [];
}

/** Daten eines Schnappschusses ({ sims, aktivId, … }) */
export async function cloudVerlaufLaden(api: ApiInstance, index: number): Promise<Record<string, unknown>> {
  const data = await entpacke(await verlaufAbruf(api, String(index)) as Parameters<typeof entpacke>[0]);
  if (!data) throw new Error("Stand ist leer");
  return data;
}

/** Kurzform: Daten oder null (leer wie Fehler) — nur wo die Unterscheidung keine Rolle spielt */
export async function cloudLoad(api: ApiInstance): Promise<Record<string, unknown> | null> {
  const r = await cloudLaden(api);
  return r.status === "ok" ? r.data : null;
}

// Viewer-Aufrufe in Teilpaketen: hängt eines, wird es nach diesem Limit übersprungen statt den ganzen
// Vorgang (z.B. Auto-Verknüpfung) einzufrieren
const VIEWER_TIMEOUT_MS = 30000;

export async function batchGetProperties(
  api: ApiInstance,
  modelId: string,
  ids: number[]
): Promise<TcObjectWithProps[]> {
  const BATCH = 10;
  const results: TcObjectWithProps[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    try {
      const res = await mitTimeout(api.viewer.getObjectProperties(modelId, slice), VIEWER_TIMEOUT_MS, "Eigenschaften");
      if (Array.isArray(res)) results.push(...res);
    } catch {
      for (const id of slice) {
        try {
          const r = await mitTimeout(api.viewer.getObjectProperties(modelId, [id]), VIEWER_TIMEOUT_MS, "Eigenschaften");
          if (Array.isArray(r) && r.length > 0) results.push(...r);
        } catch { /* einzelnes Objekt überspringen */ }
      }
    }
  }
  return results;
}

export async function batchConvertToObjectIds(
  api: ApiInstance,
  modelId: string,
  ids: number[]
): Promise<Map<number, string>> {
  const BATCH = 10;
  const result = new Map<number, string>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    try {
      const guids = await mitTimeout(api.viewer.convertToObjectIds(modelId, slice), VIEWER_TIMEOUT_MS, "IFC-GUIDs");
      slice.forEach((id, j) => { const g = (guids as any)?.[j]; if (g) result.set(id, g); });
    } catch {
      for (const id of slice) {
        try {
          const g = await mitTimeout(api.viewer.convertToObjectIds(modelId, [id]), VIEWER_TIMEOUT_MS, "IFC-GUIDs");
          const v = (g as any)?.[0];
          if (v) result.set(id, v);
        } catch { /* einzelnes Objekt überspringen */ }
      }
    }
  }
  return result;
}

/** IFC-GUIDs → Runtime-IDs im aktuell geladenen Modell (Umkehrung von batchConvertToObjectIds) */
export async function batchConvertToRuntimeIds(
  api: ApiInstance,
  modelId: string,
  guids: string[]
): Promise<Map<string, number>> {
  const BATCH = 200;
  const result = new Map<string, number>();
  for (let i = 0; i < guids.length; i += BATCH) {
    const slice = guids.slice(i, i + BATCH);
    try {
      const ids = await mitTimeout(api.viewer.convertToObjectRuntimeIds(modelId, slice), VIEWER_TIMEOUT_MS, "Runtime-IDs");
      slice.forEach((g, j) => { const n = Number((ids as unknown[])?.[j]); if (ids?.[j] != null && !isNaN(n)) result.set(g, n); });
    } catch { /* Chunk überspringen — fehlende werden vom Aufrufer gemeldet */ }
  }
  return result;
}

export { parseObjectIds };