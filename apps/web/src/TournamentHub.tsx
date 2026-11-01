import { useEffect, useState } from "react";
import type { Locale } from "./i18n";
import { loadTournamentDaySession } from "./TournamentDayStorage";
import { TournamentManagerHome, type LocalManagerSummary } from "./TournamentManagerExperience";
import "./TournamentDay.css";

type Props = {
  organizationId: string;
  tournamentId: string;
  locale: Locale;
  go: (path: string) => void;
};

type CoreResponse = {
  ok: true;
  tournament: {
    id: string;
    name: string;
    slug: string;
    sport: string;
    status: string;
    startAt: number;
    endAt: number | null;
    courtCount: number;
    workingRevision: number;
  };
  categories: Array<{ id: string; name: string; entryType: string; entryCount: number }>;
  summary: { playerCount: number; completedStandardMatches: number; pairIssueCount: number };
};

type DayStateResponse = {
  ok: true;
  hasOperatorAccess: boolean;
  hasPublishedSnapshot: boolean;
  publishedRevision: number;
  publishedAt: number | null;
  finalizedAt: number | null;
  syncStatus: "idle" | "syncing" | "synced" | "failed";
  syncedRevision: number;
  syncedAt: number | null;
  syncError: string | null;
};

class HubApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new HubApiError(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

export function TournamentHub({ organizationId, tournamentId, locale, go }: Props) {
  const [core, setCore] = useState<CoreResponse | null>(null);
  const [dayState, setDayState] = useState<DayStateResponse | null>(null);
  const [hasLocalSession, setHasLocalSession] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalManagerSummary | null>(null);
  const [localReadFailed, setLocalReadFailed] = useState(false);
  const [dayStateReadFailed, setDayStateReadFailed] = useState(false);
  const [operatorLink, setOperatorLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api<CoreResponse>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/core`),
      api<DayStateResponse>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-state`),
      loadTournamentDaySession(`admin:${tournamentId}`),
    ])
      .then(([coreResult, stateResult, localResult]) => {
        if (!active) return;
        if (coreResult.status === "rejected") throw coreResult.reason;
        setCore(coreResult.value);
        setDayState(stateResult.status === "fulfilled" ? stateResult.value : null);
        setDayStateReadFailed(stateResult.status !== "fulfilled");
        const local = localResult.status === "fulfilled" ? localResult.value : null;
        setLocalReadFailed(localResult.status !== "fulfilled");
        setHasLocalSession(Boolean(local));
        const meta = (local?.snapshot as { localMeta?: { publicDirty?: {
          structureRevision?: number; liveRevision?: number; structure?: number; live?: number;
        } } } | null)?.localMeta?.publicDirty;
        setLocalStatus(local ? {
          dirty: Boolean(local.dirty),
          updatedAt: local.updatedAt,
          structureRevision: Number(meta?.structureRevision ?? 0),
          liveRevision: Number(meta?.liveRevision ?? 0),
          structureDirty: Number(meta?.structure ?? 0),
          liveDirty: Number(meta?.live ?? 0),
        } : null);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "TOURNAMENT_HUB_LOAD_FAILED");
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const createOperatorLink = async () => {
    setBusy("share");
    setError("");
    setNotice("");
    try {
      const result = await api<{ ok: true; token: string; path: string }>(
        `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-access`,
        { method: "POST", body: "{}" },
      );
      const absolute = new URL(result.path, window.location.origin).toString();
      setOperatorLink(absolute);
      setDayState((current) =>
        current ? { ...current, hasOperatorAccess: true } : current,
      );
      try {
        await navigator.clipboard.writeText(absolute);
        setNotice(tr(locale, "Link de Tournament Day copiado.", "Tournament Day link copied."));
      } catch {
        setNotice(tr(locale, "Link generado. Copialo desde el campo.", "Link generated. Copy it from the field."));
      }
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "TOURNAMENT_DAY_LINK_FAILED");
    } finally {
      setBusy("");
    }
  };

  const revokeOperatorLink = async () => {
    if (
      !window.confirm(
        tr(
          locale,
          "¿Revocar el acceso compartido a Tournament Day? El operador dejará de poder descargar o publicar checkpoints.",
          "Revoke the shared Tournament Day access? The operator will no longer be able to download or publish checkpoints.",
        ),
      )
    ) return;
    setBusy("revoke");
    setError("");
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-access`, {
        method: "DELETE",
      });
      setOperatorLink("");
      setDayState((current) =>
        current ? { ...current, hasOperatorAccess: false } : current,
      );
      setNotice(tr(locale, "Acceso revocado.", "Access revoked."));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "TOURNAMENT_DAY_REVOKE_FAILED");
    } finally {
      setBusy("");
    }
  };

  if (!core) {
    return (
      <main className="td-hub">
        <div className="td-loading">{error || tr(locale, "Cargando torneo…", "Loading tournament…")}</div>
      </main>
    );
  }

  return (
    <TournamentManagerHome
      locale={locale}
      go={go}
      organizationId={organizationId}
      tournamentId={tournamentId}
      tournament={core.tournament}
      categoriesCount={core.categories.length}
      playerCount={core.summary.playerCount}
      hasLocalSession={hasLocalSession}
      localStatus={localStatus}
      localReadFailed={localReadFailed}
      dayState={dayState}
      dayStateReadFailed={dayStateReadFailed}
      operatorLink={operatorLink}
      busy={busy}
      error={error}
      notice={notice}
      onCreateAccess={() => void createOperatorLink()}
      onRevokeAccess={() => void revokeOperatorLink()}
    />
  );
}
