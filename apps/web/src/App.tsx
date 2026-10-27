import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { authClient } from "./lib/auth-client";
import { detectLocale, t } from "./i18n";
import type { Locale } from "./i18n";
import { TournamentParityWorkspace } from "./TournamentParityWorkspace";
import { TournamentHub } from "./TournamentHub";
import { TournamentDayWorkspace } from "./TournamentDayWorkspace";
import { MyTournamentRegistrations } from "./TournamentRegistration";
import { MyTournamentPayments } from "./TournamentPayments";
import { LandingAdminPanel } from "./Landing";
import { Landing } from "./LandingV2";
import { TournamentPublicEntry } from "./TournamentPublicEntry";
import { BirthDateField } from "./BirthDateField";
import { PlatformUsersAdmin } from "./PlatformUsersAdmin";
import { PlayerAvatar, PlayerPublicHeader } from "./PlayerPublicChrome";
import "./PlayerPublicV2.css";

type Membership = {
  id: string;
  status: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationType: string;
};
type Capability = { organizationId: string; capability: string; status: string };
type Me = {
  user: { id: string; name: string; email: string };
  profile: {
    firstName: string;
    lastName: string;
    phone: string | null;
    duprSingles: number | null;
    duprDoubles: number | null;
    duprId: string | null;
    birthDate: string | null;
    sportGender: "male" | "female" | "unspecified" | null;
    city: string | null;
    countryCode: string | null;
    preferredLocale: string;
  } | null;
  memberships: Membership[];
  capabilities: Capability[];
  membershipRequests: { id: string; organizationId: string; status: string }[];
  platformAdmin: boolean;
};
type Organization = { id: string; name: string; slug: string; type: string; status: string; description?: string | null };
type PublicTournamentSummary = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  startAt: number;
  endAt: number | null;
  heroImageUrl: string | null;
};
type JoinRequest = { id: string; userId: string; name: string; email: string; firstName?: string; lastName?: string; note?: string | null };

type TournamentSummary = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  visibility: string;
  startAt: number;
  endAt: number | null;
  courtCount: number;
  structureLocked: number;
  workingRevision: number;
  categoryCount: number;
  entryCount: number;
};
class ApiError extends Error {
  code: string;
  impact: string | undefined;
  constructor(code: string, impact?: string) {
    super(code);
    this.code = code;
    this.impact = impact;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string; impact?: string };
  if (!response.ok) throw new ApiError(payload.code || `HTTP_${response.status}`, payload.impact);
  return payload;
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  return { path, go };
}

const copy = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const toMs = (value: number) => (value < 10_000_000_000 ? value * 1000 : value);
const displayDate = (value: number) => new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(toMs(value)));
function publicTournamentStatus(locale: Locale, status: string) {
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

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const { path, go } = usePath();
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);

  const changeLocale = (next: Locale) => {
    setLocale(next);
    localStorage.setItem("huau.locale", next);
  };

  const refreshMe = useCallback(async () => {
    if (!session?.user) {
      setMe(null);
      return;
    }
    setMeLoading(true);
    try {
      const result = await api<{ ok: true } & Me>("/api/me");
      setMe(result);
    } finally {
      setMeLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  if (isPending) return <LoadingScreen />;
  if (path === "/") return <Landing locale={locale} setLocale={changeLocale} go={go} authenticated={Boolean(session?.user)} />;
  if (path === "/verify-email") return <EmailVerificationScreen locale={locale} go={go} authenticated={Boolean(session?.user)} onDone={refreshMe} />;
  if (path === "/reset-password") return <ResetPasswordScreen locale={locale} go={go} />;
  if (path === "/login" && !session?.user) return <AuthScreen mode="login" locale={locale} go={go} onDone={refreshMe} />;
  if (path === "/signup" && !session?.user) return <AuthScreen mode="signup" locale={locale} go={go} onDone={refreshMe} />;
  if (path === "/recover" && !session?.user) return <RecoveryScreen locale={locale} go={go} />;

  const publicTournamentRoute = path.match(/^\/tournaments\/([^/]+)(?:\/live)?$/);
  if (publicTournamentRoute) {
    const slug = decodeURIComponent(publicTournamentRoute[1]!);
    return (
      <TournamentPublicEntry
        slug={slug}
        locale={locale}
        go={go}
        authenticated={Boolean(session?.user)}
        onProfileSaved={refreshMe}
        onSignOut={() => authClient.signOut().then(() => go("/"))}
      />
    );
  }

  const operatorTournamentDayRoute = path.match(/^\/operate\/([^/]+)$/);
  if (operatorTournamentDayRoute) {
    return <TournamentDayWorkspace operatorToken={decodeURIComponent(operatorTournamentDayRoute[1]!)} locale={locale} go={go} />;
  }

  if (path.startsWith("/organizations/")) {
    return <PublicOrganization slug={decodeURIComponent(path.split("/")[2] || "")} locale={locale} go={go} me={me} refreshMe={refreshMe} authenticated={Boolean(session?.user)} />;
  }

  if (!session?.user) {
    go("/login");
    return <LoadingScreen />;
  }

  if (path === "/app/registrations") return <Shell locale={locale} go={go} me={me}><div className="player-area-v2"><MyTournamentRegistrations locale={locale} go={go} onProfileSaved={refreshMe} /><MyTournamentPayments locale={locale}/></div></Shell>;

  const tournamentManage = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments\/([^/]+)\/manage$/);
  if (tournamentManage) {
    return <Shell locale={locale} go={go} me={me}><TournamentParityWorkspace organizationId={decodeURIComponent(tournamentManage[1]!)} tournamentId={decodeURIComponent(tournamentManage[2]!)} locale={locale} go={go} mode="admin" /></Shell>;
  }
  const tournamentDay = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments\/([^/]+)\/day$/);
  if (tournamentDay) {
    const dayWorkspace = <TournamentDayWorkspace organizationId={decodeURIComponent(tournamentDay[1]!)} tournamentId={decodeURIComponent(tournamentDay[2]!)} locale={locale} go={go} />;
    if (new URLSearchParams(window.location.search).get("view") === "tv") return dayWorkspace;
    return <Shell locale={locale} go={go} me={me}>{dayWorkspace}</Shell>;
  }
  const tournamentHub = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments\/([^/]+)$/);
  if (tournamentHub) {
    return <Shell locale={locale} go={go} me={me}><TournamentHub organizationId={decodeURIComponent(tournamentHub[1]!)} tournamentId={decodeURIComponent(tournamentHub[2]!)} locale={locale} go={go} /></Shell>;
  }
  const tournamentsRoute = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments$/);
  if (tournamentsRoute) {
    return <TournamentList organizationId={decodeURIComponent(tournamentsRoute[1]!)} locale={locale} go={go} me={me} />;
  }
  if (path.startsWith("/admin/organizations/")) {
    const orgId = decodeURIComponent(path.split("/")[3] || "");
    return <OrganizationAdmin organizationId={orgId} locale={locale} go={go} me={me} refreshMe={refreshMe} />;
  }
  if (path === "/platform" && me?.platformAdmin) return <PlatformAdmin locale={locale} go={go} refreshMe={refreshMe} />;
  return <MyHuau locale={locale} setLocale={changeLocale} go={go} me={me} loading={meLoading} refreshMe={refreshMe} />;
}

function HuauBrand({ onClick, center = false }: { onClick?: () => void; center?: boolean }) {
  const image = <img className="huau-logo-image" src="/huau-logo.png" alt="HUAU" />;
  if (onClick) return <button type="button" className={`huau-logo-button${center ? " center" : ""}`} onClick={onClick} aria-label="HUAU">{image}</button>;
  return <div className={`huau-logo-static${center ? " center" : ""}`}>{image}</div>;
}

function Shell({ children, locale, go, me }: { children: React.ReactNode; locale: Locale; go: (path: string) => void; me?: Me | null }) {
  return (
    <div className="app-shell">
      <PlayerPublicHeader
        locale={locale}
        go={go}
        authenticated
        platformAdmin={Boolean(me?.platformAdmin)}
        onSignOut={() => authClient.signOut().then(() => go("/"))}
      />
      {children}
    </div>
  );
}

function AuthScreen({ mode, locale, go, onDone }: { mode: "login"|"signup"; locale: Locale; go:(p:string)=>void; onDone:()=>Promise<void> }) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form=new FormData(event.currentTarget);
    const email=String(form.get("email")||"").trim();
    const password=String(form.get("password")||"");
    const confirmPassword=String(form.get("confirmPassword")||"");

    try {
      if(mode==="signup"){
        if(password!==confirmPassword) throw new Error(copy(locale,"Las contraseñas no coinciden.","Passwords do not match."));
        const firstName=String(form.get("firstName")||"").trim();
        const lastName=String(form.get("lastName")||"").trim();
        const result=await authClient.signUp.email({
          email,
          password,
          name:`${firstName} ${lastName}`.trim(),
          callbackURL:`${window.location.origin}/verify-email?verified=1`,
        });
        if(result.error) throw new Error(result.error.message || "SIGNUP_FAILED");
        localStorage.setItem("huau.pendingSignupProfile",JSON.stringify({
          email,
          firstName,
          lastName,
          preferredLocale:locale==="es"?"es-UY":"en",
        }));
        localStorage.setItem("huau.pendingVerification",JSON.stringify({email,sent:true}));
        go("/verify-email");
        return;
      }

      const result=await authClient.signIn.email({email,password});
      if(result.error){
        if(result.error.status===403 || String(result.error.code||"").includes("EMAIL_NOT_VERIFIED")){
          localStorage.setItem("huau.pendingVerification",JSON.stringify({email,sent:false}));
          go("/verify-email");
          return;
        }
        throw new Error(result.error.message || "SIGNIN_FAILED");
      }

      await onDone();
      const next=sessionStorage.getItem("huau.afterAuth");
      if(next) sessionStorage.removeItem("huau.afterAuth");
      go(next||"/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AUTH_FAILED");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page auth-page-v2">
      <video
        className="auth-bg-video"
        autoPlay
        muted
        loop
        playsInline
        poster="/landing-v2/poster-01.jpg"
      >
        <source src="/landing-v2/sport-01-720.mp4" media="(max-width: 700px)" />
        <source src="/landing-v2/sport-01-1080.mp4" />
      </video>
      <div className="auth-bg-shade" />

      <button className="back-link" onClick={()=>go("/")}>
        ← {t(locale,"back")}
      </button>

      <section className="auth-card">
        <HuauBrand center />
        <h1>
          {mode==="login"
            ? copy(locale,"Iniciar sesión","Sign in")
            : t(locale,"createAccount")}
        </h1>

        <form onSubmit={submit}>
          {mode==="signup" && (
            <div className="two">
              <Field name="firstName" label={t(locale,"firstName")}/>
              <Field name="lastName" label={t(locale,"lastName")}/>
            </div>
          )}

          <Field name="email" label={t(locale,"email")} type="email"/>

          <PasswordField
            name="password"
            label={t(locale,"password")}
            locale={locale}
            autoComplete={mode==="login"?"current-password":"new-password"}
          />

          {mode==="signup" && (
            <PasswordField
              name="confirmPassword"
              label={copy(locale,"Repetir contraseña","Repeat password")}
              locale={locale}
              autoComplete="new-password"
            />
          )}

          <button className="light full" disabled={busy}>
            {busy
              ? "…"
              : mode==="login"
                ? copy(locale,"Iniciar sesión","Sign in")
                : t(locale,"signUp")}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        {mode==="login" ? (
          <>
            <button className="text-button" onClick={()=>go("/recover")}>
              {t(locale,"recover")}
            </button>
            <button className="text-button" onClick={()=>go("/signup")}>
              {copy(locale,"¿No tenés cuenta? Crear cuenta","No account yet? Create one")}
            </button>
          </>
        ) : (
          <button className="text-button" onClick={()=>go("/login")}>
            {copy(locale,"Ya tengo cuenta","I already have an account")}
          </button>
        )}
      </section>
    </main>
  );
}

function EmailVerificationScreen({locale,go,authenticated,onDone}:{locale:Locale;go:(p:string)=>void;authenticated:boolean;onDone:()=>Promise<void>}) {
  const params=new URLSearchParams(window.location.search); const verified=params.get("verified")==="1"; const verificationError=params.get("error");
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const pending=useMemo(()=>{try{return JSON.parse(localStorage.getItem("huau.pendingVerification")||"null") as {email?:string;sent?:boolean}|null;}catch{return null;}},[]);
  useEffect(()=>{
    if(!verified||verificationError||!authenticated)return;
    const raw=localStorage.getItem("huau.pendingSignupProfile");
    if(!raw){localStorage.removeItem("huau.pendingVerification");void onDone();return;}
    try{
      const profile=JSON.parse(raw) as {firstName?:string;lastName?:string;preferredLocale?:string};
      void api("/api/me/profile",{method:"PUT",body:JSON.stringify({firstName:profile.firstName,lastName:profile.lastName,preferredLocale:profile.preferredLocale})}).then(async()=>{
        localStorage.removeItem("huau.pendingSignupProfile"); localStorage.removeItem("huau.pendingVerification"); await onDone();
      }).catch(()=>undefined);
    }catch{localStorage.removeItem("huau.pendingSignupProfile");void onDone();}
  },[verified,verificationError,authenticated,onDone]);
  const resend=async()=>{
    const email=String(pending?.email||"").trim();
    if(!email){setMessage(copy(locale,"Volvé a iniciar sesión para reenviar la verificación.","Sign in again to resend verification."));return;}
    setBusy(true);setMessage("");
    try{
      const result=await authClient.sendVerificationEmail({email,callbackURL:`${window.location.origin}/verify-email?verified=1`});
      if(result.error)throw new Error(result.error.message||"EMAIL_VERIFICATION_FAILED");
      localStorage.setItem("huau.pendingVerification",JSON.stringify({email,sent:true}));
      setMessage(copy(locale,"Te reenviamos el correo de verificación.","We resent the verification email."));
    }catch(error){setMessage(error instanceof Error?error.message:"EMAIL_VERIFICATION_FAILED");}
    finally{setBusy(false);}
  };
  if(verificationError)return <main className="auth-page"><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"No pudimos verificar el email","We couldn't verify your email")}</h1><p className="muted">{copy(locale,"El enlace puede haber vencido o ya no ser válido. Podés pedir uno nuevo.","The link may have expired or no longer be valid. You can request a new one.")}</p><button className="light full" disabled={busy} onClick={()=>void resend()}>{busy?"…":copy(locale,"Reenviar verificación","Resend verification")}</button>{message&&<p className="muted">{message}</p>}<button className="text-button" onClick={()=>go("/login")}>{copy(locale,"Volver al login","Back to sign in")}</button></section></main>;
  if(verified)return <main className="auth-page"><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"Email confirmado","Email verified")}</h1><p className="muted">{copy(locale,"Tu cuenta HUAU ya está activa. Podés continuar con tu perfil o volver al torneo donde estabas.","Your HUAU account is active. You can continue with your profile or return to the tournament you were viewing.")}</p><button className="light full" onClick={()=>{const next=sessionStorage.getItem("huau.afterAuth");if(next)sessionStorage.removeItem("huau.afterAuth");go(next||"/app");}}>{copy(locale,"Continuar","Continue")}</button></section></main>;
  return <main className="auth-page"><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"Revisá tu correo","Check your email")}</h1><p className="muted">{pending?.sent?copy(locale,"Te enviamos un enlace para confirmar tu cuenta HUAU. Revisá también Spam o Promociones.","We sent you a link to confirm your HUAU account. Check Spam or Promotions too."):copy(locale,"Tu email todavía no está verificado. Pedí un nuevo enlace para continuar.","Your email is not verified yet. Request a new link to continue.")}</p><button className="light full" disabled={busy} onClick={()=>void resend()}>{busy?"…":copy(locale,"Reenviar correo","Resend email")}</button>{message&&<p className="muted">{message}</p>}<button className="text-button" onClick={()=>go("/login")}>{copy(locale,"Volver al login","Back to sign in")}</button></section></main>;
}

function RecoveryScreen({locale,go}:{locale:Locale;go:(p:string)=>void}) {
  const [busy,setBusy]=useState(false); const [sent,setSent]=useState(false); const [error,setError]=useState("");
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setBusy(true);setError("");
    const form=new FormData(event.currentTarget);const email=String(form.get("email")||"").trim();
    try{
      const result=await authClient.requestPasswordReset({email,redirectTo:`${window.location.origin}/reset-password`});
      if(result.error)throw new Error(result.error.message||"PASSWORD_RESET_REQUEST_FAILED");
      setSent(true);
    }catch(e){setError(e instanceof Error?e.message:"PASSWORD_RESET_REQUEST_FAILED");}
    finally{setBusy(false);}
  };
  return <main className="auth-page"><button className="back-link" onClick={()=>go("/login")}>← {t(locale,"back")}</button><section className="auth-card"><HuauBrand center /><h1>{t(locale,"recover")}</h1>{sent?<><p className="muted">{copy(locale,"Si existe una cuenta con ese email, te enviamos un enlace para crear una nueva contraseña. Revisá también Spam o Promociones.","If an account exists for that email, we sent a link to create a new password. Check Spam or Promotions too.")}</p><button className="light full" onClick={()=>go("/login")}>{copy(locale,"Volver al login","Back to sign in")}</button></>:<form onSubmit={submit}><p className="muted">{copy(locale,"Ingresá el email de tu cuenta HUAU y te enviaremos un enlace de recuperación.","Enter your HUAU account email and we'll send you a recovery link.")}</p><Field name="email" label={t(locale,"email")} type="email"/><button className="light full" disabled={busy}>{busy?"…":copy(locale,"Enviar enlace","Send reset link")}</button>{error&&<p className="error">{error}</p>}</form>}</section></main>;
}

function ResetPasswordScreen({locale,go}:{locale:Locale;go:(p:string)=>void}) {
  const params=new URLSearchParams(window.location.search); const token=params.get("token"); const tokenError=params.get("error");
  const [busy,setBusy]=useState(false); const [done,setDone]=useState(false); const [error,setError]=useState("");
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setBusy(true);setError("");
    const form=new FormData(event.currentTarget);const password=String(form.get("password")||"");const confirm=String(form.get("confirmPassword")||"");
    try{
      if(!token)throw new Error("INVALID_TOKEN");
      if(password!==confirm)throw new Error(copy(locale,"Las contraseñas no coinciden.","Passwords do not match."));
      const result=await authClient.resetPassword({newPassword:password,token});
      if(result.error)throw new Error(result.error.message||"PASSWORD_RESET_FAILED");
      setDone(true);
    }catch(e){setError(e instanceof Error?e.message:"PASSWORD_RESET_FAILED");}
    finally{setBusy(false);}
  };
  if(tokenError||!token)return <main className="auth-page"><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"Enlace inválido o vencido","Invalid or expired link")}</h1><p className="muted">{copy(locale,"Pedí un nuevo correo de recuperación para continuar.","Request a new password recovery email to continue.")}</p><button className="light full" onClick={()=>go("/recover")}>{copy(locale,"Pedir otro enlace","Request another link")}</button></section></main>;
  if(done)return <main className="auth-page"><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"Contraseña actualizada","Password updated")}</h1><p className="muted">{copy(locale,"Tu contraseña cambió correctamente. Por seguridad, cerramos las sesiones anteriores.","Your password was changed successfully. For security, previous sessions were signed out.")}</p><button className="light full" onClick={()=>go("/login")}>{copy(locale,"Iniciar sesión","Sign in")}</button></section></main>;
  return <main className="auth-page"><button className="back-link" onClick={()=>go("/login")}>← {t(locale,"back")}</button><section className="auth-card"><HuauBrand center /><h1>{copy(locale,"Nueva contraseña","New password")}</h1><form onSubmit={submit}><PasswordField name="password" label={copy(locale,"Nueva contraseña","New password")} locale={locale} autoComplete="new-password"/><PasswordField name="confirmPassword" label={copy(locale,"Repetir contraseña","Repeat password")} locale={locale} autoComplete="new-password"/><button className="light full" disabled={busy}>{busy?"…":copy(locale,"Guardar contraseña","Save password")}</button>{error&&<p className="error">{error}</p>}</form></section></main>;
}

function MyHuau({locale,setLocale,go,me,loading,refreshMe}:{locale:Locale;setLocale:(l:Locale)=>void;go:(p:string)=>void;me:Me|null;loading:boolean;refreshMe:()=>Promise<void>}) {
  const [publicTournaments,setPublicTournaments]=useState<PublicTournamentSummary[]>([]);
  const [profileBusy,setProfileBusy]=useState(false);
  const [profileMessage,setProfileMessage]=useState("");
  const [profileEditing,setProfileEditing]=useState(false);

  void setLocale;

  useEffect(()=>{
    void api<{ok:true;tournaments:PublicTournamentSummary[]}>("/api/public/landing")
      .then(r=>setPublicTournaments(r.tournaments))
      .catch(()=>setPublicTournaments([]));
  },[]);

  const adminOrgIds=useMemo(
    ()=>new Set(
      me?.capabilities
        .filter(c=>c.capability==="org_admin"&&c.status==="active")
        .map(c=>c.organizationId)??[]
    ),
    [me],
  );

  const profileComplete=Boolean(
    me?.profile?.firstName &&
    me.profile.lastName &&
    me.profile.phone &&
    me.profile.birthDate &&
    me.profile.sportGender &&
    me.profile.sportGender!=="unspecified"
  );

  const fullName = [
    me?.profile?.firstName,
    me?.profile?.lastName,
  ].filter(Boolean).join(" ") || me?.user.name || copy(locale,"Jugador","Player");

  const genderLabel =
    me?.profile?.sportGender === "male"
      ? copy(locale,"Masculino","Male")
      : me?.profile?.sportGender === "female"
        ? copy(locale,"Femenino","Female")
        : copy(locale,"Sin especificar","Unspecified");

  const saveProfile=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setProfileBusy(true);
    setProfileMessage("");

    const form=new FormData(event.currentTarget);

    try{
      await api("/api/me/profile",{
        method:"PUT",
        body:JSON.stringify({
          firstName:form.get("firstName"),
          lastName:form.get("lastName"),
          phone:form.get("phone")||null,
          birthDate:form.get("birthDate")||null,
          sportGender:form.get("sportGender"),
          city:form.get("city")||null,
          countryCode:String(form.get("countryCode")||"").trim().toUpperCase()||null,
          duprId:String(form.get("duprId")||"").trim()||null,
          duprSingles:String(form.get("duprSingles")||"").trim()
            ? Number(form.get("duprSingles"))
            : null,
          duprDoubles:String(form.get("duprDoubles")||"").trim()
            ? Number(form.get("duprDoubles"))
            : null,
        }),
      });
      await refreshMe();
      setProfileEditing(false);
      setProfileMessage(copy(locale,"Perfil actualizado.","Profile updated."));
    }catch(error){
      setProfileMessage(error instanceof Error?error.message:"PROFILE_UPDATE_FAILED");
    }finally{
      setProfileBusy(false);
    }
  };

  return (
    <Shell locale={locale} go={go} me={me}>
      <main className="dashboard player-profile-page player-profile-page-v2">
        <section className="player-v2-hero">
          <div className="player-v2-identity">
            <PlayerAvatar name={fullName} size="lg" />
            <div>
              <h1>
                {me?.profile?.firstName
                  ? copy(locale,`Hola, ${me.profile.firstName}.`,`Hi, ${me.profile.firstName}.`)
                  : copy(locale,"Mi HUAU","My HUAU")}
              </h1>
              <p>{me?.user.email ?? ""}</p>
            </div>
          </div>

          <div className="player-v2-actions">
            <button className="light" onClick={()=>go("/app/registrations")}>
              {copy(locale,"Mis inscripciones","My registrations")}
            </button>
            <button className="ghost" onClick={()=>setProfileEditing(value=>!value)}>
              {profileEditing
                ? copy(locale,"Cerrar edición","Close editing")
                : copy(locale,"Editar perfil","Edit profile")}
            </button>
          </div>
        </section>

        <section className="player-v2-grid">
          <article className="player-v2-card">
            <div className="player-v2-card-head">
              <h2>{copy(locale,"Información personal","Personal information")}</h2>
              <span className={`profile-completion ${profileComplete?"complete":""}`}>
                {profileComplete
                  ? copy(locale,"Perfil completo","Profile complete")
                  : copy(locale,"Faltan datos","Missing details")}
              </span>
            </div>

            {!profileEditing ? (
              <div className="player-v2-data-list">
                <div className="player-v2-data-row">
                  <span>{copy(locale,"Nombre","Name")}</span>
                  <strong>{fullName}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>Email</span>
                  <strong>{me?.user.email ?? "—"}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>{copy(locale,"Teléfono","Phone")}</span>
                  <strong>{me?.profile?.phone || "—"}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>{copy(locale,"Nacimiento","Birth date")}</span>
                  <strong>{me?.profile?.birthDate || "—"}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>{copy(locale,"Género deportivo","Sport gender")}</span>
                  <strong>{genderLabel}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>{copy(locale,"Ciudad","City")}</span>
                  <strong>{me?.profile?.city || "—"}</strong>
                </div>
                <div className="player-v2-data-row">
                  <span>{copy(locale,"País","Country")}</span>
                  <strong>{me?.profile?.countryCode || "—"}</strong>
                </div>
              </div>
            ) : (
              <form onSubmit={saveProfile} className="player-profile-form">
                <div className="two">
                  <Field
                    name="firstName"
                    label={copy(locale,"Nombre","First name")}
                    defaultValue={me?.profile?.firstName??""}
                  />
                  <Field
                    name="lastName"
                    label={copy(locale,"Apellido","Last name")}
                    defaultValue={me?.profile?.lastName??""}
                  />
                </div>

                <div className="two">
                  <label>
                    <span>Email</span>
                    <input value={me?.user.email??""} disabled readOnly/>
                  </label>
                  <Field
                    name="phone"
                    label={copy(locale,"Teléfono","Phone")}
                    required={false}
                    defaultValue={me?.profile?.phone??""}
                  />
                </div>

                <div className="two">
                  <BirthDateField
                    name="birthDate"
                    label={copy(locale,"Fecha de nacimiento","Birth date")}
                    defaultValue={me?.profile?.birthDate??""}
                    locale={locale}
                  />
                  <label>
                    <span>{copy(locale,"Género deportivo","Sport gender")}</span>
                    <select name="sportGender" defaultValue={me?.profile?.sportGender??"unspecified"}>
                      <option value="unspecified">{copy(locale,"Sin especificar","Unspecified")}</option>
                      <option value="male">{copy(locale,"Masculino","Male")}</option>
                      <option value="female">{copy(locale,"Femenino","Female")}</option>
                    </select>
                  </label>
                </div>

                <div className="two">
                  <Field
                    name="city"
                    label={copy(locale,"Ciudad","City")}
                    required={false}
                    defaultValue={me?.profile?.city??""}
                  />
                  <label>
                    <span>{copy(locale,"País (código)","Country code")}</span>
                    <input
                      name="countryCode"
                      maxLength={3}
                      defaultValue={me?.profile?.countryCode??""}
                      placeholder="UY"
                    />
                  </label>
                </div>

                <label>
                  <span>DUPR ID</span>
                  <input
                    name="duprId"
                    maxLength={80}
                    defaultValue={me?.profile?.duprId??""}
                    placeholder={copy(locale,"ID de jugador DUPR","DUPR player ID")}
                  />
                </label>

                <div className="two">
                  <label>
                    <span>DUPR Singles</span>
                    <input
                      name="duprSingles"
                      type="number"
                      min="0"
                      max="8"
                      step="0.001"
                      defaultValue={me?.profile?.duprSingles===null||me?.profile?.duprSingles===undefined?"":String(me.profile.duprSingles)}
                    />
                  </label>
                  <label>
                    <span>DUPR Doubles</span>
                    <input
                      name="duprDoubles"
                      type="number"
                      min="0"
                      max="8"
                      step="0.001"
                      defaultValue={me?.profile?.duprDoubles===null||me?.profile?.duprDoubles===undefined?"":String(me.profile.duprDoubles)}
                    />
                  </label>
                </div>

                <div className="form-actions">
                  <button className="light small" disabled={profileBusy}>
                    {profileBusy?"…":copy(locale,"Guardar cambios","Save changes")}
                  </button>
                  {profileMessage&&<span className="muted">{profileMessage}</span>}
                </div>
              </form>
            )}
          </article>

          <aside className="player-v2-card">
            <div className="player-v2-card-head">
              <h2>Pickleball</h2>
            </div>
            <div className="player-v2-data-list">
              <div className="player-v2-data-row">
                <span>DUPR ID</span>
                <strong>{me?.profile?.duprId || "—"}</strong>
              </div>
              <div className="player-v2-data-row">
                <span>Singles</span>
                <strong>
                  {me?.profile?.duprSingles===null||me?.profile?.duprSingles===undefined
                    ? "—"
                    : me.profile.duprSingles.toFixed(3)}
                </strong>
              </div>
              <div className="player-v2-data-row">
                <span>Doubles</span>
                <strong>
                  {me?.profile?.duprDoubles===null||me?.profile?.duprDoubles===undefined
                    ? "—"
                    : me.profile.duprDoubles.toFixed(3)}
                </strong>
              </div>
            </div>
          </aside>
        </section>

        <section className="player-v2-section">
          <header>
            <h2>{copy(locale,"Torneos","Tournaments")}</h2>
            <button className="ghost small" onClick={()=>go("/")}>
              {copy(locale,"Explorar","Explore")}
            </button>
          </header>

          {publicTournaments.length ? (
            <div className="player-v2-tournaments">
              {publicTournaments.slice(0,4).map((tournament)=>(
                <article className="player-v2-list-card" key={tournament.id}>
                  <div>
                    <h3>{tournament.name}</h3>
                    <p>
                      {publicTournamentStatus(locale,tournament.status)}
                      {" · "}
                      {displayDate(tournament.startAt)}
                    </p>
                  </div>
                  <button
                    className="ghost small"
                    onClick={()=>go(`/tournaments/${tournament.slug}`)}
                  >
                    {copy(locale,"Ver torneo","View tournament")}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              {copy(locale,"No hay torneos públicos disponibles.","No public tournaments available.")}
            </p>
          )}
        </section>

        {me?.memberships.length ? (
          <section className="player-v2-section">
            <header>
              <h2>{copy(locale,"Mis organizaciones","My organizations")}</h2>
            </header>
            <div className="player-v2-organizations">
              {me.memberships.map((membership)=>(
                <article className="player-v2-list-card" key={membership.id}>
                  <div>
                    <h3>{membership.organizationName}</h3>
                    <p>{membership.organizationType}</p>
                  </div>
                  <div className="card-actions">
                    <button
                      className="ghost small"
                      onClick={()=>go(`/organizations/${membership.organizationSlug}`)}
                    >
                      {copy(locale,"Ver","View")}
                    </button>
                    {adminOrgIds.has(membership.organizationId)&&(
                      <button
                        className="light small"
                        onClick={()=>go(`/admin/organizations/${membership.organizationId}`)}
                      >
                        {copy(locale,"Administrar","Manage")}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : loading ? (
          <p className="muted">Loading…</p>
        ) : null}
      </main>
    </Shell>
  );
}

function PublicOrganization({slug,locale,go,me,refreshMe,authenticated}:{slug:string;locale:Locale;go:(p:string)=>void;me:Me|null;refreshMe:()=>Promise<void>;authenticated:boolean}) {
  const [org,setOrg]=useState<Organization|null>(null); const [state,setState]=useState("");
  useEffect(()=>{ void api<{organization:Organization}>(`/api/organizations/${encodeURIComponent(slug)}`).then(r=>setOrg(r.organization)); },[slug]);
  const membership=me?.memberships.find(m=>m.organizationId===org?.id); const pendingRequest=me?.membershipRequests?.find(r=>r.organizationId===org?.id&&r.status==="pending");
  const request=async()=>{ if(!org)return; try{await api(`/api/organizations/${org.id}/membership-requests`,{method:"POST",body:"{}"});setState("sent");await refreshMe();}catch(e){setState(e instanceof Error?e.message:"error");}};
  const content=<main className="public-org">{org?<><div className="eyebrow">{org.type}</div><h1>{org.name}</h1><p>{org.description||"HUAU Organization"}</p><div className="public-org-actions">{membership?<span className="pill strong">{membership.status}</span>:pendingRequest?<span className="pill strong">{t(locale,"pending")}</span>:authenticated?<button className="light" onClick={()=>void request()} disabled={state==="sent"}>{state==="sent"?t(locale,"requestSent"):t(locale,"requestJoin")}</button>:<button className="light" onClick={()=>go("/login")}>{t(locale,"enter")}</button>}</div></>:<p>Loading…</p>}</main>;
  if(authenticated) return <Shell locale={locale} go={go} me={me}>{content}</Shell>;
  return <div className="app-shell"><header className="topbar"><HuauBrand onClick={()=>go("/")} /><button className="light small" onClick={()=>go("/login")}>{t(locale,"enter")}</button></header>{content}</div>;
}

function OrganizationAdmin({organizationId,locale,go,me,refreshMe}:{organizationId:string;locale:Locale;go:(p:string)=>void;me:Me|null;refreshMe:()=>Promise<void>}) {
  const [requests,setRequests]=useState<JoinRequest[]>([]); const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await api<{requests:JoinRequest[]}>(`/api/admin/organizations/${organizationId}/membership-requests`);setRequests(r.requests);}catch(e){setError(e instanceof Error?e.message:"error")}},[organizationId]);
  useEffect(()=>{void load()},[load]);
  const review=async(id:string,decision:"approve"|"reject")=>{await api(`/api/admin/membership-requests/${id}/review`,{method:"POST",body:JSON.stringify({decision})});await load();await refreshMe();};
  return <Shell locale={locale} go={go} me={me}><main className="dashboard"><section className="dashboard-head"><div><div className="eyebrow">{t(locale,"admin")}</div><h1>{copy(locale,"Administración","Administration")}</h1></div><button className="light" onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>HUAU Tournament →</button></section><div className="admin-module-strip"><button className="active">{copy(locale,"Membresías","Memberships")}</button><button onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>Tournament</button></div><section className="panel wide"><div className="panel-title"><h2>{t(locale,"membershipRequests")}</h2><span>{requests.length}</span></div>{error&&<p className="error">{error}</p>}{requests.length?<div className="request-list">{requests.map(r=><article key={r.id}><div><strong>{r.firstName&&r.lastName?`${r.firstName} ${r.lastName}`:r.name}</strong><span>{r.email}</span></div><div className="card-actions"><button className="ghost" onClick={()=>void review(r.id,"reject")}>{t(locale,"reject")}</button><button className="light small" onClick={()=>void review(r.id,"approve")}>{t(locale,"approve")}</button></div></article>)}</div>:<p className="muted">{t(locale,"noRequests")}</p>}</section></main></Shell>;
}

function TournamentList({organizationId,locale,go,me}:{organizationId:string;locale:Locale;go:(p:string)=>void;me:Me|null}) {
  const [items,setItems]=useState<TournamentSummary[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [deletingId,setDeletingId]=useState("");
  const load=useCallback(async()=>{try{const r=await api<{tournaments:TournamentSummary[]}>(`/api/admin/organizations/${organizationId}/tournaments`);setItems(r.tournaments);setError("");}catch(e){setError(e instanceof Error?e.message:"error")}},[organizationId]);
  useEffect(()=>{void load()},[load]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);try{const r=await api<{tournament:{id:string}}>(`/api/admin/organizations/${organizationId}/tournaments`,{method:"POST",body:JSON.stringify({name:form.get("name"),sport:form.get("sport"),startDate:form.get("startDate"),endDate:form.get("endDate")||null,courtCount:Number(form.get("courtCount")),visibility:form.get("visibility")})});go(`/admin/organizations/${organizationId}/tournaments/${r.tournament.id}`);}catch(e){setError(e instanceof Error?e.message:"error");setBusy(false)}};
  const removeTournament=async(item:TournamentSummary)=>{const typed=window.prompt(copy(locale,`Eliminar ${item.name} borra jugadores, categorías, cronograma y resultados. Escribí exactamente: ${item.name}`,`Deleting ${item.name} removes players, categories, schedule and results. Type exactly: ${item.name}`));if(typed!==item.name)return;setDeletingId(item.id);setError("");try{await api(`/api/admin/tournaments/${item.id}`,{method:"DELETE",body:JSON.stringify({confirmDelete:true})});await load();}catch(e){setError(e instanceof Error?e.message:"error");}finally{setDeletingId("");}};
  return <Shell locale={locale} go={go} me={me}><main className="dashboard tournament-list-page"><button className="section-back" onClick={()=>go(`/admin/organizations/${organizationId}`)}>← {copy(locale,"Organización","Organization")}</button><section className="dashboard-head"><div><div className="eyebrow">HUAU Tournament</div><h1>{copy(locale,"Torneos","Tournaments")}</h1><p className="muted">{copy(locale,"Creá, prepará y operá cada competencia desde un único workspace.","Create, prepare and operate every competition from one workspace.")}</p></div></section><section className="tournament-list-grid"><div className="panel"><h2>{copy(locale,"Nuevo torneo","New tournament")}</h2><form onSubmit={submit}><Field name="name" label={copy(locale,"Nombre","Name")}/><div className="two"><label><span>{copy(locale,"Deporte","Sport")}</span><select name="sport" defaultValue="pickleball"><option value="pickleball">Pickleball</option><option value="padel">Padel</option><option value="tennis">Tennis</option></select></label><Field name="courtCount" label={copy(locale,"Canchas","Courts")} type="number"/></div><div className="two"><Field name="startDate" label={copy(locale,"Inicio","Start") } type="date"/><Field name="endDate" label={copy(locale,"Fin (opcional)","End (optional)")} type="date" required={false}/></div><label><span>{copy(locale,"Visibilidad","Visibility")}</span><select name="visibility" defaultValue="public"><option value="public">{copy(locale,"Público","Public")}</option><option value="members">{copy(locale,"Miembros","Members")}</option><option value="invite">{copy(locale,"Invitación","Invite")}</option></select></label><button className="light full" disabled={busy}>{busy?"…":copy(locale,"Crear torneo","Create tournament")}</button>{error&&<p className="error">{error}</p>}</form></div><div className="panel wide"><div className="panel-title"><h2>{copy(locale,"Tus torneos","Your tournaments")}</h2><span>{items.length}</span></div><div className="tournament-card-list">{items.length?items.map(item=><article className="tournament-card-shell" key={item.id}><button className="tournament-card" onClick={()=>go(`/admin/organizations/${organizationId}/tournaments/${item.id}`)}><div><span className="pill">{item.sport}</span><h3>{item.name}</h3><p>{displayDate(item.startAt)} · {item.courtCount} {copy(locale,"canchas","courts")}</p></div><div className="tournament-card-meta"><strong>{item.status.replaceAll("_"," ")}</strong><span>{item.categoryCount} {copy(locale,"categorías","categories")} · {item.entryCount} {copy(locale,"inscriptos","entries")}</span></div></button><button className="tournament-delete" disabled={deletingId===item.id} onClick={()=>void removeTournament(item)} title={copy(locale,"Eliminar torneo","Delete tournament")}>{deletingId===item.id?"…":"×"}</button></article>):<div className="empty-state">{copy(locale,"Todavía no hay torneos.","No tournaments yet.")}</div>}</div></div></section></main></Shell>;
}

function PlatformAdmin({locale,go,refreshMe}:{locale:Locale;go:(p:string)=>void;refreshMe:()=>Promise<void>}) {
  const [section,setSection]=useState<"general"|"users">("general");
  const [message,setMessage]=useState("");
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    try{
      const r=await api<{organization:{slug:string}}>("/api/platform/organizations",{
        method:"POST",
        body:JSON.stringify({
          name:f.get("name"),
          slug:f.get("slug"),
          type:f.get("type"),
          description:f.get("description"),
        }),
      });
      setMessage("OK");
      await refreshMe();
      go(`/organizations/${r.organization.slug}`);
    }catch(err){
      setMessage(err instanceof Error?err.message:"error");
    }
  };

  return <Shell locale={locale} go={go}>
    <main className="dashboard platform-admin-page">
      <section className="dashboard-head">
        <div>
          <div className="eyebrow">HUAU</div>
          <h1>{t(locale,"platform")}</h1>
        </div>
      </section>

      <div className="admin-module-strip platform-admin-tabs">
        <button className={section==="general"?"active":""} onClick={()=>setSection("general")}>
          {copy(locale,"General","General")}
        </button>
        <button className={section==="users"?"active":""} onClick={()=>setSection("users")}>
          {copy(locale,"Usuarios","Users")}
        </button>
      </div>

      {section==="users" ? (
        <PlatformUsersAdmin locale={locale}/>
      ) : (
        <>
          <LandingAdminPanel locale={locale}/>
          <section className="panel form-panel">
            <h2>{t(locale,"createOrganization")}</h2>
            <form onSubmit={submit}>
              <Field name="name" label={t(locale,"organizationName")}/>
              <Field name="slug" label={t(locale,"organizationSlug")} required={false}/>
              <label>
                <span>{t(locale,"organizationType")}</span>
                <select name="type" defaultValue="club">
                  <option value="club">Club</option>
                  <option value="sports_complex">Sports complex</option>
                  <option value="community">Community</option>
                  <option value="academy">Academy</option>
                  <option value="organizer">Organizer</option>
                  <option value="league">League</option>
                  <option value="federation">Federation</option>
                </select>
              </label>
              <label>
                <span>{t(locale,"description")}</span>
                <textarea name="description" rows={4}/>
              </label>
              <button className="light">{t(locale,"create")}</button>
              {message&&<p>{message}</p>}
            </form>
          </section>
        </>
      )}
    </main>
  </Shell>;
}

function PasswordField({name,label,locale,autoComplete}:{name:string;label:string;locale:Locale;autoComplete:"current-password"|"new-password"}) {
  const [visible,setVisible]=useState(false);
  return <label><span>{label}</span><div className="password-input-wrap"><input name={name} type={visible?"text":"password"} required minLength={8} autoComplete={autoComplete}/><button type="button" className="password-visibility" onClick={()=>setVisible(value=>!value)} aria-label={visible?copy(locale,"Ocultar contraseña","Hide password"):copy(locale,"Mostrar contraseña","Show password")} title={visible?copy(locale,"Ocultar contraseña","Hide password"):copy(locale,"Mostrar contraseña","Show password")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>{visible&&<path d="M4 4l16 16"/>}</svg></button></div></label>;
}

function Field({name,label,type="text",required=true,defaultValue}:{name:string;label:string;type?:string;required?:boolean;defaultValue?:string}) { return <label><span>{label}</span><input name={name} type={type} required={required} defaultValue={defaultValue} min={type==="number"?"0":undefined} minLength={type==="password"?8:undefined}/></label>; }
function LocaleToggle({locale,setLocale}:{locale:Locale;setLocale:(l:Locale)=>void}) { return <div className="locale-toggle"><button className={locale==="es"?"active":""} onClick={()=>setLocale("es")}>ES</button><button className={locale==="en"?"active":""} onClick={()=>setLocale("en")}>EN</button></div>; }
function LoadingScreen(){ return <main className="loading-screen"><HuauBrand center /></main>; }
