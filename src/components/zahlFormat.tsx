// zahlFormat.tsx — einheitliche Anzeige von Zahlen in der App: höchstens 2 Nachkommastellen, nur wenn vorhanden (18 → "18",
// 0.5 → "0.5", 27121.016 → "27’121.02"; de-CH, Tausender mit ’). Tab Kosten zeigt Beträge immer mit genau 2 Stellen
// (fmtZahlFix2). Nur Anzeige — gerechnet und gespeichert wird weiterhin mit dem vollen Wert.
// Ganze Zählwerte (Anzahl Tasks, Kräne, KW …) werden bewusst nicht hiermit formatiert.
import { useState } from "react";

const FORMAT_BIS_2 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const FORMAT_FIX_2 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatiere(f: Intl.NumberFormat, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = f.format(v);
  return /^-0([.,]0+)?$/.test(s) ? s.slice(1) : s; // kein "-0" bei winzigen negativen Werten
}

/** Zahl mit höchstens 2 Nachkommastellen, nur wenn vorhanden: 18 → "18", 0.5 → "0.5", 27121.016 → "27’121.02". */
export function fmtZahl(v: number | null | undefined): string {
  return formatiere(FORMAT_BIS_2, v);
}

/** Zahl mit genau 2 Nachkommastellen (Beträge in Tab Kosten): 18 → "18.00". */
export function fmtZahlFix2(v: number | null | undefined): string {
  return formatiere(FORMAT_FIX_2, v);
}

/** Wie fmtZahl, mit Vorzeichen "+" bei positiven Werten (Abweichungen/Differenzen). */
export function fmtZahlMitVorzeichen(v: number): string {
  const s = fmtZahl(v);
  return v > 0 && s !== fmtZahl(0) ? `+${s}` : s;
}

/** Stunden als Arbeitstage + Stunden (1 Tag = Std./Tag aus Tab Ressourcen): 66.3 h bei 8.5 h/Tag → "7 d 6.8 h",
 *  unter einem Tag nur Stunden ("1.65 h"), ganze Tage ohne Stunden ("2 d"). */
export function fmtTageStunden(stunden: number, stdProTag: number): string {
  if (!Number.isFinite(stunden) || stunden <= 0) return "0 h";
  if (!(stdProTag > 0)) return `${fmtZahl(stunden)} h`;
  const gerundet = Math.round(stunden * 100) / 100; // erst auf die Anzeige runden, damit nicht "0 d 8.50 h" entsteht
  const tage = Math.floor(gerundet / stdProTag + 1e-9);
  const rest = Math.round((gerundet - tage * stdProTag) * 100) / 100;
  if (tage === 0) return `${fmtZahl(rest)} h`;
  return rest > 0 ? `${tage} d ${fmtZahl(rest)} h` : `${tage} d`;
}

/** Eingabe von Zahlen ("27’121.02", "27121,02", "1 234.5") → Zahl; leer → null; ungültig → undefined. */
export function parseZahl(text: string): number | null | undefined {
  const t = text.trim().replace(/['’\s]/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

type ZahlFeldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  wert: number | null | undefined;
  onWert: (v: number | null) => void;
};

/** Zahlen-Eingabefeld: zeigt den Wert mit 2 Nachkommastellen; beim Bearbeiten (Fokus) den vollen gespeicherten Wert,
 *  damit nichts verloren geht — ein nur angeklicktes, unverändertes Feld überschreibt den Wert also nicht gerundet. */
export function ZahlFeld({ wert, onWert, onFocus, onBlur, ...rest }: ZahlFeldProps) {
  const [entwurf, setEntwurf] = useState<string | null>(null);
  const angezeigt = entwurf ?? (wert == null ? "" : fmtZahl(wert));
  return (
    <input {...rest} type="text" inputMode="decimal" value={angezeigt}
      onFocus={e => { setEntwurf(wert == null ? "" : String(wert)); onFocus?.(e); }}
      onBlur={e => { setEntwurf(null); onBlur?.(e); }}
      onChange={e => {
        setEntwurf(e.target.value);
        const n = parseZahl(e.target.value);
        if (n !== undefined) onWert(n);
      }} />
  );
}
