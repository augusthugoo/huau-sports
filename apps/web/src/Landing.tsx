import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Locale } from "./i18n";
import "./Landing.css";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

type LandingTournament = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  startAt: number;
  endAt: number | null;
};

type LandingData = {
  ok: true;
  heroes: Array<{ slot: number; url: string }>;
  tournaments: LandingTournament[];
};

type ContactLead = {
  id: string;
  name: string;
  organization: string;
  email: string;
  phone: string | null;
  organizationType: string;
  message: string;
  status: string;
  createdAt: number;
};

type LandingAdminData = {
  ok: true;
  heroes: Array<{ slot: number; url: string; configured: boolean }>;
  leads: ContactLead[];
  contactStorageReady: boolean;
};

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
const date = (value: number, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "medium" }).format(new Date(toMs(value)));

function tournamentStatus(locale: Locale, status: string) {
  const labels: Record<string, [string, string]> = {
    registration_open: ["Inscripciones abiertas", "Registration open"],
    registration_closed: ["Inscripciones cerradas", "Registration closed"],
    draw_ready: ["Sorteo listo", "Draw ready"],
    scheduled: ["Cronograma publicado", "Schedule published"],
    live: ["En vivo", "Live"],
  };
  return labels[status]?.[locale === "es" ? 0 : 1] ?? status.replaceAll("_", " ");
}

const slideCopy = {
  es: [
    { eyebrow: "HUAU TOURNAMENT", title: "Del registro al último punto.", body: "Inscripciones, operación de torneo y competencia en un mismo ecosistema." },
    { eyebrow: "HUAU REF", title: "Arbitraje más simple en cancha.", body: "Scoring, servicio, posiciones y control de partido desde una interfaz dedicada." },
    { eyebrow: "HUAU SPORTS", title: "Tu ecosistema deportivo.", body: "Tecnología para competir, organizar y vivir el deporte con menos fricción." },
  ],
  en: [
    { eyebrow: "HUAU TOURNAMENT", title: "From registration to the final point.", body: "Registration, tournament operations and competition in one ecosystem." },
    { eyebrow: "HUAU REF", title: "Simpler officiating on court.", body: "Scoring, service, positions and match control from a dedicated interface." },
    { eyebrow: "HUAU SPORTS", title: "Your sports ecosystem.", body: "Technology to compete, organize and experience sport with less friction." },
  ],
} as const;

export function Landing({ locale, setLocale, go }: { locale: Locale; setLocale: (locale: Locale) => void; go: Go }) {
  const [showLanguageGate, setShowLanguageGate] = useState(() => !localStorage.getItem("huau.locale"));
  const [data, setData] = useState<LandingData | null>(null);
  const [slide, setSlide] = useState(0);
  const [brokenHeroes, setBrokenHeroes] = useState<Record<number, boolean>>({});
  const [contactState, setContactState] = useState<"idle" | "sending" | "sent">("idle");
  const [contactError, setContactError] = useState("");

  useEffect(() => {
    void jsonApi<LandingData>("/api/public/landing").then(setData).catch(() => setData(null));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % 3), 6500);
    return () => window.clearInterval(timer);
  }, []);

  const heroUrls = useMemo(() => {
    const result = new Map<number, string>();
    for (const hero of data?.heroes ?? []) result.set(hero.slot, hero.url);
    return result;
  }, [data]);

  const chooseLanguage = (next: Locale) => {
    setLocale(next);
    setShowLanguageGate(false);
  };

  const sendContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContactState("sending");
    setContactError("");
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
      setContactState("sent");
    } catch (error) {
      setContactState("idle");
      setContactError(error instanceof Error ? error.message : "CONTACT_FAILED");
    }
  };

  const currentCopy = slideCopy[locale][slide]!;
  const currentHero = heroUrls.get(slide + 1);
  const hasHero = Boolean(currentHero && !brokenHeroes[slide + 1]);

  return (
    <main className={`huau-public-landing${showLanguageGate ? " language-open" : ""}`}>
      <div className="landing-orbit landing-orbit-one" />
      <div className="landing-orbit landing-orbit-two" />

      <div className="landing-topline">
        <img className="landing-master-logo" src="/huau-logo.png" alt="HUAU" />
        <div className="landing-auth-actions">
          <button className="landing-button subtle" onClick={() => go("/login")}>{tr(locale, "Iniciar sesión", "Sign in")}</button>
          <button className="landing-button solid" onClick={() => go("/signup")}>{tr(locale, "Crear cuenta", "Create account")}</button>
        </div>
      </div>

      <section className="landing-intro">
        <div className="landing-kicker">HUAU SPORTS</div>
        <h1>{tr(locale, "Tu ecosistema deportivo.", "Your sports ecosystem.")}</h1>
        <p>{tr(locale, "Organizá, competí y viví el deporte desde un solo lugar.", "Organize, compete and experience sport from one place.")}</p>
      </section>

      <section className={`landing-hero-carousel${hasHero ? " has-image" : ""}`} aria-label={tr(locale, "Presentación HUAU", "HUAU presentation")}>
        {hasHero && <img src={currentHero} alt="" onError={() => setBrokenHeroes((current) => ({ ...current, [slide + 1]: true }))} />}
        <div className="landing-hero-shade" />
        <div className="landing-hero-copy" key={`${locale}-${slide}`}>
          <span>{currentCopy.eyebrow}</span>
          <h2>{currentCopy.title}</h2>
          <p>{currentCopy.body}</p>
        </div>
        <button className="carousel-arrow previous" aria-label={tr(locale, "Imagen anterior", "Previous image")} onClick={() => setSlide((current) => (current + 2) % 3)}>‹</button>
        <button className="carousel-arrow next" aria-label={tr(locale, "Imagen siguiente", "Next image")} onClick={() => setSlide((current) => (current + 1) % 3)}>›</button>
        <div className="carousel-dots">
          {[0, 1, 2].map((index) => <button key={index} className={index === slide ? "active" : ""} aria-label={`${tr(locale, "Imagen", "Image")} ${index + 1}`} onClick={() => setSlide(index)} />)}
        </div>
      </section>

      <section className="landing-section ecosystem-section">
        <div className="landing-section-heading">
          <span>HUAU</span>
          <h2>{tr(locale, "Un ecosistema. Distintas herramientas.", "One ecosystem. Different tools.")}</h2>
        </div>
        <div className="ecosystem-grid">
          <article className="ecosystem-card">
            <img className="product-lockup tournament-lockup" src="/huau-tournament-logo.png" alt="HUAU Tournament" />
            <p>{tr(locale, "Inscripciones online, participantes, pagos, categorías, formatos individuales, parejas y equipos, Tournament Day local, cronograma, resultados, recuperación y TV.", "Online registration, participants, payments, categories, individual, pair and team formats, local Tournament Day, scheduling, results, recovery and TV.")}</p>
          </article>
          <article className="ecosystem-card">
            <img className="product-lockup ref-lockup" src="/huau-ref-logo.png" alt="HUAU Ref" />
            <p>{tr(locale, "Scoring, servicio, posiciones, timeouts, correcciones, advertencias y conducción del partido desde la cancha.", "Scoring, service, positions, timeouts, corrections, warnings and match control from the court.")}</p>
          </article>
          <article className="ecosystem-card coming-soon-card">
            <div className="club-lockup"><img src="/huau-logo.png" alt="HUAU" /><span>— CLUB —</span></div>
            <div className="coming-soon-pill">{tr(locale, "PRÓXIMAMENTE", "COMING SOON")}</div>
            <p>{tr(locale, "El próximo espacio del ecosistema HUAU para clubes, jugadores y comunidades deportivas.", "The next HUAU ecosystem space for clubs, players and sports communities.")}</p>
          </article>
        </div>
      </section>

      <section className="landing-section tournaments-section">
        <div className="landing-section-heading split-heading">
          <div><span>HUAU TOURNAMENT</span><h2>{tr(locale, "Torneos en HUAU", "Tournaments on HUAU")}</h2></div>
          <p>{tr(locale, "Encontrá una competencia y entrá directo a su inscripción pública.", "Find a competition and go straight to its public registration page.")}</p>
        </div>
        {data?.tournaments.length ? (
          <div className="public-tournament-grid">
            {data.tournaments.map((tournament) => (
              <article className="landing-tournament-card" key={tournament.id}>
                <div className="tournament-card-top"><span>{tournament.sport}</span><strong>{tournamentStatus(locale, tournament.status)}</strong></div>
                <h3>{tournament.name}</h3>
                <p>{date(tournament.startAt, locale)}{tournament.endAt ? ` → ${date(tournament.endAt, locale)}` : ""}</p>
                <button className="landing-button solid full" onClick={() => go(`/tournaments/${tournament.slug}`)}>{tournament.status === "registration_open" ? tr(locale, "Inscribirme", "Register") : tr(locale, "Ver torneo", "View tournament")}</button>
              </article>
            ))}
          </div>
        ) : <div className="landing-empty">{tr(locale, "Los próximos torneos públicos van a aparecer acá.", "Upcoming public tournaments will appear here.")}</div>}
      </section>

      <section className="player-callout">
        <div><span>{tr(locale, "PARA JUGADORES", "FOR PLAYERS")}</span><h2>{tr(locale, "¿Querés competir?", "Want to compete?")}</h2><p>{tr(locale, "Creá tu cuenta HUAU para inscribirte, completar tu perfil deportivo y seguir tus torneos desde un solo lugar.", "Create your HUAU account to register, complete your sports profile and follow your tournaments from one place.")}</p></div>
        <button className="landing-button inverted" onClick={() => go("/signup")}>{tr(locale, "Crear cuenta", "Create account")}</button>
      </section>

      <section className="landing-section contact-section">
        <div className="contact-copy">
          <span>HUAU FOR ORGANIZATIONS</span>
          <h2>{tr(locale, "¿Organizás deporte?", "Do you organize sport?")}</h2>
          <p>{tr(locale, "Si representás un club, liga, academia, federación u organización, contanos qué necesitás. El acceso operativo a HUAU se gestiona con cada organización.", "If you represent a club, league, academy, federation or organization, tell us what you need. Operational access to HUAU is managed with each organization.")}</p>
          <div className="contact-types"><span>CLUBES</span><span>LIGAS</span><span>ACADEMIAS</span><span>FEDERACIONES</span><span>ORGANIZADORES</span></div>
        </div>
        <form className="landing-contact-form" onSubmit={sendContact}>
          <div className="contact-two"><label><span>{tr(locale, "Nombre", "Name")}</span><input name="name" required maxLength={120} /></label><label><span>{tr(locale, "Organización", "Organization")}</span><input name="organization" required maxLength={160} /></label></div>
          <div className="contact-two"><label><span>Email</span><input name="email" type="email" required maxLength={200} /></label><label><span>{tr(locale, "Teléfono", "Phone")}</span><input name="phone" type="tel" maxLength={60} /></label></div>
          <label><span>{tr(locale, "Tipo de organización", "Organization type")}</span><select name="organizationType" defaultValue="club"><option value="club">Club</option><option value="league">{tr(locale, "Liga", "League")}</option><option value="academy">{tr(locale, "Academia", "Academy")}</option><option value="federation">{tr(locale, "Federación", "Federation")}</option><option value="organizer">{tr(locale, "Organizador", "Organizer")}</option><option value="other">{tr(locale, "Otro", "Other")}</option></select></label>
          <label><span>{tr(locale, "¿Qué necesitás?", "What do you need?")}</span><textarea name="message" rows={5} required maxLength={3000} /></label>
          <label className="website-trap" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
          <button className="landing-button solid full" disabled={contactState === "sending"}>{contactState === "sending" ? "…" : tr(locale, "Enviar consulta", "Send inquiry")}</button>
          {contactState === "sent" && <p className="contact-success">{tr(locale, "Consulta enviada. Gracias por contactar a HUAU.", "Inquiry sent. Thanks for contacting HUAU.")}</p>}
          {contactError && <p className="contact-error">{contactError}</p>}
        </form>
      </section>

      <footer className="huau-landing-footer">
        <div><strong>HUAU SPORTS</strong><span>Your Sports Ecosystem</span></div>
        <button onClick={() => chooseLanguage(locale === "es" ? "en" : "es")}>{locale === "es" ? "English" : "Español"}</button>
      </footer>

      {showLanguageGate && (
        <div className="language-gate" role="dialog" aria-modal="true" aria-label="Language">
          <div className="language-gate-card">
            <img src="/huau-logo.png" alt="HUAU" />
            <div className="language-gate-title"><strong>Elegí tu idioma</strong><span>Choose your language</span></div>
            <div className="language-options">
              <button onClick={() => chooseLanguage("es")}><span>Español</span><small>Continuar en español</small></button>
              <button onClick={() => chooseLanguage("en")}><span>English</span><small>Continue in English</small></button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export function LandingAdminPanel({ locale }: { locale: Locale }) {
  const [data, setData] = useState<LandingAdminData | null>(null);
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try { setData(await jsonApi<LandingAdminData>("/api/platform/landing")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "LANDING_ADMIN_LOAD_FAILED"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = async (slot: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setBusy(slot); setMessage("");
    try {
      const response = await fetch(`/api/platform/landing/hero/${slot}`, { method: "PUT", headers: { "content-type": file.type }, body: file });
      const payload = await response.json() as { ok?: boolean; code?: string };
      if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
      setVersion((current) => current + 1);
      await load();
      setMessage(tr(locale, `Imagen ${slot} actualizada.`, `Image ${slot} updated.`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "HERO_UPLOAD_FAILED"); }
    finally { event.currentTarget.value = ""; setBusy(0); }
  };

  const remove = async (slot: number) => {
    setBusy(slot); setMessage("");
    try {
      await jsonApi(`/api/platform/landing/hero/${slot}`, { method: "DELETE", body: "{}" });
      setVersion((current) => current + 1);
      await load();
      setMessage(tr(locale, `Imagen ${slot} eliminada.`, `Image ${slot} removed.`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "HERO_DELETE_FAILED"); }
    finally { setBusy(0); }
  };

  return (
    <section className="panel landing-admin-panel">
      <div className="panel-title"><div><div className="eyebrow">HUAU LANDING</div><h2>{tr(locale, "Portada pública", "Public landing")}</h2></div></div>
      <p className="muted">{tr(locale, "Las tres imágenes usan claves fijas en R2: reemplazar una sobrescribe la anterior y no acumula archivos.", "The three images use fixed R2 keys: replacing one overwrites the previous file and does not accumulate objects.")}</p>
      <div className="landing-admin-heroes">
        {[1, 2, 3].map((slot) => {
          const hero = data?.heroes.find((item) => item.slot === slot);
          return <div className="landing-admin-hero" key={slot}>
            <div className="landing-admin-preview">{hero?.configured ? <img key={`${slot}-${version}`} src={`${hero.url}?v=${version}`} alt={`${tr(locale, "Imagen", "Image")} ${slot}`} /> : <span>{tr(locale, "Sin imagen", "No image")}</span>}</div>
            <strong>{tr(locale, "Imagen", "Image")} {slot}</strong>
            <div className="landing-admin-actions"><label className={`ghost small${busy === slot ? " disabled" : ""}`}>{busy === slot ? "…" : tr(locale, "Reemplazar", "Replace")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy !== 0} onChange={(event) => void upload(slot, event)} /></label>{hero?.configured && <button className="ghost small" disabled={busy !== 0} onClick={() => void remove(slot)}>{tr(locale, "Quitar", "Remove")}</button>}</div>
          </div>;
        })}
      </div>
      <div className="landing-leads-head"><h3>{tr(locale, "Consultas de organizaciones", "Organization inquiries")}</h3><span>{data?.leads.length ?? 0}</span></div>
      {!data ? <div className="empty-state">{tr(locale, "Cargando…", "Loading…")}</div> : !data.contactStorageReady ? <div className="empty-state">{tr(locale, "Aplicá la migración 0013 para activar el formulario de contacto.", "Apply migration 0013 to activate contact storage.")}</div> : data.leads.length ? <div className="landing-leads-list">{data.leads.map((lead) => <article key={lead.id}><div><strong>{lead.organization}</strong><span>{lead.name} · {lead.email}{lead.phone ? ` · ${lead.phone}` : ""}</span></div><span className="pill">{lead.organizationType}</span><p>{lead.message}</p><small>{new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.createdAt))}</small></article>)}</div> : <div className="empty-state">{tr(locale, "Todavía no hay consultas.", "No inquiries yet.")}</div>}
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
