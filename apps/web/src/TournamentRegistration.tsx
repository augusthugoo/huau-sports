import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { registrationPriceMinor, resolveRegistrationPricing, resolveTeamIndividualPrice } from "@huau/core";
import { FormatExplanationPanel, explanationForPersistedFormat } from "./FormatExplanationPanel";
import type { Locale } from "./i18n";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

class RegistrationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new RegistrationError(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

const money = (minor: number, currency: string | null, locale: Locale = "es") =>
  minor === 0
    ? tr(locale, "Gratis", "Free")
    : new Intl.NumberFormat(locale === "es" ? "es-UY" : "en-US", {
        style: "currency",
        currency: currency || "UYU",
        maximumFractionDigits: 0,
      }).format(minor / 100);

const date = (unix: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(
    new Date(unix < 10_000_000_000 ? unix * 1000 : unix),
  );

type PlayerProfile = {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sportGender: "male" | "female" | "unspecified";
  phone: string | null;
};

type PricingPolicy = {
  paymentType: "per_category" | "base_plus_extra" | "free";
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
};

type TeamPricingPolicy = {
  individualFeeMinor: number | null;
  fullTeamFeeMinor: number | null;
  additionalParticipationMode: "full" | "extra" | "free";
  additionalFeeMinor: number | null;
  allowAgeDivisionOverlap: boolean;
};

type PublicCategory = {
  id: string;
  name: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: string | null;
  minAge: number | null;
  maxAge: number | null;
  maxEntries: number | null;
  registrationStatus: "closed" | "open" | "waitlist_only";
  rawPriceScope: "free" | "per_entry" | "per_person";
  rawPriceMinor: number | null;
  priceScope: "free" | "per_entry" | "per_person";
  priceMinor: number;
  priceSource: string;
  currency: string | null;
  scheduledDate: string | null;
  structureLocked: number;
  occupiedEntries: number;
  waitlistCount: number;
  formatKind: "standard" | "team" | null;
  formatConfig: unknown;
  explanationSchemaVersion: number | null;
  registrationBlockedCode: string | null;
  viewerAlreadyRegistered: boolean;
};

export type PublicTournamentData = {
  ok: true;
  tournament: {
    id: string;
    name: string;
    slug: string;
    sport: string;
    status: string;
    startAt: number;
    endAt: number | null;
    timezone: string;
    courtCount: number;
    heroImageUrl: string | null;
    structureLocked: number;
  };
  publicInfo: {
    club: string;
    city: string;
    location: string;
    description: string;
    contact: string;
  };
  registrationCloseAt: number | null;
  pricingPolicy: PricingPolicy;
  teamPricing: TeamPricingPolicy;
  maxCategoriesPerPlayer: number | null;
  activeCategoryCount: number;
  activeTeamCategoryCount: number;
  activeAgeTeamDivisionCount: number;
  categories: PublicCategory[];
  viewer: { authenticated: boolean; profile: PlayerProfile | null };
};

function codeCopy(locale: Locale, code: string) {
  const map: Record<string, [string, string]> = {
    PROFILE_REQUIRED: ["Completá tu perfil antes de inscribirte.", "Complete your profile before registering."],
    BIRTH_DATE_REQUIRED: ["Esta categoría necesita tu fecha de nacimiento.", "This category requires your birth date."],
    SPORT_GENDER_REQUIRED: ["Esta categoría necesita tu género deportivo.", "This category requires your sport gender."],
    BELOW_MIN_AGE: ["No alcanzás la edad mínima de esta categoría.", "You do not meet this category's minimum age."],
    ABOVE_MAX_AGE: ["Superás la edad máxima de esta categoría.", "You exceed this category's maximum age."],
    GENDER_NOT_ELIGIBLE: ["Tu género deportivo no coincide con esta categoría.", "Your sport gender is not eligible for this category."],
    ALREADY_REGISTERED_IN_CATEGORY: ["Ya estás inscripto en esta categoría.", "You are already registered in this category."],
    CATEGORY_REGISTRATION_CLOSED: ["Esta categoría está cerrada para inscripciones.", "This category is closed for registrations."],
    REGISTRATION_DEADLINE_PASSED: ["El período de inscripción ya cerró.", "Registration is closed."],
    TOURNAMENT_REGISTRATION_CLOSED: ["El torneo no está recibiendo inscripciones.", "The tournament is not accepting registrations."],
    COMPETITION_STRUCTURE_LOCKED: ["La competencia ya fue cerrada para nuevas inscripciones.", "The competition is already locked for new registrations."],
    MAX_CATEGORIES_REACHED: ["Ya alcanzaste el máximo de categorías permitido para este torneo.", "You already reached this tournament's maximum categories per player."],
    TEAM_AGE_DIVISION_OVERLAP_DISABLED: ["Este torneo no permite jugar más de una división de edad por equipos.", "This tournament does not allow more than one team age division."],
    TEAM_FULL_FEE_NOT_CONFIGURED: ["El organizador todavía no configuró el precio por equipo completo.", "The organizer has not configured the full-team fee yet."],
    CANDIDATE_NOT_AVAILABLE: ["Ese jugador ya no está libre en esta categoría.", "That player is no longer free in this category."],
    PAIR_NOT_COMPATIBLE: ["Esa combinación no cumple las reglas de la categoría.", "That pairing does not meet the category rules."],
    PAIR_ALREADY_COMPLETE: ["Ya tenés pareja asignada.", "You already have a partner."],
    TEAM_ROSTER_FULL: ["El equipo ya alcanzó el máximo de integrantes.", "The team roster is already full."],
    ROSTER_TOO_LARGE: ["El equipo ya alcanzó el máximo de integrantes.", "The team roster is already full."],
    ROSTER_MALE_MAX: ["Ese jugador supera el máximo masculino permitido para este roster.", "That player would exceed the male roster limit."],
    ROSTER_FEMALE_MAX: ["Esa jugadora supera el máximo femenino permitido para este roster.", "That player would exceed the female roster limit."],
    ROSTER_COMPOSITION_MALE: ["Este equipo admite únicamente jugadores masculinos.", "This team only accepts male players."],
    ROSTER_COMPOSITION_FEMALE: ["Este equipo admite únicamente jugadoras femeninas.", "This team only accepts female players."],
    CREATE_TEAM_FIRST: ["Primero creá tu equipo.", "Create your team first."],
    CAPTAIN_REQUIRED: ["Sólo el capitán puede invitar jugadores.", "Only the captain can invite players."],
    NO_CATEGORIES_SELECTED: ["Seleccioná al menos una categoría.", "Select at least one category."],
  };
  return map[code]?.[locale === "es" ? 0 : 1] ?? code;
}

function tournamentStatusCopy(locale: Locale, status: string) {
  const statuses: Record<string, [string, string]> = {
    draft: ["En preparación", "In setup"],
    registration_open: ["Inscripciones abiertas", "Registration open"],
    registration_closed: ["Inscripciones cerradas", "Registration closed"],
    draw_ready: ["Sorteo listo", "Draw ready"],
    scheduled: ["Cronograma publicado", "Schedule published"],
    live: ["En vivo", "Live"],
    completed: ["Finalizado", "Completed"],
    cancelled: ["Cancelado", "Cancelled"],
  };
  return statuses[status]?.[locale === "es" ? 0 : 1] ?? status.replaceAll("_", " ");
}

function blockedButtonCopy(locale: Locale, code: string) {
  if (code === "COMPETITION_STRUCTURE_LOCKED") return tr(locale, "Competencia cerrada", "Competition locked");
  if (code === "REGISTRATION_DEADLINE_PASSED") return tr(locale, "Inscripciones cerradas", "Registration closed");
  if (code === "TOURNAMENT_REGISTRATION_CLOSED") return tr(locale, "Torneo cerrado", "Tournament closed");
  if (code === "ALREADY_REGISTERED_IN_CATEGORY") return tr(locale, "Ya estás inscripto", "Already registered");
  if (code === "MAX_CATEGORIES_REACHED") return tr(locale, "Máximo alcanzado", "Limit reached");
  if (code === "TEAM_AGE_DIVISION_OVERLAP_DISABLED") return tr(locale, "División no disponible", "Division unavailable");
  return tr(locale, "Cerrada", "Closed");
}

function categoryNeedsProfile(category: Pick<PublicCategory, "minAge" | "maxAge" | "competitionGender">, profile: PlayerProfile | null) {
  if (!profile) return true;
  const needsBirth = (category.minAge !== null || category.maxAge !== null) && !profile.birthDate;
  const gendered = ["male", "female", "mixed"].includes(category.competitionGender ?? "");
  return needsBirth || (gendered && profile.sportGender === "unspecified");
}

function EligibilityProfileCard({
  locale,
  profile,
  busy,
  onSave,
  compact = false,
}: {
  locale: Locale;
  profile: PlayerProfile | null;
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  compact?: boolean;
}) {
  return (
    <section className="registration-profile-card">
      <div>
        <div className="eyebrow">PLAYER PROFILE</div>
        <h2>{tr(locale, "Completá tu elegibilidad", "Complete your eligibility profile")}</h2>
        <p>{tr(locale, compact ? "Estos datos pertenecen a tu perfil global HUAU." : "Tournament usa estos datos de tu perfil global sólo cuando una categoría necesita validar elegibilidad.", compact ? "These fields belong to your global HUAU profile." : "Tournament uses your global profile only when a category needs eligibility checks.")}</p>
      </div>
      <form onSubmit={(event) => void onSave(event)}>
        <label><span>{tr(locale, "Fecha de nacimiento", "Birth date")}</span><input name="birthDate" type="date" defaultValue={profile?.birthDate ?? ""} /></label>
        <label><span>{tr(locale, "Género deportivo", "Sport gender")}</span><select name="sportGender" defaultValue={profile?.sportGender ?? "unspecified"}><option value="unspecified">{tr(locale, "Sin especificar", "Unspecified")}</option><option value="male">{tr(locale, "Masculino", "Male")}</option><option value="female">{tr(locale, "Femenino", "Female")}</option></select></label>
        <button className="light" disabled={busy}>{busy ? "…" : tr(locale, "Guardar perfil", "Save profile")}</button>
      </form>
    </section>
  );
}

type TeamSelection = { choice: "free" | "create"; teamName: string; paymentMode: "individual" | "team_full" };

function estimateCategoryPrice(data: PublicTournamentData, category: PublicCategory, priorOverall: number, priorTeam: number, team: TeamSelection) {
  if (category.entryType === "team" && team.choice === "create" && team.paymentMode === "team_full") {
    return Math.max(0, data.teamPricing.fullTeamFeeMinor ?? 0);
  }
  if (category.rawPriceMinor !== null) {
    return registrationPriceMinor({ priceScope: category.rawPriceScope, priceMinor: category.rawPriceMinor }, 1);
  }
  if (category.entryType === "team" && data.teamPricing.individualFeeMinor !== null) {
    return resolveTeamIndividualPrice({
      individualFeeMinor: data.teamPricing.individualFeeMinor,
      additionalMode: data.teamPricing.additionalParticipationMode,
      additionalFeeMinor: data.teamPricing.additionalFeeMinor,
      priorTeamRegistrationCount: priorTeam,
    });
  }
  const resolution = resolveRegistrationPricing({
    categoryPriceScope: category.rawPriceScope,
    categoryPriceMinor: category.rawPriceMinor,
    tournamentPaymentType: data.pricingPolicy.paymentType,
    tournamentEntryFeeMinor: data.pricingPolicy.entryFeeMinor,
    tournamentBaseFeeMinor: data.pricingPolicy.baseFeeMinor,
    tournamentExtraCategoryFeeMinor: data.pricingPolicy.extraCategoryFeeMinor,
    priorActiveRegistrationCount: priorOverall,
  });
  return registrationPriceMinor({ priceScope: resolution.priceScope, priceMinor: resolution.priceMinor }, 1);
}

export function PublicTournamentRegistration({ slug, locale, go, onProfileSaved }: { slug: string; locale: Locale; go: Go; onProfileSaved?: () => Promise<void> }) {
  const [data, setData] = useState<PublicTournamentData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [teamSelections, setTeamSelections] = useState<Record<string, TeamSelection>>({});
  const [explanationCategoryId, setExplanationCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<PublicTournamentData>(`/api/public/tournaments/${encodeURIComponent(slug)}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!explanationCategoryId) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExplanationCategoryId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [explanationCategoryId]);

  const login = () => {
    sessionStorage.setItem("huau.afterAuth", `/tournaments/${slug}`);
    go("/login");
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("profile");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/me/profile", { method: "PUT", body: JSON.stringify({ birthDate: form.get("birthDate") || null, sportGender: form.get("sportGender") }) });
      await Promise.all([load(), onProfileSaved?.() ?? Promise.resolve()]);
      setNotice(tr(locale, "Perfil actualizado.", "Profile updated."));
    } catch (err) {
      setError(codeCopy(locale, err instanceof RegistrationError ? err.code : "PROFILE_UPDATE_FAILED"));
    } finally {
      setBusy("");
    }
  };

  const teamChoice = (categoryId: string): TeamSelection => teamSelections[categoryId] ?? { choice: "free", teamName: "", paymentMode: "individual" };
  const updateTeamChoice = (categoryId: string, patch: Partial<TeamSelection>) => setTeamSelections((current) => ({ ...current, [categoryId]: { ...teamChoice(categoryId), ...patch } }));

  const basket = useMemo(() => {
    if (!data) return [] as Array<{ category: PublicCategory; price: number }>;
    let priorOverall = data.activeCategoryCount;
    let priorTeam = data.activeTeamCategoryCount;
    return selected.map((id) => data.categories.find((category) => category.id === id)).filter((category): category is PublicCategory => Boolean(category)).map((category) => {
      const price = estimateCategoryPrice(data, category, priorOverall, priorTeam, teamChoice(category.id));
      priorOverall += 1;
      if (category.entryType === "team") priorTeam += 1;
      return { category, price };
    });
  }, [data, selected, teamSelections]);

  const basketTotal = basket.reduce((sum, item) => sum + item.price, 0);
  const limitAfterSelection = data?.maxCategoriesPerPlayer === null || data?.maxCategoriesPerPlayer === undefined ? null : data.activeCategoryCount + selected.length;

  const toggle = (category: PublicCategory) => {
    if (selected.includes(category.id)) {
      setSelected((current) => current.filter((id) => id !== category.id));
      return;
    }
    if (data?.maxCategoriesPerPlayer !== null && data && data.activeCategoryCount + selected.length >= data.maxCategoriesPerPlayer) {
      setError(codeCopy(locale, "MAX_CATEGORIES_REACHED"));
      return;
    }
    if (data && category.entryType === "team" && !data.teamPricing.allowAgeDivisionOverlap && (category.minAge !== null || category.maxAge !== null)) {
      const selectedAgeTeams = selected.map((id) => data.categories.find((item) => item.id === id)).filter((item) => item?.entryType === "team" && (item.minAge !== null || item.maxAge !== null)).length;
      if ((data.activeAgeTeamDivisionCount ?? 0) + selectedAgeTeams > 0) {
        setError(codeCopy(locale, "TEAM_AGE_DIVISION_OVERLAP_DISABLED"));
        return;
      }
    }
    setError("");
    setSelected((current) => [...current, category.id]);
    if (category.entryType === "team" && !teamSelections[category.id]) setTeamSelections((current) => ({ ...current, [category.id]: { choice: "free", teamName: "", paymentMode: "individual" } }));
  };

  const confirmBasket = async () => {
    if (!data || !basket.length) return;
    const invalidTeam = basket.find(({ category }) => category.entryType === "team" && teamChoice(category.id).choice === "create" && teamChoice(category.id).paymentMode === "team_full" && data.teamPricing.fullTeamFeeMinor === null);
    if (invalidTeam) {
      setError(codeCopy(locale, "TEAM_FULL_FEE_NOT_CONFIGURED"));
      return;
    }
    setBusy("basket");
    setError("");
    setNotice("");
    try {
      const result = await api<{ registrations: Array<{ status: string }> }>(`/api/tournaments/${data.tournament.id}/registrations/batch`, {
        method: "POST",
        body: JSON.stringify({ selections: basket.map(({ category }) => ({ categoryId: category.id, ...(category.entryType === "team" ? { teamChoice: teamChoice(category.id).choice, teamName: teamChoice(category.id).teamName, teamPaymentMode: teamChoice(category.id).paymentMode } : {}) })) }),
      });
      const waitlisted = result.registrations.filter((registration) => registration.status === "waitlisted").length;
      setSelected([]);
      setTeamSelections({});
      await load();
      setNotice(waitlisted ? tr(locale, `Inscripción creada. ${waitlisted} selección(es) quedaron en waitlist.`, `Registration created. ${waitlisted} selection(s) joined the waitlist.`) : tr(locale, "Inscripción creada. Parejas y equipos se completan desde Mis inscripciones.", "Registration created. Complete pairs and teams from My registrations."));
    } catch (err) {
      setError(codeCopy(locale, err instanceof RegistrationError ? err.code : "REGISTRATION_FAILED"));
    } finally {
      setBusy("");
    }
  };

  if (!data) return <main className="public-tournament-page"><button className="back-link" onClick={() => go("/")}>← HUAU</button>{error ? <div className="registration-alert">{error}</div> : <div className="empty-state">{tr(locale, "Cargando torneo…", "Loading tournament…")}</div>}</main>;

  const profileNeededSomewhere = data.viewer.authenticated && data.categories.some((category) => !category.registrationBlockedCode && categoryNeedsProfile(category, data.viewer.profile));
  const explanationCategory = explanationCategoryId ? data.categories.find((category) => category.id === explanationCategoryId) ?? null : null;
  const modalExplanation = explanationCategory
    ? explanationForPersistedFormat(explanationCategory.formatKind, explanationCategory.formatConfig, locale)
    : null;

  return (
    <main className="public-tournament-page">
      <header className="public-tournament-nav">
        <button className="brand-button" onClick={() => go("/")}><strong>HUAU</strong><span>SPORTS</span></button>
        <div>{data.viewer.authenticated ? <button className="ghost" onClick={() => go("/app/registrations")}>{tr(locale, "Mis inscripciones", "My registrations")}</button> : <button className="light" onClick={login}>{tr(locale, "Ingresar", "Sign in")}</button>}</div>
      </header>
      <section
        className={`public-tournament-hero ${data.tournament.heroImageUrl ? "has-cover" : ""}`}
        style={data.tournament.heroImageUrl ? {
          backgroundImage: `linear-gradient(90deg, rgba(3,3,3,.94) 0%, rgba(3,3,3,.70) 50%, rgba(3,3,3,.30) 100%), url("${data.tournament.heroImageUrl}")`,
        } : undefined}
      >
        <div className="public-tournament-hero-content">
          <div className="public-tournament-hero-copy">
            <div className="eyebrow">{data.tournament.sport.toUpperCase()} · HUAU TOURNAMENT</div>
            <h1>{data.tournament.name}</h1>
            <div className="public-tournament-hero-meta">
              <span>{date(data.tournament.startAt)}{data.tournament.endAt ? ` → ${date(data.tournament.endAt)}` : ""}</span>
              {(data.publicInfo.location || data.publicInfo.club || data.publicInfo.city) && (
                <span>{data.publicInfo.location || data.publicInfo.club || data.publicInfo.city}</span>
              )}
              <span>{data.tournament.courtCount} {tr(locale, "canchas", "courts")}</span>
            </div>
            <div className="public-tournament-hero-actions">
              <button
                className="light"
                onClick={() => document.getElementById("registration-categories")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {tr(locale, "Ver inscripción", "View registration")}
              </button>
              {data.viewer.authenticated && (
                <button className="ghost" onClick={() => go("/app/registrations")}>
                  {tr(locale, "Mis inscripciones", "My registrations")}
                </button>
              )}
            </div>
          </div>
          <span className={`registration-open-pill ${data.tournament.status}`}>
            {tournamentStatusCopy(locale, data.tournament.status)}
          </span>
        </div>
      </section>

      <section className="public-tournament-summary">
        <div className="public-tournament-summary-copy">
          <div className="eyebrow">{tr(locale, "INFORMACIÓN DEL TORNEO", "TOURNAMENT INFO")}</div>
          <h2>{tr(locale, "Todo lo necesario antes de inscribirte", "Everything you need before registering")}</h2>
          {data.publicInfo.description ? (
            <p>{data.publicInfo.description}</p>
          ) : (
            <p>{tr(locale, "Revisá las categorías disponibles, su formato oficial y el valor de inscripción.", "Review available categories, their official format and registration fee.")}</p>
          )}
          {data.publicInfo.contact && (
            <small>{tr(locale, "Contacto", "Contact")}: {data.publicInfo.contact}</small>
          )}
        </div>
        <div className="public-tournament-facts">
          <div className="public-tournament-fact"><span>{tr(locale, "Fecha", "Date")}</span><strong>{date(data.tournament.startAt)}</strong></div>
          <div className="public-tournament-fact"><span>{tr(locale, "Sede", "Venue")}</span><strong>{data.publicInfo.location || data.publicInfo.club || data.publicInfo.city || tr(locale, "A confirmar", "TBC")}</strong></div>
          <div className="public-tournament-fact"><span>{tr(locale, "Inscripción", "Registration")}</span><strong>{data.registrationCloseAt ? `${tr(locale, "Hasta", "Until")} ${date(data.registrationCloseAt)}` : tournamentStatusCopy(locale, data.tournament.status)}</strong></div>
          <div className="public-tournament-fact"><span>{tr(locale, "Categorías", "Categories")}</span><strong>{data.categories.length}</strong></div>
        </div>
      </section>
      {notice && <div className="registration-notice">{notice}</div>}
      {error && <div className="registration-alert">{error}</div>}
      {data.viewer.authenticated && data.maxCategoriesPerPlayer !== null && <div className="registration-limit-note">{tr(locale, `Categorías: ${data.activeCategoryCount + selected.length}/${data.maxCategoriesPerPlayer}`, `Categories: ${data.activeCategoryCount + selected.length}/${data.maxCategoriesPerPlayer}`)}</div>}
      {profileNeededSomewhere && <EligibilityProfileCard locale={locale} profile={data.viewer.profile} busy={busy === "profile"} onSave={saveProfile} />}

      <section className="registration-shop-layout" id="registration-categories">
        <div className="public-registration-grid">
          {data.categories.map((category) => {
            const full = category.maxEntries !== null && category.occupiedEntries >= category.maxEntries;
            const needsProfile = categoryNeedsProfile(category, data.viewer.profile);
            const isSelected = selected.includes(category.id);
            const explanation = explanationForPersistedFormat(category.formatKind, category.formatConfig, locale);
            return (
              <article className={`public-category-card ${isSelected ? "selected" : ""}`} key={category.id}>
                <header><div><span className="pill">{category.entryType.toUpperCase()}</span><h2>{category.name}</h2></div><strong>{money(category.priceMinor, category.currency, locale)}</strong></header>
                <div className="category-registration-meta"><span>{category.competitionGender ?? "open"}</span>{category.minAge !== null && <span>+{category.minAge}</span>}{category.maxAge !== null && <span>≤ {category.maxAge}</span>}<span>{category.maxEntries === null ? tr(locale, "Sin cupo máximo", "No capacity limit") : `${category.occupiedEntries}/${category.maxEntries}`}</span>{category.waitlistCount > 0 && <span>{category.waitlistCount} waitlist</span>}</div>
                {category.entryType === "pair" && <p className="muted">{tr(locale, "Te inscribís vos primero. La pareja se arma después entre jugadores ya inscriptos y libres.", "Register yourself first. Pairing happens later between registered free players.")}</p>}
                {category.entryType === "team" && <p className="muted">{tr(locale, "Podés quedar libre o crear un equipo y convertirte en capitán.", "Stay free or create a team and become captain.")}</p>}
                {explanation && <button type="button" className="public-format-explanation-trigger" onClick={() => setExplanationCategoryId(category.id)}><span>{tr(locale, "Cómo se juega", "How it works")}</span><span aria-hidden="true">↗</span></button>}
                {category.registrationBlockedCode ? <><button className="ghost full" disabled>{blockedButtonCopy(locale, category.registrationBlockedCode)}</button><p className="muted">{codeCopy(locale, category.registrationBlockedCode)}</p></> : !data.viewer.authenticated ? <button className="ghost full" onClick={login}>{tr(locale, "Ingresar para inscribirme", "Sign in to register")}</button> : <button className={isSelected ? "ghost full" : full ? "ghost full" : "light full"} disabled={needsProfile} onClick={() => toggle(category)}>{needsProfile ? tr(locale, "Completá tu perfil", "Complete your profile") : isSelected ? tr(locale, "Quitar", "Remove") : full ? tr(locale, "Agregar · puede ir a waitlist", "Add · may waitlist") : tr(locale, "Agregar", "Add")}</button>}
              </article>
            );
          })}
        </div>

        <aside className="registration-basket">
          <div className="registration-basket-head"><div><div className="eyebrow">TU INSCRIPCIÓN</div><h2>{tr(locale, "Revisá todo de una", "Review everything once")}</h2></div><span>{basket.length}</span></div>
          {!basket.length ? <div className="registration-basket-empty">{tr(locale, "Agregá categorías y vas a ver acá el desglose antes de confirmar.", "Add categories to see the full breakdown before confirming.")}</div> : <div className="registration-basket-items">{basket.map(({ category, price }) => {
            const team = teamChoice(category.id);
            return <div className="registration-basket-item" key={category.id}><div className="registration-basket-line"><div><strong>{category.name}</strong><small>{category.entryType === "pair" ? tr(locale, "Inscripción individual · pareja después", "Personal registration · pair later") : category.entryType === "team" ? tr(locale, "Torneo por equipos", "Team tournament") : tr(locale, "Individual", "Individual")}</small></div><strong>{money(price, category.currency, locale)}</strong></div>{category.entryType === "team" && <div className="team-basket-config"><label><span>{tr(locale, "Al confirmar", "On confirmation")}</span><select value={team.choice} onChange={(event) => updateTeamChoice(category.id, { choice: event.target.value as "free" | "create" })}><option value="free">{tr(locale, "Quedar libre / esperar equipo", "Stay free / wait for team")}</option><option value="create">{tr(locale, "Crear equipo · ser capitán", "Create team · become captain")}</option></select></label>{team.choice === "create" && <><label><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input value={team.teamName} onChange={(event) => updateTeamChoice(category.id, { teamName: event.target.value })} placeholder={tr(locale, "Ej. Horneros +50", "e.g. Horneros +50")} /></label><label><span>{tr(locale, "Quién paga", "Who pays")}</span><select value={team.paymentMode} onChange={(event) => updateTeamChoice(category.id, { paymentMode: event.target.value as "individual" | "team_full" })}><option value="individual">{tr(locale, "Cada jugador paga su inscripción", "Each player pays individually")}</option><option value="team_full" disabled={data.teamPricing.fullTeamFeeMinor === null}>{data.teamPricing.fullTeamFeeMinor === null ? tr(locale, "Equipo completo · precio no configurado", "Full team · fee not configured") : tr(locale, `Capitán paga equipo completo · ${money(data.teamPricing.fullTeamFeeMinor, category.currency, locale)}`, `Captain pays full team · ${money(data.teamPricing.fullTeamFeeMinor, category.currency, locale)}`)}</option></select></label></>}</div>}<button className="text-button" onClick={() => toggle(category)}>{tr(locale, "Quitar", "Remove")}</button></div>;
          })}</div>}
          <div className="registration-basket-total"><span>{tr(locale, "Total previsto", "Estimated total")}</span><strong>{money(basketTotal, basket[0]?.category.currency ?? "UYU", locale)}</strong></div>
          {data.pricingPolicy.paymentType === "base_plus_extra" && <p className="muted">{tr(locale, "El cálculo incluye automáticamente tarifa base y categorías extra según tus inscripciones previas y esta selección.", "The estimate automatically includes base and extra-category pricing using your existing registrations and this selection.")}</p>}
          {data.teamPricing.individualFeeMinor !== null && <p className="muted">{tr(locale, `Equipos: individual ${money(data.teamPricing.individualFeeMinor, "UYU", locale)}${data.teamPricing.additionalParticipationMode === "extra" ? ` · participación adicional ${money(data.teamPricing.additionalFeeMinor ?? 0, "UYU", locale)}` : data.teamPricing.additionalParticipationMode === "free" ? " · participación adicional gratis" : " · participación adicional a precio completo"}.`, `Teams: individual ${money(data.teamPricing.individualFeeMinor, "UYU", locale)}.`)}</p>}
          <button className="light full" disabled={!basket.length || busy === "basket"} onClick={() => void confirmBasket()}>{busy === "basket" ? "…" : tr(locale, "Confirmar inscripción", "Confirm registration")}</button>
          {limitAfterSelection !== null && data.maxCategoriesPerPlayer !== null && <small>{tr(locale, `${limitAfterSelection}/${data.maxCategoriesPerPlayer} categorías`, `${limitAfterSelection}/${data.maxCategoriesPerPlayer} categories`)}</small>}
        </aside>
      </section>

      {explanationCategory && modalExplanation && (
        <div
          className="public-format-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExplanationCategoryId(null);
          }}
        >
          <section
            className="public-format-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-format-modal-title"
          >
            <header className="public-format-modal-header">
              <div>
                <div className="eyebrow">{tr(locale, "FORMATO DE COMPETENCIA", "COMPETITION FORMAT")}</div>
                <h2 id="public-format-modal-title">{explanationCategory.name}</h2>
                <p>{tr(locale, "Así se juega esta categoría según la configuración oficial del torneo.", "This is how the category is played according to the tournament's official configuration.")}</p>
              </div>
              <button
                type="button"
                className="public-format-modal-close"
                aria-label={tr(locale, "Cerrar explicación", "Close explanation")}
                onClick={() => setExplanationCategoryId(null)}
              >
                ×
              </button>
            </header>
            <div className="public-format-modal-scroll">
              <FormatExplanationPanel
                explanation={modalExplanation}
                locale={locale}
                title={tr(locale, "Formato oficial", "Official format")}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

type Invitation = {
  id: string;
  kind: "pair" | "team";
  expiresAt: number;
  tournamentId: string;
  tournamentName: string;
  slug: string;
  categoryName: string;
  entryType: "pair" | "team";
  competitionGender: string | null;
  minAge: number | null;
  maxAge: number | null;
  inviterName: string;
  teamName: string | null;
};

type RegistrationMember = { personId: string; name: string; email: string | null; memberRole: string; status: string; userId: string | null };
type OutgoingInvitation = { id: string; targetRegistrationId: string; targetName: string; status: string; expiresAt: number };
type Candidate = { registrationId: string; userId: string; status: string; finalAmountMinor: number; name: string; email: string; invitationStatus: string | null; paymentReady: boolean };

type ManagedRegistration = {
  id: string;
  registrationNumber: number;
  status: string;
  participantCount: number;
  finalAmountMinor: number;
  currency: string | null;
  waitlistPosition: number | null;
  tournamentId: string;
  tournamentName: string;
  slug: string;
  categoryName: string;
  categoryId: string;
  entryType: "individual" | "pair" | "team";
  entryName: string | null;
  entryId: string | null;
  isOwner: number;
  viewerRole: string | null;
  groupingState: "ready" | "free" | "paired" | "captain" | "member";
  members: RegistrationMember[];
  outgoingInvitations: OutgoingInvitation[];
  rosterMin: number | null;
  rosterMax: number | null;
  teamPaymentMode: "individual" | "team_full" | null;
  teamFullFeeMinor: number | null;
  coveredByRegistrationId: string | null;
  covered: boolean;
  canSearch: boolean;
  formatKind: "standard" | "team" | null;
  formatConfig: unknown;
  explanationSchemaVersion: number | null;
  pendingCancellationRequest: { id: string; reason: string | null; netPaidMinor: number; createdAt: number } | null;
};

type MyData = { ok: true; profile: PlayerProfile | null; registrations: ManagedRegistration[]; invitations: Invitation[] };

export function MyTournamentRegistrations({ locale, go, onProfileSaved }: { locale: Locale; go: Go; onProfileSaved?: () => Promise<void> }) {
  const [data, setData] = useState<MyData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [profileNeeded, setProfileNeeded] = useState(false);
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [teamBuilderId, setTeamBuilderId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamPaymentMode, setTeamPaymentMode] = useState<"individual" | "team_full">("individual");

  const load = useCallback(async () => {
    try { setData(await api<MyData>("/api/me/tournament-registrations")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "LOAD_FAILED"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invitationNeedsMissingProfile = useMemo(() => Boolean(data?.invitations.some((invitation) => categoryNeedsProfile(invitation, data.profile))), [data]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("profile"); const form = new FormData(event.currentTarget);
    try { await api("/api/me/profile", { method: "PUT", body: JSON.stringify({ birthDate: form.get("birthDate") || null, sportGender: form.get("sportGender") }) }); setProfileNeeded(false); await Promise.all([load(), onProfileSaved?.() ?? Promise.resolve()]); }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "PROFILE_UPDATE_FAILED")); }
    finally { setBusy(""); }
  };

  const respond = async (id: string, response: "accept" | "decline") => {
    setBusy(id); setError("");
    try { await api(`/api/registration-match-invitations/${id}/respond`, { method: "POST", body: JSON.stringify({ response }) }); setProfileNeeded(false); await load(); }
    catch (e) { const code = e instanceof RegistrationError ? e.code : "INVITATION_FAILED"; setError(codeCopy(locale, code)); if (["PROFILE_REQUIRED", "BIRTH_DATE_REQUIRED", "SPORT_GENDER_REQUIRED"].includes(code)) setProfileNeeded(true); }
    finally { setBusy(""); }
  };

  const cancel = async (id: string) => {
    if (!window.confirm(tr(locale, "¿Cancelar esta inscripción? Si ya existe un pago, se enviará una solicitud al organizador y la participación seguirá activa hasta que la resuelva.", "Cancel this registration? If a payment already exists, a request will be sent to the organizer and participation stays active until reviewed."))) return;
    const reason = window.prompt(tr(locale, "Motivo de cancelación (opcional)", "Cancellation reason (optional)"));
    if (reason === null) return;
    setBusy(id);
    try {
      const result = await api<{ ok: true; cancellationRequested?: boolean }>(`/api/tournament-registrations/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
      if (result.cancellationRequested) window.alert(tr(locale, "Solicitud enviada. El organizador debe resolver la cancelación y, si corresponde, la devolución.", "Request sent. The organizer must review the cancellation and any applicable refund."));
      await load();
    }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "CANCEL_FAILED")); }
    finally { setBusy(""); }
  };
  const cancelAll = async (tournamentId: string, tournamentName: string, count: number) => {
    if (!window.confirm(tr(locale, `¿Cancelar tus ${count} inscripciones activas en ${tournamentName}? Las categorías pagadas quedarán activas hasta que el organizador resuelva la solicitud y la devolución que corresponda.`, `Cancel your ${count} active registrations in ${tournamentName}? Paid categories remain active until the organizer reviews the request and any applicable refund.`))) return;
    const reason = window.prompt(tr(locale, "Motivo de cancelación total (opcional)", "Reason for cancelling all registrations (optional)"));
    if (reason === null) return;
    setBusy(`cancel-all-${tournamentId}`);
    try {
      const result = await api<{ ok: true; total: number; cancelledNow: number; requestsCreated: number; requestsAlreadyPending: number }>(`/api/tournaments/${tournamentId}/registrations/cancel-all`, { method: "POST", body: JSON.stringify({ reason }) });
      if (result.requestsCreated + result.requestsAlreadyPending > 0) window.alert(tr(locale, `Se cancelaron ${result.cancelledNow} inscripción(es) sin saldo y ${result.requestsCreated + result.requestsAlreadyPending} quedaron solicitadas para revisión del organizador.`, `${result.cancelledNow} unpaid registration(s) were cancelled and ${result.requestsCreated + result.requestsAlreadyPending} were sent for organizer review.`));
      await load();
    }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "CANCEL_FAILED")); }
    finally { setBusy(""); }
  };

  const leaveGroup = async (registration: ManagedRegistration) => {
    const message = registration.entryType === "pair" ? tr(locale, "¿Desvincular esta pareja? Ambos seguirán inscriptos y quedarán libres para buscar otra pareja.", "Unlink this pair? Both players remain registered and become free again.") : registration.groupingState === "captain" ? tr(locale, "¿Disolver el equipo? Los integrantes seguirán inscriptos y quedarán libres.", "Dissolve this team? Members remain registered and become free.") : tr(locale, "¿Salir del equipo? Tu inscripción seguirá activa y quedarás libre.", "Leave the team? Your registration stays active and you become free.");
    if (!window.confirm(message)) return;
    setBusy(`leave-${registration.id}`);
    try { await api(`/api/tournament-registrations/${registration.id}/leave-group`, { method: "POST", body: "{}" }); await load(); }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "LEAVE_FAILED")); }
    finally { setBusy(""); }
  };

  const search = async (registration: ManagedRegistration) => {
    if (candidates[registration.id]) { setCandidates((current) => { const next = { ...current }; delete next[registration.id]; return next; }); return; }
    setBusy(`search-${registration.id}`);
    try { const result = await api<{ candidates: Candidate[] }>(`/api/tournament-registrations/${registration.id}/candidates`); setCandidates((current) => ({ ...current, [registration.id]: result.candidates })); }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "MATCHING_FAILED")); }
    finally { setBusy(""); }
  };

  const invite = async (registrationId: string, targetRegistrationId: string) => {
    setBusy(`invite-${targetRegistrationId}`);
    try { await api(`/api/tournament-registrations/${registrationId}/match-invitations`, { method: "POST", body: JSON.stringify({ targetRegistrationId }) }); const result = await api<{ candidates: Candidate[] }>(`/api/tournament-registrations/${registrationId}/candidates`); setCandidates((current) => ({ ...current, [registrationId]: result.candidates })); await load(); }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "INVITATION_FAILED")); }
    finally { setBusy(""); }
  };

  const cancelInvite = async (registrationId: string, invitationId: string) => {
    setBusy(`cancel-invite-${invitationId}`);
    try { await api(`/api/registration-match-invitations/${invitationId}`, { method: "DELETE" }); await load(); if (candidates[registrationId]) { const result = await api<{ candidates: Candidate[] }>(`/api/tournament-registrations/${registrationId}/candidates`); setCandidates((current) => ({ ...current, [registrationId]: result.candidates })); } }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "INVITATION_FAILED")); }
    finally { setBusy(""); }
  };

  const createTeam = async (registrationId: string) => {
    if (!teamName.trim()) { setError(tr(locale, "Poné un nombre para el equipo.", "Enter a team name.")); return; }
    setBusy(`team-${registrationId}`);
    try { await api(`/api/tournament-registrations/${registrationId}/team`, { method: "POST", body: JSON.stringify({ teamName, paymentMode: teamPaymentMode }) }); setTeamBuilderId(""); setTeamName(""); setTeamPaymentMode("individual"); await load(); }
    catch (e) { setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "TEAM_CREATE_FAILED")); }
    finally { setBusy(""); }
  };

  const currentRegistrations = data?.registrations.filter((registration) => !["cancelled", "rejected"].includes(registration.status)) ?? [];
  const registrationHistory = data?.registrations.filter((registration) => ["cancelled", "rejected"].includes(registration.status)) ?? [];
  const cancellableTournamentGroups = [...new Map(currentRegistrations.filter((registration) => registration.isOwner === 1).map((registration) => [registration.tournamentId, registration])).values()].map((seed) => ({
    tournamentId: seed.tournamentId,
    tournamentName: seed.tournamentName,
    count: currentRegistrations.filter((registration) => registration.isOwner === 1 && registration.tournamentId === seed.tournamentId).length,
  })).filter((group) => group.count > 1);

  return (
    <main className="dashboard my-registrations-page">
      <button className="section-back" onClick={() => go("/app")}>← {tr(locale, "Mi HUAU", "My HUAU")}</button>
      <section className="dashboard-head"><div><div className="eyebrow">HUAU TOURNAMENT</div><h1>{tr(locale, "Mis inscripciones", "My registrations")}</h1><p className="muted">{tr(locale, "Tu inscripción es tuya. Después podés vincularla a una pareja o equipo sin volver a inscribirte.", "Your registration belongs to you. Pair or join a team later without registering again.")}</p></div></section>
      {error && <div className="registration-alert">{error}</div>}
      {(profileNeeded || invitationNeedsMissingProfile) && <EligibilityProfileCard locale={locale} profile={data?.profile ?? null} busy={busy === "profile"} onSave={saveProfile} compact />}

      {data?.invitations.length ? <section className="panel"><div className="panel-title"><div><h2>{tr(locale, "Invitaciones pendientes", "Pending invitations")}</h2><p className="muted">{tr(locale, "Aceptar vincula tu inscripción existente; no crea una inscripción nueva.", "Accepting links your existing registration; it does not create a new one.")}</p></div><span>{data.invitations.length}</span></div><div className="registration-list">{data.invitations.map((invitation) => <article className="registration-row" key={invitation.id}><div><span className="pill">{invitation.kind}</span><strong>{invitation.kind === "pair" ? tr(locale, `${invitation.inviterName} quiere formar pareja contigo`, `${invitation.inviterName} wants to pair with you`) : tr(locale, `${invitation.inviterName} te invita a ${invitation.teamName || "su equipo"}`, `${invitation.inviterName} invites you to ${invitation.teamName || "their team"}`)}</strong><small>{invitation.tournamentName} · {invitation.categoryName}</small></div><div className="form-actions"><button className="ghost small" disabled={busy === invitation.id} onClick={() => void respond(invitation.id, "decline")}>{tr(locale, "Rechazar", "Decline")}</button><button className="light small" disabled={busy === invitation.id} onClick={() => void respond(invitation.id, "accept")}>{tr(locale, "Aceptar", "Accept")}</button></div></article>)}</div></section> : null}

      <section className="panel"><div className="panel-title"><div><h2>{tr(locale, "Inscripciones actuales", "Current registrations")}</h2><p className="muted">{tr(locale, "Sólo aparecen acá tus participaciones vigentes. Las canceladas quedan guardadas aparte como historial.", "Only current participation appears here. Cancelled registrations are kept separately as history.")}</p></div><span>{currentRegistrations.length}</span></div>{cancellableTournamentGroups.length > 0 && <div className="registration-cancel-all-list">{cancellableTournamentGroups.map((group) => <div key={group.tournamentId}><div><strong>{group.tournamentName}</strong><span>{group.count} {tr(locale, "inscripciones activas", "active registrations")}</span></div><button className="ghost small" disabled={busy === `cancel-all-${group.tournamentId}`} onClick={() => void cancelAll(group.tournamentId, group.tournamentName, group.count)}>{tr(locale, "Cancelar todas", "Cancel all")}</button></div>)}</div>}<div className="registration-list">{currentRegistrations.length ? currentRegistrations.map((registration) => {
        const active = !["cancelled", "rejected"].includes(registration.status);
        const registrationCandidates = candidates[registration.id];
        const explanation = explanationForPersistedFormat(registration.formatKind, registration.formatConfig, locale);
        return <article className="registration-card" key={`${registration.id}-${registration.isOwner}`}>
          <div className="registration-card-head"><button className="registration-main" onClick={() => go(`/tournaments/${registration.slug}`)}><span className={`pill status-${registration.status}`}>#{registration.registrationNumber} · {registration.status}</span><strong>{registration.tournamentName} · {registration.categoryName}</strong><small>{registration.entryType === "pair" ? registration.groupingState === "paired" ? tr(locale, "Pareja asignada", "Partner assigned") : tr(locale, "Buscando pareja", "Looking for partner") : registration.entryType === "team" ? registration.groupingState === "free" ? tr(locale, "Libre / sin equipo", "Free agent / no team") : `${registration.entryName || tr(locale, "Equipo", "Team")} · ${registration.groupingState}` : tr(locale, "Individual", "Individual")} · {money(registration.finalAmountMinor, registration.currency, locale)}</small></button><div className="form-actions">{registration.isOwner === 1 && active && (registration.pendingCancellationRequest ? <span className="pill">{tr(locale, "Cancelación solicitada", "Cancellation requested")}</span> : <button className="ghost small" disabled={busy === registration.id} onClick={() => void cancel(registration.id)}>{tr(locale, "Cancelar inscripción", "Cancel registration")}</button>)}{registration.isOwner === 0 && active && registration.entryType !== "individual" && <button className="ghost small" disabled={busy === `leave-${registration.id}`} onClick={() => void leaveGroup(registration)}>{tr(locale, "Salir", "Leave")}</button>}</div></div>

          {registration.entryType !== "individual" && registration.members.length > 0 && <div className="registration-entry-manager"><div className="registration-member-grid">{registration.members.map((member) => <div className="registration-member" key={member.personId}><span className="pill">{member.memberRole}</span><strong>{member.name}</strong><small>{member.email || tr(locale, "Cuenta HUAU", "HUAU account")}</small></div>)}</div></div>}

          {registration.isOwner === 1 && active && registration.entryType === "pair" && registration.groupingState === "free" && <div className="registration-group-actions"><div><strong>{tr(locale, "Buscando pareja", "Looking for partner")}</strong><p className="muted">{tr(locale, "HUAU muestra sólo jugadores inscriptos en esta misma categoría que todavía están libres.", "HUAU only shows registered players in this category who are still free.")}</p></div><button className="light small" disabled={busy === `search-${registration.id}`} onClick={() => void search(registration)}>{candidates[registration.id] ? tr(locale, "Cerrar búsqueda", "Close search") : tr(locale, "Buscar pareja", "Find partner")}</button></div>}

          {registration.isOwner === 1 && active && registration.entryType === "team" && registration.groupingState === "free" && <div className="registration-group-actions"><div><strong>{tr(locale, "Libre / sin equipo", "Free agent / no team")}</strong><p className="muted">{tr(locale, "Podés esperar una invitación o crear un equipo y pasar a ser capitán.", "Wait for an invitation or create a team and become captain.")}</p></div><button className="light small" onClick={() => setTeamBuilderId(teamBuilderId === registration.id ? "" : registration.id)}>{tr(locale, "Crear equipo", "Create team")}</button></div>}

          {teamBuilderId === registration.id && <div className="registration-team-builder"><label><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input value={teamName} onChange={(event) => setTeamName(event.target.value)} /></label><label><span>{tr(locale, "Modalidad de pago", "Payment mode")}</span><select value={teamPaymentMode} onChange={(event) => setTeamPaymentMode(event.target.value as "individual" | "team_full")}><option value="individual">{tr(locale, "Cada jugador paga individual", "Each player pays individually")}</option><option value="team_full" disabled={registration.teamFullFeeMinor === null}>{registration.teamFullFeeMinor === null ? tr(locale, "Equipo completo · precio no configurado", "Full team · fee not configured") : tr(locale, `Capitán paga equipo completo · ${money(registration.teamFullFeeMinor, registration.currency, locale)}`, `Captain pays full team · ${money(registration.teamFullFeeMinor, registration.currency, locale)}`)}</option></select></label><button className="light small" disabled={busy === `team-${registration.id}`} onClick={() => void createTeam(registration.id)}>{tr(locale, "Crear", "Create")}</button></div>}

          {registration.isOwner === 1 && active && registration.entryType === "team" && registration.groupingState === "captain" && <div className="registration-group-actions"><div><strong>{registration.entryName}</strong><p className="muted">{tr(locale, `Capitán · ${registration.teamPaymentMode === "team_full" ? "pagás el equipo completo" : "cada integrante paga lo suyo"}`, `Captain · ${registration.teamPaymentMode === "team_full" ? "you cover the full team" : "each member pays individually"}`)}{registration.rosterMin !== null ? ` · ${registration.members.length}/${registration.rosterMin} min` : ""}</p></div><div className="form-actions"><button className="light small" disabled={busy === `search-${registration.id}`} onClick={() => void search(registration)}>{candidates[registration.id] ? tr(locale, "Cerrar jugadores", "Close players") : tr(locale, "Buscar jugadores", "Find players")}</button><button className="ghost small" disabled={busy === `leave-${registration.id}`} onClick={() => void leaveGroup(registration)}>{tr(locale, "Disolver equipo", "Dissolve team")}</button></div></div>}

          {registration.isOwner === 1 && active && registration.entryType === "pair" && registration.groupingState === "paired" && <div className="registration-group-actions"><div><strong>{tr(locale, "Pareja confirmada", "Pair linked")}</strong><p className="muted">{registration.members.map((member) => member.name).join(" · ")}</p></div><button className="ghost small" disabled={busy === `leave-${registration.id}`} onClick={() => void leaveGroup(registration)}>{tr(locale, "Desvincular pareja", "Unlink pair")}</button></div>}

          {registration.isOwner === 1 && active && registration.entryType === "team" && registration.groupingState === "member" && <div className="registration-group-actions"><div><strong>{registration.entryName}</strong><p className="muted">{tr(locale, "Integrante del equipo", "Team member")}</p></div><button className="ghost small" disabled={busy === `leave-${registration.id}`} onClick={() => void leaveGroup(registration)}>{tr(locale, "Salir del equipo", "Leave team")}</button></div>}

          {registrationCandidates && <div className="registration-candidate-list">{registrationCandidates.length ? registrationCandidates.map((candidate) => <div className="registration-candidate" key={candidate.registrationId}><div><strong>{candidate.name}</strong><small>{candidate.status === "awaiting_payment" ? tr(locale, "Pago pendiente", "Payment pending") : tr(locale, "Inscripción activa", "Active registration")}</small></div><button className={candidate.invitationStatus === "pending" ? "ghost small" : "light small"} disabled={candidate.invitationStatus === "pending" || busy === `invite-${candidate.registrationId}`} onClick={() => void invite(registration.id, candidate.registrationId)}>{candidate.invitationStatus === "pending" ? tr(locale, "Invitación enviada", "Invitation sent") : tr(locale, "Invitar", "Invite")}</button></div>) : <div className="empty-state compact">{tr(locale, "No hay jugadores libres por ahora.", "No free players yet.")}</div>}</div>}

          {registration.outgoingInvitations.length > 0 && <div className="registration-outgoing"><span className="muted">{tr(locale, "Invitaciones enviadas", "Sent invitations")}</span>{registration.outgoingInvitations.map((invitation) => <div key={invitation.id}><span>{invitation.targetName}</span><button className="text-button" disabled={busy === `cancel-invite-${invitation.id}`} onClick={() => void cancelInvite(registration.id, invitation.id)}>{tr(locale, "Cancelar", "Cancel")}</button></div>)}</div>}

          {registration.covered && <div className="registration-payment-note covered"><strong>{tr(locale, "Cubierto por el capitán", "Covered by captain")}</strong><span>{tr(locale, "Tu participación está asociada a un equipo con pago completo.", "Your participation is covered by a full-team payment.")}</span></div>}
          {!registration.covered && registration.status === "awaiting_payment" && <div className="registration-payment-note"><strong>{tr(locale, "Pago pendiente", "Payment pending")}</strong><span>{tr(locale, "La inscripción ya existe. El pago se confirma cuando el organizador o el medio habilitado lo aprueba.", "Your registration already exists. Payment is confirmed when the organizer or enabled payment method approves it.")}</span></div>}
          {explanation && <details className="registration-format-explanation"><summary>{tr(locale, "Cómo se juega esta categoría", "How this category works")}</summary><FormatExplanationPanel explanation={explanation} locale={locale} compact title={registration.categoryName}/></details>}
        </article>;
      }) : <div className="empty-state">{tr(locale, "No tenés inscripciones vigentes.", "You do not have current registrations.")}</div>}</div></section>

      {registrationHistory.length > 0 && <section className="panel registration-history-panel"><div className="panel-title"><div><h2>{tr(locale, "Cancelaciones e historial", "Cancellations & history")}</h2><p className="muted">{tr(locale, "Se conserva para trazabilidad. No cuenta como participación activa ni aparece en la operación del torneo.", "Kept for traceability. It does not count as active participation or appear in tournament operations.")}</p></div><span>{registrationHistory.length}</span></div><div className="registration-history-list">{registrationHistory.map((registration) => <article className="registration-history-row" key={`history-${registration.id}-${registration.isOwner}`}><div><span className={`pill status-${registration.status}`}>#{registration.registrationNumber} · {registration.status}</span><strong>{registration.tournamentName} · {registration.categoryName}</strong><small>{money(registration.finalAmountMinor, registration.currency, locale)}</small></div><span className="history-state">{registration.status === "cancelled" ? tr(locale, "Cancelada", "Cancelled") : tr(locale, "Rechazada", "Rejected")}</span></article>)}</div></section>}
    </main>
  );
}

type AdminRegistration = ManagedRegistration & { priceScope: string; baseAmountMinor: number; discountMinor: number; createdAt: number; userName: string; userEmail: string };
type AdminData = { ok: true; publicUrl: string; registrations: AdminRegistration[] };

type AdminRegistrationTableProps = {
  rows: AdminRegistration[];
  locale: Locale;
  busy: string;
  allowActions: boolean;
  promote: (id: string) => Promise<void>;
  discount: (id: string) => Promise<void>;
  courtesy: (id: string) => Promise<void>;
  restoreCharge: (registration: AdminRegistration) => Promise<void>;
};

function adminGroupingCopy(registration: AdminRegistration, locale: Locale) {
  if (registration.entryType === "pair") return registration.groupingState === "paired" ? registration.members.map((member) => member.name).join(" / ") : tr(locale, "Libre · buscando pareja", "Free · looking for partner");
  if (registration.entryType === "team") return registration.entryName ? `${registration.entryName} · ${registration.groupingState}` : tr(locale, "Libre · sin equipo", "Free · no team");
  return tr(locale, "Individual", "Individual");
}

function AdminRegistrationTable({ rows, locale, busy, allowActions, promote, discount, courtesy, restoreCharge }: AdminRegistrationTableProps) {
  if (!rows.length) return <div className="empty-state compact">{tr(locale, "No hay registros en este apartado.", "No records in this section.")}</div>;
  return <div className="registration-admin-table"><div className="registration-admin-head"><span>#</span><span>{tr(locale, "Jugador", "Player")}</span><span>{tr(locale, "Categoría / vínculo", "Category / group")}</span><span>{tr(locale, "Estado", "Status")}</span><span>{tr(locale, "Importe", "Amount")}</span><span></span></div>{rows.map((registration) => <div className={`registration-admin-row${allowActions ? "" : " history"}`} key={registration.id}><span>{registration.registrationNumber}</span><div><strong>{registration.userName}</strong><small>{registration.userEmail}</small></div><div><strong>{registration.categoryName}</strong><small>{adminGroupingCopy(registration, locale)}</small></div><span><b className={`pill status-${registration.status}`}>{registration.status}</b>{registration.covered && <small>{tr(locale, "cubierto", "covered")}</small>}</span><span>{money(registration.finalAmountMinor, registration.currency, locale)}{registration.discountMinor > 0 && <small> − {money(registration.discountMinor, registration.currency, locale)}</small>}</span><div className="form-actions">{allowActions && <>{registration.status === "waitlisted" && <button className="light small" disabled={busy === registration.id} onClick={() => void promote(registration.id)}>{tr(locale, "Promover", "Promote")}</button>}<button className="ghost small" disabled={busy === registration.id} onClick={() => void discount(registration.id)}>{tr(locale, "Descuento", "Discount")}</button><button className="ghost small" disabled={busy === registration.id} onClick={() => void courtesy(registration.id)}>{tr(locale, "Cortesía", "Courtesy")}</button>{registration.discountMinor > 0 && <button className="ghost small" disabled={busy === registration.id} onClick={() => void restoreCharge(registration)}>{tr(locale, "Restaurar cobro", "Restore charge")}</button>}</>}</div></div>)}</div>;
}

export function TournamentRegistrationAdmin({ tournamentId, locale }: { tournamentId: string; locale: Locale }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setData(await api<AdminData>(`/api/admin/tournaments/${tournamentId}/registrations`)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "LOAD_FAILED"); } }, [tournamentId]);
  useEffect(() => { void load(); }, [load]);
  const promote = async (id: string) => { setBusy(id); try { await api(`/api/admin/registrations/${id}/promote`, { method: "POST", body: "{}" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "PROMOTE_FAILED"); } finally { setBusy(""); } };
  const courtesy = async (id: string) => { const note = window.prompt(tr(locale, "Motivo de cortesía (opcional)", "Courtesy reason (optional)")); if (note === null) return; setBusy(id); try { await api(`/api/admin/registrations/${id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "courtesy", amountMinor: 0, note }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "ADJUSTMENT_FAILED"); } finally { setBusy(""); } };
  const restoreCharge = async (registration: AdminRegistration) => { if (!window.confirm(tr(locale, "¿Restaurar el importe original? La inscripción volverá a pago pendiente si corresponde.", "Restore the original amount? The registration will return to awaiting payment when applicable."))) return; setBusy(registration.id); try { await api(`/api/admin/registrations/${registration.id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "fixed_total", amountMinor: registration.baseAmountMinor, note: tr(locale, "Cortesía/descuento revertido por administrador", "Courtesy/discount reverted by administrator") }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "ADJUSTMENT_FAILED"); } finally { setBusy(""); } };
  const discount = async (id: string) => { const value = window.prompt(tr(locale, "Descuento en pesos (ej. 200)", "Discount amount (e.g. 200)")); if (value === null) return; setBusy(id); try { await api(`/api/admin/registrations/${id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "discount", amountMinor: Math.round(Number(value) * 100) }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "ADJUSTMENT_FAILED"); } finally { setBusy(""); } };
  const copyLink = async () => { if (data) await navigator.clipboard.writeText(`${window.location.origin}${data.publicUrl}`); };
  const active = data?.registrations.filter((registration) => registration.status === "confirmed") ?? [];
  const pending = data?.registrations.filter((registration) => !["confirmed", "cancelled", "rejected"].includes(registration.status)) ?? [];
  const history = data?.registrations.filter((registration) => ["cancelled", "rejected"].includes(registration.status)) ?? [];

  return <section className="tpw-stack"><article className="panel"><div className="panel-title"><div><div className="eyebrow">ONLINE REGISTRATION</div><h2>{tr(locale, "Inscripciones del torneo", "Tournament registrations")}</h2><p>{tr(locale, "La operación vigente queda separada del historial. Cancelaciones y rechazos se conservan sin mezclarse con los jugadores efectivos.", "Current operations are separated from history. Cancellations and rejections are preserved without mixing with effective players.")}</p></div><button className="ghost small" onClick={() => void copyLink()}>{tr(locale, "Copiar link público", "Copy public link")}</button></div>{error && <div className="registration-alert">{error}</div>}</article>
    <article className="panel registration-admin-section"><div className="panel-title"><div><h2>{tr(locale, "Jugadores efectivos", "Effective players")}</h2><p className="muted">{tr(locale, "Inscripciones confirmadas que forman parte de la operación actual del torneo.", "Confirmed registrations that are part of current tournament operations.")}</p></div><span>{active.length}</span></div><AdminRegistrationTable rows={active} locale={locale} busy={busy} allowActions promote={promote} discount={discount} courtesy={courtesy} restoreCharge={restoreCharge}/></article>
    <article className="panel registration-admin-section"><div className="panel-title"><div><h2>{tr(locale, "En proceso", "In progress")}</h2><p className="muted">{tr(locale, "Pago pendiente, búsqueda de pareja/equipo o lista de espera. Requieren seguimiento pero todavía no son bajas.", "Awaiting payment, pairing/team formation, or waitlist. They need follow-up but are not cancellations.")}</p></div><span>{pending.length}</span></div><AdminRegistrationTable rows={pending} locale={locale} busy={busy} allowActions promote={promote} discount={discount} courtesy={courtesy} restoreCharge={restoreCharge}/></article>
    <article className="panel registration-admin-section registration-history-panel"><div className="panel-title"><div><h2>{tr(locale, "Cancelaciones e historial", "Cancellations & history")}</h2><p className="muted">{tr(locale, "Historial no operativo. Se conserva para auditoría y para que Phase 7 pueda asociar solicitudes de cancelación y reembolsos sin perder trazabilidad.", "Non-operational history. It is preserved for audit and so Phase 7 can attach cancellation requests and refunds without losing traceability.")}</p></div><span>{history.length}</span></div><AdminRegistrationTable rows={history} locale={locale} busy={busy} allowActions={false} promote={promote} discount={discount} courtesy={courtesy} restoreCharge={restoreCharge}/></article>
  </section>;
}
