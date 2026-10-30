// EntwurfInput.tsx — Eingabefeld, das erst beim Verlassen oder mit Enter speichert (Esc verwirft). Für Felder, deren Änderung
// viel nachrechnet (Tab Ressourcen: jede Änderung wendet die Ablaufregeln an und führt mit «Automatisch nachführen» die
// Optimierung nach): so ist nicht jeder Tastendruck eine Neuberechnung und ein eigener Rückgängig-Schritt, und Zwischenstände
// beim Tippen (z.B. "1:7" auf dem Weg zu "1:70/4:30") werden nicht gerechnet.
import { useState } from "react";
import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { wert: string; onCommit: (v: string) => void };

export default function EntwurfInput({ wert, onCommit, onBlur, onKeyDown, ...rest }: Props) {
  const [entwurf, setEntwurf] = useState<string | null>(null);
  return (
    <input {...rest} value={entwurf ?? wert}
      onChange={e => setEntwurf(e.target.value)}
      onBlur={e => { if (entwurf !== null && entwurf !== wert) onCommit(entwurf); setEntwurf(null); onBlur?.(e); }}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") { setEntwurf(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
        onKeyDown?.(e);
      }} />
  );
}
