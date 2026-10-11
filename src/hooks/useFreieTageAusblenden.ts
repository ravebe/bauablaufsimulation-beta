// useFreieTageAusblenden.ts — Gantt-Option (⋮ → Optionen) "Wochenende, Ferien und Feiertage ausblenden":
// arbeitsfreie Tage werden auf der Zeitachse eingeklappt. Standard: sichtbar. Pro Projekt im Browser
// gespeichert und zwischen Tab Bauteile und Abspielen abgeglichen (beide bleiben gemountet).
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "./lokalSpeicher";
import { nsKey } from "../types";

const LS_KEY = "4d-gantt-freie-tage-aus";
const EVENT = "4d-gantt-freie-tage-aus";

export function useFreieTageAusblenden(projectId: string | null): [boolean, (v: boolean) => void] {
  const key = nsKey(LS_KEY, projectId);
  const [aus, setAus] = useState(() => lsGet(key) === "1");
  useEffect(() => {
    setAus(lsGet(key) === "1");
    const onEvent = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setAus(lsGet(key) === "1"); };
    window.addEventListener(EVENT, onEvent);
    return () => window.removeEventListener(EVENT, onEvent);
  }, [key]);
  const setze = (v: boolean) => {
    lsSet(key, v ? "1" : "0");
    setAus(v);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  };
  return [aus, setze];
}
