import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";
import "./TournamentLiveLinks.css";

type Go = (path: string) => void;
type ManifestEntry = {
  tournamentId: string;
  slug: string;
  name: string;
  sport: string;
  startAt: number;
  endAt: number | null;
  status: "scheduled" | "live" | "finished";
  showOnLanding?: boolean;
  structureRevision: number;
  liveRevision: number;
  updatedAt: number;
};
type ManifestResponse = { ok: true; tournaments: ManifestEntry[]; updatedAt: number };

const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

async function manifest(): Promise<ManifestResponse> {
  const response = await fetch("/api/public/live-tournaments", { cache: "no-store" });
  const payload = await response.json() as ManifestResponse;
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return payload;
}

function repeatedTickerItems(items: ManifestEntry[]) {
  if (!items.length) return [];
  const minimumItems = 16;
  let cycles = Math.max(2, Math.ceil(minimumItems / items.length));
  if (cycles % 2 !== 0) cycles += 1;
  return Array.from({ length: cycles }, () => items).flat();
}

export function TournamentLiveTicker({ locale, go }: { locale: Locale; go: Go }) {
  const [items, setItems] = useState<ManifestEntry[]>([]);
  useEffect(() => {
    let active = true;
    void manifest().then((value) => { if (active) setItems(value.tournaments ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const visible = useMemo(
    () => items.filter((item) => item.status !== "finished" && item.showOnLanding === true),
    [items],
  );
  if (!visible.length) return null;
  const repeated = repeatedTickerItems(visible);
  return <div className="huau-live-ticker" role="region" aria-label={tr(locale,"Torneos destacados en vivo","Featured live tournaments")}>
    <div className="huau-live-ticker-track">
      {repeated.map((item,index)=><button key={`${item.tournamentId}-${index}`} onClick={()=>go(`/tournaments/${item.slug}/live`)}>
        <span className={`huau-live-ticker-dot ${item.status}`} />
        <b>{item.status === "live" ? "LIVE" : tr(locale,"PROGRAMADO","SCHEDULED")}</b>
        <span>{item.name}</span>
        <em>{tr(locale,"Seguir torneo →","Follow tournament →")}</em>
      </button>)}
    </div>
  </div>;
}

export function TournamentLiveRegistrationLink({ slug, locale, go }: { slug: string; locale: Locale; go: Go }) {
  const [published, setPublished] = useState(false);
  useEffect(() => {
    let active = true;
    void manifest().then((value) => { if (active) setPublished((value.tournaments ?? []).some((item) => item.slug === slug)); }).catch(() => undefined);
    return () => { active = false; };
  }, [slug]);
  if (!published) return null;
  return <div className="huau-registration-live-link"><button type="button" className="ghost" onClick={()=>go(`/tournaments/${slug}/live`)}>{tr(locale,"Seguir torneo en vivo","Follow tournament live")} ↗</button></div>;
}
