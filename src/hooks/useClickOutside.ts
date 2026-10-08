import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// Schliesst ein Dropdown/Menü zuverlässig bei Klick ausserhalb seines DOM-Knotens,
// unabhängig davon ob der Klick durch andere Handler im Baum abgefangen wird.
// `weitere`: zusätzliche Knoten, die als "innen" gelten (z.B. per Portal angehängte Menüs, siehe Schwebend.tsx).
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void, ...weitere: RefObject<HTMLElement | null>[]) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      const ziel = e.target as Node;
      if (ref.current && !ref.current.contains(ziel) && !weitere.some(w => w.current?.contains(ziel))) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs sind stabil
  }, [active, onOutside]);
  return ref;
}
