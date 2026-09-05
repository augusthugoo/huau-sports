import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { authClient } from "./lib/auth-client";
import { detectLocale, t } from "./i18n";
import type { Locale } from "./i18n";
import { TournamentParityWorkspace } from "./TournamentParityWorkspace";
import { MyTournamentRegistrations, PublicTournamentRegistration } from "./TournamentRegistration";
import { MyTournamentPayments } from "./TournamentPayments";

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
    avatarUrl: string | null;
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
  if (path === "/" && !session?.user) return <Landing locale={locale} setLocale={changeLocale} go={go} />;
  if (path === "/login" && !session?.user) return <AuthScreen mode="login" locale={locale} go={go} onDone={refreshMe} />;
  if (path === "/signup" && !session?.user) return <AuthScreen mode="signup" locale={locale} go={go} onDone={refreshMe} />;
  if (path === "/recover" && !session?.user) return <RecoveryScreen locale={locale} go={go} />;

  const publicTournamentRoute = path.match(/^\/tournaments\/([^/]+)$/);
  if (publicTournamentRoute) return <PublicTournamentRegistration slug={decodeURIComponent(publicTournamentRoute[1]!)} locale={locale} go={go} onProfileSaved={refreshMe} />;

  if (path.startsWith("/organizations/")) {
    return <PublicOrganization slug={decodeURIComponent(path.split("/")[2] || "")} locale={locale} go={go} me={me} refreshMe={refreshMe} authenticated={Boolean(session?.user)} />;
  }

  if (!session?.user) {
    go("/login");
    return <LoadingScreen />;
  }

  if (path === "/app/registrations") return <Shell locale={locale} go={go} me={me}><><MyTournamentPayments locale={locale}/><MyTournamentRegistrations locale={locale} go={go} onProfileSaved={refreshMe} /></></Shell>;

  const tournamentWorkspace = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments\/([^/]+)$/);
  if (tournamentWorkspace) {
    return <Shell locale={locale} go={go} me={me}><TournamentParityWorkspace organizationId={decodeURIComponent(tournamentWorkspace[1]!)} tournamentId={decodeURIComponent(tournamentWorkspace[2]!)} locale={locale} go={go} /></Shell>;
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
      <header className="topbar">
        <HuauBrand onClick={() => go("/app")} />
        <nav>
          <button className="light compact player-profile-nav" onClick={() => go("/app")}>{copy(locale, "Perfil de jugador", "Player profile")}</button>
          {me?.platformAdmin && <button onClick={() => go("/platform")}>{t(locale, "platform")}</button>}
        </nav>
        <button className="ghost compact" onClick={() => void authClient.signOut().then(() => go("/"))}>{t(locale, "signOut")}</button>
      </header>
      {children}
    </div>
  );
}

function Landing({ locale, setLocale, go }: { locale: Locale; setLocale: (l: Locale) => void; go: (p: string) => void }) {
  return <main className="landing">
    <header className="landing-nav"><HuauBrand /><div className="landing-actions"><LocaleToggle locale={locale} setLocale={setLocale}/><button className="ghost" onClick={() => go("/login")}>{t(locale,"enter")}</button><button className="light" onClick={() => go("/signup")}>{t(locale,"createAccount")}</button></div></header>
    <section className="landing-hero"><div className="eyebrow">{t(locale,"landingEyebrow")}</div><h1>{t(locale,"landingTitle")}</h1><p>{t(locale,"landingBody")}</p><div className="hero-actions"><button className="light" onClick={() => go("/signup")}>{t(locale,"createAccount")}</button><button className="ghost" onClick={() => go("/login")}>{t(locale,"enter")}</button></div><div className="module-strip"><span>CLUB</span><span>TOURNAMENT</span><span>REF</span></div></section>
    <footer className="landing-footer"><span>HUAU</span><span>{t(locale,"brandTagline")}</span></footer>
  </main>;
}

function AuthScreen({ mode, locale, go, onDone }: { mode: "login"|"signup"; locale: Locale; go:(p:string)=>void; onDone:()=>Promise<void> }) {
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form=new FormData(event.currentTarget); const email=String(form.get("email")||"").trim(); const password=String(form.get("password")||"");
    try {
      if(mode==="signup"){
        const firstName=String(form.get("firstName")||"").trim(); const lastName=String(form.get("lastName")||"").trim();
        const result=await authClient.signUp.email({email,password,name:`${firstName} ${lastName}`.trim()});
        if(result.error) throw new Error(result.error.message || "SIGNUP_FAILED");
        await api("/api/me/profile",{method:"PUT",body:JSON.stringify({firstName,lastName,preferredLocale:locale==="es"?"es-UY":"en"})});
      } else {
        const result=await authClient.signIn.email({email,password}); if(result.error) throw new Error(result.error.message || "SIGNIN_FAILED");
      }
      await onDone(); const next=sessionStorage.getItem("huau.afterAuth"); if(next)sessionStorage.removeItem("huau.afterAuth"); go(next||"/app");
    } catch (e) { setError(e instanceof Error?e.message:"AUTH_FAILED"); } finally { setBusy(false); }
  };
  return <main className="auth-page"><button className="back-link" onClick={()=>go("/")}>← {t(locale,"back")}</button><section className="auth-card"><HuauBrand center /><h1>{mode==="login"?t(locale,"signIn"):t(locale,"createAccount")}</h1><form onSubmit={submit}>{mode==="signup"&&<div className="two"><Field name="firstName" label={t(locale,"firstName")}/><Field name="lastName" label={t(locale,"lastName")}/></div>}<Field name="email" label={t(locale,"email")} type="email"/><Field name="password" label={t(locale,"password")} type="password"/><button className="light full" disabled={busy}>{busy?"…":mode==="login"?t(locale,"signIn"):t(locale,"signUp")}</button>{error&&<p className="error">{error}</p>}</form>{mode==="login"?<><button className="text-button" onClick={()=>go("/recover")}>{t(locale,"recover")}</button><button className="text-button" onClick={()=>go("/signup")}>{copy(locale,"¿No tenés cuenta? Crear cuenta","No account yet? Create one")}</button></>:<button className="text-button" onClick={()=>go("/login")}>{copy(locale,"Ya tengo cuenta","I already have an account")}</button>}</section></main>;
}

function RecoveryScreen({locale,go}:{locale:Locale;go:(p:string)=>void}) { return <main className="auth-page"><button className="back-link" onClick={()=>go("/login")}>← {t(locale,"back")}</button><section className="auth-card"><HuauBrand center /><h1>{t(locale,"recover")}</h1><p className="muted">{t(locale,"recoverySoon")}</p></section></main>; }

function MyHuau({locale,setLocale,go,me,loading,refreshMe}:{locale:Locale;setLocale:(l:Locale)=>void;go:(p:string)=>void;me:Me|null;loading:boolean;refreshMe:()=>Promise<void>}) {
  const [organizations,setOrganizations]=useState<Organization[]>([]);
  const [profileBusy,setProfileBusy]=useState(false);
  const [profileMessage,setProfileMessage]=useState("");
  const [avatarBusy,setAvatarBusy]=useState(false);
  const [avatarVersion,setAvatarVersion]=useState(0);
  useEffect(()=>{ void api<{organizations:Organization[]}>("/api/organizations").then(r=>setOrganizations(r.organizations)); },[]);
  const adminOrgIds=useMemo(()=>new Set(me?.capabilities.filter(c=>c.capability==="org_admin"&&c.status==="active").map(c=>c.organizationId)??[]),[me]);
  const profileComplete=Boolean(me?.profile?.firstName&&me.profile.lastName&&me.profile.phone&&me.profile.birthDate&&me.profile.sportGender&&me.profile.sportGender!=="unspecified");
  const initials=`${me?.profile?.firstName?.[0]??me?.user.name?.[0]??"H"}${me?.profile?.lastName?.[0]??""}`.toUpperCase();

  const saveProfile=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setProfileBusy(true);setProfileMessage("");
    const form=new FormData(event.currentTarget);
    try{
      await api("/api/me/profile",{method:"PUT",body:JSON.stringify({
        firstName:form.get("firstName"),
        lastName:form.get("lastName"),
        phone:form.get("phone")||null,
        birthDate:form.get("birthDate")||null,
        sportGender:form.get("sportGender"),
        city:form.get("city")||null,
        countryCode:String(form.get("countryCode")||"").trim().toUpperCase()||null,
        duprId:String(form.get("duprId")||"").trim()||null,
        duprSingles:String(form.get("duprSingles")||"").trim()?Number(form.get("duprSingles")):null,
        duprDoubles:String(form.get("duprDoubles")||"").trim()?Number(form.get("duprDoubles")):null,
      })});
      await refreshMe();
      setProfileMessage(copy(locale,"Perfil actualizado.","Profile updated."));
    }catch(error){setProfileMessage(error instanceof Error?error.message:"PROFILE_UPDATE_FAILED");}
    finally{setProfileBusy(false);}
  };

  const uploadAvatar=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];
    if(!file)return;
    setAvatarBusy(true);setProfileMessage("");
    try{
      const response=await fetch("/api/me/avatar",{method:"PUT",headers:{"content-type":file.type},body:file});
      const payload=await response.json() as {ok?:boolean;code?:string};
      if(!response.ok)throw new Error(payload.code||`HTTP_${response.status}`);
      await refreshMe();
      setAvatarVersion(value=>value+1);
      setProfileMessage(copy(locale,"Foto de perfil actualizada.","Profile photo updated."));
    }catch(error){setProfileMessage(error instanceof Error?error.message:"AVATAR_UPDATE_FAILED");}
    finally{event.currentTarget.value="";setAvatarBusy(false);}
  };

  const removeAvatar=async()=>{
    setAvatarBusy(true);setProfileMessage("");
    try{
      const response=await fetch("/api/me/avatar",{method:"DELETE"});
      const payload=await response.json() as {ok?:boolean;code?:string};
      if(!response.ok)throw new Error(payload.code||`HTTP_${response.status}`);
      await refreshMe();
      setAvatarVersion(value=>value+1);
      setProfileMessage(copy(locale,"Foto eliminada.","Photo removed."));
    }catch(error){setProfileMessage(error instanceof Error?error.message:"AVATAR_DELETE_FAILED");}
    finally{setAvatarBusy(false);}
  };

  return <Shell locale={locale} go={go} me={me}><main className="dashboard player-profile-page">
    <section className="dashboard-head"><div><div className="eyebrow">{copy(locale,"PERFIL DE JUGADOR","PLAYER PROFILE")}</div><h1>{me?.profile?.firstName ? copy(locale,`Bienvenido, ${me.profile.firstName}.`,`Welcome, ${me.profile.firstName}.`) : copy(locale,"Bienvenido a HUAU.","Welcome to HUAU.")}</h1></div><div className="dashboard-head-actions"><button className="ghost" onClick={()=>go("/app/registrations")}>{copy(locale,"Mis inscripciones","My registrations")}</button><LocaleToggle locale={locale} setLocale={setLocale}/></div></section>
    <section className="dashboard-grid">
      <div className="panel wide player-profile-panel">
        <div className="player-profile-overview">
          <div className="player-profile-avatar-block">
            <div className="player-avatar">{me?.profile?.avatarUrl?<img key={avatarVersion} src={`${me.profile.avatarUrl}?v=${avatarVersion}`} alt={copy(locale,"Foto de perfil","Profile photo")} />:<span>{initials}</span>}</div>
            <div className="avatar-actions">
              <label className={`ghost small avatar-upload${avatarBusy?" disabled":""}`}><span>{avatarBusy?"…":copy(locale,"Cambiar foto","Change photo")}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy} onChange={uploadAvatar}/></label>
              {me?.profile?.avatarUrl&&<button type="button" className="ghost small" disabled={avatarBusy} onClick={()=>void removeAvatar()}>{copy(locale,"Quitar","Remove")}</button>}
            </div>
          </div>
          <div className="player-profile-summary">
            <div className="eyebrow">HUAU ID</div>
            <h2>{copy(locale,"Perfil de jugador","Player profile")}</h2>
            <p className="muted">{copy(locale,"Tus datos de identidad, contacto y pickleball se reutilizan al inscribirte a torneos.","Your identity, contact and pickleball data are reused when you register for tournaments.")}</p>
            <div className="profile-status-row">
              <span className={`profile-completion ${profileComplete?"complete":""}`}>{profileComplete?copy(locale,"Perfil base completo","Base profile complete"):copy(locale,"Faltan datos básicos","Basic details missing")}</span>
              <code title={me?.user.id}>{me?.user.id??"—"}</code>
            </div>
          </div>
        </div>

        <form onSubmit={saveProfile} className="player-profile-form">
          <div className="two"><Field name="firstName" label={copy(locale,"Nombre","First name")} defaultValue={me?.profile?.firstName??""}/><Field name="lastName" label={copy(locale,"Apellido","Last name")} defaultValue={me?.profile?.lastName??""}/></div>
          <div className="two"><label><span>Email</span><input value={me?.user.email??""} disabled readOnly/></label><Field name="phone" label={copy(locale,"Teléfono","Phone")} required={false} defaultValue={me?.profile?.phone??""}/></div>
          <div className="two"><Field name="birthDate" label={copy(locale,"Fecha de nacimiento","Birth date")} type="date" required={false} defaultValue={me?.profile?.birthDate??""}/><label><span>{copy(locale,"Género deportivo","Sport gender")}</span><select name="sportGender" defaultValue={me?.profile?.sportGender??"unspecified"}><option value="unspecified">{copy(locale,"Sin especificar","Unspecified")}</option><option value="male">{copy(locale,"Masculino","Male")}</option><option value="female">{copy(locale,"Femenino","Female")}</option></select></label></div>
          <div className="two"><Field name="city" label={copy(locale,"Ciudad","City")} required={false} defaultValue={me?.profile?.city??""}/><label><span>{copy(locale,"País (código)","Country code")}</span><input name="countryCode" maxLength={3} defaultValue={me?.profile?.countryCode??""} placeholder="UY"/></label></div>
          <div className="dupr-profile-box">
            <div className="dupr-profile-copy"><div className="eyebrow">DUPR</div><strong>{copy(locale,"Identidad y ratings","Identity & ratings")}</strong><p className="muted">{copy(locale,"El DUPR ID permite que la organización verifique los ratings declarados cuando corresponda.","Your DUPR ID lets organizers verify declared ratings when needed.")}</p></div>
            <label><span>DUPR ID</span><input name="duprId" maxLength={80} defaultValue={me?.profile?.duprId??""} placeholder={copy(locale,"ID de jugador DUPR","DUPR player ID")}/></label>
            <div className="two"><label><span>DUPR Singles</span><input name="duprSingles" type="number" min="0" max="8" step="0.001" defaultValue={me?.profile?.duprSingles===null||me?.profile?.duprSingles===undefined?"":String(me.profile.duprSingles)}/></label><label><span>DUPR Doubles</span><input name="duprDoubles" type="number" min="0" max="8" step="0.001" defaultValue={me?.profile?.duprDoubles===null||me?.profile?.duprDoubles===undefined?"":String(me.profile.duprDoubles)}/></label></div>
          </div>
          <div className="form-actions"><button className="light small" disabled={profileBusy}>{profileBusy?"…":copy(locale,"Guardar perfil","Save profile")}</button>{profileMessage&&<span className="muted">{profileMessage}</span>}</div>
        </form>
      </div>

      <div className="panel wide"><div className="panel-title"><h2>{t(locale,"organizations")}</h2><span>{me?.memberships.length??0}</span></div>{loading?<p className="muted">Loading…</p>:me?.memberships.length? <div className="card-list">{me.memberships.map(m=><article className="org-card" key={m.id}><div><span className="pill">{m.organizationType}</span><h3>{m.organizationName}</h3><p>{m.status}</p></div><div className="card-actions"><button className="ghost small" onClick={()=>go(`/organizations/${m.organizationSlug}`)}>{t(locale,"openOrganization")}</button>{adminOrgIds.has(m.organizationId)&&<button className="light small" onClick={()=>go(`/admin/organizations/${m.organizationId}`)}>{t(locale,"admin")}</button>}</div></article>)}</div>:<p className="muted">{t(locale,"noOrganizations")}</p>}</div>
      <div className="panel"><h2>{t(locale,"discover")}</h2><div className="mini-list">{organizations.slice(0,6).map(org=><button key={org.id} onClick={()=>go(`/organizations/${org.slug}`)}><span>{org.name}</span><small>{org.type}</small></button>)}</div></div>
    </section>
  </main></Shell>;
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
  const [message,setMessage]=useState("");
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await api<{organization:{slug:string}}>("/api/platform/organizations",{method:"POST",body:JSON.stringify({name:f.get("name"),slug:f.get("slug"),type:f.get("type"),description:f.get("description")})});setMessage("OK");await refreshMe();go(`/organizations/${r.organization.slug}`);}catch(err){setMessage(err instanceof Error?err.message:"error")}};
  return <Shell locale={locale} go={go}><main className="dashboard"><section className="dashboard-head"><div><div className="eyebrow">HUAU</div><h1>{t(locale,"platform")}</h1></div></section><section className="panel form-panel"><h2>{t(locale,"createOrganization")}</h2><form onSubmit={submit}><Field name="name" label={t(locale,"organizationName")}/><Field name="slug" label={t(locale,"organizationSlug")} required={false}/><label><span>{t(locale,"organizationType")}</span><select name="type" defaultValue="club"><option value="club">Club</option><option value="sports_complex">Sports complex</option><option value="community">Community</option><option value="academy">Academy</option><option value="organizer">Organizer</option><option value="league">League</option><option value="federation">Federation</option></select></label><label><span>{t(locale,"description")}</span><textarea name="description" rows={4}/></label><button className="light">{t(locale,"create")}</button>{message&&<p>{message}</p>}</form></section></main></Shell>;
}

function Field({name,label,type="text",required=true,defaultValue}:{name:string;label:string;type?:string;required?:boolean;defaultValue?:string}) { return <label><span>{label}</span><input name={name} type={type} required={required} defaultValue={defaultValue} min={type==="number"?"0":undefined} minLength={type==="password"?8:undefined}/></label>; }
function LocaleToggle({locale,setLocale}:{locale:Locale;setLocale:(l:Locale)=>void}) { return <div className="locale-toggle"><button className={locale==="es"?"active":""} onClick={()=>setLocale("es")}>ES</button><button className={locale==="en"?"active":""} onClick={()=>setLocale("en")}>EN</button></div>; }
function LoadingScreen(){ return <main className="loading-screen"><HuauBrand center /></main>; }
