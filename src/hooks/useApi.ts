import { useEffect, useRef, useState } from "react";
import type { TcModel, TcObjectWithProps, TcSelectionEvent } from "../types";
import { parseObjectIds } from "../types";

export interface ApiInstance {
  viewer: {
    getModels: () => Promise<TcModel[]>;
    getObjects: (modelId: string) => Promise<unknown>;
    getObjectProperties: (
      modelId: string,
      ids: number[]
    ) => Promise<TcObjectWithProps[]>;
    setSelection: (ids: number[]) => Promise<void>;
    setObjectsState: (
      modelId: string,
      ids: number[],
      state: { visible?: boolean; color?: { r: number; g: number; b: number; a: number } | null }
    ) => Promise<void>;
    onSelectionChanged: {
      addListener: (cb: (event: TcSelectionEvent) => void) => void;
      removeListener: (cb: (event: TcSelectionEvent) => void) => void;
    };
  };
  extension: {
    requestPermission: (type: string) => Promise<string>;
  };
  project: {
    getProject: () => Promise<{ id: string; name: string }>;
  };
}

interface UseApiReturn {
  api: ApiInstance | null;
  ready: boolean;
  fehler: string | null;
  selektion: number[];
  aktivesModellId: string | null;
}

export function useApi(): UseApiReturn {
  const [api, setApi] = useState<ApiInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [selektion, setSelektion] = useState<number[]>([]);
  const [aktivesModellId, setAktivesModellId] = useState<string | null>(null);
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

        // Modell ermitteln mit Retry — versucht nur sichtbare/geladene Modelle
        const ladeModelle = async () => {
          for (let i = 0; i < 6; i++) {
            try {
              // Versuch 1: getLoadedModel() — nur geladene Modelle
              const geladen = await (apiInst!.viewer as any).getLoadedModel?.();
              if (geladen?.modelId) {
                setAktivesModellId(geladen.modelId);
                return;
              }
            } catch { /* ignore */ }

            try {
              // Versuch 2: getModels() + objectState visible filter
              const alleModelle = await apiInst!.viewer.getModels() as any[];
              for (const m of alleModelle) {
                try {
                  const objs = await (apiInst!.viewer as any).getObjects(
                    m.modelId, undefined, { visible: true }
                  );
                  if (parseObjectIds(objs).length > 0) {
                    setAktivesModellId(m.modelId);
                    return;
                  }
                } catch { /* ignore */ }
              }
            } catch { /* ignore */ }

            await new Promise(r => setTimeout(r, 1500));
          }
        };
        ladeModelle();

        // onModelStateChanged → aktivesModellId aktualisieren mit visible filter
        try {
          (apiInst.viewer as any).onModelStateChanged?.addListener(async () => {
            try {
              const geladen = await (apiInst!.viewer as any).getLoadedModel?.();
              if (geladen?.modelId) { setAktivesModellId(geladen.modelId); return; }
            } catch { /* ignore */ }
            try {
              const alle = await apiInst!.viewer.getModels() as any[];
              for (const m of alle) {
                const objs = await (apiInst!.viewer as any).getObjects(m.modelId, undefined, { visible: true });
                if (parseObjectIds(objs).length > 0) { setAktivesModellId(m.modelId); return; }
              }
            } catch { /* ignore */ }
          });
        } catch { /* ignore */ }

        // Selection Listener — robust für beide Formate
        const cb = (event: TcSelectionEvent) => {
          const ids: number[] = [];
          const data = (event as any)?.data;
          if (Array.isArray(data)) {
            for (const item of data) {
              if (Array.isArray(item?.objectRuntimeIds)) {
                ids.push(...item.objectRuntimeIds);
              } else if (Array.isArray(item?.objects)) {
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

  return { api, ready, fehler, selektion, aktivesModellId };
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
