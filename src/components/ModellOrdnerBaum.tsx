// ModellOrdnerBaum.tsx — Modellauswahl im Tab Projekt als Ordnerbaum wie im TC-Explorer. Der Proxy liefert
// nur Ordner, in denen (auch weiter unten) Modelle liegen (api/tc-datei.js, mode=explorer).
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TcExplorerEintrag } from "../hooks/tcDateien";

interface Props {
  rootId: string;
  eintraege: TcExplorerEintrag[];
  ausgewaehlt: Set<string>;
  onToggle: (id: string) => void;
}

const sortiere = (a: TcExplorerEintrag, b: TcExplorerEintrag) =>
  (a.typ === b.typ ? 0 : a.typ === "ordner" ? -1 : 1) || a.name.localeCompare(b.name, "de", { numeric: true });

export default function ModellOrdnerBaum({ rootId, eintraege, ausgewaehlt, onToggle }: Props) {
  const { kinder, modelleUnter } = useMemo(() => {
    const kinder = new Map<string, TcExplorerEintrag[]>();
    for (const e of eintraege) {
      const liste = kinder.get(e.parentId) ?? [];
      liste.push(e);
      kinder.set(e.parentId, liste);
    }
    kinder.forEach(l => l.sort(sortiere));
    // alle Modell-IDs unterhalb jedes Ordners (für die Anzeige "x ✓" bei zugeklappten Ordnern)
    const modelleUnter = new Map<string, string[]>();
    const sammle = (id: string): string[] => {
      const ids = (kinder.get(id) ?? []).flatMap(e => e.typ === "modell" ? [e.id] : sammle(e.id));
      modelleUnter.set(id, ids);
      return ids;
    };
    sammle(rootId);
    return { kinder, modelleUnter };
  }, [rootId, eintraege]);

  // Anfangs zugeklappt — nur die Ordner mit bereits gewählten Modellen (samt übergeordneten) sind offen
  const [offen, setOffen] = useState<Set<string>>(() => {
    const ordnerIds = eintraege.filter(e => e.typ === "ordner").map(e => e.id);
    return new Set(ordnerIds.filter(id => modelleUnter.get(id)?.some(m => ausgewaehlt.has(m))));
  });
  const umschalten = (id: string) => setOffen(prev => {
    const neu = new Set(prev);
    if (neu.has(id)) neu.delete(id); else neu.add(id);
    return neu;
  });

  const zeile = { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", cursor: "pointer", fontSize: 10, borderBottom: "0.5px solid var(--tc-border)" } as const;
  const text = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

  const ebene = (parentId: string, tiefe: number): ReactNode => (kinder.get(parentId) ?? []).map(e => {
    const einzug = 8 + tiefe * 14;
    if (e.typ === "modell") {
      return (
        <label key={e.id} style={{ ...zeile, paddingLeft: einzug + 14 }}>
          <input type="checkbox" checked={ausgewaehlt.has(e.id)} onChange={() => onToggle(e.id)} />
          <span style={{ ...text, color: "var(--tc-text)" }} title={e.name}>{e.name}</span>
        </label>
      );
    }
    const istOffen = offen.has(e.id);
    const gewaehlt = (modelleUnter.get(e.id) ?? []).filter(id => ausgewaehlt.has(id)).length;
    return (
      <div key={e.id}>
        <div style={{ ...zeile, paddingLeft: einzug, fontWeight: 600, color: "var(--tc-text-2)" }} onClick={() => umschalten(e.id)}>
          <span style={{ width: 8, flexShrink: 0, color: "var(--tc-text-3)" }}>{istOffen ? "▾" : "▸"}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" style={{ flexShrink: 0 }}>
            <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" fill={gewaehlt > 0 ? "#2d7dbd" : "none"} stroke="#2d7dbd" strokeWidth="1.6" />
          </svg>
          <span style={{ ...text, flex: 1 }} title={e.name}>{e.name}</span>
          {!istOffen && gewaehlt > 0 && <span style={{ flexShrink: 0, color: "var(--tc-text-3)", fontWeight: 400 }}>{gewaehlt} ✓</span>}
        </div>
        {istOffen && ebene(e.id, tiefe + 1)}
      </div>
    );
  });

  return <>{ebene(rootId, 0)}</>;
}
