// Hinweis.tsx — längere Erklärtexte zugeklappt: nur ▶ «Hinweis», ein Klick zeigt den ganzen Text (und klappt ihn wieder zu).
// Klicks auf den Hinweis lösen nichts anderes aus (z.B. den Menüeintrag oder das Kontrollkästchen, in dem er steht).
// inZeile: ▶ «Hinweis» steht neben anderem Inhalt einer Zeile (Eltern-Element mit display flex + flexWrap wrap), der Text klappt
// darunter über die ganze Breite auf.
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export default function Hinweis({ children, titel = "Hinweis", style, inZeile }: { children: ReactNode; titel?: string; style?: CSSProperties; inZeile?: boolean }) {
  const [offen, setOffen] = useState(false);
  const stopp = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };
  const knopf = (
    <span role="button" tabIndex={0} title={offen ? "Erklärung zuklappen" : "Klicken für die ganze Erklärung"}
      onClick={e => { stopp(e); setOffen(o => !o); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { stopp(e); setOffen(o => !o); } }}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", color: "var(--tc-text-3)", fontSize: 11, ...(inZeile ? style : {}) }}>
      <span style={{ display: "inline-block", fontSize: 8, transform: `rotate(${offen ? 90 : 0}deg)`, transition: "transform .15s" }}>▶</span>
      <span style={{ fontWeight: 600 }}>{titel}</span>
    </span>
  );
  const text = offen && <div style={{ marginTop: 3, ...(inZeile ? { flexBasis: "100%", fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.55 } : {}) }}
    onClick={e => e.stopPropagation()}>{children}</div>;
  if (inZeile) return <>{knopf}{text}</>;
  return <div style={style}>{knopf}{text}</div>;
}
