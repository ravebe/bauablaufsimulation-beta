// Hinweis.tsx — längere Erklärtexte zugeklappt: ein ? im Kreis gleich rechts vom Titel, ein Klick zeigt den ganzen Text darunter
// (und klappt ihn wieder zu). Klicks auf den Hinweis lösen nichts anderes aus (z.B. den Menüeintrag oder das Kontrollkästchen, in
// dem er steht).
//  - kopf: Titel, rechts daneben das ?, der Text klappt unter der Titelzeile auf.
//  - inZeile: nur das ?, neben anderem Inhalt einer Zeile (Eltern-Element mit display flex + flexWrap wrap); der Text klappt
//    darunter über die ganze Breite auf.
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

const stopp = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };

/** Das ? im Kreis (auch für Abschnittstitel, siehe CockpitAbschnitt) */
export function HinweisKnopf({ offen, onToggle, style }: { offen: boolean; onToggle: () => void; style?: CSSProperties }) {
  return (
    <span role="button" tabIndex={0} aria-expanded={offen} title={offen ? "Hinweis zuklappen" : "Hinweis — klicken für die Erklärung"}
      onClick={e => { stopp(e); onToggle(); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { stopp(e); onToggle(); } }}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 15, height: 15, borderRadius: "50%",
        border: `1.3px solid ${offen ? "var(--tc-blue)" : "#9aa5b0"}`, background: offen ? "var(--tc-blue-bg)" : "#fff",
        color: offen ? "var(--tc-blue)" : "#7a8692", fontSize: 10, fontWeight: 700, lineHeight: 1, cursor: "pointer", userSelect: "none",
        fontFamily: "var(--tc-font)", ...style }}>?</span>
  );
}

/** Der aufgeklappte Text */
export function HinweisText({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div onClick={e => e.stopPropagation()}
    style={{ marginTop: 4, padding: "6px 8px", background: "#f5f8fb", borderLeft: "2px solid var(--tc-blue)", fontSize: 11, fontWeight: 400,
      color: "var(--tc-text-2)", lineHeight: 1.55, whiteSpace: "normal", textAlign: "left", ...style }}>{children}</div>;
}

export default function Hinweis({ children, kopf, inZeile, style }: { children: ReactNode; kopf?: ReactNode; inZeile?: boolean; style?: CSSProperties }) {
  const [offen, setOffen] = useState(false);
  const knopf = <HinweisKnopf offen={offen} onToggle={() => setOffen(o => !o)} style={inZeile ? style : undefined} />;
  if (inZeile) return <>{knopf}{offen && <HinweisText style={{ flexBasis: "100%" }}>{children}</HinweisText>}</>;
  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{kopf}{knopf}</div>
      {offen && <HinweisText>{children}</HinweisText>}
    </div>
  );
}
