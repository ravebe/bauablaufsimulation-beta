// ModelSelector.tsx — blauer Balken: Bauteilzählung + Fortschrittsanzeige
import type { SimProjekt } from "../types";
interface Props {
  aktiveSim: SimProjekt;
  totalObjekte: number | null;
  totalLaedt: boolean;
  alleGuids: Set<string>;
}
export default function ModelSelector({ aktiveSim, totalObjekte, totalLaedt, alleGuids }: Props) {
  if (!totalObjekte && !totalLaedt) return null;
  const nichtZugewiesen = totalObjekte != null ? Math.max(0, totalObjekte - alleGuids.size) : null;
  return (
    <div className="detail-block" style={{ background: "#EFF6FF", border: "0.5px solid #BFDBFE", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#1D4ED8", fontWeight: 600 }}>
          ⬡ {alleGuids.size} / {totalLaedt ? "…" : totalObjekte} Bauteile zugewiesen
        </span>
        {nichtZugewiesen != null && nichtZugewiesen > 0 && (
          <span style={{ fontSize: 9, color: "#3B82F6" }}>{nichtZugewiesen} offen</span>
        )}
      </div>
      <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "#BFDBFE", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2, background: "#3B82F6", transition: "width 0.3s ease",
          width: `${totalObjekte ? Math.round((alleGuids.size / totalObjekte) * 100) : 0}%`,
        }} />
      </div>
      <div style={{ fontSize: 9, color: "#60A5FA", marginTop: 3 }}>
        {aktiveSim.tasks.filter(t => t.objektGuids.length > 0).length} Tasks mit Bauteilen
      </div>
    </div>
  );
}
