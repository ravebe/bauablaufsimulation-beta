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
}

export function useApi(): UseApiReturn {
  const [api, setApi] = useState<ApiInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [selektion, setSelektion] = useState<number[]>([]);
  const [aktivesModellId, setAktivesModellId] = useState<string | null>(null);
  const [geladeneModelle, setGeladeneModelle] = useState<{ id: string; name: string }[]>([]);
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

  return { api, ready, fehler, selektion, aktivesModellId, geladeneModelle };
}

// --- Cloud Sync Helpers ---
export async function cloudSave(api: ApiInstance, data: Record<string, unknown>): Promise<boolean> {
  try {
    // Versuch 1: extension.setSettings (TC Workspace API)
    if (typeof (api.extension as any).setSettings === "function") {
      await (api.extension as any).setSettings(data);
      console.log("[CloudSync] Gespeichert via extension.setSettings");
      return true;
    }
    // Versuch 2: postMessage an Parent
    if (typeof (api as any).setExtensionSettings === "function") {
      await (api as any).setExtensionSettings(data);
      console.log("[CloudSync] Gespeichert via setExtensionSettings");
      return true;
    }
    console.warn("[CloudSync] Keine Cloud-Save Methode gefunden");
    return false;
  } catch (e) {
    console.warn("[CloudSync] Speichern fehlgeschlagen:", e);
    return false;
  }
}

export async function cloudLoad(api: ApiInstance): Promise<Record<string, unknown> | null> {
  // Debug: alle verfügbaren Methoden auflisten
  try {
    const apiAny = api as any;
    console.log("[CloudSync] API keys:", Object.keys(apiAny));
    console.log("[CloudSync] extension keys:", Object.keys(apiAny.extension || {}));
    console.log("[CloudSync] project keys:", Object.keys(apiAny.project || {}));
    if (apiAny.storage) console.log("[CloudSync] storage keys:", Object.keys(apiAny.storage));
    if (apiAny.data) console.log("[CloudSync] data keys:", Object.keys(apiAny.data));
    if (apiAny.file) console.log("[CloudSync] file keys:", Object.keys(apiAny.file));
    if (apiAny.files) console.log("[CloudSync] files keys:", Object.keys(apiAny.files));
    if (apiAny.pset) console.log("[CloudSync] pset keys:", Object.keys(apiAny.pset));

    // Alle Top-Level Methoden/Properties durchsuchen
    for (const key of Object.keys(apiAny)) {
      const val = apiAny[key];
      if (val && typeof val === "object") {
        console.log(`[CloudSync] api.${key}:`, Object.keys(val));
      }
    }
  } catch (e) { console.warn("[CloudSync] Debug-Fehler:", e); }

  try {
    if (typeof (api.extension as any).getSettings === "function") {
      const data = await (api.extension as any).getSettings();
      if (data && typeof data === "object") {
        console.log("[CloudSync] Geladen via extension.getSettings");
        return data as Record<string, unknown>;
      }
    }
    if (typeof (api as any).getExtensionSettings === "function") {
      const data = await (api as any).getExtensionSettings();
      if (data && typeof data === "object") {
        console.log("[CloudSync] Geladen via getExtensionSettings");
        return data as Record<string, unknown>;
      }
    }
    console.warn("[CloudSync] Keine Cloud-Load Methode gefunden");
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

export { parseObjectIds };