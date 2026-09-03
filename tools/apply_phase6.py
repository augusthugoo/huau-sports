#!/usr/bin/env python3
from pathlib import Path
import re, sys
ROOT=Path.cwd()

def load(path):
    p=ROOT/path
    if not p.exists(): raise SystemExit(f"Missing expected file: {path}")
    return p,p.read_text()

def save(p,s): p.write_text(s)

def once(s,old,new,label):
    if new in s: return s
    if old not in s: raise SystemExit(f"Phase 6 patch anchor not found: {label}")
    return s.replace(old,new,1)

# Version metadata
for path in ["package.json","apps/web/package.json","apps/web/wrangler.jsonc"]:
    p,s=load(path)
    s=re.sub(r'0\.6\.[0-9]+-phase5[^"\s]*','0.7.0-phase6-online-registration',s)
    save(p,s)
p,s=load("packages/core/src/index.ts")
s=re.sub(r'export const HUAU_FOUNDATION_VERSION = "[^"]+";', 'export const HUAU_FOUNDATION_VERSION = "0.7.0-phase6-online-registration";', s)
save(p,s)
p,s=load("packages/core/src/index.test.ts")
s=once(s,'version: "0.6.0-phase5-team-engine",', 'version: "0.7.0-phase6-online-registration",', 'foundation identity test version')
save(p,s)

# App routes and player-facing screens
p,s=load("apps/web/src/App.tsx")
s=once(s,'import { TournamentParityWorkspace } from "./TournamentParityWorkspace";','import { TournamentParityWorkspace } from "./TournamentParityWorkspace";\nimport { MyTournamentRegistrations, PublicTournamentRegistration } from "./TournamentRegistration";','App import')
anchor='''  if (path === "/recover" && !session?.user) return <RecoveryScreen locale={locale} go={go} />;\n\n  if (path.startsWith("/organizations/")) {'''
insert='''  if (path === "/recover" && !session?.user) return <RecoveryScreen locale={locale} go={go} />;\n\n  const publicTournamentRoute = path.match(/^\\/tournaments\\/([^/]+)$/);\n  if (publicTournamentRoute) return <PublicTournamentRegistration slug={decodeURIComponent(publicTournamentRoute[1]!)} locale={locale} go={go} />;\n\n  if (path.startsWith("/organizations/")) {'''
s=once(s,anchor,insert,'public tournament route')
anchor='''  const tournamentWorkspace = path.match(/^\\/admin\\/organizations\\/([^/]+)\\/tournaments\\/([^/]+)$/);'''
insert='''  if (path === "/app/registrations") return <Shell locale={locale} go={go} me={me}><MyTournamentRegistrations locale={locale} go={go} /></Shell>;\n\n  const tournamentWorkspace = path.match(/^\\/admin\\/organizations\\/([^/]+)\\/tournaments\\/([^/]+)$/);'''
s=once(s,anchor,insert,'my registrations route')
old='''      await onDone(); go("/app");'''
new='''      await onDone(); const next=sessionStorage.getItem("huau.afterAuth"); if(next)sessionStorage.removeItem("huau.afterAuth"); go(next||"/app");'''
s=once(s,old,new,'auth return path')
old='''<div className="eyebrow">{t(locale,"myHuau")}</div><h1>{me?.profile?.firstName ? `${me.profile.firstName}, tu deporte empieza acá.` : "Tu deporte empieza acá."}</h1></div><LocaleToggle locale={locale} setLocale={setLocale}/>'''
new='''<div className="eyebrow">{t(locale,"myHuau")}</div><h1>{me?.profile?.firstName ? `${me.profile.firstName}, tu deporte empieza acá.` : "Tu deporte empieza acá."}</h1></div><div className="dashboard-head-actions"><button className="ghost" onClick={()=>go("/app/registrations")}>{copy(locale,"Mis inscripciones","My registrations")}</button><LocaleToggle locale={locale} setLocale={setLocale}/></div>'''
s=once(s,old,new,'My HUAU registration link')
save(p,s)

# Tournament workspace admin tab + category registration controls
p,s=load("apps/web/src/TournamentParityWorkspace.tsx")
if 'import { TournamentRegistrationAdmin } from "./TournamentRegistration";' not in s:
    lines=s.splitlines()
    idx=next((i for i,line in enumerate(lines) if line.startswith('import {') and 'TeamTournamentPanel' in line and 'from "./TeamTournamentPanel";' in line), None)
    if idx is None: raise SystemExit('Phase 6 patch anchor not found: workspace import')
    lines.insert(idx+1, 'import { TournamentRegistrationAdmin } from "./TournamentRegistration";')
    s="\n".join(lines)+("\n" if s.endswith("\n") else "")
s=s.replace('"overview"|"players"|"categories"|"teams"','"overview"|"players"|"categories"|"registrations"|"teams"',1) if '"registrations"' not in s.split('type Tab',1)[1].split(';',1)[0] else s
# category type
pattern=r'type Category = \{id:string;name:string;entryType:"individual"\|"pair"\|"team";competitionGender:string\|null;scheduledDate:string\|null;sortOrder:number;structureLocked:number;formatVersionId:string\|null;entryCount:number;competitionStatus:string\|null;groupMatchCount:number;finishedGroupMatchCount:number;finalMatchCount:number;configJson:string\|null\};'
replacement='type Category = {id:string;name:string;entryType:"individual"|"pair"|"team";competitionGender:string|null;minAge:number|null;maxAge:number|null;maxEntries:number|null;registrationStatus:"closed"|"open"|"waitlist_only";priceScope:"free"|"per_entry"|"per_person";priceMinor:number|null;currency:string|null;scheduledDate:string|null;sortOrder:number;structureLocked:number;formatVersionId:string|null;entryCount:number;competitionStatus:string|null;groupMatchCount:number;finishedGroupMatchCount:number;finalMatchCount:number;configJson:string|null};'
if 'minAge:number|null' not in s:
    s,n=re.subn(pattern,replacement,s,count=1)
    if n!=1: raise SystemExit('Phase 6 patch anchor not found: Category type')
# tabs
if '["registrations"' not in s:
    s=s.replace('["categories",text(locale,"Categorías","Categories")],','["categories",text(locale,"Categorías","Categories")],["registrations",text(locale,"Inscripciones","Registrations")],',1)
# render
if 'tab==="registrations"' not in s:
    render_anchor='{tab==="categories"&&<Categories detail={detail} locale={locale} busy={busy} act={act}/>}'
    if render_anchor not in s:
        raise SystemExit('Phase 6 patch anchor not found: registrations render')
    s=s.replace(render_anchor, render_anchor+'\n    {tab==="registrations"&&<TournamentRegistrationAdmin tournamentId={detail.tournament.id} locale={locale}/>} ',1)
# Replace CategoryCard function as one logical block
start=s.find('function CategoryCard(');end=s.find('\nfunction Formats(',start)
if start<0 or end<0: raise SystemExit('Phase 6 patch anchor not found: CategoryCard')
if 'ONLINE REGISTRATION' not in s[start:end]:
    new_func='''function CategoryCard({category,index,detail,locale,busy,act}:{category:Category;index:number;detail:Detail;locale:Locale;busy:boolean;act:ActionRunner}){const issues=category.entryType==="pair"?pairIssues(detail,category):[];const assigned=detail.playerCategories.filter(a=>a.categoryId===category.id).length;const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);await act(()=>withImpactMethod(locale,`/api/admin/categories/${category.id}`,"PUT",{name:f.get("name"),entryType:f.get("entryType"),competitionGender:f.get("competitionGender"),scheduledDate:f.get("scheduledDate")||null,minAge:f.get("minAge")?Number(f.get("minAge")):null,maxAge:f.get("maxAge")?Number(f.get("maxAge")):null,maxEntries:f.get("maxEntries")?Number(f.get("maxEntries")):null,registrationStatus:f.get("registrationStatus"),priceScope:f.get("priceScope"),priceMinor:f.get("priceScope")==="free"?null:Math.round(Number(f.get("price")||0)*100),currency:String(f.get("currency")||"UYU")}));};const move=(direction:"up"|"down")=>act(()=>request(`/api/admin/categories/${category.id}/order`,{method:"POST",body:JSON.stringify({direction})}));return <article className="category-card"><header><div><span className="pill">{index+1}</span><strong>{category.name}</strong><small>{assigned} {text(locale,"jugadores asignados","assigned players")} · {category.entryCount} {text(locale,"entradas válidas","valid entries")}</small></div><div className="order-buttons"><button disabled={busy||index===0} onClick={()=>void move("up")}>↑</button><button disabled={busy||index===detail.categories.length-1} onClick={()=>void move("down")}>↓</button></div></header>{issues.length>0&&<p className="warning-line">{issues.length} {text(locale,"jugadores sin pareja recíproca; no entrarán al sorteo.","players without reciprocal partner; they will not enter the draw.")}</p>}<details><summary>{text(locale,"Editar categoría","Edit category")}</summary><form className="tpw-form" onSubmit={save}><div className="four"><Field n="name" l={text(locale,"Nombre","Name")} value={category.name} required/><Select n="entryType" l={text(locale,"Modalidad","Mode")} value={category.entryType} options={category.entryType==="team"?[["team",text(locale,"Equipo","Team")]]:[["individual",text(locale,"Individual","Individual")],["pair",text(locale,"Pareja","Pair")]]}/><Select n="competitionGender" l={text(locale,"Género","Gender")} value={category.competitionGender||"open"} options={[["open","Open"],["male",text(locale,"Masculino","Male")],["female",text(locale,"Femenino","Female")],["mixed",text(locale,"Mixto","Mixed")]]}/><Field n="scheduledDate" l={text(locale,"Jornada","Day")} type="date" value={category.scheduledDate||iso(detail.tournament.startAt)}/></div><div className="registration-category-settings"><div className="eyebrow">ONLINE REGISTRATION</div><div className="four"><Select n="registrationStatus" l={text(locale,"Inscripción","Registration")} value={category.registrationStatus||"closed"} options={[["closed",text(locale,"Cerrada","Closed")],["open",text(locale,"Abierta","Open")],["waitlist_only","Waitlist only"]]}/><Field n="maxEntries" l={text(locale,"Cupo (vacío = sin límite)","Capacity (blank = unlimited)")} type="number" value={category.maxEntries===null?"":String(category.maxEntries)}/><Field n="minAge" l={text(locale,"Edad mínima","Minimum age")} type="number" value={category.minAge===null?"":String(category.minAge)}/><Field n="maxAge" l={text(locale,"Edad máxima","Maximum age")} type="number" value={category.maxAge===null?"":String(category.maxAge)}/></div><div className="three"><Select n="priceScope" l={text(locale,"Precio","Price")} value={category.priceScope||"free"} options={[["free",text(locale,"Gratis","Free")],["per_entry",text(locale,"Por inscripción","Per entry")],["per_person",text(locale,"Por persona","Per person")]]}/><Field n="price" l={text(locale,"Importe","Amount")} type="number" step="1" value={category.priceMinor===null?"":String(category.priceMinor/100)}/><Field n="currency" l={text(locale,"Moneda","Currency")} value={category.currency||"UYU"}/></div><p className="muted">{text(locale,"Para +40 / +50 / +60 usá Edad mínima explícita. HUAU calcula la edad a la fecha de inicio del torneo.","For +40 / +50 / +60 use an explicit minimum age. HUAU calculates age at tournament start.")}</p></div><div className="form-actions"><button className="light small" disabled={busy}>{text(locale,"Guardar","Save")}</button><button className="danger small" type="button" disabled={busy} onClick={()=>{if(window.confirm(text(locale,"¿Eliminar esta categoría?","Delete this category?")))void act(()=>withImpactMethod(locale,`/api/admin/categories/${category.id}`,"DELETE",{}));}}>{text(locale,"Eliminar","Delete")}</button></div></form></details></article>}'''
    s=s[:start]+new_func+s[end:]
save(p,s)

# Tournament admin: category settings + Phase 6 snapshots
p,s=load("apps/web/src/worker/tournament-admin.ts")
# CategoryRow fields
if 'minAge: number | null;' not in s[:s.find('type TournamentRow')]:
    s=s.replace('''  competitionGender: "male" | "female" | "mixed" | "open" | null;\n  scheduledDate: string | null;''','''  competitionGender: "male" | "female" | "mixed" | "open" | null;\n  minAge: number | null;\n  maxAge: number | null;\n  maxEntries: number | null;\n  registrationStatus: "closed" | "open" | "waitlist_only";\n  priceScope: "free" | "per_entry" | "per_person";\n  priceMinor: number | null;\n  currency: string | null;\n  scheduledDate: string | null;''',1)
# generic category access SELECTs: add fields after competitionGender where alias shape used
s=s.replace('''competition_gender as competitionGender,\n            scheduled_date as scheduledDate''','''competition_gender as competitionGender,min_age as minAge,max_age as maxAge,max_entries as maxEntries,registration_status as registrationStatus,price_scope as priceScope,price_minor as priceMinor,currency,\n            scheduled_date as scheduledDate''')
s=s.replace('''tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.scheduled_date as scheduledDate,''','''tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.min_age as minAge,tc.max_age as maxAge,tc.max_entries as maxEntries,tc.registration_status as registrationStatus,tc.price_scope as priceScope,tc.price_minor as priceMinor,tc.currency,tc.scheduled_date as scheduledDate,''')
# category PUT body
old='''const body: {name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;confirmImpact?:boolean} = await readJson<{name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;confirmImpact?:boolean}>(request).catch(()=>({}));'''
new='''const body: {name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;minAge?:number|null;maxAge?:number|null;maxEntries?:number|null;registrationStatus?:"closed"|"open"|"waitlist_only";priceScope?:"free"|"per_entry"|"per_person";priceMinor?:number|null;currency?:string|null;confirmImpact?:boolean} = await readJson<{name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;minAge?:number|null;maxAge?:number|null;maxEntries?:number|null;registrationStatus?:"closed"|"open"|"waitlist_only";priceScope?:"free"|"per_entry"|"per_person";priceMinor?:number|null;currency?:string|null;confirmImpact?:boolean}>(request).catch(()=>({}));'''
if old in s:s=s.replace(old,new,1)
old_update='''await env.HUAU_DB.prepare(`UPDATE tournament_categories SET name=COALESCE(?,name),entry_type=?,competition_gender=?,scheduled_date=?,updated_at=?,version=version+1 WHERE id=?`).bind(body.name?.trim()||null,nextEntryType,body.competitionGender===undefined?accessResult.category.competitionGender:body.competitionGender,scheduledDate,unixNow(),categoryId).run();'''
new_update='''const minAge=body.minAge===undefined?accessResult.category.minAge:body.minAge; const maxAge=body.maxAge===undefined?accessResult.category.maxAge:body.maxAge; if(minAge!==null&&maxAge!==null&&minAge>maxAge)return json({ok:false,code:"INVALID_AGE_RANGE"},{status:400});\n    await env.HUAU_DB.prepare(`UPDATE tournament_categories SET name=COALESCE(?,name),entry_type=?,competition_gender=?,scheduled_date=?,min_age=?,max_age=?,max_entries=?,registration_status=?,price_scope=?,price_minor=?,currency=?,updated_at=?,version=version+1 WHERE id=?`).bind(body.name?.trim()||null,nextEntryType,body.competitionGender===undefined?accessResult.category.competitionGender:body.competitionGender,scheduledDate,minAge,maxAge,body.maxEntries===undefined?accessResult.category.maxEntries:body.maxEntries,body.registrationStatus??accessResult.category.registrationStatus,body.priceScope??accessResult.category.priceScope,(body.priceScope??accessResult.category.priceScope)==="free"?null:(body.priceMinor===undefined?accessResult.category.priceMinor:body.priceMinor),body.currency===undefined?accessResult.category.currency:body.currency,unixNow(),categoryId).run();'''
if old_update in s:s=s.replace(old_update,new_update,1)
# category create body + insert defaults remains closed/free, support supplied values if API client later
old='''const body = await readJson<{ name?: string; entryType?: string; competitionGender?: string | null; scheduledDate?: string | null }>(request);'''
new='''const body = await readJson<{ name?: string; entryType?: string; competitionGender?: string | null; scheduledDate?: string | null; minAge?:number|null;maxAge?:number|null;maxEntries?:number|null;registrationStatus?:"closed"|"open"|"waitlist_only";priceScope?:"free"|"per_entry"|"per_person";priceMinor?:number|null;currency?:string|null }>(request);'''
if old in s:s=s.replace(old,new,1)
old='''`INSERT INTO tournament_categories (id,tournament_id,name,entry_type,competition_gender,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version)\n       VALUES (?,?,?,?,?,NULL,'closed','free',NULL,'UYU',NULL,?, ?,0,?,?,1)`,\n    ).bind(categoryId,tournamentId,name,body.entryType,body.competitionGender ?? null,body.scheduledDate ?? null,sortRow?.nextSort ?? 0,stamp,stamp).run();'''
new='''`INSERT INTO tournament_categories (id,tournament_id,name,entry_type,competition_gender,min_age,max_age,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version)\n       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?, ?,0,?,?,1)`,\n    ).bind(categoryId,tournamentId,name,body.entryType,body.competitionGender ?? null,body.minAge??null,body.maxAge??null,body.maxEntries??null,body.registrationStatus??"closed",body.priceScope??"free",body.priceScope==="free"?null:(body.priceMinor??null),body.currency??"UYU",body.scheduledDate ?? null,sortRow?.nextSort ?? 0,stamp,stamp).run();'''
if old in s:s=s.replace(old,new,1)
# Snapshot payload types and Promise load
if 'registrations?: SqlRow[];' not in s:
    s=s.replace('''  matchSideMembers?: SqlRow[];\n};''','''  matchSideMembers?: SqlRow[];\n  registrations?: SqlRow[];\n  entryInvitations?: SqlRow[];\n  registrationAdjustments?: SqlRow[];\n};''',1)
# snapshot function array names
if 'registrationAdjustments,' not in s[s.find('async function snapshotCategory'):s.find('async function snapshotCategory')+3000]:
    s=s.replace('''    matchSideMembers,\n  ] = await Promise.all([''','''    matchSideMembers,\n    registrations,\n    entryInvitations,\n    registrationAdjustments,\n  ] = await Promise.all([''',1)
    target='''    env.HUAU_DB.prepare(`SELECT msm.* FROM match_side_members msm JOIN matches m ON m.id=msm.match_id JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id WHERE c.category_id=? ORDER BY msm.match_id,msm.side,msm.position`).bind(category.id).all(),\n  ]);'''
    repl='''    env.HUAU_DB.prepare(`SELECT msm.* FROM match_side_members msm JOIN matches m ON m.id=msm.match_id JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id WHERE c.category_id=? ORDER BY msm.match_id,msm.side,msm.position`).bind(category.id).all(),\n    env.HUAU_DB.prepare(`SELECT * FROM tournament_registrations WHERE category_id=? ORDER BY created_at,id`).bind(category.id).all(),\n    env.HUAU_DB.prepare(`SELECT * FROM entry_invitations WHERE category_id=? ORDER BY created_at,id`).bind(category.id).all(),\n    env.HUAU_DB.prepare(`SELECT ra.* FROM registration_adjustments ra JOIN tournament_registrations tr ON tr.id=ra.registration_id WHERE tr.category_id=? ORDER BY ra.created_at,ra.id`).bind(category.id).all(),\n  ]);'''
    if target in s:s=s.replace(target,repl,1)
    s=s.replace('''    snapshotVersion: 3,''','''    snapshotVersion: 4,''',1)
    s=s.replace('''    matchSideMembers: matchSideMembers.results as SqlRow[],''','''    matchSideMembers: matchSideMembers.results as SqlRow[],\n    registrations: registrations.results as SqlRow[],\n    entryInvitations: entryInvitations.results as SqlRow[],\n    registrationAdjustments: registrationAdjustments.results as SqlRow[],''',1)
# restore: delete current phase6 data before category destructive restore; registrations cascade on category delete, inserts after base entry data. Add generic SQL builder helper already insert row functions are explicit, so append loops before audit using positional columns.
if 'payload.registrations ?? []' not in s:
    marker='''  for (const row of payload.matchSideMembers ?? []) statements.push(env.HUAU_DB.prepare('''
    # don't disturb this loop; insert phase6 loops after its closing vicinity using audit marker
    audit_marker='''  await runBatches(env.HUAU_DB, statements);\n  await audit(env, accessResult.tournament, accessResult.user.id, "snapshot.restore", "Restored category snapshot", "category", snapshot.scopeId, { snapshotId, snapshotVersion: payload.snapshotVersion ?? 1 });'''
    phase6='''  for (const row of payload.registrations ?? []) statements.push(env.HUAU_DB.prepare(`INSERT OR REPLACE INTO tournament_registrations (id,tournament_id,category_id,entry_id,user_id,registration_number,status,participant_count,price_scope,base_amount_minor,discount_minor,final_amount_minor,currency,waitlist_position,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,row.tournament_id,row.category_id,row.entry_id,row.user_id,row.registration_number,row.status,row.participant_count,row.price_scope,row.base_amount_minor,row.discount_minor,row.final_amount_minor,row.currency,row.waitlist_position,row.created_at,row.updated_at,row.version));\n  for (const row of payload.entryInvitations ?? []) statements.push(env.HUAU_DB.prepare(`INSERT OR REPLACE INTO entry_invitations (id,registration_id,entry_id,tournament_id,category_id,inviter_user_id,invitee_email,invitee_user_id,member_role,status,token,expires_at,responded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,row.registration_id,row.entry_id,row.tournament_id,row.category_id,row.inviter_user_id,row.invitee_email,row.invitee_user_id,row.member_role,row.status,row.token,row.expires_at,row.responded_at,row.created_at,row.updated_at));\n  for (const row of payload.registrationAdjustments ?? []) statements.push(env.HUAU_DB.prepare(`INSERT OR REPLACE INTO registration_adjustments (id,registration_id,kind,amount_minor,note,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)`).bind(row.id,row.registration_id,row.kind,row.amount_minor,row.note,row.created_by_user_id,row.created_at));\n  await runBatches(env.HUAU_DB, statements);\n  await audit(env, accessResult.tournament, accessResult.user.id, "snapshot.restore", "Restored category snapshot", "category", snapshot.scopeId, { snapshotId, snapshotVersion: payload.snapshotVersion ?? 1 });'''
    if audit_marker in s:s=s.replace(audit_marker,phase6,1)
save(p,s)


# Worker routing + profile eligibility fields
p,s=load("apps/web/src/worker/index.ts")
s=once(s,'import { handleTeamAdminApi } from "./team-admin";','import { handleTeamAdminApi } from "./team-admin";\nimport { handleRegistrationApi } from "./registration";','worker registration import')
start=s.find('async function handleProfileUpdate('); end=s.find('\nasync function handleOrganizationList', start)
if start<0 or end<0: raise SystemExit('Phase 6 patch anchor not found: profile update handler')
if 'birthDate?: string | null' not in s[start:end]:
    replacement='''async function handleProfileUpdate(request: Request, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const body = await readJson<{ firstName?: string; lastName?: string; phone?: string | null; birthDate?: string | null; sportGender?: string | null; city?: string | null; countryCode?: string | null; preferredLocale?: string }>(request);
  const current = await env.HUAU_DB.prepare(`SELECT first_name as firstName,last_name as lastName,phone,birth_date as birthDate,sport_gender as sportGender,city,country_code as countryCode,preferred_locale as preferredLocale FROM user_profiles WHERE user_id=?`).bind(currentUser.id).first<{firstName:string;lastName:string;phone:string|null;birthDate:string|null;sportGender:string|null;city:string|null;countryCode:string|null;preferredLocale:string}>();
  const firstName = body.firstName?.trim() || current?.firstName || currentUser.name.split(" ")[0] || "Player";
  const lastName = body.lastName?.trim() ?? current?.lastName ?? currentUser.name.split(" ").slice(1).join(" ");
  const sportGender = body.sportGender === undefined ? current?.sportGender ?? null : body.sportGender === "male" || body.sportGender === "female" ? body.sportGender : null;
  const birthDate = body.birthDate === undefined ? current?.birthDate ?? null : body.birthDate || null;
  if (birthDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(birthDate)) return json({ ok:false, code:"INVALID_BIRTH_DATE" }, { status:400 });
  const stamp = now();
  const db = createDb(env.HUAU_DB);
  await db.insert(userProfiles).values({ userId:currentUser.id, firstName, lastName, phone:body.phone===undefined?current?.phone??null:body.phone, birthDate, sportGender, city:body.city===undefined?current?.city??null:body.city, countryCode:body.countryCode===undefined?current?.countryCode??null:body.countryCode, preferredLocale:body.preferredLocale??current?.preferredLocale??"es-UY", createdAt:stamp, updatedAt:stamp }).onConflictDoUpdate({ target:userProfiles.userId, set:{ firstName,lastName,phone:body.phone===undefined?current?.phone??null:body.phone,birthDate,sportGender,city:body.city===undefined?current?.city??null:body.city,countryCode:body.countryCode===undefined?current?.countryCode??null:body.countryCode,preferredLocale:body.preferredLocale??current?.preferredLocale??"es-UY",updatedAt:stamp } });
  return json({ ok: true });
}
'''
    s=s[:start]+replacement+s[end:]
if 'const registrationResponse = await handleRegistrationApi' not in s:
    anchor='''    const teamAdminResponse = await handleTeamAdminApi(request, env, url, {
      requireUser,
      isOrgAdmin,
    });'''
    repl='''    const registrationResponse = await handleRegistrationApi(request, env, { requireUser, isOrgAdmin });
    if (registrationResponse) return registrationResponse;

    const teamAdminResponse = await handleTeamAdminApi(request, env, url, {
      requireUser,
      isOrgAdmin,
    });'''
    s=once(s,anchor,repl,'worker registration routing')
save(p,s)

# Core registration barrel export
p,s=load("packages/core/src/tournament/index.ts")
if 'export * from "./registration";' not in s:
    s=s.rstrip()+"\n\nexport * from \"./registration\";\n"
save(p,s)

# Drizzle schema mirrors migration 0005
p,s=load("packages/db/src/schema.ts")
if 'minAge: integer("min_age")' not in s:
    s=once(s,'    maxEntries: integer("max_entries"),','    maxEntries: integer("max_entries"),\n    minAge: integer("min_age"),\n    maxAge: integer("max_age"),','category age schema')
if 'export const tournamentRegistrations = sqliteTable(' not in s:
    s=s.rstrip()+r'''

// Phase 6: Online Tournament Registration.
export const tournamentRegistrations = sqliteTable(
  "tournament_registrations",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    entryId: text("entry_id").references(() => tournamentEntries.id, { onDelete: "set null" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    registrationNumber: integer("registration_number").notNull(),
    status: text("status", { enum: ["draft","inviting","awaiting_payment","confirmed","waitlisted","cancelled","rejected"] }).notNull(),
    participantCount: integer("participant_count").notNull().default(1),
    priceScope: text("price_scope", { enum: ["free","per_entry","per_person"] }).notNull(),
    baseAmountMinor: integer("base_amount_minor").notNull().default(0),
    discountMinor: integer("discount_minor").notNull().default(0),
    finalAmountMinor: integer("final_amount_minor").notNull().default(0),
    currency: text("currency"),
    waitlistPosition: integer("waitlist_position"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("tournament_registrations_tournament_number_uq").on(table.tournamentId, table.registrationNumber),
    index("tournament_registrations_tournament_idx").on(table.tournamentId, table.status, table.createdAt),
    index("tournament_registrations_category_idx").on(table.categoryId, table.status, table.waitlistPosition),
    index("tournament_registrations_user_idx").on(table.userId, table.status, table.createdAt),
  ],
);

export const entryInvitations = sqliteTable(
  "entry_invitations",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull().references(() => tournamentEntries.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    inviteeEmail: text("invitee_email").notNull(),
    inviteeUserId: text("invitee_user_id").references(() => user.id, { onDelete: "set null" }),
    memberRole: text("member_role", { enum: ["player","captain","substitute"] }).notNull(),
    status: text("status", { enum: ["pending","accepted","declined","cancelled","expired"] }).notNull(),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    respondedAt: integer("responded_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("entry_invitations_email_status_idx").on(table.inviteeEmail, table.status, table.createdAt)],
);

export const registrationAdjustments = sqliteTable(
  "registration_adjustments",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["discount","courtesy","fixed_total"] }).notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    note: text("note"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("registration_adjustments_registration_idx").on(table.registrationId, table.createdAt)],
);
'''+"\n"
save(p,s)

# CSS: append only, never overwrite Phase 5C styling
p,s=load("apps/web/src/styles.css")
marker='/* Phase 6 — Online Registration */'
if marker not in s:
    s += r'''

/* Phase 6 — Online Registration */
.dashboard-head-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.public-tournament-page{min-height:100vh;background:#050505;color:#f1f1ed;padding:0 5vw 70px}.public-tournament-nav{min-height:74px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #242424}.public-tournament-hero{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;padding:54px 0 30px}.public-tournament-hero h1{font-size:clamp(38px,6vw,72px);margin:8px 0}.registration-open-pill{border:1px solid #3b3b36;border-radius:999px;padding:9px 13px;text-transform:uppercase;font-size:11px;letter-spacing:.08em}.public-registration-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.public-category-card,.registration-profile-card{border:1px solid #292929;border-radius:20px;background:#0a0a0a;padding:20px}.public-category-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.public-category-card h2{margin:8px 0}.category-registration-meta{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.category-registration-meta span{background:#151515;border-radius:8px;padding:6px 8px;color:#a9a9a2;font-size:11px}.public-register-form,.registration-profile-card form{display:grid;gap:10px}.registration-profile-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.8fr);gap:24px;margin-bottom:16px}.registration-notice,.registration-alert{border:1px solid #35352f;border-radius:14px;padding:12px 14px;margin:12px 0;background:#10100d}.registration-alert{border-color:#572d2d;background:#170b0b}.registration-list{display:grid;gap:8px}.registration-row{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #242424;border-radius:14px;padding:12px;background:#090909}.registration-row>div,.registration-main{display:grid;gap:4px;text-align:left}.registration-main{flex:1;background:none;border:0;color:inherit}.registration-row small,.registration-admin-row small{display:block;color:#7e7e78}.registration-admin-table{display:grid;gap:4px;overflow-x:auto}.registration-admin-head,.registration-admin-row{display:grid;grid-template-columns:45px minmax(160px,1.3fr) minmax(130px,1fr) 150px 120px minmax(250px,1fr);gap:10px;align-items:center;min-width:900px;padding:10px 8px}.registration-admin-head{color:#777;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.registration-admin-row{border-top:1px solid #222}.registration-category-settings{margin-top:14px;padding-top:14px;border-top:1px solid #252525}.status-confirmed{border-color:#45453f}.status-waitlisted{border-color:#5a492b}.status-awaiting_payment{border-color:#5a402b}.status-cancelled,.status-rejected{opacity:.55}@media(max-width:800px){.public-tournament-hero,.registration-profile-card{grid-template-columns:1fr;display:grid}.registration-row{align-items:flex-start;flex-direction:column}.public-tournament-page{padding-left:18px;padding-right:18px}}
'''
save(p,s)
print('Phase 6 patches applied successfully.')
