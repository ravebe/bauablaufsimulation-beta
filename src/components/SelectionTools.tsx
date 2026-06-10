// SelectionTools.tsx — Mausklick-Zuweisung + grüner Hinzufügen-Button
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { filterEchteBauteile } from "./modelHelpers";

interface Props {
  selektion: number[];
  aktivTask: Task | null;
  aktiveSim: SimProjekt | null;
  api: ApiInstance | null;
  aktivesModellId: string | null;
  updateSim: (sim: SimProjekt) => void;
}

export default function SelectionTools({ selektion, aktivTask, aktiveSim, api, aktivesModellId, updateSim }: Props) {
  async function selektionHinzufuegen() {
    if (!aktivTask || selektion.length === 0 || !aktiveSim || !api) return;
    const mid = aktivesModellId ?? aktiveSim.modelle[0]?.id;
    if (!mid) return;
    const echteIds = await filterEchteBauteile(api, mid, selektion);
    if (echteIds.length === 0) return;
    const neueGuids = echteIds.map(rId => `${mid}:::${rId}`);
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
  }

  const bereitsImTask = new Set(
    aktivTask?.objektGuids.map(g => g.includes(":::") ? Number(g.split(":::")[1]) : Number(g)) ?? []
  );
  const neueAnzahl = selektion.filter(rId => !bereitsImTask.has(rId)).length;

  return (
    <div className="detail-block">
      <div className="detail-block-title">Mausklick Zuweisung</div>
      <div className={`sel-status ${selektion.length > 0 ? "aktiv" : ""}`}>
        {selektion.length > 0
          ? `✓ ${selektion.length} Bauteil(e) ausgewählt`
          : "Bauteil(e) im Viewer anklicken…"}
      </div>
      {selektion.length > 0 && neueAnzahl > 0 && (
        <button
          className="tc-btn-primary"
          style={{ width: "100%", marginTop: 5, background: "#16a34a", borderColor: "#16a34a" }}
          onClick={selektionHinzufuegen}
        >
          + Hinzufügen ({neueAnzahl} neu)
        </button>
      )}
      {selektion.length > 0 && neueAnzahl === 0 && (
        <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
          Alle ausgewählten Objekte bereits im Task
        </div>
      )}
    </div>
  );
}
