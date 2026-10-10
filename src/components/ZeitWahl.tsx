// ZeitWahl.tsx — Uhrzeit neben dem Datum eines Tasks bei Zeiteinheit Halbtage (VM/NM umschalten) oder Uhrzeit (Zeitfeld).
// Start: VM = 08:00, NM = 13:00 · Ende: VM = 12:00, NM = 17:00. Ausserhalb der Arbeitszeit gewählte Uhrzeiten rückt
// zeitraumVerschieben() (types.ts) auf die nächste bzw. letzte Arbeitszeit.
import type { Zeiteinheit } from "./zeitHelpers";
import { minZuZeit, zeitZuMin, ARBEITSBEGINN_MIN, MITTAG_VON_MIN, MITTAG_BIS_MIN, ARBEITSENDE_MIN } from "./zeitHelpers";

interface Props {
  einheit: Zeiteinheit;
  art: "start" | "ende";
  min: number;
  onChange: (min: number) => void;
  readOnly?: boolean;
}

export default function ZeitWahl({ einheit, art, min, onChange, readOnly }: Props) {
  if (einheit === "tage") return null;
  if (einheit === "halbtage") {
    const nachmittag = art === "start" ? min >= MITTAG_BIS_MIN : min > MITTAG_VON_MIN;
    const label = nachmittag ? "NM" : "VM";
    const titel = art === "start"
      ? (nachmittag ? "Beginnt am Nachmittag (13:00) — klicken für Vormittag" : "Beginnt am Vormittag (08:00) — klicken für Nachmittag")
      : (nachmittag ? "Endet am Abend (17:00) — klicken für Mittag" : "Endet am Mittag (12:00) — klicken für Abend");
    return (
      <span title={readOnly ? undefined : titel}
        onClick={readOnly ? undefined : (e => { e.stopPropagation(); onChange(art === "start" ? (nachmittag ? ARBEITSBEGINN_MIN : MITTAG_BIS_MIN) : (nachmittag ? MITTAG_VON_MIN : ARBEITSENDE_MIN)); })}
        style={{ fontSize: 9, fontWeight: 600, padding: "0 3px", border: "1px solid #c8d8e6", borderRadius: 2, color: "#2d7dbd", cursor: readOnly ? "default" : "pointer", userSelect: "none", lineHeight: "13px" }}>
        {label}
      </span>
    );
  }
  return (
    <input type="time" step={900} min="08:00" max="17:00" disabled={readOnly} value={minZuZeit(min)}
      onClick={e => e.stopPropagation()}
      onChange={e => { if (e.target.value) onChange(zeitZuMin(e.target.value, min)); }}
      title={art === "start" ? "Startzeit (Arbeitszeit 08–12 / 13–17 Uhr)" : "Endzeit (Arbeitszeit 08–12 / 13–17 Uhr)"}
      style={{ fontSize: 10, padding: "0 2px", border: "1px solid #d4dce4", fontFamily: "inherit", width: 58, color: "#2d7dbd" }} />
  );
}
