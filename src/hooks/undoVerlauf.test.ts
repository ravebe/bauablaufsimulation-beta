import { describe, it, expect } from "vitest";
import type { SimProjekt } from "../types";
import { LEERER_VERLAUF, aufzeichnen, rueckgaengig, wiederholen, gleicherStand } from "./undoVerlauf";

const sim = (id: string) => ({ id, name: id }) as unknown as SimProjekt;
const a = sim("a"), b = sim("b"), b2 = { ...b, name: "B neu" };

describe("undoVerlauf", () => {
  it("Löschen rückgängig: gelöschte Sim kommt zurück, danach wiederholen", () => {
    const vorher = [a, b], nachher = [a];
    const v = aufzeichnen(LEERER_VERLAUF, vorher);
    const u = rueckgaengig(v, nachher)!;
    expect(u.stand).toEqual([a, b]);
    const w = wiederholen(u.verlauf, u.stand)!;
    expect(w.stand).toEqual([a]);
  });

  it("Anlegen rückgängig", () => {
    const v = aufzeichnen(LEERER_VERLAUF, [a]);
    expect(rueckgaengig(v, [sim("neu"), a])!.stand).toEqual([a]);
  });

  it("neue Änderung verwirft den Wiederholen-Stapel", () => {
    let v = aufzeichnen(LEERER_VERLAUF, [a]);
    v = rueckgaengig(v, [a, b])!.verlauf;
    expect(v.redo.length).toBe(1);
    v = aufzeichnen(v, [a]);
    expect(v.redo.length).toBe(0);
  });

  it("höchstens 15 Schritte", () => {
    let v = LEERER_VERLAUF;
    for (let i = 0; i < 20; i++) v = aufzeichnen(v, [sim(String(i))]);
    expect(v.undo.length).toBe(15);
    expect(v.undo[0][0].id).toBe("5");
  });

  it("nichts zu tun → null", () => {
    expect(rueckgaengig(LEERER_VERLAUF, [a])).toBeNull();
    expect(wiederholen(LEERER_VERLAUF, [a])).toBeNull();
  });

  it("gleicherStand: neue Liste mit denselben Objekten = gleich, geänderte Sim = verschieden", () => {
    expect(gleicherStand([a, b], [a, b])).toBe(true);
    expect(gleicherStand([a, b], [a, b2])).toBe(false);
    expect(gleicherStand([a, b], [b, a])).toBe(false);
  });
});
