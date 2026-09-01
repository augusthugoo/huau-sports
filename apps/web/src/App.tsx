import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { DEFAULT_STANDARD_FORMAT, recommendedGroupCount } from "@huau/core";
import type { StandardCompetitionFormat } from "@huau/core";
import { authClient } from "./lib/auth-client";
import { detectLocale, t } from "./i18n";
import type { Locale } from "./i18n";

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
  profile: { firstName: string; lastName: string; preferredLocale: string } | null;
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
type TournamentCategory = {
  id: string;
  name: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: string | null;
  scheduledDate: string | null;
  sortOrder: number;
  structureLocked: number;
  formatVersionId: string | null;
  entryCount: number;
  competitionStatus: string | null;
  groupMatchCount: number;
  finishedGroupMatchCount: number;
  finalMatchCount: number;
  configJson: string | null;
};
type TournamentEntryRow = {
  id: string;
  categoryId: string;
  displayName: string;
  entryType: string;
  status: string;
  seedRating: number;
  members: string | null;
};
type TournamentGroupRow = {
  id: string;
  name: string;
  categoryId: string;
  entryId: string | null;
  entryName: string | null;
  sortOrder: number | null;
};
type TournamentMatchRow = {
  encounterId: string;
  categoryId: string;
  categoryName: string;
  stage: string;
  groupId: string | null;
  groupName: string | null;
  roundLabel: string | null;
  legNumber: number;
  entryAId: string | null;
  sideA: string | null;
  entryBId: string | null;
  sideB: string | null;
  status: string;
  winnerEntryId: string | null;
  matchId: string | null;
  bestOf: number;
  pointTarget: number | null;
  scoreA: number | null;
  scoreB: number | null;
  resultStatus: string | null;
};
type TournamentScheduleRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  encounterId: string | null;
  matchId: string | null;
  stage: string;
  roundLabel: string | null;
  courtLabel: string;
  startAt: number;
  endAt: number;
  status: string;
};
type TournamentSnapshotRow = {
  id: string;
  scopeType: string;
  scopeId: string | null;
  reason: string;
  revision: number;
  createdAt: number;
  categoryName: string | null;
};
type ChecklistItem = { key: "general" | "categories" | "participants" | "structure" | "schedule"; complete: boolean };
type TournamentDetail = {
  tournament: {
    id: string;
    organizerOrganizationId: string;
    name: string;
    slug: string;
    sport: string;
    status: string;
    visibility: string;
    startAt: number;
    endAt: number | null;
    timezone: string;
    courtCount: number;
    publicParticipants: number;
    publicLive: number;
    structureLocked: number;
    publishedRevision: number;
    workingRevision: number;
  };
  categories: TournamentCategory[];
  entries: TournamentEntryRow[];
  groups: TournamentGroupRow[];
  matches: TournamentMatchRow[];
  schedule: TournamentScheduleRow[];
  snapshots: TournamentSnapshotRow[];
  checklist: ChecklistItem[];
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
const displayDateTime = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(toMs(value)));
const isoDate = (value: number) => new Date(toMs(value)).toISOString().slice(0, 10);

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

  if (path.startsWith("/organizations/")) {
    return <PublicOrganization slug={decodeURIComponent(path.split("/")[2] || "")} locale={locale} go={go} me={me} refreshMe={refreshMe} authenticated={Boolean(session?.user)} />;
  }

  if (!session?.user) {
    go("/login");
    return <LoadingScreen />;
  }

  const tournamentWorkspace = path.match(/^\/admin\/organizations\/([^/]+)\/tournaments\/([^/]+)$/);
  if (tournamentWorkspace) {
    return <TournamentWorkspace organizationId={decodeURIComponent(tournamentWorkspace[1]!)} tournamentId={decodeURIComponent(tournamentWorkspace[2]!)} locale={locale} go={go} me={me} />;
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
  return <MyHuau locale={locale} setLocale={changeLocale} go={go} me={me} loading={meLoading} />;
}

function Shell({ children, locale, go, me }: { children: React.ReactNode; locale: Locale; go: (path: string) => void; me?: Me | null }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => go("/app")}><strong>HUAU</strong><span>SPORTS</span></button>
        <nav>
          <button onClick={() => go("/app")}>{t(locale, "myHuau")}</button>
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
    <header className="landing-nav"><div className="brand"><strong>HUAU</strong><span>SPORTS</span></div><div className="landing-actions"><LocaleToggle locale={locale} setLocale={setLocale}/><button className="ghost" onClick={() => go("/login")}>{t(locale,"enter")}</button><button className="light" onClick={() => go("/signup")}>{t(locale,"createAccount")}</button></div></header>
    <section className="landing-hero"><div className="eyebrow">{t(locale,"landingEyebrow")}</div><h1>{t(locale,"landingTitle")}</h1><p>{t(locale,"landingBody")}</p><div className="hero-actions"><button className="light" onClick={() => go("/signup")}>{t(locale,"createAccount")}</button><button className="ghost" onClick={() => go("/login")}>{t(locale,"enter")}</button></div><div className="module-strip"><span>CLUB</span><span>TOURNAMENT</span><span>REF</span></div></section>
    <footer className="landing-footer"><span>HUAU Sports</span><span>{t(locale,"brandTagline")}</span></footer>
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
      await onDone(); go("/app");
    } catch (e) { setError(e instanceof Error?e.message:"AUTH_FAILED"); } finally { setBusy(false); }
  };
  return <main className="auth-page"><button className="back-link" onClick={()=>go("/")}>← {t(locale,"back")}</button><section className="auth-card"><div className="brand center"><strong>HUAU</strong><span>SPORTS</span></div><h1>{mode==="login"?t(locale,"signIn"):t(locale,"createAccount")}</h1><form onSubmit={submit}>{mode==="signup"&&<div className="two"><Field name="firstName" label={t(locale,"firstName")}/><Field name="lastName" label={t(locale,"lastName")}/></div>}<Field name="email" label={t(locale,"email")} type="email"/><Field name="password" label={t(locale,"password")} type="password"/><button className="light full" disabled={busy}>{busy?"…":mode==="login"?t(locale,"signIn"):t(locale,"signUp")}</button>{error&&<p className="error">{error}</p>}</form>{mode==="login"&&<button className="text-button" onClick={()=>go("/recover")}>{t(locale,"recover")}</button>}</section></main>;
}

function RecoveryScreen({locale,go}:{locale:Locale;go:(p:string)=>void}) { return <main className="auth-page"><button className="back-link" onClick={()=>go("/login")}>← {t(locale,"back")}</button><section className="auth-card"><div className="brand center"><strong>HUAU</strong><span>SPORTS</span></div><h1>{t(locale,"recover")}</h1><p className="muted">{t(locale,"recoverySoon")}</p></section></main>; }

function MyHuau({locale,setLocale,go,me,loading}:{locale:Locale;setLocale:(l:Locale)=>void;go:(p:string)=>void;me:Me|null;loading:boolean}) {
  const [organizations,setOrganizations]=useState<Organization[]>([]);
  useEffect(()=>{ void api<{organizations:Organization[]}>("/api/organizations").then(r=>setOrganizations(r.organizations)); },[]);
  const adminOrgIds=useMemo(()=>new Set(me?.capabilities.filter(c=>c.capability==="org_admin"&&c.status==="active").map(c=>c.organizationId)??[]),[me]);
  return <Shell locale={locale} go={go} me={me}><main className="dashboard"><section className="dashboard-head"><div><div className="eyebrow">{t(locale,"myHuau")}</div><h1>{me?.profile?.firstName ? `${me.profile.firstName}, tu deporte empieza acá.` : "Tu deporte empieza acá."}</h1></div><LocaleToggle locale={locale} setLocale={setLocale}/></section><section className="dashboard-grid"><div className="panel wide"><div className="panel-title"><h2>{t(locale,"organizations")}</h2><span>{me?.memberships.length??0}</span></div>{loading?<p className="muted">Loading…</p>:me?.memberships.length? <div className="card-list">{me.memberships.map(m=><article className="org-card" key={m.id}><div><span className="pill">{m.organizationType}</span><h3>{m.organizationName}</h3><p>{m.status}</p></div><div className="card-actions"><button className="ghost" onClick={()=>go(`/organizations/${m.organizationSlug}`)}>{t(locale,"openOrganization")}</button>{adminOrgIds.has(m.organizationId)&&<button className="light small" onClick={()=>go(`/admin/organizations/${m.organizationId}`)}>{t(locale,"admin")}</button>}</div></article>)}</div>:<p className="muted">{t(locale,"noOrganizations")}</p>}</div><div className="panel"><h2>{t(locale,"discover")}</h2><div className="mini-list">{organizations.slice(0,6).map(org=><button key={org.id} onClick={()=>go(`/organizations/${org.slug}`)}><span>{org.name}</span><small>{org.type}</small></button>)}</div></div></section></main></Shell>;
}

function PublicOrganization({slug,locale,go,me,refreshMe,authenticated}:{slug:string;locale:Locale;go:(p:string)=>void;me:Me|null;refreshMe:()=>Promise<void>;authenticated:boolean}) {
  const [org,setOrg]=useState<Organization|null>(null); const [state,setState]=useState("");
  useEffect(()=>{ void api<{organization:Organization}>(`/api/organizations/${encodeURIComponent(slug)}`).then(r=>setOrg(r.organization)); },[slug]);
  const membership=me?.memberships.find(m=>m.organizationId===org?.id); const pendingRequest=me?.membershipRequests?.find(r=>r.organizationId===org?.id&&r.status==="pending");
  const request=async()=>{ if(!org)return; try{await api(`/api/organizations/${org.id}/membership-requests`,{method:"POST",body:"{}"});setState("sent");await refreshMe();}catch(e){setState(e instanceof Error?e.message:"error");}};
  const content=<main className="public-org">{org?<><div className="eyebrow">{org.type}</div><h1>{org.name}</h1><p>{org.description||"HUAU Sports Organization"}</p><div className="public-org-actions">{membership?<span className="pill strong">{membership.status}</span>:pendingRequest?<span className="pill strong">{t(locale,"pending")}</span>:authenticated?<button className="light" onClick={()=>void request()} disabled={state==="sent"}>{state==="sent"?t(locale,"requestSent"):t(locale,"requestJoin")}</button>:<button className="light" onClick={()=>go("/login")}>{t(locale,"enter")}</button>}</div></>:<p>Loading…</p>}</main>;
  if(authenticated) return <Shell locale={locale} go={go} me={me}>{content}</Shell>;
  return <div className="app-shell"><header className="topbar"><button className="brand-button" onClick={()=>go("/")}><strong>HUAU</strong><span>SPORTS</span></button><button className="light small" onClick={()=>go("/login")}>{t(locale,"enter")}</button></header>{content}</div>;
}

function OrganizationAdmin({organizationId,locale,go,me,refreshMe}:{organizationId:string;locale:Locale;go:(p:string)=>void;me:Me|null;refreshMe:()=>Promise<void>}) {
  const [requests,setRequests]=useState<JoinRequest[]>([]); const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await api<{requests:JoinRequest[]}>(`/api/admin/organizations/${organizationId}/membership-requests`);setRequests(r.requests);}catch(e){setError(e instanceof Error?e.message:"error")}},[organizationId]);
  useEffect(()=>{void load()},[load]);
  const review=async(id:string,decision:"approve"|"reject")=>{await api(`/api/admin/membership-requests/${id}/review`,{method:"POST",body:JSON.stringify({decision})});await load();await refreshMe();};
  return <Shell locale={locale} go={go} me={me}><main className="dashboard"><section className="dashboard-head"><div><div className="eyebrow">{t(locale,"admin")}</div><h1>{copy(locale,"Administración","Administration")}</h1></div><button className="light" onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>HUAU Tournament →</button></section><div className="admin-module-strip"><button className="active">{copy(locale,"Membresías","Memberships")}</button><button onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>Tournament</button></div><section className="panel wide"><div className="panel-title"><h2>{t(locale,"membershipRequests")}</h2><span>{requests.length}</span></div>{error&&<p className="error">{error}</p>}{requests.length?<div className="request-list">{requests.map(r=><article key={r.id}><div><strong>{r.firstName&&r.lastName?`${r.firstName} ${r.lastName}`:r.name}</strong><span>{r.email}</span></div><div className="card-actions"><button className="ghost" onClick={()=>void review(r.id,"reject")}>{t(locale,"reject")}</button><button className="light small" onClick={()=>void review(r.id,"approve")}>{t(locale,"approve")}</button></div></article>)}</div>:<p className="muted">{t(locale,"noRequests")}</p>}</section></main></Shell>;
}

function TournamentList({organizationId,locale,go,me}:{organizationId:string;locale:Locale;go:(p:string)=>void;me:Me|null}) {
  const [items,setItems]=useState<TournamentSummary[]>([]); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{try{const r=await api<{tournaments:TournamentSummary[]}>(`/api/admin/organizations/${organizationId}/tournaments`);setItems(r.tournaments);}catch(e){setError(e instanceof Error?e.message:"error")}},[organizationId]);
  useEffect(()=>{void load()},[load]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);try{const r=await api<{tournament:{id:string}}>(`/api/admin/organizations/${organizationId}/tournaments`,{method:"POST",body:JSON.stringify({name:form.get("name"),sport:form.get("sport"),startDate:form.get("startDate"),endDate:form.get("endDate")||null,courtCount:Number(form.get("courtCount")),visibility:form.get("visibility")})});go(`/admin/organizations/${organizationId}/tournaments/${r.tournament.id}`);}catch(e){setError(e instanceof Error?e.message:"error");setBusy(false)}};
  return <Shell locale={locale} go={go} me={me}><main className="dashboard tournament-list-page"><button className="section-back" onClick={()=>go(`/admin/organizations/${organizationId}`)}>← {copy(locale,"Organización","Organization")}</button><section className="dashboard-head"><div><div className="eyebrow">HUAU Tournament</div><h1>{copy(locale,"Torneos","Tournaments")}</h1><p className="muted">{copy(locale,"Creá, prepará y operá cada competencia desde un único workspace.","Create, prepare and operate every competition from one workspace.")}</p></div></section><section className="tournament-list-grid"><div className="panel"><h2>{copy(locale,"Nuevo torneo","New tournament")}</h2><form onSubmit={submit}><Field name="name" label={copy(locale,"Nombre","Name")}/><div className="two"><label><span>{copy(locale,"Deporte","Sport")}</span><select name="sport" defaultValue="pickleball"><option value="pickleball">Pickleball</option><option value="padel">Padel</option><option value="tennis">Tennis</option></select></label><Field name="courtCount" label={copy(locale,"Canchas","Courts")} type="number"/></div><div className="two"><Field name="startDate" label={copy(locale,"Inicio","Start") } type="date"/><Field name="endDate" label={copy(locale,"Fin (opcional)","End (optional)")} type="date" required={false}/></div><label><span>{copy(locale,"Visibilidad","Visibility")}</span><select name="visibility" defaultValue="public"><option value="public">{copy(locale,"Público","Public")}</option><option value="members">{copy(locale,"Miembros","Members")}</option><option value="invite">{copy(locale,"Invitación","Invite")}</option></select></label><button className="light full" disabled={busy}>{busy?"…":copy(locale,"Crear torneo","Create tournament")}</button>{error&&<p className="error">{error}</p>}</form></div><div className="panel wide"><div className="panel-title"><h2>{copy(locale,"Tus torneos","Your tournaments")}</h2><span>{items.length}</span></div><div className="tournament-card-list">{items.length?items.map(item=><button className="tournament-card" key={item.id} onClick={()=>go(`/admin/organizations/${organizationId}/tournaments/${item.id}`)}><div><span className="pill">{item.sport}</span><h3>{item.name}</h3><p>{displayDate(item.startAt)} · {item.courtCount} {copy(locale,"canchas","courts")}</p></div><div className="tournament-card-meta"><strong>{item.status.replaceAll("_"," ")}</strong><span>{item.categoryCount} {copy(locale,"categorías","categories")} · {item.entryCount} {copy(locale,"inscriptos","entries")}</span></div></button>):<div className="empty-state">{copy(locale,"Todavía no hay torneos.","No tournaments yet.")}</div>}</div></div></section></main></Shell>;
}

type WorkspaceTab = "overview" | "categories" | "draw" | "schedule" | "results" | "finals" | "publish" | "recovery";

function TournamentWorkspace({organizationId,tournamentId,locale,go,me}:{organizationId:string;tournamentId:string;locale:Locale;go:(p:string)=>void;me:Me|null}) {
  const [detail,setDetail]=useState<TournamentDetail|null>(null); const [tab,setTab]=useState<WorkspaceTab>("overview"); const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const [operatorMode,setOperatorMode]=useState(false);
  const load=useCallback(async()=>{try{const r=await api<{ok:true}&TournamentDetail>(`/api/admin/tournaments/${tournamentId}`);setDetail(r);setError("");}catch(e){setError(e instanceof Error?e.message:"error")}},[tournamentId]);
  useEffect(()=>{void load()},[load]);
  if(!detail)return <Shell locale={locale} go={go} me={me}><main className="dashboard"><button className="section-back" onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>← Tournament</button>{error?<p className="error">{error}</p>:<p className="muted">Loading…</p>}</main></Shell>;
  const tournament=detail.tournament;
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);setError("");try{await action();await load();}catch(e){setError(e instanceof Error?e.message:"error")}finally{setBusy(false)}};
  if(operatorMode)return <Shell locale={locale} go={go} me={me}><main className="dashboard operator-workspace"><div className="operator-head"><div><div className="eyebrow">{tournament.name}</div><h1>{copy(locale,"Modo operador","Operator mode")}</h1></div><button className="ghost" onClick={()=>setOperatorMode(false)}>{copy(locale,"Volver al workspace","Back to workspace")}</button></div><SchedulePanel detail={detail} locale={locale}/><ResultsPanel detail={detail} locale={locale} busy={busy} onSave={(match,payload)=>act(()=>saveResult(match,payload))}/></main></Shell>;
  const tabs:Array<{key:WorkspaceTab;label:string}>=[{key:"overview",label:copy(locale,"Resumen","Overview")},{key:"categories",label:copy(locale,"Participantes","Participants")},{key:"draw",label:copy(locale,"Formato y sorteo","Format & draw")},{key:"schedule",label:copy(locale,"Cronograma","Schedule")},{key:"results",label:copy(locale,"Resultados","Results")},{key:"finals",label:copy(locale,"Fase final","Final phase")},{key:"publish",label:copy(locale,"Publicar","Publish")},{key:"recovery",label:copy(locale,"Recuperación","Recovery")}];
  return <Shell locale={locale} go={go} me={me}><main className="dashboard tournament-workspace"><button className="section-back" onClick={()=>go(`/admin/organizations/${organizationId}/tournaments`)}>← HUAU Tournament</button><section className="workspace-hero"><div><div className="eyebrow">{tournament.sport} · {tournament.status.replaceAll("_"," ")}</div><h1>{tournament.name}</h1><p>{displayDate(tournament.startAt)} · {tournament.courtCount} {copy(locale,"canchas","courts")} · rev. {tournament.workingRevision}</p></div><div className="workspace-actions"><span className={`lock-chip ${tournament.structureLocked?"is-locked":""}`}>{tournament.structureLocked?copy(locale,"Estructura bloqueada","Structure locked"):copy(locale,"En preparación","In setup")}</span><button className="light small" onClick={()=>setOperatorMode(true)}>{copy(locale,"Modo operador","Operator mode")}</button></div></section><nav className="workspace-tabs">{tabs.map(item=><button className={tab===item.key?"active":""} key={item.key} onClick={()=>setTab(item.key)}>{item.label}</button>)}</nav>{error&&<p className="workspace-alert error">{error}</p>}{tab==="overview"&&<OverviewPanel detail={detail} locale={locale} onGo={setTab}/>} {tab==="categories"&&<CategoriesPanel detail={detail} locale={locale} busy={busy} onAction={act}/>} {tab==="draw"&&<DrawPanel detail={detail} locale={locale} busy={busy} onAction={act}/>} {tab==="schedule"&&<SchedulePanel detail={detail} locale={locale}/>} {tab==="results"&&<ResultsPanel detail={detail} locale={locale} busy={busy} onSave={(match,payload)=>act(()=>saveResult(match,payload))}/>} {tab==="finals"&&<FinalsPanel detail={detail} locale={locale} busy={busy} onAction={act}/>} {tab==="publish"&&<PublishPanel detail={detail} locale={locale} busy={busy} onAction={act}/>} {tab==="recovery"&&<RecoveryPanel detail={detail} locale={locale} busy={busy} onAction={act}/>}</main></Shell>;
}

function OverviewPanel({detail,locale,onGo}:{detail:TournamentDetail;locale:Locale;onGo:(tab:WorkspaceTab)=>void}) {
  const labels:Record<ChecklistItem["key"],string>={general:copy(locale,"Datos generales","General"),categories:copy(locale,"Categorías","Categories"),participants:copy(locale,"Participantes","Participants"),structure:copy(locale,"Grupos y estructura","Groups & structure"),schedule:copy(locale,"Cronograma","Schedule")};
  const next=detail.checklist.find(item=>!item.complete);
  return <section className="workspace-grid"><div className="panel wide"><div className="panel-title"><h2>{copy(locale,"Checklist de preparación","Setup checklist")}</h2><span>{detail.checklist.filter(i=>i.complete).length}/{detail.checklist.length}</span></div><div className="setup-checklist">{detail.checklist.map(item=><div className={item.complete?"complete":""} key={item.key}><span>{item.complete?"✓":"○"}</span><strong>{labels[item.key]}</strong></div>)}</div>{next&&<button className="light small" onClick={()=>onGo(next.key==="categories"||next.key==="participants"?"categories":next.key==="structure"?"draw":next.key==="schedule"?"schedule":"overview")}>{copy(locale,"Continuar preparación","Continue setup")} →</button>}</div><div className="panel"><h2>{copy(locale,"Estado rápido","Quick status")}</h2><div className="quick-stats"><div><strong>{detail.categories.length}</strong><span>{copy(locale,"Categorías","Categories")}</span></div><div><strong>{detail.entries.length}</strong><span>{copy(locale,"Entradas","Entries")}</span></div><div><strong>{detail.matches.filter(m=>m.stage==="group").length}</strong><span>{copy(locale,"Partidos de grupo","Group matches")}</span></div><div><strong>{detail.schedule.length}</strong><span>{copy(locale,"Bloques","Schedule slots")}</span></div></div></div></section>;
}

function CategoriesPanel({detail,locale,busy,onAction}:{detail:TournamentDetail;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const createCategory=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);await onAction(()=>api(`/api/admin/tournaments/${detail.tournament.id}/categories`,{method:"POST",body:JSON.stringify({name:form.get("name"),entryType:form.get("entryType"),competitionGender:form.get("competitionGender")||null})}));event.currentTarget.reset();};
  const addEntry=async(event:FormEvent<HTMLFormElement>,category:TournamentCategory)=>{event.preventDefault();const form=new FormData(event.currentTarget);const payload={displayName:form.get("displayName"),members:String(form.get("members")||"").split("\n"),seedRating:Number(form.get("seedRating")||0)};let confirmImpact=false;if(category.structureLocked){confirmImpact=window.confirm(copy(locale,"Esta categoría ya tiene sorteo. Agregar un participante invalidará grupos y cronograma; HUAU guardará un snapshot antes. ¿Continuar?","This category already has a draw. Adding a participant will invalidate groups and schedule; HUAU will save a snapshot first. Continue?"));if(!confirmImpact)return;}await onAction(()=>api(`/api/admin/categories/${category.id}/entries`,{method:"POST",body:JSON.stringify({...payload,confirmImpact})}));event.currentTarget.reset();};
  return <section className="workspace-stack"><div className="panel"><div className="panel-title"><h2>{copy(locale,"Categorías y participantes","Categories & participants")}</h2><span>{detail.categories.length}</span></div><form className="inline-admin-form" onSubmit={createCategory}><Field name="name" label={copy(locale,"Nombre de categoría","Category name")}/><label><span>{copy(locale,"Tipo","Type")}</span><select name="entryType" defaultValue="pair"><option value="individual">{copy(locale,"Individual","Individual")}</option><option value="pair">{copy(locale,"Pareja","Pair")}</option><option value="team">{copy(locale,"Equipo (Phase 5)","Team (Phase 5)")}</option></select></label><label><span>{copy(locale,"Género","Gender")}</span><select name="competitionGender" defaultValue="open"><option value="open">Open</option><option value="male">{copy(locale,"Masculino","Male")}</option><option value="female">{copy(locale,"Femenino","Female")}</option><option value="mixed">{copy(locale,"Mixto","Mixed")}</option></select></label><button className="light" disabled={busy}>{copy(locale,"Agregar categoría","Add category")}</button></form></div>{detail.categories.map(category=><CategoryParticipantsCard key={category.id} detail={detail} category={category} locale={locale} busy={busy} onSubmit={addEntry}/>)}</section>;
}

function CategoryParticipantsCard({detail,category,locale,busy,onSubmit}:{detail:TournamentDetail;category:TournamentCategory;locale:Locale;busy:boolean;onSubmit:(event:FormEvent<HTMLFormElement>,category:TournamentCategory)=>Promise<void>}) {
  const entries=detail.entries.filter(entry=>entry.categoryId===category.id);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    await onSubmit(event,category);
  };
  return <article className="category-admin-card"><header><div><span className="pill">{category.entryType}</span><h2>{category.name}</h2><p>{entries.length} {copy(locale,"entradas","entries")} · {category.structureLocked?copy(locale,"estructura bloqueada","structure locked"):copy(locale,"editable","editable")}</p></div></header><div className="entry-grid">{entries.map(entry=><div className="entry-row" key={entry.id}><div><strong>{entry.displayName}</strong><span>{entry.members||copy(locale,"Sin miembros vinculados","No linked members")}</span></div><span className="rating-chip">{Number(entry.seedRating||0).toFixed(2)}</span></div>)}</div>{category.entryType!=="team"?<form className="entry-form" onSubmit={submit}><div className="two"><Field name="displayName" label={copy(locale,"Nombre visible (opcional)","Display name (optional)")} required={false}/><Field name="seedRating" label={copy(locale,"Rating / siembra","Rating / seed")} type="number" required={false}/></div><label><span>{category.entryType==="individual"?copy(locale,"Jugador","Player"):copy(locale,"Jugadores — uno por línea","Players — one per line")}</span><textarea name="members" rows={category.entryType==="pair"?2:1} required placeholder={category.entryType==="pair"?"Augusto Hugo\nDavid Pérez":"Augusto Hugo"}/></label><button className="ghost" disabled={busy}>{copy(locale,"Agregar manualmente","Add manually")}</button></form>:<div className="phase-note">{copy(locale,"La administración de roster de equipos se habilita en Phase 5.","Team roster administration is enabled in Phase 5.")}</div>}</article>;
}

type StoredFormatConfig = Partial<StandardCompetitionFormat> & {
  matchMinutes?: number;
  dailyStart?: string;
  groupCount?: number;
};

function storedFormat(category: TournamentCategory): StoredFormatConfig {
  if (!category.configJson) return {};
  try {
    return JSON.parse(category.configJson) as StoredFormatConfig;
  } catch {
    return {};
  }
}

function DrawPanel({detail,locale,busy,onAction}:{detail:TournamentDetail;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const moveCategory=(category:TournamentCategory,direction:"up"|"down")=>
    onAction(()=>api(`/api/admin/categories/${category.id}/order`,{method:"POST",body:JSON.stringify({direction})}));
  return <section className="workspace-stack">
    {detail.categories.length>1&&<div className="panel category-order-panel">
      <div className="panel-title"><div><h2>{copy(locale,"Jornadas y orden","Days & order")}</h2><p className="muted">{copy(locale,"Las categorías del mismo día se juegan en este orden. HUAU recalcula el cronograma sin tocar grupos ni resultados.","Categories on the same day play in this order. HUAU recalculates the schedule without changing groups or results.")}</p></div></div>
      <div className="category-order-list">
        {detail.categories.map((category,index)=><div className="category-order-row" key={category.id}>
          <b>{index+1}</b><div><strong>{category.name}</strong><span>{category.scheduledDate||copy(locale,"Sin fecha","No date")}</span></div>
          <div className="order-buttons"><button className="ghost small" disabled={busy||index===0} onClick={()=>void moveCategory(category,"up")}>↑</button><button className="ghost small" disabled={busy||index===detail.categories.length-1} onClick={()=>void moveCategory(category,"down")}>↓</button></div>
        </div>)}
      </div>
    </div>}
    {detail.categories.length===0?<div className="empty-state">{copy(locale,"Primero creá una categoría.","Create a category first.")}</div>:detail.categories.map(category=><FormatCard key={category.id} detail={detail} category={category} locale={locale} busy={busy} onAction={onAction}/>)}
  </section>;
}

function FormatCard({detail,category,locale,busy,onAction}:{detail:TournamentDetail;category:TournamentCategory;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const entries=detail.entries.filter(entry=>entry.categoryId===category.id);
  const groups=detail.groups.filter(group=>group.categoryId===category.id);
  const grouped=useMemo(()=>{const map=new Map<string,{name:string;entries:string[]}>();groups.forEach(row=>{const item=map.get(row.id)??{name:row.name,entries:[]};if(row.entryName)item.entries.push(row.entryName);map.set(row.id,item)});return [...map.values()]},[groups]);
  const saved=storedFormat(category);
  const prelim=saved.preliminary??DEFAULT_STANDARD_FORMAT.preliminary;
  const medal=saved.medal??DEFAULT_STANDARD_FORMAT.medal;
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const payload={
      groupCount:Number(form.get("groupCount")),
      scheduledDate:form.get("scheduledDate"),
      dailyStart:form.get("dailyStart"),
      matchMinutes:Number(form.get("matchMinutes")),
      format:{
        groupRounds:Number(form.get("groupRounds"))===2?2:1,
        qualifiersPerGroup:Number(form.get("qualifiersPerGroup")),
        wildcardQualifiers:Number(form.get("wildcardQualifiers")),
        crossGroupMethod:form.get("crossGroupMethod"),
        playoffMode:form.get("playoffMode"),
        consolationMode:form.get("consolationMode"),
        avoidGroupRematches:form.get("avoidGroupRematches")==="yes",
        bronzeMatch:form.get("bronzeMatch")==="yes",
        medalSchedule:form.get("medalSchedule"),
        finalDrawMethod:form.get("finalDrawMethod"),
        preliminary:{bestOf:1,pointTarget:Number(form.get("preliminaryTarget"))},
        medal:{bestOf:Number(form.get("medalBestOf"))===3?3:1,pointTarget:Number(form.get("medalTarget"))},
        preferredRestSlots:Number(form.get("preferredRestSlots")),
      },
      confirmImpact:false,
    };
    const run=(confirmImpact:boolean)=>api(`/api/admin/categories/${category.id}/generate`,{method:"POST",body:JSON.stringify({...payload,confirmImpact})});
    if(category.structureLocked){
      const accepted=window.confirm(copy(locale,"Esto reemplazará el sorteo y cronograma de esta categoría. HUAU creará un snapshot automático antes de regenerar. ¿Continuar?","This will replace this category draw and schedule. HUAU will create an automatic snapshot before regenerating. Continue?"));
      if(!accepted)return;
      payload.confirmImpact=true;
    }
    await onAction(()=>run(payload.confirmImpact));
  };
  return <article className="format-card">
    <header><div><span className="eyebrow">{copy(locale,"Formato estándar","Standard format")}</span><h2>{category.name}</h2><p>{entries.length} {copy(locale,"entradas","entries")} · {grouped.length?`${grouped.length} ${copy(locale,"grupos generados","generated groups")}`:copy(locale,"sin sorteo","no draw")}</p></div>{category.structureLocked&&<span className="lock-chip is-locked">{copy(locale,"Bloqueado","Locked")}</span>}</header>
    <form className="format-builder" onSubmit={submit}>
      <div className="format-simple">
        <div className="two"><Field name="groupCount" label={copy(locale,"Cantidad de grupos","Number of groups")} type="number" defaultValue={String(saved.groupCount ?? (recommendedGroupCount(entries.length) || 1))}/><Field name="scheduledDate" label={copy(locale,"Fecha de categoría","Category date")} type="date" defaultValue={category.scheduledDate||isoDate(detail.tournament.startAt)}/></div>
        <div className="three"><label><span>{copy(locale,"Vueltas","Legs")}</span><select name="groupRounds" defaultValue={String(saved.groupRounds??DEFAULT_STANDARD_FORMAT.groupRounds)}><option value="1">1</option><option value="2">2</option></select></label><Field name="qualifiersPerGroup" label={copy(locale,"Clasificados/grupo","Qualifiers/group")} type="number" defaultValue={String(saved.qualifiersPerGroup??2)}/><Field name="wildcardQualifiers" label="Wildcards" type="number" defaultValue={String(saved.wildcardQualifiers??0)}/></div>
        <div className="three"><Field name="matchMinutes" label={copy(locale,"Min/partido","Min/match")} type="number" defaultValue={String(saved.matchMinutes??15)}/><Field name="dailyStart" label={copy(locale,"Hora de inicio","Start time")} type="time" defaultValue={saved.dailyStart??"09:00"}/><Field name="preliminaryTarget" label={copy(locale,"Puntos fase grupos","Group target")} type="number" defaultValue={String(prelim.pointTarget??15)}/></div>
      </div>
      <details className="advanced-format" open={Boolean(category.formatVersionId)}>
        <summary>{copy(locale,"Opciones avanzadas","Advanced options")}</summary>
        <div className="advanced-grid">
          <label><span>{copy(locale,"Comparación entre grupos","Cross-group comparison")}</span><select name="crossGroupMethod" defaultValue={saved.crossGroupMethod??"normalized"}><option value="normalized">{copy(locale,"Normalizada","Normalized")}</option><option value="equalized">{copy(locale,"Equiparada","Equalized")}</option></select></label>
          <label><span>{copy(locale,"Fase posterior","Post-group phase")}</span><select name="playoffMode" defaultValue={saved.playoffMode??"standard"}><option value="standard">{copy(locale,"Cuadro estándar","Standard bracket")}</option><option value="top2_final">Top 2 → Final</option><option value="top3_step">Top 3 step</option><option value="top4_semis">Top 4 → Semis</option><option value="league_only">{copy(locale,"Campeón por tabla","League only")}</option></select></label>
          <label><span>{copy(locale,"Cuadro consuelo","Consolation")}</span><select name="consolationMode" defaultValue={saved.consolationMode??"none"}><option value="none">{copy(locale,"Sin consuelo","None")}</option><option value="knockout">{copy(locale,"Eliminación directa","Knockout")}</option></select></label>
          <label><span>{copy(locale,"Cruce de fase final","Final draw")}</span><select name="finalDrawMethod" defaultValue={saved.finalDrawMethod??"performance"}><option value="performance">{copy(locale,"Por rendimiento","Performance")}</option><option value="pots">{copy(locale,"Sorteo por bombos","Pots")}</option></select></label>
          <label><span>{copy(locale,"Revancha inmediata","Immediate rematch")}</span><select name="avoidGroupRematches" defaultValue={(saved.avoidGroupRematches??true)?"yes":"no"}><option value="yes">{copy(locale,"Evitar cuando sea posible","Avoid when possible")}</option><option value="no">{copy(locale,"Permitir","Allow")}</option></select></label>
          <label><span>{copy(locale,"Descanso preferido","Preferred rest")}</span><select name="preferredRestSlots" defaultValue={String(saved.preferredRestSlots??1)}><option value="0">0</option><option value="1">1 {copy(locale,"bloque","slot")}</option><option value="2">2 {copy(locale,"bloques","slots")}</option></select></label>
          <label><span>{copy(locale,"Partido por bronce","Bronze match")}</span><select name="bronzeMatch" defaultValue={(saved.bronzeMatch??true)?"yes":"no"}><option value="yes">{copy(locale,"Sí","Yes")}</option><option value="no">No</option></select></label>
          <label><span>{copy(locale,"Orden de medallas","Medal scheduling")}</span><select name="medalSchedule" defaultValue={saved.medalSchedule??"sequential"}><option value="sequential">{copy(locale,"Bronce y luego final","Bronze then final")}</option><option value="simultaneous">{copy(locale,"Simultáneos","Simultaneous")}</option></select></label>
          <label><span>BO final / bronce</span><select name="medalBestOf" defaultValue={String(medal.bestOf??3)}><option value="1">BO1</option><option value="3">BO3</option></select></label>
          <Field name="medalTarget" label={copy(locale,"Puntos medallas","Medal target")} type="number" defaultValue={String(medal.pointTarget??11)}/>
        </div>
      </details>
      <button className="light" disabled={busy||entries.length<2}>{category.structureLocked?copy(locale,"Regenerar con snapshot","Regenerate with snapshot"):copy(locale,"Generar grupos y cronograma","Generate groups & schedule")}</button>
    </form>
    {grouped.length>0&&<div className="group-preview">{grouped.map(group=><div key={group.name}><strong>{copy(locale,"Grupo","Group")} {group.name}</strong>{group.entries.map(entry=><span key={entry}>{entry}</span>)}</div>)}</div>}
  </article>;
}

function SchedulePanel({detail,locale}:{detail:TournamentDetail;locale:Locale}) {
  return <section className="panel schedule-panel"><div className="panel-title"><h2>{copy(locale,"Cronograma","Schedule")}</h2><span>{detail.schedule.length}</span></div>{detail.schedule.length?<div className="schedule-table">{detail.schedule.map(item=><div className={item.status==="reserved"?"reserved":""} key={item.id}><time>{displayDateTime(item.startAt)}</time><strong>{item.courtLabel}</strong><span>{item.categoryName}</span><span>{item.roundLabel||item.stage}</span><em>{item.status==="reserved"?copy(locale,"Reserva de fase","Phase slot"):copy(locale,"Partido","Match")}</em></div>)}</div>:<div className="empty-state">{copy(locale,"El cronograma aparece después de generar al menos una categoría.","The schedule appears after generating at least one category.")}</div>}</section>;
}

type MatchResultPayload = { scoreA: number; scoreB: number } | { sets: Array<{ scoreA: number; scoreB: number }> };

async function saveResult(match:TournamentMatchRow,payload:MatchResultPayload) {
  if(!match.matchId)throw new Error("MATCH_NOT_BOUND");
  if(!match.sideA||!match.sideB)throw new Error("ENCOUNTER_NOT_READY");
  return api(`/api/admin/matches/${match.matchId}/result`,{method:"POST",body:JSON.stringify(payload)});
}

function ResultEntry({match,locale,busy,onSave}:{match:TournamentMatchRow;locale:Locale;busy:boolean;onSave:(match:TournamentMatchRow,payload:MatchResultPayload)=>Promise<void>}) {
  const [scoreA,setScoreA]=useState(match.scoreA===null?"":String(match.scoreA));
  const [scoreB,setScoreB]=useState(match.scoreB===null?"":String(match.scoreB));
  const [showSets,setShowSets]=useState(false);
  const [sets,setSets]=useState<Array<{a:string;b:string}>>([{a:"",b:""},{a:"",b:""},{a:"",b:""}]);
  const [localError,setLocalError]=useState("");
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setLocalError("");
    if(match.bestOf===3){
      const completed=sets.filter(set=>set.a!==""||set.b!=="");
      if(completed.length<2||completed.some(set=>set.a===""||set.b==="")){setLocalError(copy(locale,"Ingresá al menos dos sets completos.","Enter at least two complete sets."));return;}
      const payload={sets:completed.map(set=>({scoreA:Number(set.a),scoreB:Number(set.b)}))};
      if(payload.sets.some(set=>!Number.isFinite(set.scoreA)||!Number.isFinite(set.scoreB))){setLocalError(copy(locale,"Revisá los puntajes.","Check the scores."));return;}
      await onSave(match,payload);setShowSets(false);return;
    }
    const a=Number(scoreA),b=Number(scoreB);
    if(scoreA===""||scoreB===""||!Number.isFinite(a)||!Number.isFinite(b)){setLocalError(copy(locale,"Ingresá ambos puntajes.","Enter both scores."));return;}
    await onSave(match,{scoreA:a,scoreB:b});
  };
  return <form className={`result-row ${match.status==="finished"?"is-finished":""}`} onSubmit={submit}><div className="result-context"><span>{match.categoryName}</span><small>{match.groupName?`${copy(locale,"Grupo","Group")} ${match.groupName}`:match.roundLabel||match.stage}{match.legNumber>1?` · V${match.legNumber}`:""}</small></div><div className="result-inline"><strong>{match.sideA}</strong>{match.bestOf===3?<button className="score-summary" type="button" onClick={()=>setShowSets(value=>!value)}>{match.scoreA!==null&&match.scoreB!==null?`${match.scoreA} — ${match.scoreB}`:copy(locale,"Cargar sets","Enter sets")}</button>:<div className="score-inputs"><input aria-label={`${match.sideA} score`} inputMode="numeric" min="0" type="number" value={scoreA} onChange={event=>setScoreA(event.target.value)}/><span>—</span><input aria-label={`${match.sideB} score`} inputMode="numeric" min="0" type="number" value={scoreB} onChange={event=>setScoreB(event.target.value)}/></div>}<strong>{match.sideB}</strong></div><button className={match.status==="finished"?"ghost small":"light small"} disabled={busy} type="submit">{busy?"…":match.status==="finished"?copy(locale,"Guardar corrección","Save correction"):copy(locale,"Guardar","Save")}</button>{match.bestOf===3&&showSets?<div className="set-editor"><div className="set-editor-head"><span>{match.sideA}</span><b>{copy(locale,"Sets","Sets")}</b><span>{match.sideB}</span></div>{sets.map((set,index)=><div className="set-score-row" key={index}><strong>{index+1}</strong><input aria-label={`Set ${index+1} ${match.sideA}`} inputMode="numeric" min="0" type="number" value={set.a} onChange={event=>setSets(current=>current.map((item,i)=>i===index?{...item,a:event.target.value}:item))}/><span>—</span><input aria-label={`Set ${index+1} ${match.sideB}`} inputMode="numeric" min="0" type="number" value={set.b} onChange={event=>setSets(current=>current.map((item,i)=>i===index?{...item,b:event.target.value}:item))}/></div>)}</div>:null}{localError?<p className="result-error">{localError}</p>:null}</form>;
}

function ResultsPanel({detail,locale,busy,onSave}:{detail:TournamentDetail;locale:Locale;busy:boolean;onSave:(match:TournamentMatchRow,payload:MatchResultPayload)=>Promise<void>}) {
  const playable=detail.matches.filter(match=>match.matchId&&match.sideA&&match.sideB&&match.status!=="bye");
  return <section className="panel results-panel"><div className="panel-title"><h2>{copy(locale,"Resultados","Results")}</h2><span>{playable.filter(m=>m.status==="finished").length}/{playable.length}</span></div>{playable.length?<div className="results-list">{playable.map(match=><ResultEntry key={match.encounterId} match={match} locale={locale} busy={busy} onSave={onSave}/>)}</div>:<div className="empty-state">{copy(locale,"Todavía no hay partidos generados.","No generated matches yet.")}</div>}</section>;
}

function FinalsPanel({detail,locale,busy,onAction}:{detail:TournamentDetail;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  return <section className="workspace-stack">{detail.categories.map(category=>{const groupComplete=Number(category.groupMatchCount)>0&&Number(category.finishedGroupMatchCount)===Number(category.groupMatchCount);const finals=detail.matches.filter(match=>match.categoryId===category.id&&match.stage!=="group");return <article className="panel" key={category.id}><div className="panel-title"><h2>{category.name}</h2><span>{finals.length}</span></div>{finals.length?<div className="final-bracket-list">{finals.map(match=><div key={match.encounterId}><span>{match.roundLabel||match.stage}</span><strong>{match.sideA||copy(locale,"Por definir","TBD")} <em>vs</em> {match.sideB||copy(locale,"Por definir","TBD")}</strong><small>{match.status}</small></div>)}</div>:<><p className="muted">{groupComplete?copy(locale,"La fase de grupos terminó. Ya podés fijar la llave final.","Group stage is complete. You can now lock the final bracket."):copy(locale,"Completá todos los resultados de grupo para generar la fase final.","Complete every group result to generate the final phase.")}</p><button className="light small" disabled={busy||!groupComplete} onClick={()=>void onAction(()=>api(`/api/admin/categories/${category.id}/finals`,{method:"POST",body:"{}"}))}>{copy(locale,"Generar fase final","Generate final phase")}</button></>}</article>})}</section>;
}

function PublishPanel({detail,locale,busy,onAction}:{detail:TournamentDetail;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const update=(payload:unknown)=>onAction(()=>api(`/api/admin/tournaments/${detail.tournament.id}`,{method:"PUT",body:JSON.stringify(payload)}));
  return <section className="workspace-grid"><div className="panel wide"><h2>{copy(locale,"Estado del torneo","Tournament status")}</h2><p className="muted">{copy(locale,"Phase 4 controla qué está listo para operar. La página pública/live completa llega en Phase 9.","Phase 4 controls what is ready to operate. The complete public/live page arrives in Phase 9.")}</p><div className="status-actions">{["draft","registration_open","registration_closed","scheduled","live","completed"].map(status=><button key={status} className={detail.tournament.status===status?"light small":"ghost small"} disabled={busy} onClick={()=>void update({status})}>{status.replaceAll("_"," ")}</button>)}</div></div><div className="panel"><h2>{copy(locale,"Visibilidad live","Live visibility")}</h2><div className="toggle-row"><span>{copy(locale,"Datos públicos","Public data")}</span><button className={detail.tournament.publicParticipants?"light small":"ghost small"} onClick={()=>void update({publicParticipants:!detail.tournament.publicParticipants})}>{detail.tournament.publicParticipants?"ON":"OFF"}</button></div><div className="toggle-row"><span>Live</span><button className={detail.tournament.publicLive?"light small":"ghost small"} onClick={()=>void update({publicLive:!detail.tournament.publicLive})}>{detail.tournament.publicLive?"ON":"OFF"}</button></div></div></section>;
}

function RecoveryPanel({detail,locale,busy,onAction}:{detail:TournamentDetail;locale:Locale;busy:boolean;onAction:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const restore=async(snapshot:TournamentSnapshotRow)=>{const accepted=window.confirm(copy(locale,`Restaurar ${snapshot.categoryName||"categoría"} al snapshot “${snapshot.reason}”? HUAU guardará primero un snapshot del estado actual.`,`Restore ${snapshot.categoryName||"category"} to snapshot “${snapshot.reason}”? HUAU will first save a snapshot of the current state.`));if(!accepted)return;await onAction(()=>api(`/api/admin/tournament-snapshots/${snapshot.id}/restore`,{method:"POST",body:"{}"}));};
  return <section className="panel"><div className="panel-title"><h2>{copy(locale,"Snapshots y recuperación","Snapshots & recovery")}</h2><span>{detail.snapshots.length}</span></div><p className="muted">{copy(locale,"HUAU crea snapshots automáticos antes de regenerar estructura, cambiar participantes bloqueados o restaurar un estado anterior.","HUAU creates automatic snapshots before regenerating structure, changing locked participants or restoring a previous state.")}</p>{detail.snapshots.length?<div className="snapshot-list">{detail.snapshots.map(snapshot=><article key={snapshot.id}><div><strong>{snapshot.categoryName||copy(locale,"Torneo","Tournament")}</strong><span>{snapshot.reason}</span><small>{displayDateTime(snapshot.createdAt)} · rev. {snapshot.revision}</small></div><button className="ghost small" disabled={busy} onClick={()=>void restore(snapshot)}>{copy(locale,"Restaurar","Restore")}</button></article>)}</div>:<div className="empty-state">{copy(locale,"Todavía no hay snapshots.","No snapshots yet.")}</div>}</section>;
}

function PlatformAdmin({locale,go,refreshMe}:{locale:Locale;go:(p:string)=>void;refreshMe:()=>Promise<void>}) {
  const [message,setMessage]=useState("");
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await api<{organization:{slug:string}}>("/api/platform/organizations",{method:"POST",body:JSON.stringify({name:f.get("name"),slug:f.get("slug"),type:f.get("type"),description:f.get("description")})});setMessage("OK");await refreshMe();go(`/organizations/${r.organization.slug}`);}catch(err){setMessage(err instanceof Error?err.message:"error")}};
  return <Shell locale={locale} go={go}><main className="dashboard"><section className="dashboard-head"><div><div className="eyebrow">HUAU</div><h1>{t(locale,"platform")}</h1></div></section><section className="panel form-panel"><h2>{t(locale,"createOrganization")}</h2><form onSubmit={submit}><Field name="name" label={t(locale,"organizationName")}/><Field name="slug" label={t(locale,"organizationSlug")} required={false}/><label><span>{t(locale,"organizationType")}</span><select name="type" defaultValue="club"><option value="club">Club</option><option value="sports_complex">Sports complex</option><option value="community">Community</option><option value="academy">Academy</option><option value="organizer">Organizer</option><option value="league">League</option><option value="federation">Federation</option></select></label><label><span>{t(locale,"description")}</span><textarea name="description" rows={4}/></label><button className="light">{t(locale,"create")}</button>{message&&<p>{message}</p>}</form></section></main></Shell>;
}

function Field({name,label,type="text",required=true,defaultValue}:{name:string;label:string;type?:string;required?:boolean;defaultValue?:string}) { return <label><span>{label}</span><input name={name} type={type} required={required} defaultValue={defaultValue} min={type==="number"?"0":undefined} minLength={type==="password"?8:undefined}/></label>; }
function LocaleToggle({locale,setLocale}:{locale:Locale;setLocale:(l:Locale)=>void}) { return <div className="locale-toggle"><button className={locale==="es"?"active":""} onClick={()=>setLocale("es")}>ES</button><button className={locale==="en"?"active":""} onClick={()=>setLocale("en")}>EN</button></div>; }
function LoadingScreen(){ return <main className="loading-screen"><div className="brand center"><strong>HUAU</strong><span>SPORTS</span></div></main>; }
