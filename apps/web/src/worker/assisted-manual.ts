/** Tournament-scoped assisted registrations. Never creates an auth account. */
import { parseTeamFormat, validateTeamRoster, type TeamRosterMember } from "@huau/core";

type User = { id: string; name: string; email: string };
type Access = {
  requireUser: (request: Request, env: Env) => Promise<User | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};
type Base = { id: string; organizerOrganizationId: string; status: string; structureLocked: number };
type Category = { id: string; tournamentId: string; entryType: "individual" | "pair" | "team"; competitionGender: string | null; structureLocked: number; maxEntries: number | null; registrationStatus: string };
type Manual = { profileId: string; personId: string; name: string; gender: string; manualAge: number | null; categoryId: string; entryType: string; entryId: string | null; entryName: string | null; entryStatus: string | null; role: string | null };
type Online = { id: string; userId: string; categoryId: string; name: string; personId: string | null; entryId: string | null; status: string };
type TargetEntry = { id: string; categoryId: string; entryType: string; sourceKind: string | null; teamPaymentMode: string | null; status: string; captainUserId: string | null };
type RequestRow = { id: string; inviterRegistrationId: string; manualProfileId: string; tournamentId: string; categoryId: string; status: string; teamEntryId: string | null; sourceUserId: string };
const stamp = () => Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();
const j = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const failure = (code: string, status = 409) => j({ ok: false, code }, status);
const encoded = (value: string) => value.trim();

async function tournament(env: Env, id: string) {
  return env.HUAU_DB.prepare(`SELECT id,organizer_organization_id as organizerOrganizationId,status,structure_locked as structureLocked FROM tournaments WHERE id=?`).bind(id).first<Base>();
}
async function admin(env: Env, request: Request, access: Access, id: string) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: failure("UNAUTHENTICATED", 401) };
  const t = await tournament(env, id);
  if (!t) return { response: failure("TOURNAMENT_NOT_FOUND", 404) };
  if (!(await access.isOrgAdmin(user.id, t.organizerOrganizationId, env, request))) return { response: failure("FORBIDDEN", 403) };
  return { user, t };
}
async function category(env: Env, id: string) {
  return env.HUAU_DB.prepare(`SELECT id,tournament_id as tournamentId,entry_type as entryType,competition_gender as competitionGender,structure_locked as structureLocked,max_entries as maxEntries,registration_status as registrationStatus FROM tournament_categories WHERE id=?`).bind(id).first<Category>();
}
async function manual(env: Env, tournamentId: string, profileId: string, categoryId: string) {
  return env.HUAU_DB.prepare(`SELECT pp.id as profileId,pp.organization_person_id as personId,pp.display_name as name,COALESCE(op.sport_gender,'unspecified') as gender,pp.manual_age as manualAge,tc.id as categoryId,tc.entry_type as entryType,
    e.id as entryId,e.display_name as entryName,e.status as entryStatus,em.member_role as role
    FROM tournament_player_profiles pp JOIN organization_people op ON op.id=pp.organization_person_id
    JOIN tournament_player_categories tpc ON tpc.player_profile_id=pp.id JOIN tournament_categories tc ON tc.id=tpc.category_id
    LEFT JOIN entry_members em ON em.id=(SELECT em2.id FROM entry_members em2 JOIN tournament_entries e2 ON e2.id=em2.entry_id WHERE em2.organization_person_id=pp.organization_person_id AND em2.status IN ('accepted','manual') AND e2.category_id=tc.id AND e2.status NOT IN ('withdrawn','rejected') ORDER BY e2.created_at DESC LIMIT 1)
    LEFT JOIN tournament_entries e ON e.id=em.entry_id
    WHERE pp.id=? AND pp.tournament_id=? AND tc.id=? AND op.user_id IS NULL AND pp.player_status='confirmed' LIMIT 1`).bind(profileId,tournamentId,categoryId).first<Manual>();
}
async function online(env: Env, id: string, categoryId: string) {
  return env.HUAU_DB.prepare(`SELECT tr.id,tr.user_id as userId,tr.category_id as categoryId,COALESCE(NULLIF(TRIM(COALESCE(up.first_name,'') || ' ' || COALESCE(up.last_name,'')),''),u.name) as name,op.id as personId,tr.entry_id as entryId,tr.status FROM tournament_registrations tr JOIN user u ON u.id=tr.user_id LEFT JOIN user_profiles up ON up.user_id=u.id LEFT JOIN tournaments t ON t.id=tr.tournament_id LEFT JOIN organization_people op ON op.organization_id=t.organizer_organization_id AND op.user_id=tr.user_id WHERE tr.id=? AND tr.category_id=? AND tr.status NOT IN ('cancelled','rejected','waitlisted') LIMIT 1`).bind(id,categoryId).first<Online>();
}
async function entry(env: Env, id: string, categoryId: string) {
  return env.HUAU_DB.prepare(`SELECT id,category_id as categoryId,entry_type as entryType,source_kind as sourceKind,team_payment_mode as teamPaymentMode,status,captain_user_id as captainUserId FROM tournament_entries WHERE id=? AND category_id=? AND status NOT IN ('withdrawn','rejected') LIMIT 1`).bind(id,categoryId).first<TargetEntry>();
}
async function invalidate(env: Env, tournamentId: string) {
  await env.HUAU_ASSETS.delete(`public/tournaments/${tournamentId}/participants.json`).catch(() => undefined);
}
async function isFreePerson(env: Env, personId: string, categoryId: string) {
  const used = await env.HUAU_DB.prepare(`SELECT 1 as used FROM entry_members em JOIN tournament_entries e ON e.id=em.entry_id WHERE em.organization_person_id=? AND e.category_id=? AND em.status IN ('manual','accepted') AND e.status NOT IN ('withdrawn','rejected') LIMIT 1`).bind(personId,categoryId).first<{used:number}>();
  return !used;
}
async function capacityAvailable(env: Env, cat: Category) {
  if (cat.registrationStatus === "closed") return false;
  if (cat.maxEntries === null) return true;
  const r = await env.HUAU_DB.prepare(`SELECT COUNT(*) as occupied FROM tournament_entries WHERE category_id=? AND status NOT IN ('waitlisted','withdrawn','rejected')`).bind(cat.id).first<{occupied:number}>();
  return Number(r?.occupied ?? 0) < cat.maxEntries;
}
async function validateRoster(env: Env, entryId: string, categoryId: string, candidate: {personId: string; name: string; gender: string}) {
  const config = await env.HUAU_DB.prepare(`SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`).bind(categoryId).first<{configJson:string}>();
  if (!config) return null;
  try {
    const format = parseTeamFormat(JSON.parse(config.configJson) as unknown);
    const current = await env.HUAU_DB.prepare(`SELECT em.organization_person_id as personId,TRIM(op.first_name || ' ' || op.last_name) as name,COALESCE(op.sport_gender,'unspecified') as sportGender,em.member_role as role FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND em.status IN ('accepted','manual')`).bind(entryId).all<TeamRosterMember>();
    const gender: TeamRosterMember["sportGender"] = candidate.gender === "male" || candidate.gender === "female" ? candidate.gender : "unspecified";
    const roster: TeamRosterMember[] = [...current.results,{ personId:candidate.personId,name:candidate.name,sportGender:gender,role:"player" }];
    const hard = new Set(["ROSTER_TOO_LARGE","ROSTER_MALE_MAX","ROSTER_FEMALE_MAX","ROSTER_COMPOSITION_MALE","ROSTER_COMPOSITION_FEMALE"]);
    return validateTeamRoster(format,roster).issues.find(x=>hard.has(x.code))?.code ?? null;
  } catch { return "TEAM_FORMAT_INVALID"; }
}

export async function assistedRegistrationViews(env: Env, tournamentId: string) {
  const [rows, items] = await Promise.all([
    env.HUAU_DB.prepare(`SELECT pp.id as profileId,pp.display_name as name,pp.contact,pp.manual_age as age,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,tc.currency,tc.sort_order as sortOrder,
      te.id as entryId,te.display_name as entryName,te.team_payment_mode as teamPaymentMode,em.member_role as role
      FROM tournament_player_profiles pp JOIN organization_people op ON op.id=pp.organization_person_id
      JOIN tournament_player_categories tpc ON tpc.player_profile_id=pp.id JOIN tournament_categories tc ON tc.id=tpc.category_id
      LEFT JOIN entry_members em ON em.id=(SELECT em2.id FROM entry_members em2 JOIN tournament_entries e2 ON e2.id=em2.entry_id WHERE em2.organization_person_id=pp.organization_person_id AND em2.status IN ('accepted','manual') AND e2.category_id=tc.id AND e2.status NOT IN ('withdrawn','rejected') ORDER BY e2.created_at DESC LIMIT 1)
      LEFT JOIN tournament_entries te ON te.id=em.entry_id
      WHERE pp.tournament_id=? AND pp.player_status='confirmed' AND op.user_id IS NULL ORDER BY tc.sort_order,pp.display_name`).bind(tournamentId).all<{
        profileId:string; name:string; contact:string; age:number|null; categoryId:string; categoryName:string; entryType:"individual"|"pair"|"team"; currency:string|null; sortOrder:number; entryId:string|null; entryName:string|null; teamPaymentMode:string|null; role:string|null;
      }>(),
    env.HUAU_DB.prepare(`SELECT poi.player_profile_id as profileId,poi.category_id as categoryId,poi.amount_minor as amountMinor,po.status,po.amount_paid_minor as paidMinor,po.amount_refunded_minor as refundedMinor,po.currency FROM payment_order_items poi JOIN payment_orders po ON po.id=poi.order_id WHERE po.tournament_id=? AND po.payer_kind='manual_profile' AND po.status<>'cancelled' ORDER BY po.updated_at DESC`).bind(tournamentId).all<{profileId:string;categoryId:string;amountMinor:number;status:string;paidMinor:number;refundedMinor:number;currency:string}>(),
  ]);
  const paymentBy = new Map(items.results.map(x=>[`${x.profileId}:${x.categoryId}`,x]));
  const entryIds = [...new Set(rows.results.map(x=>x.entryId).filter((x):x is string=>Boolean(x)))];
  const membersBy = new Map<string,Array<{name:string;email:null;userId:string|null;personId:string;memberRole:string;status:string}>>();
  if (entryIds.length) {
    for (let i=0;i<entryIds.length;i+=40) {
      const ids=entryIds.slice(i,i+40);
      const members=await env.HUAU_DB.prepare(`SELECT em.entry_id as entryId,em.organization_person_id as personId,em.member_role as memberRole,em.status,TRIM(op.first_name || ' ' || op.last_name) as name,op.user_id as userId FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id IN (${ids.map(()=>'?').join(',')}) AND em.status IN ('accepted','manual') ORDER BY em.created_at`).bind(...ids).all<{entryId:string;personId:string;memberRole:string;status:string;name:string;userId:string|null}>();
      for(const m of members.results){const list=membersBy.get(m.entryId)??[];list.push({name:m.name,email:null,userId:m.userId,personId:m.personId,memberRole:m.memberRole,status:m.status});membersBy.set(m.entryId,list);}
    }
  }
  return rows.results.map(row=>{
    const p=paymentBy.get(`${row.profileId}:${row.categoryId}`);
    const amount=p?.amountMinor??0;
    const paid=p?.status==="paid";
    const members=row.entryId?membersBy.get(row.entryId)??[]:[];
    return {
      id:`manual:${row.profileId}:${row.categoryId}`,userId:null,isManual:true,manualProfileId:row.profileId,registrationNumber:0,
      status:amount>0&&!paid?"awaiting_payment":"confirmed",categoryId:row.categoryId,categoryName:row.categoryName,
      entryType:row.entryType,entryName:row.entryName,entryId:row.entryId,
      groupingState:row.entryType==="individual"?"ready":!row.entryId?"free":row.entryType==="pair"?"paired":row.role==="captain"?"captain":"member",
      finalAmountMinor:amount,baseAmountMinor:amount,discountMinor:0,currency:p?.currency??row.currency??"UYU",covered:false,
      paidAmountMinor:p?.paidMinor??0,refundedAmountMinor:p?.refundedMinor??0,
      userName:row.name,userEmail:row.contact.includes('@')?row.contact:"",age:row.age,
      members,participantCount:1,priceScope:"per_person",waitlistPosition:null,createdAt:0,
    };
  });
}

export async function assistedCandidates(env: Env, categoryId: string, entryType: "pair"|"team", sourceUserId: string, sourceRegistrationId: string, sourceEntryId: string|null) {
  const results=await env.HUAU_DB.prepare(`SELECT pp.id as profileId,pp.display_name as name,COALESCE(op.sport_gender,'unspecified') as gender,pp.organization_person_id as personId,
    (SELECT status FROM assisted_join_requests r WHERE r.manual_profile_id=pp.id AND r.inviter_registration_id=? AND r.status='pending' LIMIT 1) as requestStatus
    FROM tournament_player_categories pc JOIN tournament_player_profiles pp ON pp.id=pc.player_profile_id JOIN organization_people op ON op.id=pp.organization_person_id
    WHERE pc.category_id=? AND pp.player_status='confirmed' AND op.user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM entry_members em JOIN tournament_entries e ON e.id=em.entry_id WHERE em.organization_person_id=pp.organization_person_id AND e.category_id=pc.category_id AND e.status NOT IN ('withdrawn','rejected') AND em.status IN ('accepted','manual'))
    ORDER BY pp.display_name`).bind(sourceRegistrationId,categoryId).all<{profileId:string;name:string;gender:string;personId:string;requestStatus:string|null}>();
  const sourceGender=entryType==="pair"?await env.HUAU_DB.prepare(`SELECT COALESCE(sport_gender,'unspecified') as gender FROM user_profiles WHERE user_id=?`).bind(sourceUserId).first<{gender:string}>():null;
  const cat=await category(env,categoryId);
  const candidates: Array<{ registrationId:string;userId:string;status:string;finalAmountMinor:number;name:string;email:string;invitationStatus:string|null;paymentReady:boolean;isManual:boolean }> = [];
  for(const row of results.results){
    if(entryType==="pair"&&cat?.competitionGender==="mixed"&&[sourceGender?.gender,row.gender].sort().join(',')!=="female,male")continue;
    if(entryType==="team"&&sourceEntryId&&await validateRoster(env,sourceEntryId,categoryId,{personId:row.personId,name:row.name,gender:row.gender}))continue;
    candidates.push({registrationId:`manual:${row.profileId}`,userId:"",status:"confirmed",finalAmountMinor:0,name:row.name,email:"",invitationStatus:row.requestStatus,paymentReady:true,isManual:true});
  }
  return candidates;
}

export async function createAssistedRequest(env:Env, source:{id:string;userId:string;tournamentId:string;categoryId:string;entryId:string|null;status:string}, cat:{entryType:string;structureLocked:number}, actor:User, profileId:string) {
  if(source.userId!==actor.id||["cancelled","rejected","waitlisted"].includes(source.status)||cat.structureLocked)return failure("CANDIDATE_NOT_AVAILABLE");
  if(cat.entryType==="team"){
    if(!source.entryId)return failure("CREATE_TEAM_FIRST");
    const captain=await entry(env,source.entryId,source.categoryId);
    if(!captain||captain.captainUserId!==actor.id)return failure("CAPTAIN_REQUIRED",403);
  }else if(cat.entryType==="pair"&&source.entryId)return failure("PAIR_ALREADY_COMPLETE");
  const candidate=await manual(env,source.tournamentId,profileId,source.categoryId);
  if(!candidate||candidate.entryId)return failure("CANDIDATE_NOT_AVAILABLE");
  const existing=await env.HUAU_DB.prepare(`SELECT id FROM assisted_join_requests WHERE inviter_registration_id=? AND manual_profile_id=? AND status='pending'`).bind(source.id,profileId).first<{id:string}>();
  if(existing)return j({ok:true,requestId:existing.id,alreadyPending:true});
  const id=uuid();const now=stamp();
  await env.HUAU_DB.prepare(`INSERT INTO assisted_join_requests (id,tournament_id,category_id,inviter_registration_id,manual_profile_id,requested_by_user_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)`).bind(id,source.tournamentId,source.categoryId,source.id,profileId,actor.id,now,now).run();
  return j({ok:true,requestId:id,adminApprovalRequired:true},201);
}

async function manageAction(env:Env,t:Base,user:User,body:{action?:string;profileId?:string;categoryId?:string;entryId?:string;targetRegistrationId?:string;targetProfileId?:string;teamName?:string;requestId?:string;decision?:string}, recalc:(env:Env,entryId:string)=>Promise<void>): Promise<Response> {
  const action=String(body.action??"");
  if(action==="resolve_request"){
    const row=await env.HUAU_DB.prepare(`SELECT id,inviter_registration_id as inviterRegistrationId,manual_profile_id as manualProfileId,tournament_id as tournamentId,category_id as categoryId,status FROM assisted_join_requests WHERE id=? AND tournament_id=?`).bind(body.requestId??"",t.id).first<RequestRow>();
    if(!row||row.status!=="pending")return failure("REQUEST_NOT_PENDING");
    if(body.decision==="reject"){
      await env.HUAU_DB.prepare(`UPDATE assisted_join_requests SET status='rejected',resolved_by_user_id=?,updated_at=? WHERE id=? AND status='pending'`).bind(user.id,stamp(),row.id).run();
      return j({ok:true});
    }
    if(body.decision!=="approve")return failure("DECISION_REQUIRED",400);
    const source=await online(env,row.inviterRegistrationId,row.categoryId);
    if(!source)return failure("SOURCE_REGISTRATION_UNAVAILABLE");
    const next: Response = await manageAction(env,t,user,{action:source.entryId?"join_entry":"pair_online",profileId:row.manualProfileId,categoryId:row.categoryId,...(source.entryId ? {entryId:source.entryId} : {}),targetRegistrationId:source.id},recalc);
    if(!next.ok)return next;
    await env.HUAU_DB.prepare(`UPDATE assisted_join_requests SET status='approved',resolved_by_user_id=?,updated_at=? WHERE id=?`).bind(user.id,stamp(),row.id).run();
    return next;
  }
  const categoryId=encoded(body.categoryId??"");const profileId=encoded(body.profileId??"");
  const [cat,player]=await Promise.all([category(env,categoryId),manual(env,t.id,profileId,categoryId)]);
  if(!cat||cat.tournamentId!==t.id||!player)return failure("MANUAL_PLAYER_OR_CATEGORY_NOT_FOUND",404);
  if(t.structureLocked||cat.structureLocked)return failure("COMPETITION_STRUCTURE_LOCKED");
  if(action==="create_team"){
    if(cat.entryType!=="team"||player.entryId)return failure("TEAM_NOT_AVAILABLE");
    const name=encoded(body.teamName??"");if(name.length<2||name.length>90)return failure("TEAM_NAME_INVALID",400);
    if(!(await capacityAvailable(env,cat)))return failure("CATEGORY_CAPACITY_REACHED");
    const id=uuid();const now=stamp();
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(`INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode) VALUES (?,?,'team',?,NULL,'inviting',NULL,NULL,?,1,'manual_team',?,?,?,1,'individual')`).bind(id,cat.id,name,user.id,profileId,now,now),
      env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'captain',NULL,'manual',NULL,?,?,?)`).bind(uuid(),id,player.personId,now,now,now),
    ]);
    await recalc(env,id);await invalidate(env,t.id);return j({ok:true,entryId:id});
  }
  if(action==="pair_online"||action==="pair_manual"){
    if(cat.entryType!=="pair"||player.entryId)return failure("PAIR_NOT_AVAILABLE");
    if(!(await capacityAvailable(env,cat)))return failure("CATEGORY_CAPACITY_REACHED");
    let secondPerson="",secondName="",secondGender="",userId:string|null=null,registrationId:string|null=null;
    if(action==="pair_online"){
      const target=await online(env,body.targetRegistrationId??"",cat.id);
      if(!target||target.entryId||!target.personId)return failure("ONLINE_PARTNER_NOT_FREE");
      secondPerson=target.personId;secondName=target.name;registrationId=target.id;userId=target.userId;
      const person=await env.HUAU_DB.prepare(`SELECT COALESCE(sport_gender,'unspecified') as gender FROM organization_people WHERE id=?`).bind(target.personId).first<{gender:string}>();secondGender=person?.gender??"unspecified";
    }else{
      const other=await manual(env,t.id,encoded(body.targetProfileId??""),cat.id);
      if(!other||other.entryId||other.profileId===player.profileId)return failure("MANUAL_PARTNER_NOT_FREE");
      secondPerson=other.personId;secondName=other.name;secondGender=other.gender;
    }
    if(cat.competitionGender==="mixed"&&[player.gender,secondGender].sort().join(',')!=="female,male")return failure("MIXED_PAIR_GENDER_RULE");
    if(!(await isFreePerson(env,player.personId,cat.id))||!(await isFreePerson(env,secondPerson,cat.id)))return failure("PAIR_NO_LONGER_FREE");
    const id=uuid();const now=stamp();
    const statements=[
      env.HUAU_DB.prepare(`INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode) VALUES (?,?,'pair',?,NULL,'inviting',NULL,NULL,?,1,'assisted_pair',?,?,?,1,NULL)`).bind(id,cat.id,`${player.name} / ${secondName}`,user.id,player.profileId,now,now),
      env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player','1','manual',NULL,?,?,?)`).bind(uuid(),id,player.personId,now,now,now),
      env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player','2',?,?,?,?,?)`).bind(uuid(),id,secondPerson,userId?"accepted":"manual",userId,now,now,now),
    ];
    if(registrationId)statements.push(env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=?,updated_at=?,version=version+1 WHERE id=? AND entry_id IS NULL`).bind(id,now,registrationId));
    await env.HUAU_DB.batch(statements);await recalc(env,id);await invalidate(env,t.id);return j({ok:true,entryId:id});
  }
  if(action==="join_entry"||action==="add_online"){
    const target=await entry(env,encoded(body.entryId??""),cat.id);
    if(!target||target.entryType!=="team"||player.entryId&&action==="join_entry")return failure("TEAM_NOT_AVAILABLE");
    if(action==="join_entry"){
      if(!(await isFreePerson(env,player.personId,cat.id)))return failure("MANUAL_PLAYER_ALREADY_ASSIGNED");
      const hard=await validateRoster(env,target.id,cat.id,{personId:player.personId,name:player.name,gender:player.gender});
      if(hard)return failure(hard);
      const now=stamp();await env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player',NULL,'manual',NULL,?,?,?)`).bind(uuid(),target.id,player.personId,now,now,now).run();
    }else{
      if(target.sourceKind!=="manual_team"||player.entryId!==target.id)return failure("MANUAL_TEAM_REQUIRED");
      const targetOnline=await online(env,body.targetRegistrationId??"",cat.id);
      if(!targetOnline||targetOnline.entryId||!targetOnline.personId||!(await isFreePerson(env,targetOnline.personId,cat.id)))return failure("ONLINE_PLAYER_NOT_FREE");
      const sg=await env.HUAU_DB.prepare(`SELECT COALESCE(sport_gender,'unspecified') as gender FROM organization_people WHERE id=?`).bind(targetOnline.personId).first<{gender:string}>();
      const hard=await validateRoster(env,target.id,cat.id,{personId:targetOnline.personId,name:targetOnline.name,gender:sg?.gender??"unspecified"});if(hard)return failure(hard);
      const now=stamp();await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player',NULL,'accepted',?,?,?,?)`).bind(uuid(),target.id,targetOnline.personId,targetOnline.userId,now,now,now),
        env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=?,updated_at=?,version=version+1 WHERE id=? AND entry_id IS NULL`).bind(target.id,now,targetOnline.id),
      ]);
    }
    await recalc(env,target.id);await invalidate(env,t.id);return j({ok:true,entryId:target.id});
  }
  return failure("ASSISTED_ACTION_INVALID",400);
}

export async function handleAssistedAdminApi(request:Request,env:Env,access:Access,recalc:(env:Env,entryId:string)=>Promise<void>):Promise<Response|null>{
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/manual-management$/);
  if(!match)return null;
  const tournamentId=decodeURIComponent(match[1]!);
  const allowed=await admin(env,request,access,tournamentId);
  if("response" in allowed)return allowed.response ?? failure("FORBIDDEN",403);
  const {user,t}=allowed;
  if(request.method==="GET"){
    const profileId=url.searchParams.get("profileId")??"";
    const [participants,entries,onlineRows,requests]=await Promise.all([
      env.HUAU_DB.prepare(`SELECT pp.id as profileId,pp.display_name as name,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType FROM tournament_player_profiles pp JOIN organization_people op ON op.id=pp.organization_person_id JOIN tournament_player_categories pc ON pc.player_profile_id=pp.id JOIN tournament_categories tc ON tc.id=pc.category_id WHERE pp.tournament_id=? AND pp.player_status='confirmed' AND op.user_id IS NULL ORDER BY pp.display_name`).bind(tournamentId).all<{profileId:string;name:string;categoryId:string;categoryName:string;entryType:string}>(),
      env.HUAU_DB.prepare(`SELECT e.id,e.display_name as name,tc.id as categoryId,tc.entry_type as entryType,e.source_kind as sourceKind,e.team_payment_mode as teamPaymentMode,COUNT(em.id) as memberCount FROM tournament_entries e JOIN tournament_categories tc ON tc.id=e.category_id LEFT JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual') WHERE tc.tournament_id=? AND tc.entry_type IN ('pair','team') AND e.status NOT IN ('withdrawn','rejected') GROUP BY e.id ORDER BY tc.name,e.display_name`).bind(tournamentId).all<{id:string;name:string;categoryId:string;entryType:string;sourceKind:string|null;teamPaymentMode:string|null;memberCount:number}>(),
      env.HUAU_DB.prepare(`SELECT tr.id,tr.category_id as categoryId,u.name,op.id as personId FROM tournament_registrations tr JOIN user u ON u.id=tr.user_id JOIN tournaments t ON t.id=tr.tournament_id LEFT JOIN organization_people op ON op.organization_id=t.organizer_organization_id AND op.user_id=tr.user_id WHERE tr.tournament_id=? AND tr.status NOT IN ('cancelled','rejected','waitlisted') AND tr.entry_id IS NULL ORDER BY u.name`).bind(tournamentId).all<{id:string;categoryId:string;name:string;personId:string|null}>(),
      env.HUAU_DB.prepare(`SELECT r.id,r.manual_profile_id as profileId,r.category_id as categoryId,r.inviter_registration_id as inviterRegistrationId,u.name as requestedBy,e.display_name as teamName FROM assisted_join_requests r JOIN tournament_registrations tr ON tr.id=r.inviter_registration_id JOIN user u ON u.id=r.requested_by_user_id LEFT JOIN tournament_entries e ON e.id=tr.entry_id WHERE r.tournament_id=? AND r.status='pending' ORDER BY r.created_at`).bind(tournamentId).all<{id:string;profileId:string;categoryId:string;inviterRegistrationId:string;requestedBy:string;teamName:string|null}>(),
    ]);
    return j({ok:true,participants:participants.results,entries:entries.results,freeOnline:onlineRows.results.filter(x=>Boolean(x.personId)),requests:requests.results.filter(x=>!profileId||x.profileId===profileId)});
  }
  if(request.method!=="POST")return failure("METHOD_NOT_ALLOWED",405);
  const body=await request.json() as {action?:string;profileId?:string;categoryId?:string;entryId?:string;targetRegistrationId?:string;targetProfileId?:string;teamName?:string;requestId?:string;decision?:string};
  return manageAction(env,t,user,body,recalc);
}
