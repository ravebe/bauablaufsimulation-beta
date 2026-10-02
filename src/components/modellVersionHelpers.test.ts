import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { stelleVersionUm, wendeUmstellungAn, runtimeIdsDesModells } from "./modellVersionHelpers";

// Viewer-Attrappe: je Version eigene Runtime-IDs für dieselben IFC-GUIDs
function fakeApi(versionen: Record<string, Record<number, string>>): ApiInstance {
  let geladen = "";
  return {
    viewer: {
      toggleModelVersion: async (m: { versionId?: string }) => { geladen = m.versionId ?? ""; },
      convertToObjectIds: async (_mid: string, ids: number[]) => ids.map(i => versionen[geladen][i]),
      convertToObjectRuntimeIds: async (_mid: string, guids: string[]) =>
        guids.map(g => Number(Object.entries(versionen[geladen]).find(([, x]) => x === g)?.[0] ?? NaN)),
    },
  } as unknown as ApiInstance;
}

const task = (id: string, objektGuids: string[]): Task => ({ id, name: id, start: "2026-01-01", end: "2026-01-02", typ: "neubau", objektGuids });

describe("modellVersionHelpers", () => {
  it("überträgt Zuordnungen über IFC-GUIDs auf die neuen Runtime-IDs", async () => {
    const api = fakeApi({ v1: { 1: "WAND", 2: "DECKE", 3: "ALT" }, v2: { 10: "DECKE", 11: "WAND" } });
    const tasks = [task("a", ["m:::1", "x:::1"]), task("b", ["m:::2", "m:::3"])];
    expect(runtimeIdsDesModells(tasks, "m")).toEqual([1, 2, 3]);
    const u = await stelleVersionUm(api, "m", "v1", "v2", tasks);
    expect(u.umgestellt).toBe(2);
    expect(u.nichtGefunden).toBe(1);
    const neu = wendeUmstellungAn(tasks, u.mapping);
    expect(neu[0].objektGuids).toEqual(["m:::11", "x:::1"]); // anderes Modell unberührt
    expect(neu[1].objektGuids).toEqual(["m:::10", "m:::3"]);  // nicht gefunden → unverändert
  });
});
