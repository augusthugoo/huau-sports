import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";

type PlatformUser = {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  platformAdmin: boolean;
};

type UserImpact = {
  user: PlatformUser;
  canDelete: boolean;
  blockedReason: string | null;
  impact: {
    registrations: number;
    paymentOrders: number;
    competitiveProfiles: number;
    organizationPeople: number;
    memberships: number;
    entries: number;
    invitations: number;
    files: number;
  };
};

type DeleteResult = {
  ok: true;
  complete: boolean;
  audit: { remainingD1Traces: number };
  r2: { deleted: number; failed: string[] };
};

const copy = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const toMs = (value: number) => (value < 10_000_000_000 ? value * 1000 : value);
const dateLabel = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(toMs(value)));

async function platformApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload;
}

export function PlatformUsersAdmin({ locale }: { locale: Locale }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PlatformUser | null>(null);
  const [impact, setImpact] = useState<UserImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const load = useCallback(async (reset: boolean, q: string, cursor?: string | null) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (!reset && cursor) params.set("cursor", cursor);
      const result = await platformApi<{
        ok: true;
        users: PlatformUser[];
        nextCursor: string | null;
      }>(`/api/platform/users?${params.toString()}`);
      setUsers((current) => (reset ? result.users : [...current, ...result.users]));
      setNextCursor(result.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true, "");
  }, [load]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = queryInput.trim();
    setQuery(next);
    setSelected(null);
    setImpact(null);
    setConfirmEmail("");
    setResultMessage("");
    void load(true, next);
  };

  const openImpact = async (user: PlatformUser) => {
    setSelected(user);
    setImpact(null);
    setConfirmEmail("");
    setResultMessage("");
    setImpactLoading(true);
    setError("");
    try {
      const result = await platformApi<{ ok: true } & UserImpact>(
        `/api/platform/users/${encodeURIComponent(user.id)}/impact`,
      );
      setImpact(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "IMPACT_FAILED");
    } finally {
      setImpactLoading(false);
    }
  };

  const hardDelete = async () => {
    if (!selected || !impact?.canDelete || confirmEmail !== selected.email) return;
    setDeleting(true);
    setError("");
    setResultMessage("");
    try {
      const result = await platformApi<DeleteResult>(
        `/api/platform/users/${encodeURIComponent(selected.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ confirmEmail }),
        },
      );
      setUsers((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
      setImpact(null);
      setConfirmEmail("");
      setResultMessage(
        result.complete
          ? copy(
              locale,
              `Eliminación completa · D1 ${result.audit.remainingD1Traces} rastros · R2 ${result.r2.deleted} objetos eliminados`,
              `Deletion complete · D1 ${result.audit.remainingD1Traces} traces · R2 ${result.r2.deleted} objects deleted`,
            )
          : copy(
              locale,
              `D1 quedó limpio, pero ${result.r2.failed.length} objeto(s) de R2 requieren revisión.`,
              `D1 is clean, but ${result.r2.failed.length} R2 object(s) need review.`,
            ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DELETE_FAILED");
    } finally {
      setDeleting(false);
    }
  };

  const impactItems = impact
    ? [
        [copy(locale, "Inscripciones", "Registrations"), impact.impact.registrations],
        [copy(locale, "Órdenes de pago", "Payment orders"), impact.impact.paymentOrders],
        [copy(locale, "Perfiles competitivos", "Competitive profiles"), impact.impact.competitiveProfiles],
        [copy(locale, "Personas de organización", "Organization people"), impact.impact.organizationPeople],
        [copy(locale, "Membresías", "Memberships"), impact.impact.memberships],
        [copy(locale, "Entradas / equipos", "Entries / teams"), impact.impact.entries],
        [copy(locale, "Invitaciones", "Invitations"), impact.impact.invitations],
        [copy(locale, "Archivos R2 propios", "Owned R2 files"), impact.impact.files],
      ]
    : [];

  return (
    <section className="platform-users-layout">
      <div className="panel platform-users-list">
        <div className="panel-title">
          <div>
            <h2>{copy(locale, "Usuarios", "Users")}</h2>
            <p className="muted platform-users-note">
              {copy(
                locale,
                "El listado es liviano. El impacto sólo se consulta cuando abrís un usuario.",
                "The list is lightweight. Impact is queried only when you open a user.",
              )}
            </p>
          </div>
        </div>

        <form className="platform-user-search" onSubmit={search}>
          <input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={copy(locale, "Buscar por nombre o email…", "Search by name or email…")}
            aria-label={copy(locale, "Buscar usuarios", "Search users")}
          />
          <button className="light small" disabled={loading}>
            {loading ? "…" : copy(locale, "Buscar", "Search")}
          </button>
          {query && (
            <button
              type="button"
              className="ghost small"
              disabled={loading}
              onClick={() => {
                setQueryInput("");
                setQuery("");
                setSelected(null);
                setImpact(null);
                void load(true, "");
              }}
            >
              {copy(locale, "Limpiar", "Clear")}
            </button>
          )}
        </form>

        {error && <p className="error">{error}</p>}
        {resultMessage && <p className="platform-user-success">{resultMessage}</p>}

        <div className="platform-user-rows">
          {users.map((user) => (
            <article className="platform-user-row" key={user.id}>
              <div className="platform-user-copy">
                <div className="platform-user-name-line">
                  <strong>{user.name}</strong>
                  {user.platformAdmin && <span className="pill strong">Platform Admin</span>}
                </div>
                <span>{user.email}</span>
                <small>{copy(locale, "Alta", "Created")} {dateLabel(user.createdAt)}</small>
              </div>
              <button className="ghost small" onClick={() => void openImpact(user)}>
                {copy(locale, "Ver impacto", "View impact")}
              </button>
            </article>
          ))}
          {!loading && users.length === 0 && (
            <div className="empty-state">{copy(locale, "No se encontraron usuarios.", "No users found.")}</div>
          )}
        </div>

        {nextCursor && (
          <button
            className="ghost small platform-users-more"
            disabled={loading}
            onClick={() => void load(false, query, nextCursor)}
          >
            {loading ? "…" : copy(locale, "Cargar más", "Load more")}
          </button>
        )}
      </div>

      <div className="panel platform-user-detail">
        {!selected ? (
          <div className="empty-state">
            {copy(
              locale,
              "Elegí un usuario para inspeccionar su impacto antes de eliminarlo.",
              "Choose a user to inspect their impact before deleting them.",
            )}
          </div>
        ) : (
          <>
            <div className="platform-user-detail-head">
              <div>
                <div className="eyebrow">HARD DELETE</div>
                <h2>{selected.name}</h2>
                <p className="muted">{selected.email}</p>
              </div>
              <button
                className="ghost small"
                onClick={() => {
                  setSelected(null);
                  setImpact(null);
                  setConfirmEmail("");
                }}
              >
                ×
              </button>
            </div>

            {impactLoading ? (
              <p className="muted">{copy(locale, "Calculando impacto…", "Calculating impact…")}</p>
            ) : impact ? (
              <>
                <div className="platform-impact-grid">
                  {impactItems.map(([label, value]) => (
                    <div className="platform-impact-card" key={String(label)}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>

                {!impact.canDelete ? (
                  <div className="platform-delete-blocked">
                    <strong>{copy(locale, "Usuario protegido", "Protected user")}</strong>
                    <span>
                      {impact.blockedReason === "SELF_DELETE_FORBIDDEN"
                        ? copy(locale, "No podés eliminar tu propia cuenta.", "You cannot delete your own account.")
                        : copy(
                            locale,
                            "Los Platform Admin no se pueden eliminar desde esta herramienta.",
                            "Platform Admins cannot be deleted from this tool.",
                          )}
                    </span>
                  </div>
                ) : (
                  <div className="platform-hard-delete">
                    <h3>{copy(locale, "Eliminar usuario definitivamente", "Delete user permanently")}</h3>
                    <p>
                      {copy(
                        locale,
                        "Elimina de raíz su cuenta, auth, inscripciones, pagos propios, perfiles competitivos, invitaciones y archivos R2 propios. Las referencias administrativas necesarias se anonimizan o reasignan para no romper datos de terceros.",
                        "Permanently removes the account, auth, registrations, owned payments, competitive profiles, invitations and owned R2 files. Required administrative references are anonymized or reassigned so third-party data is not broken.",
                      )}
                    </p>
                    <label>
                      <span>
                        {copy(locale, `Escribí ${selected.email} para confirmar`, `Type ${selected.email} to confirm`)}
                      </span>
                      <input
                        value={confirmEmail}
                        onChange={(event) => setConfirmEmail(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      className="platform-danger-button"
                      disabled={deleting || confirmEmail !== selected.email}
                      onClick={() => void hardDelete()}
                    >
                      {deleting
                        ? copy(locale, "Eliminando…", "Deleting…")
                        : copy(locale, "Eliminar definitivamente", "Delete permanently")}
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
