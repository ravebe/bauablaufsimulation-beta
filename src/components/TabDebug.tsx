// TabDebug.tsx — zeigt Diagnosewerte für Debugging (selektion, modellId etc.)
interface Props {
  selektion: number[];
  aktivesModellId: string | null;
  aktivSimId: string | null;
  aktivTaskId: string | null;
  totalObjekte: number | null;
}
export default function TabDebug({ selektion, aktivesModellId, aktivSimId, aktivTaskId, totalObjekte }: Props) {
  return (
    <div style={{ fontSize: 9, fontFamily: "monospace", background: "#1e1e1e", color: "#9cdcfe", padding: 6, borderRadius: 4, margin: "4px 0", lineHeight: 1.6 }}>
      <div style={{ color: "#569cd6", fontWeight: 700, marginBottom: 2 }}>🔧 DEBUG</div>
      <div>selektion: <span style={{ color: selektion.length > 0 ? "#4ec9b0" : "#f44747" }}>{selektion.length} Obj {selektion.length > 0 ? `[${selektion.slice(0,3).join(",")}${selektion.length > 3 ? "…" : ""}]` : "leer"}</span></div>
      <div>aktivesModellId: <span style={{ color: "#ce9178" }}>{aktivesModellId ?? "null"}</span></div>
      <div>aktivSimId: <span style={{ color: "#ce9178" }}>{aktivSimId ?? "null"}</span></div>
      <div>aktivTaskId: <span style={{ color: "#ce9178" }}>{aktivTaskId ?? "null"}</span></div>
      <div>totalObjekte: <span style={{ color: "#b5cea8" }}>{totalObjekte ?? "null"}</span></div>
    </div>
  );
}
