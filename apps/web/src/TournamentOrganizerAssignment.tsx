import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";

type Assignment = {
  organizerEmail: string;
  organizerUserId: string | null;
  status: "active" | "revoked";
  dayEnabled: number;
};
type ResponseBody = { ok: true; organizer: Assignment | null };
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const data = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(data.code || `HTTP_${response.status}`);
  return data;
}

/** Only rendered from the Platform Admin tournament hub, never from organizer accounts. */
export function TournamentOrganizerAssignment({ tournamentId, locale }: { tournamentId: string; locale: Locale }) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/platform/tournaments/${encodeURIComponent(tournamentId)}/organizer`;

  const load = useCallback(async () => {
    const data = await request<ResponseBody>(endpoint);
    setAssignment(data.organizer);
    setEmail(data.organizer?.status === "active" ? data.organizer.organizerEmail : "");
    setLoaded(true);
  }, [endpoint]);

  useEffect(() => {
    let active = true;
    void request<ResponseBody>(endpoint).then((data) => {
      if (!active) return;
      setAssignment(data.organizer);
      setEmail(data.organizer?.status === "active" ? data.organizer.organizerEmail : "");
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "ORGANIZER_LOAD_FAILED");
      setLoaded(true);
    });
    return () => { active = false; };
  }, [endpoint]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await request(endpoint, { method: "PUT", body: JSON.stringify({ email: email.trim() }) });
      await load();
      setNotice(tr(locale, "Responsable actualizado. Su acceso depende de la verificación del email.", "Organizer updated. Access requires a verified email."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ORGANIZER_SAVE_FAILED");
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!window.confirm(tr(locale, "¿Revocar el acceso de este responsable solamente a este torneo?", "Revoke this organizer's access to this tournament only?"))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(endpoint, { method: "DELETE" });
      await load();
      setNotice(tr(locale, "Acceso revocado.", "Access revoked."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_REVOKE_FAILED"); }
    finally { setBusy(false); }
  };
  const toggleDay = async () => {
    if (!assignment || assignment.status !== "active") return;
    const enabled = assignment.dayEnabled !== 1;
    if (!window.confirm(tr(locale,
      enabled ? "¿Habilitar el permiso de jornada? La interfaz de resultados se conectará en el siguiente lote." : "¿Deshabilitar el permiso de jornada?",
      enabled ? "Enable day permissions? The results interface will be connected in the next lot." : "Disable day permissions?"))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`${endpoint}/day`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      await load();
      setNotice(tr(locale, "Permiso de jornada actualizado.", "Day access updated."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_DAY_FAILED"); }
    finally { setBusy(false); }
  };

  return <details className="h3-operator" data-testid="organizer-assignment">
    <summary>{tr(locale, "Responsable del torneo · Email", "Tournament organizer · Email")} <span>+</span></summary>
    <div className="h3-operator-content">
      <p>{tr(locale, "Un responsable por torneo. Su cuenta no obtiene acceso a otros eventos del complejo. Solo HUAU puede asignarlo o revocarlo.", "One organizer per tournament. Their account cannot access other events at the venue. Only HUAU can assign or revoke access.")}</p>
      {!loaded ? <p>{tr(locale, "Cargando…", "Loading…")}</p> : <>
        <form onSubmit={(event) => void save(event)}>
          <label>{tr(locale, "Email del responsable", "Organizer email")}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" placeholder="responsable@ejemplo.com" />
          </label>
          <div className="h3-operator-actions">
            <button type="submit" disabled={busy || !email.trim()}>{tr(locale, "Guardar responsable", "Save organizer")}</button>
            {assignment?.status === "active" && <button type="button" disabled={busy} onClick={() => void revoke()}>{tr(locale, "Revocar", "Revoke")}</button>}
          </div>
        </form>
        {assignment?.status === "active" && <>
          <p>{tr(locale, "Asignado", "Assigned")}: <strong>{assignment.organizerEmail}</strong> · {assignment.organizerUserId ? tr(locale, "Cuenta verificada", "Verified account") : tr(locale, "Pendiente de cuenta verificada", "Waiting for verified account")}</p>
          <p>{tr(locale, "Operación de jornada", "Day operation")}: <strong>{assignment.dayEnabled === 1 ? tr(locale, "Habilitada", "Enabled") : tr(locale, "Deshabilitada", "Disabled")}</strong></p>
          <div className="h3-operator-actions"><button type="button" disabled={busy} onClick={() => void toggleDay()}>{assignment.dayEnabled === 1 ? tr(locale, "Deshabilitar jornada", "Disable day") : tr(locale, "Habilitar jornada", "Enable day")}</button></div>
        </>}
      </>}
      {error && <p role="alert" className="h3-error">{error}</p>}
      {notice && <p role="status" className="h3-notice">{notice}</p>}
    </div>
  </details>;
}
