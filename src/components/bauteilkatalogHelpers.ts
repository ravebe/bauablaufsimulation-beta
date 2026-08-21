// bauteilkatalogHelpers.ts — Zuordnung IFC-Objektname → Bauteil-Kürzel (AVOR-Bauteilkatalog),
// ermöglicht einen automatischen Kürzel-Vorschlag je Task aus dessen verknüpften Bauteilen.
import type { ApiInstance } from "../hooks/useApi";
import { batchGetProperties } from "../hooks/useApi";

export interface KatalogEintrag { objektname: string; kuerzel: string; }

export const BAUTEILKATALOG: KatalogEintrag[] = [
  { objektname: "Magerbetontatzen_Ortbau", kuerzel: "BPL" },
  { objektname: "Magerbeton_Ortbau", kuerzel: "BPL" },
  { objektname: "Füllbeton_Ortbau", kuerzel: "BPL" },
  { objektname: "Dämmung unter Bodenplatte_Ortbau", kuerzel: "DÄMH" },
  { objektname: "Fundament_Ortbau", kuerzel: "BPL" },
  { objektname: "Frostriegel_Ortbau", kuerzel: "BPL" },
  { objektname: "Negativbeton_Ortbau", kuerzel: "BPL" },
  { objektname: "Bodenplatte_Ortbau", kuerzel: "BPL" },
  { objektname: "Schleppplatte_Ortbau", kuerzel: "BPL" },
  { objektname: "Wand Beton tragend_Ortbau", kuerzel: "WB" },
  { objektname: "Wand Beton tragend_Element", kuerzel: "EM" },
  { objektname: "Brüstung_Ortbau", kuerzel: "BR" },
  { objektname: "Brüstung_Element", kuerzel: "EM" },
  { objektname: "Sturz_Ortbau", kuerzel: "BR" },
  { objektname: "Sturz_Element", kuerzel: "EM" },
  { objektname: "Perimeterdämmung Wände_Ortbau", kuerzel: "DÄMV" },
  { objektname: "Sockeldämmung_Ortbau", kuerzel: "DÄMV" },
  { objektname: "Konsole_Ortbau", kuerzel: "WB" },
  { objektname: "Konsole_Element", kuerzel: "WB" },
  { objektname: "Schrammbord_Ortbau", kuerzel: "WB" },
  { objektname: "Mauerwerk tragend_Ortbau", kuerzel: "MW" },
  { objektname: "Mauerwerk nicht tragend_Ortbau", kuerzel: "MW" },
  { objektname: "Mauerwerk tragend_Element", kuerzel: "MW" },
  { objektname: "Stütze tragend_Ortbau", kuerzel: "SB" },
  { objektname: "Stütze tragend_Element", kuerzel: "EM" },
  { objektname: "Stütze nicht tragend_Element", kuerzel: "EM" },
  { objektname: "Betonpilz_Ortbau", kuerzel: "DB" },
  { objektname: "Betonpilz_Element", kuerzel: "EM" },
  { objektname: "Unterzug_Ortbau", kuerzel: "UZ" },
  { objektname: "Unterzug_Element", kuerzel: "EM" },
  { objektname: "Treppenpodest_Ortbau", kuerzel: "DB" },
  { objektname: "Treppenpodest_Element", kuerzel: "EM" },
  { objektname: "Treppe_Ortbau", kuerzel: "DB" },
  { objektname: "Treppe_Element", kuerzel: "EM" },
  { objektname: "Geschossdecke_Ortbau", kuerzel: "DB" },
  { objektname: "Geschossdecke_Element", kuerzel: "EM" },
  { objektname: "Balkonplatte_Ortbau", kuerzel: "DB" },
  { objektname: "Balkonplatte_Element", kuerzel: "EM" },
  { objektname: "Rampendecke_Ortbau", kuerzel: "DB" },
  { objektname: "Kanalisation / Werkleitungen", kuerzel: "KANAL" },
  { objektname: "Folien / Abdichtung", kuerzel: "FOL" },
  { objektname: "Aushub / Hinterfüllung", kuerzel: "ERD" },
];

/** Bauteil-Kürzel für einen IFC-Objektnamen (exakter Match, getrimmt). */
export function kuerzelFuerObjektname(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const n = name.trim();
  return BAUTEILKATALOG.find(e => e.objektname === n)?.kuerzel;
}

export interface KuerzelVorschlag { kuerzel: string | null; uneindeutig: string[]; }

/**
 * Ermittelt ein Kürzel aus den mit einem Task verknüpften Bauteilen (objektGuids, Format
 * "modelId:::runtimeId"). Genau ein übereinstimmendes Kürzel unter allen Treffern → kuerzel gesetzt.
 * Mehrere unterschiedliche Kürzel → kuerzel=null, uneindeutig listet die gefundenen Kürzel.
 */
export async function kuerzelVorschlag(api: ApiInstance, objektGuids: string[]): Promise<KuerzelVorschlag> {
  const idsProModell = new Map<string, number[]>();
  for (const guid of objektGuids) {
    const sep = guid.indexOf(":::");
    if (sep < 0) continue;
    const modelId = guid.slice(0, sep);
    const runtimeId = Number(guid.slice(sep + 3));
    if (isNaN(runtimeId)) continue;
    const liste = idsProModell.get(modelId) ?? [];
    liste.push(runtimeId);
    idsProModell.set(modelId, liste);
  }

  const gefundeneKuerzel = new Set<string>();
  for (const [modelId, ids] of idsProModell) {
    const objekte = await batchGetProperties(api, modelId, ids);
    for (const obj of objekte) {
      const kuerzel = kuerzelFuerObjektname(obj.product?.name);
      if (kuerzel) gefundeneKuerzel.add(kuerzel);
    }
  }

  if (gefundeneKuerzel.size === 1) return { kuerzel: [...gefundeneKuerzel][0], uneindeutig: [] };
  if (gefundeneKuerzel.size > 1) return { kuerzel: null, uneindeutig: [...gefundeneKuerzel] };
  return { kuerzel: null, uneindeutig: [] };
}
