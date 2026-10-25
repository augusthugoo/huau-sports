import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, TouchEvent } from "react";
import type { Locale } from "./i18n";
import type { LandingTutorial } from "./LandingTutorials";
import "./LandingV2.css";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

type LandingTournament = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  startAt: number;
  endAt: number | null;
  heroImageUrl: string | null;
};

type LandingData = {
  ok: true;
  heroes: Array<{ slot: number; url: string }>;
  tournaments: LandingTournament[];
  tutorials: LandingTutorial[];
  metrics?: {
    players: number;
    matches: number;
  };
};

type JourneyItem = {
  number: string;
  labelEs: string;
  labelEn: string;
  titleEs: string;
  titleEn: string;
  bodyEs: string;
  bodyEn: string;
  image: string;
};

const journey: JourneyItem[] = [
  {
    number: "01",
    labelEs: "Antes de competir",
    labelEn: "Before competing",
    titleEs: "Inscripciones.",
    titleEn: "Registration.",
    bodyEs: "Entrá al torneo, elegí tu categoría y seguí el estado de tu inscripción desde un mismo lugar.",
    bodyEn: "Enter the tournament, choose your category and follow your registration status from one place.",
    image: "/landing-v2/journey-01.jpg",
  },
  {
    number: "02",
    labelEs: "Todo en orden",
    labelEn: "Everything in order",
    titleEs: "Cronograma.",
    titleEn: "Schedule.",
    bodyEs: "Horarios, canchas y orden del día quedan disponibles para saber cuándo y dónde jugás.",
    bodyEn: "Times, courts and the order of play stay available so you know when and where you play.",
    image: "/landing-v2/journey-02.jpg",
  },
  {
    number: "03",
    labelEs: "Mientras avanza",
    labelEn: "As it unfolds",
    titleEs: "Competencia.",
    titleEn: "Competition.",
    bodyEs: "Grupos, cruces y cuadros acompañan el torneo mientras cada resultado mueve la competencia.",
    bodyEn: "Groups, matchups and brackets follow the tournament as each result moves the competition forward.",
    image: "/landing-v2/journey-03.jpg",
  },
  {
    number: "04",
    labelEs: "Cuando termina",
    labelEn: "When it ends",
    titleEs: "Resultados.",
    titleEn: "Results.",
    bodyEs: "El torneo no desaparece al terminar: resultados y recorridos quedan disponibles para volver a verlos.",
    bodyEn: "The tournament does not disappear when it ends: results and paths remain available to revisit.",
    image: "/landing-v2/journey-04.jpg",
  },
];

async function jsonApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload;
}

const toMs = (value: number) => (value < 10_000_000_000 ? value * 1000 : value);
const formatDate = (value: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", {
    day: "2-digit",
    month: "short",
  }).format(new Date(toMs(value)));

function tournamentStatus(locale: Locale, status: string) {
  const labels: Record<string, [string, string]> = {
    registration_open: ["Inscripciones abiertas", "Registration open"],
    registration_closed: ["Inscripciones cerradas", "Registration closed"],
    draw_ready: ["Sorteo listo", "Draw ready"],
    scheduled: ["Cronograma publicado", "Schedule published"],
    live: ["En vivo", "Live"],
    completed: ["Finalizado", "Completed"],
  };
  return labels[status]?.[locale === "es" ? 0 : 1] ?? status.replaceAll("_", " ");
}

function tutorialTitle(locale: Locale, tutorial: LandingTutorial) {
  return locale === "es"
    ? tutorial.titleEs || tutorial.titleEn || "Tutorial"
    : tutorial.titleEn || tutorial.titleEs || "Tutorial";
}

function ArrowIcon() {
  return (
    <svg className="lv2-arrow-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 7l5 5-5 5" />
    </svg>
  );
}

function CloseIcon() {
  return <span className="lv2-close-icon" aria-hidden="true" />;
}

export function Landing({
  locale,
  setLocale,
  go,
  authenticated = false,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  go: Go;
  authenticated?: boolean;
}) {
  const [showLanguageGate, setShowLanguageGate] = useState(() => !localStorage.getItem("huau.locale"));
  const [data, setData] = useState<LandingData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tournamentFilter, setTournamentFilter] = useState<"upcoming" | "results">("upcoming");
  const [tournamentDot, setTournamentDot] = useState(0);
  const [desktopJourneyStep, setDesktopJourneyStep] = useState(0);
  const [mobileJourneyProgress, setMobileJourneyProgress] = useState(0);
  const [personExpanded, setPersonExpanded] = useState(false);
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null);
  const [contactState, setContactState] = useState<"idle" | "sending" | "sent">("idle");
  const [contactError, setContactError] = useState("");
  const [metricPlayers, setMetricPlayers] = useState(0);
  const [metricMatches, setMetricMatches] = useState(0);

  const tournamentTrackRef = useRef<HTMLDivElement | null>(null);
  const tournamentTouch = useRef({ x: 0, y: 0, horizontal: false });
  const metricsRef = useRef<HTMLElement | null>(null);
  const desktopJourneyRef = useRef<HTMLDivElement | null>(null);
  const mobileJourneyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void jsonApi<LandingData>("/api/public/landing").then(setData).catch(() => setData(null));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const activeTutorial = useMemo(
    () => data?.tutorials.find((tutorial) => tutorial.id === activeTutorialId) ?? null,
    [activeTutorialId, data?.tutorials],
  );

  useEffect(() => {
    if (!activeTutorial) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTutorialId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTutorial]);

  useEffect(() => {
    const root = desktopJourneyRef.current;
    if (!root) return;
    const steps = [...root.querySelectorAll<HTMLElement>("[data-lv2-journey-step]")];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        setDesktopJourneyStep(Number((visible.target as HTMLElement).dataset.lv2JourneyStep ?? 0));
      },
      { threshold: [0.35, 0.5, 0.65] },
    );
    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (!window.matchMedia("(max-width: 980px)").matches) return;
      const root = mobileJourneyRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const stage = root.querySelector<HTMLElement>(".lv2-journey-mobile-stage");
      const travel = Math.max(1, root.offsetHeight - (stage?.offsetHeight ?? window.innerHeight));
      setMobileJourneyProgress(clamp(-rect.top / travel));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    sync();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const section = metricsRef.current;
    const players = Math.max(0, Number(data?.metrics?.players ?? 0));
    const matches = Math.max(0, Number(data?.metrics?.matches ?? 0));
    if (!section || (!players && !matches)) return;

    let played = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (played || !entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) return;
        played = true;
        const start = performance.now();
        const duration = 2000;
        const animate = (now: number) => {
          const progress = clamp((now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3.2);
          setMetricPlayers(Math.round(players * eased));
          setMetricMatches(Math.round(matches * eased));
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
        observer.disconnect();
      },
      { threshold: [0.35, 0.5, 0.7] },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [data?.metrics?.matches, data?.metrics?.players]);

  const chooseLanguage = (next: Locale) => {
    localStorage.setItem("huau.locale", next);
    setLocale(next);
    setShowLanguageGate(false);
  };

  const scrollToSection = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sendContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setContactState("sending");
    setContactError("");
    const form = new FormData(formElement);
    try {
      await jsonApi("/api/public/contact", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          organization: form.get("organization"),
          email: form.get("email"),
          phone: form.get("phone") || null,
          organizationType: form.get("organizationType"),
          message: form.get("message"),
          website: form.get("website"),
        }),
      });
      formElement.reset();
      setContactState("sent");
    } catch (error) {
      setContactState("idle");
      setContactError(error instanceof Error ? error.message : "CONTACT_FAILED");
    }
  };

  const filteredTournaments = useMemo(() => {
    const tournaments = data?.tournaments ?? [];
    return tournaments.filter((tournament) =>
      tournamentFilter === "results" ? tournament.status === "completed" : tournament.status !== "completed",
    );
  }, [data?.tournaments, tournamentFilter]);

  useEffect(() => {
    setTournamentDot(0);
    tournamentTrackRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [tournamentFilter]);

  const nearestTournamentIndex = () => {
    const track = tournamentTrackRef.current;
    if (!track) return 0;
    const cards = [...track.querySelectorAll<HTMLElement>(".lv2-tournament-card")];
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const next = Math.abs(cardCenter - center);
      if (next < distance) {
        distance = next;
        best = index;
      }
    });
    return best;
  };

  const settleTournamentCarousel = () => {
    const track = tournamentTrackRef.current;
    if (!track) return;
    const cards = [...track.querySelectorAll<HTMLElement>(".lv2-tournament-card")];
    const index = nearestTournamentIndex();
    const card = cards[index];
    if (!card) return;
    const left = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    setTournamentDot(index);
  };

  const onTournamentTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    tournamentTouch.current = { x: touch.clientX, y: touch.clientY, horizontal: false };
  };

  const onTournamentTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - tournamentTouch.current.x);
    const dy = Math.abs(touch.clientY - tournamentTouch.current.y);
    if (dx > 8 && dx > dy * 1.08) tournamentTouch.current.horizontal = true;
  };

  const onTournamentTouchEnd = () => {
    if (tournamentTouch.current.horizontal) window.setTimeout(settleTournamentCarousel, 30);
  };

  const onTournamentScroll = () => {
    window.requestAnimationFrame(() => setTournamentDot(nearestTournamentIndex()));
  };

  const metricsVisible = Boolean((data?.metrics?.players ?? 0) || (data?.metrics?.matches ?? 0));
  const mobileJourneyPosition = mobileJourneyProgress * (journey.length - 1);

  return (
    <main className={`landing-v2${showLanguageGate ? " is-language-open" : ""}`}>
      <header className="lv2-header">
        <button className="lv2-logo-button" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <img src="/huau-logo.png" alt="HUAU" />
        </button>

        <nav className="lv2-desktop-nav" aria-label={tr(locale, "Navegación", "Navigation")}>
          <button type="button" onClick={() => scrollToSection("lv2-tournaments")}>{tr(locale, "Torneos", "Tournaments")}</button>
          <button type="button" onClick={() => scrollToSection("lv2-how")}>{tr(locale, "Cómo funciona", "How it works")}</button>
          <button type="button" onClick={() => scrollToSection("lv2-person")}>{tr(locale, "Quién está detrás", "Who is behind it")}</button>
          <button type="button" onClick={() => scrollToSection("lv2-organize")}>{tr(locale, "Organizar", "Organize")}</button>
        </nav>

        <div className="lv2-header-actions">
          <button
            type="button"
            className="lv2-account-action"
            onClick={() => go(authenticated ? "/app" : "/login")}
          >
            {authenticated ? tr(locale, "Mi perfil", "My profile") : tr(locale, "Iniciar sesión", "Sign in")}
          </button>
          <button
            type="button"
            className={`lv2-menu-button${menuOpen ? " is-open" : ""}`}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? tr(locale, "Cerrar menú", "Close menu") : tr(locale, "Abrir menú", "Open menu")}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      <aside className={`lv2-mobile-menu${menuOpen ? " is-open" : ""}`} aria-hidden={!menuOpen}>
        <button type="button" onClick={() => scrollToSection("lv2-tournaments")}>{tr(locale, "Torneos", "Tournaments")}</button>
        <button type="button" onClick={() => scrollToSection("lv2-how")}>{tr(locale, "Cómo funciona", "How it works")}</button>
        <button type="button" onClick={() => scrollToSection("lv2-person")}>{tr(locale, "Quién está detrás", "Who is behind it")}</button>
        <button type="button" onClick={() => scrollToSection("lv2-organize")}>{tr(locale, "Organizar", "Organize")}</button>
        <button type="button" onClick={() => scrollToSection("lv2-help")}>{tr(locale, "Ayuda", "Help")}</button>
        <div className="lv2-mobile-menu-foot">
          <button type="button" onClick={() => chooseLanguage(locale === "es" ? "en" : "es")}>
            {locale === "es" ? "English" : "Español"}
          </button>
        </div>
      </aside>

      <section className="lv2-hero">
        <video autoPlay muted loop playsInline controls={false} preload="auto" poster="/landing-v2/poster-01.jpg" tabIndex={-1} aria-hidden="true">
          <source src="/landing-v2/sport-01-720.mp4" media="(max-width: 800px)" type="video/mp4" />
          <source src="/landing-v2/sport-01-1080.mp4" type="video/mp4" />
        </video>
        <div className="lv2-video-shade lv2-hero-shade" />
        <div className="lv2-shell lv2-hero-content">
          <h1>{tr(locale, "Todo el torneo. En un solo lugar.", "The whole tournament. In one place.")}</h1>
          <div className="lv2-hero-bottom">
            <p>
              {tr(
                locale,
                "Encontrá torneos, inscribite y seguí cada etapa. Si organizás, manejá inscripciones, cronograma, competencia y resultados desde el mismo lugar.",
                "Find tournaments, register and follow every stage. If you organize, manage registration, schedule, competition and results from the same place.",
              )}
            </p>
            <button className="lv2-line-cta" type="button" onClick={() => scrollToSection("lv2-tournaments")}>
              <span>{tr(locale, "Explorar torneos", "Explore tournaments")}</span>
              <span className="lv2-line-cta-rule"><i /></span>
            </button>
          </div>
        </div>
      </section>

      <section className="lv2-section lv2-tournaments" id="lv2-tournaments">
        <div className="lv2-shell">
          <div className="lv2-section-head">
            <h2>{tr(locale, "Torneos.", "Tournaments.")}</h2>
            <p>{tr(locale, "Lo que está por empezar, lo que se está jugando y lo que ya quedó en la historia.", "What is about to start, what is being played and what is already part of the history.")}</p>
          </div>

          <div className="lv2-tournament-filters" role="tablist" aria-label={tr(locale, "Filtrar torneos", "Filter tournaments")}>
            <button type="button" className={tournamentFilter === "upcoming" ? "is-active" : ""} onClick={() => setTournamentFilter("upcoming")}>
              {tr(locale, "Próximos", "Upcoming")}
            </button>
            <button type="button" className={tournamentFilter === "results" ? "is-active" : ""} onClick={() => setTournamentFilter("results")}>
              {tr(locale, "Resultados", "Results")}
            </button>
          </div>

          {filteredTournaments.length ? (
            <>
              <div
                ref={tournamentTrackRef}
                className="lv2-tournament-track"
                onTouchStart={onTournamentTouchStart}
                onTouchMove={onTournamentTouchMove}
                onTouchEnd={onTournamentTouchEnd}
                onScroll={onTournamentScroll}
              >
                {filteredTournaments.map((tournament) => (
                  <article className="lv2-tournament-card" key={tournament.id} onClick={() => go(`/tournaments/${tournament.slug}`)}>
                    {tournament.heroImageUrl ? (
                      <img src={tournament.heroImageUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="lv2-tournament-fallback"><img src="/huau-logo.png" alt="" /></div>
                    )}
                    <div className="lv2-tournament-overlay" />
                    <button
                      type="button"
                      className="lv2-card-open"
                      aria-label={tr(locale, "Ver torneo", "View tournament")}
                      onClick={(event) => {
                        event.stopPropagation();
                        go(`/tournaments/${tournament.slug}`);
                      }}
                    >
                      <ArrowIcon />
                    </button>
                    <div className="lv2-tournament-copy">
                      <div className="lv2-tournament-meta">
                        <span>{formatDate(tournament.startAt, locale)}{tournament.endAt ? ` – ${formatDate(tournament.endAt, locale)}` : ""}</span>
                        <strong className={tournament.status === "live" ? "is-live" : ""}>{tournamentStatus(locale, tournament.status)}</strong>
                      </div>
                      <h3>{tournament.name}</h3>
                      <p>{tournament.sport}</p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="lv2-carousel-dots" aria-hidden="true">
                {filteredTournaments.map((tournament, index) => <i key={tournament.id} className={index === tournamentDot ? "is-active" : ""} />)}
              </div>
            </>
          ) : (
            <div className="lv2-empty">
              {tournamentFilter === "results"
                ? tr(locale, "Todavía no hay resultados recientes para mostrar.", "There are no recent results to show yet.")
                : tr(locale, "Los próximos torneos van a aparecer acá.", "Upcoming tournaments will appear here.")}
            </div>
          )}
        </div>
      </section>

      {metricsVisible && (
        <section className="lv2-metrics" ref={metricsRef}>
          <div className="lv2-shell lv2-metrics-grid">
            <div className="lv2-metric"><strong>{metricPlayers.toLocaleString(locale === "es" ? "es-UY" : "en-US")}</strong><span>{tr(locale, "Jugadores", "Players")}</span></div>
            <div className="lv2-metric"><strong>{metricMatches.toLocaleString(locale === "es" ? "es-UY" : "en-US")}</strong><span>{tr(locale, "Partidos jugados", "Matches played")}</span></div>
          </div>
        </section>
      )}

      <section className="lv2-how" id="lv2-how">
        <div className="lv2-journey-desktop" ref={desktopJourneyRef}>
          <div className="lv2-journey-copy">
            {journey.map((item, index) => (
              <article key={item.number} className={`lv2-journey-step${desktopJourneyStep === index ? " is-active" : ""}`} data-lv2-journey-step={index}>
                <span>{item.number}</span>
                <h3>{tr(locale, item.titleEs, item.titleEn)}</h3>
                <p>{tr(locale, item.bodyEs, item.bodyEn)}</p>
              </article>
            ))}
          </div>
          <div className="lv2-journey-stage">
            <div className="lv2-journey-panel">
              <img src={journey[desktopJourneyStep]?.image} alt="" />
              <div className="lv2-journey-panel-shade" />
              <div className="lv2-journey-panel-copy">
                <span>{tr(locale, journey[desktopJourneyStep]?.labelEs ?? "", journey[desktopJourneyStep]?.labelEn ?? "")}</span>
                <strong>{tr(locale, journey[desktopJourneyStep]?.titleEs ?? "", journey[desktopJourneyStep]?.titleEn ?? "")}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="lv2-journey-mobile" ref={mobileJourneyRef}>
          <div className="lv2-journey-mobile-stage">
            <h2>{tr(locale, "Todo el torneo, conectado.", "The whole tournament, connected.")}</h2>
            <div className="lv2-journey-mobile-frame">
              {journey.map((item, index) => {
                const delta = index - mobileJourneyPosition;
                return (
                  <article
                    key={item.number}
                    className="lv2-journey-mobile-slide"
                    style={{
                      transform: `translate3d(0, ${delta * 100}%, 0)`,
                      opacity: Math.max(0.22, 1 - Math.max(0, Math.abs(delta) - 0.4) * 0.5),
                    }}
                  >
                    <img src={item.image} alt="" />
                    <div className="lv2-journey-mobile-shade" />
                    <div className="lv2-journey-mobile-copy">
                      <span>{item.number} · {tr(locale, item.labelEs, item.labelEn)}</span>
                      <h3>{tr(locale, item.titleEs, item.titleEn)}</h3>
                      <p>{tr(locale, item.bodyEs, item.bodyEn)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="lv2-journey-mobile-footer">
              <div className="lv2-journey-progress"><i style={{ width: `${Math.max(3, mobileJourneyProgress * 100)}%` }} /></div>
              <div className={`lv2-scroll-hint${mobileJourneyProgress > 0.93 ? " is-hidden" : ""}`}>
                <span>{tr(locale, "Seguí bajando", "Keep scrolling")}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lv2-sport-scene">
        <video autoPlay muted loop playsInline controls={false} preload="auto" poster="/landing-v2/poster-02.jpg" tabIndex={-1} aria-hidden="true">
          <source src="/landing-v2/sport-02-720.mp4" media="(max-width: 800px)" type="video/mp4" />
          <source src="/landing-v2/sport-02-1080.mp4" type="video/mp4" />
        </video>
        <div className="lv2-video-shade lv2-scene-shade" />
        <div className="lv2-shell lv2-scene-copy">
          <h2>{tr(locale, "Mientras se juega, todo tiene que estar claro.", "While the tournament is being played, everything has to be clear.")}</h2>
          <p>{tr(locale, "Horarios, cancha, rival, cuadro y resultados: la información importante aparece cuando importa.", "Times, court, opponent, bracket and results: the important information appears when it matters.")}</p>
        </div>
      </section>

      <section className="lv2-section lv2-person" id="lv2-person">
        <div className="lv2-shell">
          <h2 className="lv2-person-mobile-title">{tr(locale, "Quién está detrás.", "Who is behind it.")}</h2>
          <div className="lv2-person-grid">
            <button type="button" className={`lv2-person-photo${personExpanded ? " is-expanded" : ""}`} onClick={() => setPersonExpanded((value) => !value)} aria-expanded={personExpanded}>
              <img src="/landing-v2/person.jpg" alt="Augusto" />
              <div className="lv2-person-mobile-base"><strong>Augusto</strong><span>{personExpanded ? tr(locale, "Cerrar", "Close") : tr(locale, "Conocer más", "Learn more")}</span></div>
              <div className="lv2-person-overlay">
                <h3>{tr(locale, "Construido desde adentro de los torneos.", "Built from inside tournaments.")}</h3>
                <strong>Augusto</strong>
                <p>{tr(locale, "Organizar, competir, mirar horarios y seguir resultados: la idea nace de vivir esos problemas en primera persona y convertirlos en una experiencia mucho más clara.", "Organizing, competing, checking times and following results: the idea comes from living those problems first-hand and turning them into a much clearer experience.")}</p>
              </div>
            </button>
            <div className="lv2-person-copy">
              <div className="lv2-person-kicker">{tr(locale, "Quién está detrás", "Who is behind it")}</div>
              <h2>{tr(locale, "Construido desde adentro de los torneos.", "Built from inside tournaments.")}</h2>
              <strong>Augusto</strong>
              <p>{tr(locale, "Organizar, competir, mirar horarios y seguir resultados: la idea nace de vivir esos problemas en primera persona y convertirlos en una experiencia mucho más clara.", "Organizing, competing, checking times and following results: the idea comes from living those problems first-hand and turning them into a much clearer experience.")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lv2-section lv2-organize" id="lv2-organize">
        <div className="lv2-shell lv2-organize-grid">
          <div className="lv2-organize-copy">
            <h2>{tr(locale, "Organizá con", "Organize with")} <img src="/huau-logo.png" alt="HUAU" /></h2>
            <p>{tr(locale, "Contanos qué querés organizar y cómo podemos ayudarte a llevarlo a cancha.", "Tell us what you want to organize and how we can help you bring it to the court.")}</p>
          </div>

          <form className="lv2-contact-form" onSubmit={sendContact}>
            <div className="lv2-contact-row">
              <label><span>{tr(locale, "Nombre", "Name")}</span><input name="name" required maxLength={120} /></label>
              <label><span>{tr(locale, "Organización", "Organization")}</span><input name="organization" required maxLength={160} /></label>
            </div>
            <div className="lv2-contact-row">
              <label><span>Email</span><input name="email" type="email" required maxLength={200} /></label>
              <label><span>{tr(locale, "Teléfono", "Phone")}</span><input name="phone" type="tel" maxLength={60} /></label>
            </div>
            <label><span>{tr(locale, "Tipo de organización", "Organization type")}</span><select name="organizationType" defaultValue="organizer"><option value="organizer">{tr(locale, "Organizador", "Organizer")}</option><option value="club">Club</option><option value="league">{tr(locale, "Liga", "League")}</option><option value="academy">{tr(locale, "Academia", "Academy")}</option><option value="federation">{tr(locale, "Federación", "Federation")}</option><option value="other">{tr(locale, "Otro", "Other")}</option></select></label>
            <label><span>{tr(locale, "Qué querés organizar", "What do you want to organize")}</span><textarea name="message" rows={5} required maxLength={3000} /></label>
            <label className="lv2-website-trap" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
            <button type="submit" className="lv2-submit" disabled={contactState === "sending"}>{contactState === "sending" ? "…" : tr(locale, "Enviar consulta", "Send inquiry")}</button>
            {contactState === "sent" && <p className="lv2-form-success">{tr(locale, "Consulta enviada.", "Inquiry sent.")}</p>}
            {contactError && <p className="lv2-form-error">{contactError}</p>}
          </form>
        </div>
      </section>

      {(data?.tutorials.length ?? 0) > 0 && (
        <section className="lv2-section lv2-help" id="lv2-help">
          <div className="lv2-shell lv2-help-grid">
            <div className="lv2-help-heading"><h2>{tr(locale, "Ayuda.", "Help.")}</h2><p>{tr(locale, "Guías rápidas para empezar y resolver lo más común.", "Quick guides to get started and solve the most common questions.")}</p></div>
            <div className="lv2-help-list">
              {data?.tutorials.map((tutorial, index) => (
                <button type="button" key={tutorial.id} onClick={() => setActiveTutorialId(tutorial.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{tutorialTitle(locale, tutorial)}</strong>
                  <i><ArrowIcon /></i>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="lv2-footer">
        <div className="lv2-shell lv2-footer-top">
          <img src="/huau-logo.png" alt="HUAU" />
          <div className="lv2-footer-links">
            <button type="button" onClick={() => scrollToSection("lv2-tournaments")}>{tr(locale, "Torneos", "Tournaments")}</button>
            <button type="button" onClick={() => scrollToSection("lv2-organize")}>{tr(locale, "Organizar", "Organize")}</button>
            <button type="button" onClick={() => scrollToSection("lv2-help")}>{tr(locale, "Ayuda", "Help")}</button>
            <span>{tr(locale, "Términos y condiciones", "Terms and conditions")}</span>
            <span>{tr(locale, "Política de privacidad", "Privacy policy")}</span>
            <button type="button" onClick={() => chooseLanguage(locale === "es" ? "en" : "es")}>{locale === "es" ? "English" : "Español"}</button>
          </div>
        </div>
        <div className="lv2-shell lv2-footer-bottom"><span>Your Sports Ecosystem</span></div>
      </footer>

      {activeTutorial && (
        <div className="lv2-video-modal" role="dialog" aria-modal="true" aria-label={tutorialTitle(locale, activeTutorial)} onMouseDown={(event) => { if (event.currentTarget === event.target) setActiveTutorialId(null); }}>
          <div className="lv2-video-modal-card">
            <div className="lv2-video-modal-head"><h3>{tutorialTitle(locale, activeTutorial)}</h3><button type="button" onClick={() => setActiveTutorialId(null)} aria-label={tr(locale, "Cerrar video", "Close video")}><CloseIcon /></button></div>
            <video src={activeTutorial.videoUrl} controls autoPlay playsInline preload="metadata" />
          </div>
        </div>
      )}

      {showLanguageGate && (
        <div className="lv2-language-gate" role="dialog" aria-modal="true" aria-label="Language">
          <div className="lv2-language-card">
            <img src="/huau-logo.png" alt="HUAU" />
            <h2>Elegí tu idioma.</h2>
            <div><button type="button" className="is-primary" onClick={() => chooseLanguage("es")}>Español</button><button type="button" onClick={() => chooseLanguage("en")}>English</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
