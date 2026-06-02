import { useEffect, useRef, useState } from "react";
import type { TcModel, TcObjectWithProps, TcSelectionEvent } from "../types";
// TC Workspace API Typen (minimale Deklaration)
declare const TrimbleConnect: {
  Workspace: {
    connect: (win: Window) => Promise<unknown>;
  };
};

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
  /** Aktuell selektierte Runtime IDs im Viewer */
  selektion: number[];
  /** modelId des ersten geladenen Modells */
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
        // trimble-connect-workspace-api über window
        const wapi = (window as any).TrimbleConnect?.Workspace ?? 
                     (await import("trimble-connect-workspace-api" as string)).default?.Workspace;

        if (!wapi) {
          setFehler("TC Workspace API nicht gefunden");
          return;
        }

        apiInst = (await wapi.connect(window.parent, () => {})) as ApiInstance;
        setApi(apiInst);

        // Erstes Modell ermitteln — mit Retry (getModels() kann beim Start leer sein)
        const ladeModelle = async () => {
          for (let i = 0; i < 5; i++) {
            try {
              const modelle = await apiInst!.viewer.getModels();
              if (modelle?.length > 0) {
                setAktivesModellId(modelle[0].modelId);
                return;
              }
            } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, 1500));
          }
        };
        ladeModelle();

        // onModelStateChanged → aktivesModellId aktualisieren wenn Modell geladen wird
        try {
          (apiInst.viewer as any).onModelStateChanged?.addListener(async () => {
            const modelle = await apiInst!.viewer.getModels();
            if (modelle?.length > 0) setAktivesModellId(modelle[0].modelId);
          });
        } catch { /* ignore */ }

        // Selection Listener — robust für objectRuntimeIds UND objects Format
        const cb = (event: TcSelectionEvent) => {
          const ids: number[] = [];
          const data = (event as any)?.data;
          if (Array.isArray(data)) {
            for (const item of data) {
              // Format 1: objectRuntimeIds (Workspace API)
              if (Array.isArray(item?.objectRuntimeIds)) {
                ids.push(...item.objectRuntimeIds);
              }
              // Format 2: objects[{id}] (3D Viewer API)
              else if (Array.isArray(item?.objects)) {
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

// Hilfsfunktion: getObjectProperties in Batches von max. 10
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
    } catch { /* batch fehlgeschlagen, überspringen */ }
  }
  return results;
}