// useAuth.ts — angemeldeter Trimble-Connect-Benutzer. Ohne userId gilt niemand als Ersteller: alles
// schreibgeschützt, Löschen/Bearbeiten ausgeblendet. getUser() kann (wie getAccessToken) mit "Operation
// timed out" scheitern oder hängen, solange der Viewer ein Modell lädt — daher Zeitlimit + Wiederholung.
import { useEffect, useState } from "react";
import type { ApiInstance } from "./useApi";
import { mitTimeout, mitWiederholung } from "./mitTimeout";

interface TcUser { id?: string; email?: string; firstName?: string; lastName?: string; }

export interface Auth {
  userId: string | null;
  userName: string;
  userEmail: string | null;
  /** Benutzer endgültig nicht ermittelt (nach allen Versuchen) */
  userFehler: string | null;
  erneutVersuchen: () => void;
}

const VERSUCHE = 6;

export function useAuth(api: ApiInstance | null): Auth {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userFehler, setUserFehler] = useState<string | null>(null);
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    if (!api) return;
    let abgebrochen = false;
    const tcUser = (api as unknown as { user: { getUser(): Promise<TcUser | null> } }).user;
    mitWiederholung(async () => {
      if (abgebrochen) return null;
      const user = await mitTimeout(tcUser.getUser(), 8000, "Benutzer-Abfrage");
      if (!user?.id) throw new Error("keine Benutzer-ID erhalten");
      return user;
    }, {
      versuche: VERSUCHE, pauseMs: 3000,
      onFehler: (e, v) => console.warn(`[Auth] Benutzer nicht ermittelt (Versuch ${v}/${VERSUCHE}):`, e instanceof Error ? e.message : e),
    }).then(user => {
      if (abgebrochen || !user?.id) return;
      setUserId(user.id);
      setUserEmail(user.email ?? null);
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
      setUserName(name || user.email || "Kollege");
      setUserFehler(null);
      console.log("[Auth] User:", user.id, user.email);
    }).catch(e => {
      if (!abgebrochen) setUserFehler(e instanceof Error ? e.message : String(e));
    });
    return () => { abgebrochen = true; };
  }, [api, versuch]);

  return { userId, userName, userEmail, userFehler, erneutVersuchen: () => { setUserFehler(null); setVersuch(v => v + 1); } };
}
