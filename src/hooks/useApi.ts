import { useEffect, useRef, useState } from "react";
import type { TcModel, TcObjectWithProps, TcSelectionEvent } from "../types";
import { parseObjectIds } from "../types";

export interface ApiInstance {
  viewer: {
    getModels: () => Promise<TcModel[]>;
    getLoadedModel: () => Promise<TcModel[]>;
    getObjects: (modelId: string) => Promise<unknown>;
    getObjectProperties: (modelId: string, ids: number[]) => Promise<TcObjectWithProps[]>;
    setSelection: (ids: number[]) => Promise<void>;
    // Korrekte TC API Methoden laut Dokumentation:
    setObjectState: (
      entities: { modelId: string; objectRuntimeIds?: number[] }[],
      state: { visible?: boolean; color?: { r: number; g: number; b: number; a: number } | null }
    ) => Promise<void>;
    isolateEntities: (
      entities: { modelId: string; objectRuntimeIds?: number[] }[]
    ) => Promise<boolean>;
    reset: () => Promise<void>;
    onSelectionChanged: {
      addListener: (cb: (event: TcSelectionEvent) => void) => void;
      removeListener: (cb: (event: TcSelectionEvent) => void) => void;
    };
  };
  extension: { requestPermission: (type: string) => Promise<string>; };
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
        // TC API via CDN Script in index.html
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

        // Modelle beim Start laden
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

        // Selection Listener — modelId aus Klick extrahieren + robuste ID-Erkennung
        const cb = (event: TcSelectionEvent) => {
          const ids: number[] = [];
          const data = (event as any)?.data;
          if (Array.isArray(data)) {
            for (const item of data) {
              if (!item) continue;
              // modelId aus Klick → aktivesModellId aktualisieren (100% sichtbares Modell!)
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
    } catch { /* ignore */ }
  }
  return results;
}

// parseObjectIds re-export für useApi interne Nutzung
export { parseObjectIds };
