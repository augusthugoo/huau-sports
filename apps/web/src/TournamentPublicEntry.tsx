import { useEffect, useState } from "react";
import type { Locale } from "./i18n";
import { PlayerPublicHeader } from "./PlayerPublicChrome";
import { PublicTournamentRegistration } from "./TournamentRegistration";
import { TournamentLivePage } from "./TournamentLivePage";

type Go = (path: string) => void;

type PublicManifest = {
  ok: true;
  tournaments: Array<{ slug: string }>;
};

export function TournamentPublicEntry({
  slug,
  locale,
  go,
  authenticated = false,
  onSignOut,
  onProfileSaved,
}: {
  slug: string;
  locale: Locale;
  go: Go;
  authenticated?: boolean;
  onSignOut?: (() => void | Promise<void>) | undefined;
  onProfileSaved?: (() => Promise<void>) | undefined;
}) {
  const [published, setPublished] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/public/live-tournaments", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        return await response.json() as PublicManifest;
      })
      .then((manifest) => {
        if (!active) return;
        setPublished(
          (manifest.tournaments ?? []).some(
            (item) => item.slug === slug,
          ),
        );
      })
      .catch(() => {
        if (active) setPublished(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (published === null) {
    return (
      <main className="public-tournament-page public-tournament-loading">
        <PlayerPublicHeader
          locale={locale}
          go={go}
          authenticated={authenticated}
          onSignOut={onSignOut}
        />
        <div className="public-phase-loading">
          {locale === "es" ? "Cargando torneo…" : "Loading tournament…"}
        </div>
      </main>
    );
  }

  if (published) {
    return (
      <TournamentLivePage
        slug={slug}
        locale={locale}
        go={go}
        authenticated={authenticated}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <PublicTournamentRegistration
      slug={slug}
      locale={locale}
      go={go}
      authenticated={authenticated}
      onSignOut={onSignOut}
      onProfileSaved={onProfileSaved}
    />
  );
}
