import { useEffect, useRef } from "react";

// Schliesst ein Dropdown/Menü zuverlässig bei Klick ausserhalb seines DOM-Knotens,
// unabhängig davon ob der Klick durch andere Handler im Baum abgefangen wird.
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onOutside]);
  return ref;
}
