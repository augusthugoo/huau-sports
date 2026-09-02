import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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

type PublicCategory = {
  id: string;
  name: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: string | null;
  minAge: number | null;
  maxAge: number | null;
  maxEntries: number | null;
  registrationStatus: "closed" | "open" | "waitlist_only";
  priceScope: "free" | "per_entry" | "per_person";
  priceMinor: number;
  priceSource: "category" | "tournament";
  priceDescription:
    | "category_override"
    | "tournament_base"
    | "tournament_extra"
    | "tournament_per_category"
    | "tournament_free";
  currency: string | null;
  scheduledDate: string | null;
  structureLocked: number;
  occupiedEntries: number;
  waitlistCount: number;
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
    courtCount: number;
    structureLocked: number;
  };
  registrationCloseAt: number | null;
  pricingPolicy: PricingPolicy;
  maxCategoriesPerPlayer: number | null;
  activeCategoryCount: number;
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
    ALREADY_REGISTERED_IN_CATEGORY: ["Ya formás parte de una inscripción activa en esta categoría.", "You are already part of an active registration in this category."],
    CATEGORY_REGISTRATION_CLOSED: ["Esta categoría está cerrada para inscripciones.", "This category is closed for registrations."],
    REGISTRATION_DEADLINE_PASSED: ["El período de inscripción ya cerró.", "Registration is closed."],
    TOURNAMENT_REGISTRATION_CLOSED: ["El torneo no está recibiendo inscripciones.", "The tournament is not accepting registrations."],
    COMPETITION_STRUCTURE_LOCKED: ["La competencia ya fue cerrada para nuevas inscripciones.", "The competition is already locked for new registrations."],
    MAX_CATEGORIES_REACHED: ["Ya alcanzaste el máximo de categorías permitido para este torneo.", "You already reached this tournament's maximum categories per player."],
    INVITEE_ALREADY_REGISTERED_IN_CATEGORY: ["Ese jugador ya forma parte de una inscripción activa en esta categoría.", "That player is already part of an active registration in this category."],
    INVITEE_ALREADY_IN_ENTRY: ["Ese jugador ya forma parte de esta inscripción.", "That player is already part of this registration."],
    PAIR_ALREADY_COMPLETE: ["La pareja ya está completa.", "The pair is already complete."],
    TEAM_ROSTER_FULL: ["El roster ya alcanzó su máximo.", "The roster already reached its maximum."],
  };
  return map[code]?.[locale === "es" ? 0 : 1] ?? code;
}

function blockedButtonCopy(locale: Locale, code: string) {
  if (code === "COMPETITION_STRUCTURE_LOCKED") return tr(locale, "Competencia cerrada", "Competition locked");
  if (code === "REGISTRATION_DEADLINE_PASSED") return tr(locale, "Inscripciones cerradas", "Registration closed");
  if (code === "TOURNAMENT_REGISTRATION_CLOSED") return tr(locale, "Torneo cerrado", "Tournament closed");
  if (code === "ALREADY_REGISTERED_IN_CATEGORY") return tr(locale, "Ya estás inscripto", "Already registered");
  if (code === "MAX_CATEGORIES_REACHED") return tr(locale, "Máximo alcanzado", "Limit reached");
  return tr(locale, "Cerrada", "Closed");
}

function categoryNeedsProfile(category: Pick<PublicCategory, "minAge" | "maxAge" | "competitionGender">, profile: PlayerProfile | null) {
  if (!profile) return true;
  const needsBirth = (category.minAge !== null || category.maxAge !== null) && !profile.birthDate;
  const gendered = ["male", "female", "mixed"].includes(category.competitionGender ?? "");
  const needsGender = gendered && profile.sportGender === "unspecified";
  return needsBirth || needsGender;
}

function priceNote(locale: Locale, category: PublicCategory, policy: PricingPolicy) {
  if (category.priceDescription === "category_override") {
    return tr(locale, "Precio específico de esta categoría", "Category-specific price");
  }
  if (category.priceDescription === "tournament_base") {
    return tr(
      locale,
      `Precio base del torneo${policy.extraCategoryFeeMinor !== null ? ` · categoría extra ${money(policy.extraCategoryFeeMinor, category.currency, locale)}` : ""}`,
      `Tournament base price${policy.extraCategoryFeeMinor !== null ? ` · extra category ${money(policy.extraCategoryFeeMinor, category.currency, locale)}` : ""}`,
    );
  }
  if (category.priceDescription === "tournament_extra") {
    return tr(locale, "Precio de categoría extra según la configuración del torneo", "Extra-category price from tournament settings");
  }
  if (category.priceDescription === "tournament_per_category") {
    return tr(locale, "Precio por categoría según la configuración del torneo", "Per-category price from tournament settings");
  }
  return tr(locale, "Según la configuración del torneo", "From tournament settings");
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
        <p>
          {tr(
            locale,
            compact
              ? "Estos datos pertenecen a tu perfil global HUAU y se usan sólo cuando una inscripción necesita validar elegibilidad."
              : "Fecha de nacimiento y género deportivo se guardan en tu perfil global HUAU. Tournament los usa sólo cuando una categoría necesita validar edad o género.",
            compact
              ? "These fields belong to your global HUAU profile and are used only when registration eligibility requires them."
              : "Birth date and sport gender are stored in your global HUAU profile. Tournament uses them only when a category needs age or gender eligibility.",
          )}
        </p>
      </div>
      <form onSubmit={(event) => void onSave(event)}>
        <label>
          <span>{tr(locale, "Fecha de nacimiento", "Birth date")}</span>
          <input name="birthDate" type="date" defaultValue={profile?.birthDate ?? ""} />
        </label>
        <label>
          <span>{tr(locale, "Género deportivo", "Sport gender")}</span>
          <select name="sportGender" defaultValue={profile?.sportGender ?? "unspecified"}>
            <option value="unspecified">{tr(locale, "Sin especificar", "Unspecified")}</option>
            <option value="male">{tr(locale, "Masculino", "Male")}</option>
            <option value="female">{tr(locale, "Femenino", "Female")}</option>
          </select>
        </label>
        <button className="light" disabled={busy}>{busy ? "…" : tr(locale, "Guardar perfil", "Save profile")}</button>
      </form>
    </section>
  );
}

export function PublicTournamentRegistration({ slug, locale, go, onProfileSaved }: { slug: string; locale: Locale; go: Go; onProfileSaved?: () => Promise<void> }) {
  const [data, setData] = useState<PublicTournamentData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<PublicTournamentData>(`/api/public/tournaments/${encodeURIComponent(slug)}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const login = () => {
    sessionStorage.setItem("huau.afterAuth", `/tournaments/${slug}`);
    go("/login");
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("profile");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({ birthDate: form.get("birthDate") || null, sportGender: form.get("sportGender") }),
      });
      await Promise.all([load(), onProfileSaved?.() ?? Promise.resolve()]);
      setNotice(tr(locale, "Perfil actualizado. Ya podés continuar.", "Profile updated. You can continue."));
    } catch (err) {
      setError(codeCopy(locale, err instanceof RegistrationError ? err.code : "PROFILE_UPDATE_FAILED"));
    } finally {
      setBusy("");
    }
  };

  const register = async (category: PublicCategory, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(category.id);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const body = category.entryType === "pair"
      ? { partnerEmail: String(form.get("partnerEmail") || "") }
      : category.entryType === "team"
        ? {
            teamName: String(form.get("teamName") || ""),
            memberEmails: String(form.get("memberEmails") || "").split(/[,;\n]/).map((value) => value.trim()).filter(Boolean),
          }
        : {};
    try {
      const result = await api<{ status: string; waitlistPosition: number | null }>(
        `/api/tournaments/${data!.tournament.id}/categories/${category.id}/register`,
        { method: "POST", body: JSON.stringify(body) },
      );
      await load();
      setNotice(
        result.status === "waitlisted"
          ? tr(locale, `Quedaste en lista de espera${result.waitlistPosition ? ` #${result.waitlistPosition}` : ""}.`, `You joined the waitlist${result.waitlistPosition ? ` #${result.waitlistPosition}` : ""}.`)
          : category.entryType === "individual"
            ? tr(locale, "Inscripción creada.", "Registration created.")
            : tr(locale, "Inscripción creada. Ahora falta completar las invitaciones.", "Registration created. Invitations must now be completed."),
      );
    } catch (err) {
      setError(codeCopy(locale, err instanceof RegistrationError ? err.code : "REGISTRATION_FAILED"));
    } finally {
      setBusy("");
    }
  };

  if (!data) {
    return <main className="public-tournament-page"><button className="back-link" onClick={() => go("/")}>← HUAU</button>{error ? <div className="registration-alert">{error}</div> : <div className="empty-state">{tr(locale, "Cargando torneo…", "Loading tournament…")}</div>}</main>;
  }

  const profileNeededSomewhere = data.viewer.authenticated && data.categories.some((category) => !category.registrationBlockedCode && categoryNeedsProfile(category, data.viewer.profile));

  return (
    <main className="public-tournament-page">
      <header className="public-tournament-nav">
        <button className="brand-button" onClick={() => go("/")}><strong>HUAU</strong><span>SPORTS</span></button>
        <div>{data.viewer.authenticated ? <button className="ghost" onClick={() => go("/app/registrations")}>{tr(locale, "Mis inscripciones", "My registrations")}</button> : <button className="light" onClick={login}>{tr(locale, "Ingresar", "Sign in")}</button>}</div>
      </header>
      <section className="public-tournament-hero">
        <div><div className="eyebrow">HUAU TOURNAMENT</div><h1>{data.tournament.name}</h1><p>{date(data.tournament.startAt)}{data.tournament.endAt ? ` → ${date(data.tournament.endAt)}` : ""} · {data.tournament.courtCount} {tr(locale, "canchas", "courts")}</p></div>
        <span className={`registration-open-pill ${data.tournament.status}`}>{data.tournament.status.replaceAll("_", " ")}</span>
      </section>
      {notice && <div className="registration-notice">{notice}</div>}
      {error && <div className="registration-alert">{error}</div>}
      {data.viewer.authenticated && data.maxCategoriesPerPlayer !== null && <div className="registration-limit-note">{tr(locale, `Categorías: ${data.activeCategoryCount}/${data.maxCategoriesPerPlayer}`, `Categories: ${data.activeCategoryCount}/${data.maxCategoriesPerPlayer}`)}</div>}
      {profileNeededSomewhere && <EligibilityProfileCard locale={locale} profile={data.viewer.profile} busy={busy === "profile"} onSave={saveProfile} />}
      <section className="public-registration-grid">
        {data.categories.map((category) => {
          const full = category.maxEntries !== null && category.occupiedEntries >= category.maxEntries;
          const needsProfile = categoryNeedsProfile(category, data.viewer.profile);
          const pairTotal = category.priceScope === "per_person" && category.entryType === "pair" ? category.priceMinor * 2 : category.priceMinor;
          return (
            <article className="public-category-card" key={category.id}>
              <header><div><span className="pill">{category.entryType.toUpperCase()}</span><h2>{category.name}</h2></div><strong>{money(pairTotal, category.currency, locale)}</strong></header>
              <div className="category-registration-meta">
                <span>{category.competitionGender ?? "open"}</span>
                {category.minAge !== null && <span>+{category.minAge}</span>}
                {category.maxAge !== null && <span>≤ {category.maxAge}</span>}
                <span>{category.maxEntries === null ? tr(locale, "Sin cupo máximo", "No capacity limit") : `${category.occupiedEntries}/${category.maxEntries}`}</span>
                {category.waitlistCount > 0 && <span>{category.waitlistCount} waitlist</span>}
              </div>
              {category.priceScope === "per_person" && <p className="muted">{money(category.priceMinor, category.currency, locale)} {tr(locale, "por persona", "per person")}</p>}
              <p className="muted">{priceNote(locale, category, data.pricingPolicy)}</p>
              {category.registrationBlockedCode ? (
                <><button className="ghost full" disabled>{blockedButtonCopy(locale, category.registrationBlockedCode)}</button><p className="muted">{codeCopy(locale, category.registrationBlockedCode)}</p></>
              ) : !data.viewer.authenticated ? (
                <button className="ghost full" onClick={login}>{tr(locale, "Ingresar para inscribirme", "Sign in to register")}</button>
              ) : (
                <form className="public-register-form" onSubmit={(event) => void register(category, event)}>
                  {category.entryType === "pair" && <label><span>{tr(locale, "Email de tu pareja HUAU", "Partner HUAU email")}</span><input name="partnerEmail" type="email" required placeholder="pareja@email.com" /></label>}
                  {category.entryType === "team" && <><label><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input name="teamName" required /></label><label><span>{tr(locale, "Emails del roster (podés completarlo después)", "Roster emails (you can complete it later)")}</span><textarea name="memberEmails" rows={3} placeholder={tr(locale, "Uno por línea o separados por coma", "One per line or comma-separated")} /></label></>}
                  <button className={full || category.registrationStatus === "waitlist_only" ? "ghost full" : "light full"} disabled={busy === category.id || needsProfile}>
                    {needsProfile ? tr(locale, "Completá tu perfil", "Complete your profile") : full || category.registrationStatus === "waitlist_only" ? tr(locale, "Entrar a lista de espera", "Join waitlist") : tr(locale, "Inscribirme", "Register")}
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

type Invitation = {
  id: string;
  status: string;
  memberRole: string;
  expiresAt: number;
  tournamentName: string;
  slug: string;
  categoryName: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: string | null;
  minAge: number | null;
  maxAge: number | null;
  entryName: string;
  inviterName: string;
};

type RegistrationMember = {
  personId: string;
  name: string;
  email: string | null;
  memberRole: string;
  status: string;
  userId: string | null;
};

type RegistrationEntryInvitation = {
  id: string;
  inviteeEmail: string;
  memberRole: string;
  status: string;
  expiresAt: number;
  inviteeUserId: string | null;
};

type ManagedRegistration = {
  id: string;
  registrationNumber: number;
  status: string;
  participantCount: number;
  finalAmountMinor: number;
  currency: string | null;
  waitlistPosition: number | null;
  tournamentName: string;
  slug: string;
  categoryName: string;
  categoryId: string;
  entryType: "individual" | "pair" | "team";
  entryName: string | null;
  entryId: string | null;
  isOwner: number;
  viewerRole: string | null;
  members: RegistrationMember[];
  entryInvitations: RegistrationEntryInvitation[];
  canManageInvitations: boolean;
  rosterMin: number | null;
  rosterMax: number | null;
};

type MyData = {
  ok: true;
  profile: PlayerProfile | null;
  registrations: ManagedRegistration[];
  invitations: Invitation[];
};

export function MyTournamentRegistrations({ locale, go, onProfileSaved }: { locale: Locale; go: Go; onProfileSaved?: () => Promise<void> }) {
  const [data, setData] = useState<MyData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [profileNeeded, setProfileNeeded] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<MyData>("/api/me/tournament-registrations"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invitationNeedsMissingProfile = useMemo(
    () => Boolean(data?.invitations.some((invitation) => categoryNeedsProfile(invitation, data.profile))),
    [data],
  );

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("profile");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({ birthDate: form.get("birthDate") || null, sportGender: form.get("sportGender") }),
      });
      setProfileNeeded(false);
      setError("");
      await Promise.all([load(), onProfileSaved?.() ?? Promise.resolve()]);
    } catch (e) {
      setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "PROFILE_UPDATE_FAILED"));
    } finally {
      setBusy("");
    }
  };

  const respond = async (id: string, response: "accept" | "decline") => {
    setBusy(id);
    setError("");
    try {
      await api(`/api/entry-invitations/${id}/respond`, { method: "POST", body: JSON.stringify({ response }) });
      setProfileNeeded(false);
      await load();
    } catch (e) {
      const code = e instanceof RegistrationError ? e.code : "INVITATION_FAILED";
      setError(codeCopy(locale, code));
      if (["PROFILE_REQUIRED", "BIRTH_DATE_REQUIRED", "SPORT_GENDER_REQUIRED", "GENDER_NOT_ELIGIBLE"].includes(code)) setProfileNeeded(true);
    } finally {
      setBusy("");
    }
  };

  const inviteMember = async (registration: ManagedRegistration) => {
    const label = registration.entryType === "pair"
      ? tr(locale, "Email de la pareja", "Partner email")
      : tr(locale, "Email del integrante", "Member email");
    const email = window.prompt(label)?.trim();
    if (!email) return;
    setBusy(`invite-${registration.id}`);
    setError("");
    try {
      await api(`/api/tournament-registrations/${registration.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role: "player" }),
      });
      await load();
    } catch (e) {
      const code = e instanceof RegistrationError ? e.code : "INVITATION_FAILED";
      setError(codeCopy(locale, code));
    } finally {
      setBusy("");
    }
  };

  const cancelInvite = async (registrationId: string, invitationId: string) => {
    setBusy(`invite-${invitationId}`);
    setError("");
    try {
      await api(`/api/tournament-registrations/${registrationId}/invitations/${invitationId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "INVITATION_FAILED"));
    } finally {
      setBusy("");
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm(tr(locale, "¿Cancelar esta inscripción?", "Cancel this registration?"))) return;
    setBusy(id);
    try {
      await api(`/api/tournament-registrations/${id}/cancel`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CANCEL_FAILED");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="dashboard my-registrations-page">
      <button className="section-back" onClick={() => go("/app")}>← {tr(locale, "Mi HUAU", "My HUAU")}</button>
      <section className="dashboard-head"><div><div className="eyebrow">HUAU TOURNAMENT</div><h1>{tr(locale, "Mis inscripciones", "My registrations")}</h1></div></section>
      {error && <div className="registration-alert">{error}</div>}
      {(profileNeeded || invitationNeedsMissingProfile) && <EligibilityProfileCard locale={locale} profile={data?.profile ?? null} busy={busy === "profile"} onSave={saveProfile} compact />}
      {data?.invitations.length ? (
        <section className="panel">
          <div className="panel-title"><div><h2>{tr(locale, "Invitaciones pendientes", "Pending invitations")}</h2><p className="muted">{tr(locale, "Unirte completa la pareja o el roster. Si la inscripción tiene costo, no queda confirmada hasta que el pago sea aprobado.", "Joining completes the pair or roster. If the registration has a fee, it is not confirmed until payment is approved.")}</p></div><span>{data.invitations.length}</span></div>
          <div className="registration-list">
            {data.invitations.map((invitation) => (
              <article className="registration-row" key={invitation.id}>
                <div><span className="pill">{invitation.memberRole}</span><strong>{invitation.tournamentName} · {invitation.categoryName}</strong><small>{invitation.entryName} · {tr(locale, "invita", "invited by")} {invitation.inviterName}</small></div>
                <div className="form-actions"><button className="ghost small" disabled={busy === invitation.id} onClick={() => void respond(invitation.id, "decline")}>{tr(locale, "Rechazar", "Decline")}</button><button className="light small" disabled={busy === invitation.id} onClick={() => void respond(invitation.id, "accept")}>{tr(locale, "Unirme", "Join")}</button></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-title"><h2>{tr(locale, "Inscripciones", "Registrations")}</h2><span>{data?.registrations.length ?? 0}</span></div>
        <div className="registration-list">
          {data?.registrations.length ? data.registrations.map((registration) => {
            const pendingInvites = registration.entryInvitations.filter((invitation) => invitation.status === "pending");
            const pairComplete = registration.entryType === "pair" && registration.members.length >= 2;
            const teamFull = registration.entryType === "team" && registration.rosterMax !== null && registration.members.length + pendingInvites.length >= registration.rosterMax;
            const canInvite = registration.canManageInvitations && !['cancelled', 'rejected'].includes(registration.status) && (registration.entryType === "pair" ? !pairComplete : registration.entryType === "team" ? !teamFull : false);
            return (
              <article className="registration-card" key={registration.id}>
                <div className="registration-card-head">
                  <button className="registration-main" onClick={() => go(`/tournaments/${registration.slug}`)}><span className={`pill status-${registration.status}`}>#{registration.registrationNumber} · {registration.status}</span><strong>{registration.tournamentName} · {registration.categoryName}</strong><small>{registration.entryName || registration.entryType}{registration.waitlistPosition ? ` · waitlist #${registration.waitlistPosition}` : ""} · {money(registration.finalAmountMinor, registration.currency, locale)}</small></button>
                  {registration.isOwner === 1 && !['cancelled', 'rejected'].includes(registration.status) && <button className="ghost small" disabled={busy === registration.id} onClick={() => void cancel(registration.id)}>{tr(locale, "Cancelar", "Cancel")}</button>}
                </div>
                {registration.entryType !== "individual" && (
                  <div className="registration-entry-manager">
                    <div className="registration-member-grid">
                      {registration.members.map((member) => <div className="registration-member" key={member.personId}><span className="pill">{member.memberRole}</span><strong>{member.name}</strong><small>{member.email || tr(locale, "Cuenta HUAU", "HUAU account")}</small></div>)}
                      {pendingInvites.map((invitation) => <div className="registration-member pending" key={invitation.id}><span className="pill">pending</span><strong>{invitation.inviteeEmail}</strong><small>{tr(locale, "Invitación pendiente", "Pending invitation")}</small>{registration.canManageInvitations && <button className="text-button" disabled={busy === `invite-${invitation.id}`} onClick={() => void cancelInvite(registration.id, invitation.id)}>{tr(locale, "Cancelar invitación", "Cancel invitation")}</button>}</div>)}
                    </div>
                    <div className="registration-manager-actions">
                      {registration.entryType === "team" && registration.rosterMin !== null && <span className="muted">{tr(locale, `Roster ${registration.members.length}/${registration.rosterMin} mínimo${registration.rosterMax !== null ? ` · máx. ${registration.rosterMax}` : ""}`, `Roster ${registration.members.length}/${registration.rosterMin} minimum${registration.rosterMax !== null ? ` · max ${registration.rosterMax}` : ""}`)}</span>}
                      {canInvite && <button className="ghost small" disabled={busy === `invite-${registration.id}`} onClick={() => void inviteMember(registration)}>{registration.entryType === "pair" ? (pendingInvites.length ? tr(locale, "Cambiar invitación", "Change invitation") : tr(locale, "Invitar pareja", "Invite partner")) : tr(locale, "Agregar integrante", "Add member")}</button>}
                    </div>
                  </div>
                )}
                {registration.status === "awaiting_payment" && <div className="registration-payment-note"><strong>{tr(locale, "Pago pendiente", "Payment pending")}</strong><span>{tr(locale, "La pareja/equipo ya está vinculada, pero la inscripción no queda confirmada hasta aprobar el pago.", "The pair/team is linked, but the registration is not confirmed until payment is approved.")}</span></div>}
              </article>
            );
          }) : <div className="empty-state">{tr(locale, "Todavía no tenés inscripciones.", "You do not have registrations yet.")}</div>}
        </div>
      </section>
    </main>
  );
}

type AdminRegistration = ManagedRegistration & {
  priceScope: string;
  baseAmountMinor: number;
  discountMinor: number;
  createdAt: number;
  userName: string;
  userEmail: string;
};

type AdminData = {
  ok: true;
  publicUrl: string;
  registrations: AdminRegistration[];
};

export function TournamentRegistrationAdmin({ tournamentId, locale }: { tournamentId: string; locale: Locale }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<AdminData>(`/api/admin/tournaments/${tournamentId}/registrations`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_FAILED");
    }
  }, [tournamentId]);
  useEffect(() => { void load(); }, [load]);

  const promote = async (id: string) => {
    setBusy(id);
    try { await api(`/api/admin/registrations/${id}/promote`, { method: "POST", body: "{}" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "PROMOTE_FAILED"); }
    finally { setBusy(""); }
  };
  const courtesy = async (id: string) => {
    const note = window.prompt(tr(locale, "Motivo de cortesía (opcional)", "Courtesy reason (optional)")) ?? "";
    setBusy(id);
    try { await api(`/api/admin/registrations/${id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "courtesy", amountMinor: 0, note }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "ADJUSTMENT_FAILED"); }
    finally { setBusy(""); }
  };
  const discount = async (id: string) => {
    const value = window.prompt(tr(locale, "Descuento en pesos (ej. 200)", "Discount amount (e.g. 200)"));
    if (value === null) return;
    setBusy(id);
    try { await api(`/api/admin/registrations/${id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "discount", amountMinor: Math.round(Number(value) * 100) }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "ADJUSTMENT_FAILED"); }
    finally { setBusy(""); }
  };
  const invite = async (registration: AdminRegistration) => {
    const email = window.prompt(registration.entryType === "pair" ? tr(locale, "Email de la pareja", "Partner email") : tr(locale, "Email del integrante", "Member email"))?.trim();
    if (!email) return;
    setBusy(`invite-${registration.id}`);
    setError("");
    try {
      await api(`/api/admin/registrations/${registration.id}/invitations`, { method: "POST", body: JSON.stringify({ email, role: "player" }) });
      await load();
    } catch (e) {
      setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "INVITATION_FAILED"));
    } finally {
      setBusy("");
    }
  };
  const cancelInvite = async (registrationId: string, invitationId: string) => {
    setBusy(`invite-${invitationId}`);
    try {
      await api(`/api/admin/registrations/${registrationId}/invitations/${invitationId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(codeCopy(locale, e instanceof RegistrationError ? e.code : "INVITATION_FAILED"));
    } finally {
      setBusy("");
    }
  };
  const copyLink = async () => { if (data) await navigator.clipboard.writeText(`${window.location.origin}${data.publicUrl}`); };

  return (
    <section className="tpw-stack">
      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">ONLINE REGISTRATION</div><h2>{tr(locale, "Inscripciones del torneo", "Tournament registrations")}</h2><p>{tr(locale, "Singles, parejas, equipos, invitaciones, cupos y waitlist desde la misma fuente de Tournament.", "Singles, pairs, teams, invitations, capacity and waitlist from Tournament's shared source.")}</p></div><button className="ghost small" onClick={() => void copyLink()}>{tr(locale, "Copiar link público", "Copy public link")}</button></div>
        {error && <div className="registration-alert">{error}</div>}
        <div className="registration-admin-table">
          <div className="registration-admin-head"><span>#</span><span>{tr(locale, "Jugador / equipo", "Player / entry")}</span><span>{tr(locale, "Categoría", "Category")}</span><span>{tr(locale, "Estado", "Status")}</span><span>{tr(locale, "Importe", "Amount")}</span><span></span></div>
          {data?.registrations.map((registration) => {
            const pending = registration.entryInvitations.filter((invitation) => invitation.status === "pending");
            const pairComplete = registration.entryType === "pair" && registration.members.length >= 2;
            const teamFull = registration.entryType === "team" && registration.rosterMax !== null && registration.members.length + pending.length >= registration.rosterMax;
            const canInvite = registration.entryType === "pair" ? !pairComplete : registration.entryType === "team" ? !teamFull : false;
            return (
              <div className="registration-admin-row" key={registration.id}>
                <span>{registration.registrationNumber}</span>
                <div><strong>{registration.entryName || registration.userName}</strong><small>{registration.members.map((member) => member.name).join(" · ") || registration.userEmail}</small>{pending.map((invitation) => <small key={invitation.id}>{tr(locale, "Pendiente", "Pending")}: {invitation.inviteeEmail} <button className="text-button inline" disabled={busy === `invite-${invitation.id}`} onClick={() => void cancelInvite(registration.id, invitation.id)}>×</button></small>)}</div>
                <span>{registration.categoryName}</span>
                <span><b className={`pill status-${registration.status}`}>{registration.status}</b>{registration.waitlistPosition ? ` #${registration.waitlistPosition}` : ""}</span>
                <span>{money(registration.finalAmountMinor, registration.currency, locale)}{registration.discountMinor > 0 && <small> − {money(registration.discountMinor, registration.currency, locale)}</small>}</span>
                <div className="form-actions">{registration.status === "waitlisted" && <button className="light small" disabled={busy === registration.id} onClick={() => void promote(registration.id)}>{tr(locale, "Promover", "Promote")}</button>}{canInvite && <button className="light small" disabled={busy === `invite-${registration.id}`} onClick={() => void invite(registration)}>{registration.entryType === "pair" ? (pending.length ? tr(locale, "Cambiar invitación", "Change invite") : tr(locale, "Invitar pareja", "Invite partner")) : tr(locale, "Invitar integrante", "Invite member")}</button>}<button className="ghost small" disabled={busy === registration.id} onClick={() => void discount(registration.id)}>{tr(locale, "Descuento", "Discount")}</button><button className="ghost small" disabled={busy === registration.id} onClick={() => void courtesy(registration.id)}>{tr(locale, "Cortesía", "Courtesy")}</button></div>
              </div>
            );
          })}
        </div>
        {!data?.registrations.length && <div className="empty-state">{tr(locale, "Todavía no hay inscripciones online.", "No online registrations yet.")}</div>}
      </article>
    </section>
  );
}
