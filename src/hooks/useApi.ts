import { useEffect, useRef, useState } from "react";
import type { TcModel, TcObjectWithProps, TcSelectionEvent } from "../types";
import { parseObjectIds } from "../types";

export interface ApiInstance {
  viewer: {
    getModels: () => Promise<TcModel[]>;
    getLoadedModel: () => Promise<TcModel[]>;
    getObjects: (modelId: string) => Promise<unknown>;
    getObjectProperties: (modelId: string, ids: number[]) => Promise<TcObjectWithProps[]>;
    getLayers: (modelId: string) => Promise<{ name: string; visible: boolean }[]>;
    getHierarchyParents: (modelId: string, entityId: number) => Promise<number[]>;
    convertToObjectIds: (modelId: string, ids: number[]) => Promise<string[]>;
    convertToObjectRuntimeIds: (modelId: string, externalIds: string[]) => Promise<number[]>;
    setSelection: (ids: number[]) => Promise<void>;
    setObjectState: (
      entities: { modelId: string; objectRuntimeIds?: number[] }[],
      state: { visible?: boolean; color?: { r: number; g: number; b: number; a: number } | null }
    ) => Promise<void>;
    isolateEntities: (
      entities: { modelId: string; objectRuntimeIds?: number[] }[]
    ) => Promise<boolean>;
    reset: () => Promise<void>;
    toggleModelVersion: (modelId: string, load: boolean, fitToView?: boolean) => Promise<void>;
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
  project: { getProject: () => Promise<{ id: string; name: string }>; };
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

        apiInst = (await wapi.connect(window.parent, () => {})) as ApiInstance;
        setApi(apiInst);

        // Projekt-ID laden — darf "ready" niemals blockieren, falls getProject()
        // in einzelnen Projekten hängt oder sehr lange braucht
        const projPromise = apiInst.project.getProject()
          .then(proj => { if (proj?.id) setProjectId(proj.id); return proj; })
          .catch(() => null);
        await Promise.race([projPromise, new Promise(r => setTimeout(r, 2500))]);

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
        } catch { /* ignore */ }

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

        setReady(true);
        setFehler(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
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
    const proj = await Promise.race([
      api.project.getProject(),
      new Promise<null>(r => setTimeout(() => r(null), 4000)),
    ]);
    return proj?.id || null;
  } catch { return null; }
}

export type CloudSaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverData: Record<string, unknown> | null }
  | { ok: false; conflict: false };

export async function cloudSave(api: ApiInstance, data: Record<string, unknown>, baseVersion: number): Promise<CloudSaveResult> {
  try {
    const projectId = await getProjectId(api);
    if (!projectId) { console.warn("[CloudSync] Keine Projekt-ID"); return { ok: false, conflict: false }; }
    const res = await fetch(`/api/sync?projectId=${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, data, baseVersion }),
    });
    if (res.status === 409) {
      const json = await res.json().catch(() => null);
      console.warn("[CloudSync] Konflikt — jemand anderes hat inzwischen gespeichert");
      return { ok: false, conflict: true, serverData: json?.data ?? null };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log("[CloudSync] ✓ Gespeichert in Cloud (Projekt:", projectId + ")");
    return { ok: true, version: json.version };
  } catch (e) {
    console.warn("[CloudSync] Speichern fehlgeschlagen:", e);
    return { ok: false, conflict: false };
  }
}

export async function cloudLoad(api: ApiInstance): Promise<Record<string, unknown> | null> {
  try {
    const projectId = await getProjectId(api);
    if (!projectId) { console.warn("[CloudSync] Keine Projekt-ID"); return null; }
    const res = await fetch(`/api/sync?projectId=${projectId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.data && json.data.sims) {
      console.log("[CloudSync] ✓ Geladen aus Cloud:", json.data.sims.length, "Simulationen (Projekt:", projectId + ")");
      return json.data;
    }
    console.log("[CloudSync] Keine Cloud-Daten für Projekt", projectId);
    return null;
  } catch (e) {
    console.warn("[CloudSync] Laden fehlgeschlagen:", e);
    return null;
  }
}

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
      const res = await api.viewer.getObjectProperties(modelId, slice);
      if (Array.isArray(res)) results.push(...res);
    } catch {
      for (const id of slice) {
        try {
          const r = await api.viewer.getObjectProperties(modelId, [id]);
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
      const guids = await api.viewer.convertToObjectIds(modelId, slice);
      slice.forEach((id, j) => { const g = (guids as any)?.[j]; if (g) result.set(id, g); });
    } catch {
      for (const id of slice) {
        try {
          const g = await api.viewer.convertToObjectIds(modelId, [id]);
          const v = (g as any)?.[0];
          if (v) result.set(id, v);
        } catch { /* einzelnes Objekt überspringen */ }
      }
    }
  }
  return result;
}

export { parseObjectIds };