// Hinweis.tsx — längere Erklärtexte zugeklappt: nur ▶ «Hinweis», ein Klick zeigt den ganzen Text (und klappt ihn wieder zu).
// Klicks auf den Hinweis lösen nichts anderes aus (z.B. den Menüeintrag oder das Kontrollkästchen, in dem er steht).
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export default function Hinweis({ children, titel = "Hinweis", style }: { children: ReactNode; titel?: string; style?: CSSProperties }) {
  const [offen, setOffen] = useState(false);
  const stopp = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };
  return (
    <div style={style}>
      <span role="button" tabIndex={0} title={offen ? "Erklärung zuklappen" : "Klicken für die ganze Erklärung"}
        onClick={e => { stopp(e); setOffen(o => !o); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { stopp(e); setOffen(o => !o); } }}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", color: "var(--tc-text-3)", fontSize: 11 }}>
        <span style={{ display: "inline-block", fontSize: 8, transform: `rotate(${offen ? 90 : 0}deg)`, transition: "transform .15s" }}>▶</span>
        <span style={{ fontWeight: 600 }}>{titel}</span>
      </span>
      {offen && <div style={{ marginTop: 3 }} onClick={e => e.stopPropagation()}>{children}</div>}
    </div>
  );
}
