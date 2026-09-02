import {
  capacityDecision,
  categoryLimitReached,
  evaluateRegistrationEligibility,
  parseTeamFormat,
  registrationPriceMinor,
  resolveRegistrationPricing,
  validateTeamRoster,
  type RegistrationCategoryRule,
  type TeamRosterMember,
} from "@huau/core";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type TournamentRow = {
  id: string; organizerOrganizationId: string; name: string; slug: string; sport: string; status: string; visibility: string;
  startAt: number; endAt: number | null; timezone: string; courtCount: number; structureLocked: number;
};
type CategoryRow = RegistrationCategoryRule & {
  id: string; tournamentId: string; name: string; structureLocked: number; formatVersionId: string | null;
};
type ProfileRow = { firstName: string; lastName: string; birthDate: string | null; sportGender: "male"|"female"|"unspecified"; phone: string | null };
type PricingSettingsRow = {
  paymentType: "per_category" | "base_plus_extra" | "free";
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
  maxCategoriesPerPlayer: number | null;
};

type RegistrationRow = {
  id:string;tournamentId:string;categoryId:string;entryId:string|null;userId:string;status:string;participantCount:number;
  priceScope:string;baseAmountMinor:number;discountMinor:number;finalAmountMinor:number;currency:string|null;waitlistPosition:number|null;registrationNumber:number;
};

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...init.headers } });
const readJson = async <T>(request:Request):Promise<T> => (await request.json()) as T;
const uuid=()=>crypto.randomUUID();
const now=()=>Math.floor(Date.now()/1000);
const normalizeEmail=(value:string)=>value.trim().toLowerCase();
const dateFromUnix=(value:number)=>new Date((value<10_000_000_000?value*1000:value)).toISOString().slice(0,10);

async function tournamentBySlug(env:Env,slug:string){return env.HUAU_DB.prepare(`SELECT id,organizer_organization_id as organizerOrganizationId,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,timezone,court_count as courtCount,structure_locked as structureLocked FROM tournaments WHERE slug=?`).bind(slug).first<TournamentRow>();}
async function tournamentById(env:Env,id:string){return env.HUAU_DB.prepare(`SELECT id,organizer_organization_id as organizerOrganizationId,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,timezone,court_count as courtCount,structure_locked as structureLocked FROM tournaments WHERE id=?`).bind(id).first<TournamentRow>();}
async function categoryById(env:Env,id:string){return env.HUAU_DB.prepare(`SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,min_age as minAge,max_age as maxAge,max_entries as maxEntries,registration_status as registrationStatus,price_scope as priceScope,price_minor as priceMinor,currency,structure_locked as structureLocked,format_version_id as formatVersionId FROM tournament_categories WHERE id=?`).bind(id).first<CategoryRow>();}
async function profileForUser(env:Env,userId:string){return env.HUAU_DB.prepare(`SELECT first_name as firstName,last_name as lastName,birth_date as birthDate,COALESCE(sport_gender,'unspecified') as sportGender,phone FROM user_profiles WHERE user_id=?`).bind(userId).first<ProfileRow>();}

async function registrationCloseAt(env:Env,tournamentId:string){const row=await env.HUAU_DB.prepare(`SELECT registration_close_at as registrationCloseAt FROM tournament_settings WHERE tournament_id=?`).bind(tournamentId).first<{registrationCloseAt:number|null}>();return row?.registrationCloseAt??null;}
async function pricingSettingsForTournament(env:Env,tournamentId:string):Promise<PricingSettingsRow>{
  const row=await env.HUAU_DB.prepare(`SELECT payment_type as paymentType,entry_fee_minor as entryFeeMinor,base_fee_minor as baseFeeMinor,extra_category_fee_minor as extraCategoryFeeMinor,max_categories_per_player as maxCategoriesPerPlayer FROM tournament_settings WHERE tournament_id=?`).bind(tournamentId).first<PricingSettingsRow>();
  return row??{paymentType:"free",entryFeeMinor:null,baseFeeMinor:null,extraCategoryFeeMinor:null,maxCategoriesPerPlayer:null};
}
async function activeCategoryCountForUser(env:Env,tournamentId:string,userId:string){
  const row=await env.HUAU_DB.prepare(`SELECT COUNT(DISTINCT tc.id) as count
    FROM tournament_categories tc
    JOIN tournament_entries e ON e.category_id=tc.id AND e.status NOT IN ('withdrawn','rejected')
    JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
    JOIN organization_people op ON op.id=em.organization_person_id
    WHERE tc.tournament_id=? AND op.user_id=?`).bind(tournamentId,userId).first<{count:number}>();
  return Number(row?.count??0);
}

async function categoryLimitCode(env:Env,tournamentId:string,userId:string){
  const settings=await pricingSettingsForTournament(env,tournamentId);
  const activeCategoryCount=await activeCategoryCountForUser(env,tournamentId,userId);
  return { settings, activeCategoryCount, reached: categoryLimitReached(settings.maxCategoriesPerPlayer,activeCategoryCount) };
}

async function priorActiveRegistrationCount(env:Env,tournamentId:string,userId:string,beforeRegistrationNumber?:number){
  const beforeClause=beforeRegistrationNumber===undefined?"":"AND registration_number < ?";
  const values:Array<string|number>=[tournamentId,userId];
  if(beforeRegistrationNumber!==undefined)values.push(beforeRegistrationNumber);
  const row=await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM tournament_registrations WHERE tournament_id=? AND user_id=? AND status NOT IN ('cancelled','rejected') ${beforeClause}`).bind(...values).first<{count:number}>();
  return Number(row?.count??0);
}
async function effectivePricing(env:Env,tournamentId:string,userId:string,category:CategoryRow,beforeRegistrationNumber?:number){
  const settings=await pricingSettingsForTournament(env,tournamentId);
  const prior=await priorActiveRegistrationCount(env,tournamentId,userId,beforeRegistrationNumber);
  return {
    settings,
    resolution: resolveRegistrationPricing({
      categoryPriceScope:category.priceScope,categoryPriceMinor:category.priceMinor,tournamentPaymentType:settings.paymentType,
      tournamentEntryFeeMinor:settings.entryFeeMinor,tournamentBaseFeeMinor:settings.baseFeeMinor,tournamentExtraCategoryFeeMinor:settings.extraCategoryFeeMinor,
      priorActiveRegistrationCount:prior,
    }),
  };
}

async function ensureOrganizationPerson(env:Env,tournament:TournamentRow,user:CurrentUser,profile:ProfileRow):Promise<string>{
  const existing=await env.HUAU_DB.prepare(`SELECT id FROM organization_people WHERE organization_id=? AND user_id=?`).bind(tournament.organizerOrganizationId,user.id).first<{id:string}>();
  const stamp=now();
  if(existing){await env.HUAU_DB.prepare(`UPDATE organization_people SET first_name=?,last_name=?,email=?,phone=?,birth_date=?,sport_gender=?,status='active',updated_at=? WHERE id=?`).bind(profile.firstName,profile.lastName,user.email,profile.phone,profile.birthDate,profile.sportGender==="unspecified"?null:profile.sportGender,stamp,existing.id).run();return existing.id;}
  const id=uuid();await env.HUAU_DB.prepare(`INSERT INTO organization_people (id,organization_id,user_id,first_name,last_name,email,phone,birth_date,sport_gender,source,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'user','active',?,?)`).bind(id,tournament.organizerOrganizationId,user.id,profile.firstName,profile.lastName,user.email,profile.phone,profile.birthDate,profile.sportGender==="unspecified"?null:profile.sportGender,stamp,stamp).run();return id;
}

async function ensureTournamentPlayerProfile(env:Env,tournament:TournamentRow,personId:string,profile:ProfileRow,user:CurrentUser):Promise<string>{
  const existing=await env.HUAU_DB.prepare(`SELECT id FROM tournament_player_profiles WHERE tournament_id=? AND organization_person_id=?`).bind(tournament.id,personId).first<{id:string}>();
  if(existing)return existing.id;
  const id=uuid();const stamp=now();const sort=await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 as nextSort FROM tournament_player_profiles WHERE tournament_id=?`).bind(tournament.id).first<{nextSort:number}>();
  await env.HUAU_DB.prepare(`INSERT INTO tournament_player_profiles (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,payment_status,player_status,notes,sort_order,created_at,updated_at,version) VALUES (?,?,?,?, '', ?,0,0,'pending','confirmed','',?,?,?,1)`).bind(id,tournament.id,personId,`${profile.firstName} ${profile.lastName}`.trim()||user.name,user.email,sort?.nextSort??0,stamp,stamp).run();
  return id;
}

async function categoryOccupied(env:Env,categoryId:string){const row=await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM tournament_entries WHERE category_id=? AND status NOT IN ('waitlisted','withdrawn','rejected')`).bind(categoryId).first<{count:number}>();return Number(row?.count??0);}
async function nextWaitlist(env:Env,categoryId:string){const row=await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(waitlist_position),0)+1 as nextPosition FROM tournament_entries WHERE category_id=? AND status='waitlisted'`).bind(categoryId).first<{nextPosition:number}>();return Number(row?.nextPosition??1);}
async function nextRegistrationNumber(env:Env,tournamentId:string){const row=await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(registration_number),0)+1 as nextNumber FROM tournament_registrations WHERE tournament_id=?`).bind(tournamentId).first<{nextNumber:number}>();return Number(row?.nextNumber??1);}

async function acquireCategoryDecision(env:Env,category:CategoryRow):Promise<{decision:"closed"|"confirmed_slot"|"waitlist";waitlistPosition:number|null}>{
  for(let attempt=0;attempt<5;attempt+=1){
    const versionRow=await env.HUAU_DB.prepare(`SELECT version FROM tournament_categories WHERE id=?`).bind(category.id).first<{version:number}>();
    if(!versionRow)throw new Error("CATEGORY_NOT_FOUND");
    const lock=await env.HUAU_DB.prepare(`UPDATE tournament_categories SET version=version+1,updated_at=? WHERE id=? AND version=?`).bind(now(),category.id,versionRow.version).run();
    const changes=Number((lock as {meta?:{changes?:number}}).meta?.changes??0);
    if(changes!==1)continue;
    const occupied=await categoryOccupied(env,category.id);
    const decision=capacityDecision({maxEntries:category.maxEntries,occupiedEntries:occupied,registrationStatus:category.registrationStatus});
    return {decision,waitlistPosition:decision==="waitlist"?await nextWaitlist(env,category.id):null};
  }
  throw new Error("REGISTRATION_CAPACITY_BUSY");
}

async function userAlreadyInCategory(env:Env,userId:string,categoryId:string,excludeEntryId?:string){
  const row=await env.HUAU_DB.prepare(`SELECT e.id FROM tournament_entries e JOIN entry_members em ON em.entry_id=e.id JOIN organization_people op ON op.id=em.organization_person_id WHERE e.category_id=? AND op.user_id=? AND e.status NOT IN ('withdrawn','rejected') AND em.status NOT IN ('declined','removed') ${excludeEntryId?"AND e.id<>?":""} LIMIT 1`).bind(categoryId,userId,...(excludeEntryId?[excludeEntryId]:[])).first<{id:string}>();return Boolean(row);
}

function targetEntryStatus(decision:"confirmed_slot"|"waitlist",ready:boolean,amount:number){
  if(decision==="waitlist")return "waitlisted";
  if(!ready)return "inviting";
  return amount>0?"pending_payment":"confirmed";
}
function targetRegistrationStatus(decision:"confirmed_slot"|"waitlist",ready:boolean,amount:number){
  if(decision==="waitlist")return "waitlisted";
  if(!ready)return "inviting";
  return amount>0?"awaiting_payment":"confirmed";
}

async function syncLegacyAssignment(env:Env,profileId:string,categoryId:string,partnerProfileId:string|null){const stamp=now();await env.HUAU_DB.prepare(`INSERT INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(player_profile_id,category_id) DO UPDATE SET partner_profile_id=excluded.partner_profile_id,updated_at=excluded.updated_at`).bind(profileId,categoryId,partnerProfileId,stamp,stamp).run();}

async function inviteEmail(env:Env,input:{registrationId:string;entryId:string;tournamentId:string;categoryId:string;inviter:CurrentUser;email:string;role:"player"|"captain"|"substitute"}){
  const email=normalizeEmail(input.email);if(!email||email===normalizeEmail(input.inviter.email))throw new Error("INVALID_INVITEE_EMAIL");
  const user=await env.HUAU_DB.prepare(`SELECT id FROM user WHERE lower(email)=?`).bind(email).first<{id:string}>();
  const stamp=now();const invitationId=uuid();const token=uuid();
  await env.HUAU_DB.prepare(`INSERT INTO entry_invitations (id,registration_id,entry_id,tournament_id,category_id,inviter_user_id,invitee_email,invitee_user_id,member_role,status,token,expires_at,responded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,NULL,?,?)`).bind(invitationId,input.registrationId,input.entryId,input.tournamentId,input.categoryId,input.inviter.id,email,user?.id??null,input.role,token,stamp+7*86400,stamp,stamp).run();
}

async function recalcRegistration(env:Env,registrationId:string){
  const reg=await env.HUAU_DB.prepare(`SELECT tr.id,tr.tournament_id as tournamentId,tr.category_id as categoryId,tr.entry_id as entryId,tr.user_id as userId,tr.status,tr.participant_count as participantCount,tr.price_scope as priceScope,tr.base_amount_minor as baseAmountMinor,tr.discount_minor as discountMinor,tr.final_amount_minor as finalAmountMinor,tr.currency,tr.waitlist_position as waitlistPosition,tr.registration_number as registrationNumber FROM tournament_registrations tr WHERE tr.id=?`).bind(registrationId).first<RegistrationRow>();
  if(!reg||!reg.entryId)return;
  const category=await categoryById(env,reg.categoryId);if(!category)return;
  const members=await env.HUAU_DB.prepare(`SELECT em.organization_person_id as personId,em.member_role as role,COALESCE(op.sport_gender,'unspecified') as sportGender,TRIM(op.first_name||' '||op.last_name) as name FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND em.status IN ('accepted','manual') ORDER BY em.created_at`).bind(reg.entryId).all<{personId:string;role:"player"|"captain"|"substitute";sportGender:string;name:string}>();
  let ready=category.entryType==="individual"?members.results.length>=1:category.entryType==="pair"?members.results.length===2:false;
  if(category.entryType==="pair"&&category.competitionGender==="mixed"&&ready){const genders=members.results.map(m=>m.sportGender).sort().join(",");ready=genders==="female,male";}
  if(category.entryType==="team"){
    const formatRow=await env.HUAU_DB.prepare(`SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`).bind(category.id).first<{configJson:string}>();
    if(formatRow){try{const format=parseTeamFormat(JSON.parse(formatRow.configJson) as unknown);const roster:TeamRosterMember[]=members.results.map(m=>({personId:m.personId,name:m.name,sportGender:m.sportGender==="male"||m.sportGender==="female"?m.sportGender:"unspecified",role:m.role}));ready=validateTeamRoster(format,roster).valid;}catch{ready=false;}}
  }
  const count=Math.max(1,members.results.length);
  const pricingCount=category.entryType==="pair"?2:count;
  const pricing=await effectivePricing(env,reg.tournamentId,reg.userId,category,reg.registrationNumber);
  const base=registrationPriceMinor({priceScope:pricing.resolution.priceScope,priceMinor:pricing.resolution.priceMinor},pricingCount);
  const final=Math.max(0,base-reg.discountMinor);
  const entry=await env.HUAU_DB.prepare(`SELECT status,waitlist_position as waitlistPosition FROM tournament_entries WHERE id=?`).bind(reg.entryId).first<{status:string;waitlistPosition:number|null}>();if(!entry)return;
  const waitlisted=entry.status==="waitlisted"||reg.status==="waitlisted";
  const entryStatus=waitlisted?"waitlisted":(!ready?"inviting":final>0?"pending_payment":"confirmed");
  const regStatus=waitlisted?"waitlisted":(!ready?"inviting":final>0?"awaiting_payment":"confirmed");
  const stamp=now();await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournament_entries SET status=?,updated_at=?,version=version+1 WHERE id=?`).bind(entryStatus,stamp,reg.entryId),
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status=?,participant_count=?,price_scope=?,base_amount_minor=?,final_amount_minor=?,updated_at=?,version=version+1 WHERE id=?`).bind(regStatus,count,pricing.resolution.priceScope,base,final,stamp,reg.id),
  ]);
}

async function publicTournament(slug:string,request:Request,env:Env,access:AccessHelpers){
  const tournament=await tournamentBySlug(env,slug);if(!tournament||tournament.visibility!=="public")return json({ok:false,code:"TOURNAMENT_NOT_FOUND"},{status:404});
  const closeAt=await registrationCloseAt(env,tournament.id);
  const settings=await pricingSettingsForTournament(env,tournament.id);
  const categories=await env.HUAU_DB.prepare(`SELECT tc.id,tc.tournament_id as tournamentId,tc.name,tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.min_age as minAge,tc.max_age as maxAge,tc.max_entries as maxEntries,tc.registration_status as registrationStatus,tc.price_scope as priceScope,tc.price_minor as priceMinor,tc.currency,tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,tc.scheduled_date as scheduledDate,(SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status NOT IN ('waitlisted','withdrawn','rejected')) as occupiedEntries,(SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status='waitlisted') as waitlistCount FROM tournament_categories tc WHERE tc.tournament_id=? ORDER BY tc.sort_order,tc.name`).bind(tournament.id).all<CategoryRow&{scheduledDate:string|null;occupiedEntries:number;waitlistCount:number}>();
  const currentUser=await access.requireUser(request,env);let profile=null;if(currentUser)profile=await profileForUser(env,currentUser.id);
  const prior=currentUser?await priorActiveRegistrationCount(env,tournament.id,currentUser.id):0;
  const limit=currentUser?await categoryLimitCode(env,tournament.id,currentUser.id):{activeCategoryCount:0,reached:false};
  const publicCategories=await Promise.all(categories.results.map(async category=>{
    const resolution=resolveRegistrationPricing({
      categoryPriceScope:category.priceScope,categoryPriceMinor:category.priceMinor,tournamentPaymentType:settings.paymentType,
      tournamentEntryFeeMinor:settings.entryFeeMinor,tournamentBaseFeeMinor:settings.baseFeeMinor,tournamentExtraCategoryFeeMinor:settings.extraCategoryFeeMinor,priorActiveRegistrationCount:prior,
    });
    const alreadyRegistered=currentUser?await userAlreadyInCategory(env,currentUser.id,category.id):false;
    const blockedCode=category.registrationStatus==="closed"?"CATEGORY_REGISTRATION_CLOSED":tournament.status!=="registration_open"?"TOURNAMENT_REGISTRATION_CLOSED":(tournament.structureLocked||category.structureLocked)?"COMPETITION_STRUCTURE_LOCKED":closeAt&&now()>closeAt?"REGISTRATION_DEADLINE_PASSED":alreadyRegistered?"ALREADY_REGISTERED_IN_CATEGORY":limit.reached?"MAX_CATEGORIES_REACHED":null;
    const priceDescription=resolution.source==="category"?"category_override":settings.paymentType==="base_plus_extra"?(prior===0?"tournament_base":"tournament_extra"):settings.paymentType==="per_category"?"tournament_per_category":"tournament_free";
    return {...category,priceScope:resolution.priceScope,priceMinor:resolution.priceMinor,priceSource:resolution.source,priceDescription,registrationBlockedCode:blockedCode,viewerAlreadyRegistered:alreadyRegistered};
  }));
  return json({ok:true,tournament,registrationCloseAt:closeAt,pricingPolicy:settings,maxCategoriesPerPlayer:settings.maxCategoriesPerPlayer,activeCategoryCount:limit.activeCategoryCount,categories:publicCategories,viewer:currentUser?{authenticated:true,profile}:{authenticated:false,profile:null}});
}

async function createRegistration(tournamentId:string,categoryId:string,request:Request,env:Env,access:AccessHelpers){
  const user=await access.requireUser(request,env);if(!user)return json({ok:false,code:"UNAUTHENTICATED"},{status:401});
  const tournament=await tournamentById(env,tournamentId);const category=await categoryById(env,categoryId);if(!tournament||!category||category.tournamentId!==tournament.id)return json({ok:false,code:"CATEGORY_NOT_FOUND"},{status:404});
  if(tournament.status!=="registration_open")return json({ok:false,code:"TOURNAMENT_REGISTRATION_CLOSED"},{status:409});
  if(tournament.structureLocked||category.structureLocked)return json({ok:false,code:"COMPETITION_STRUCTURE_LOCKED"},{status:409});
  const closeAt=await registrationCloseAt(env,tournament.id);if(closeAt&&now()>closeAt)return json({ok:false,code:"REGISTRATION_DEADLINE_PASSED"},{status:409});
  const profile=await profileForUser(env,user.id);if(!profile)return json({ok:false,code:"PROFILE_REQUIRED"},{status:409});
  const eligibility=evaluateRegistrationEligibility(category,profile,dateFromUnix(tournament.startAt));if(!eligibility.eligible)return json({ok:false,code:eligibility.code},{status:409});
  if(await userAlreadyInCategory(env,user.id,category.id))return json({ok:false,code:"ALREADY_REGISTERED_IN_CATEGORY"},{status:409});
  const limit=await categoryLimitCode(env,tournament.id,user.id);if(limit.reached)return json({ok:false,code:"MAX_CATEGORIES_REACHED",maxCategoriesPerPlayer:limit.settings.maxCategoriesPerPlayer,activeCategoryCount:limit.activeCategoryCount},{status:409});
  const existing=await env.HUAU_DB.prepare(`SELECT id FROM tournament_registrations WHERE user_id=? AND category_id=? AND status NOT IN ('cancelled','rejected')`).bind(user.id,category.id).first();if(existing)return json({ok:false,code:"ALREADY_REGISTERED_IN_CATEGORY"},{status:409});
  type RegistrationCreateBody={partnerEmail?:string;teamName?:string;memberEmails?:Array<string|{email:string;role?:"player"|"substitute"}>};const body:RegistrationCreateBody=await readJson<RegistrationCreateBody>(request).catch(()=>({}));
  const capacity=await acquireCategoryDecision(env,category);if(capacity.decision==="closed")return json({ok:false,code:"CATEGORY_REGISTRATION_CLOSED"},{status:409});
  const decision=capacity.decision;const personId=await ensureOrganizationPerson(env,tournament,user,profile);const playerProfileId=await ensureTournamentPlayerProfile(env,tournament,personId,profile,user);
  const entryId=uuid();const registrationId=uuid();const stamp=now();
  const teamInviteCount=category.entryType==="team"?(body.memberEmails??[]).length:0;
  const targetParticipants=category.entryType==="pair"?2:category.entryType==="team"?Math.max(1,1+teamInviteCount):1;
  const pricing=await effectivePricing(env,tournament.id,user.id,category);
  const amount=registrationPriceMinor({priceScope:pricing.resolution.priceScope,priceMinor:pricing.resolution.priceMinor},targetParticipants);
  const ready=category.entryType==="individual";const entryStatus=targetEntryStatus(decision,ready,amount);const regStatus=targetRegistrationStatus(decision,ready,amount);const number=await nextRegistrationNumber(env,tournament.id);const displayName=category.entryType==="team"?(body.teamName?.trim()||`${profile.firstName} Team`):`${profile.firstName} ${profile.lastName}`.trim()||user.name;
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,0,'online_registration',?,?,?,1)`).bind(entryId,category.id,category.entryType,displayName,category.entryType==="team"?user.id:null,entryStatus,capacity.waitlistPosition,null,user.id,registrationId,stamp,stamp),
    env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,?,?,'accepted',?,?,?,?)`).bind(uuid(),entryId,personId,category.entryType==="team"?"captain":"player","1",user.id,stamp,stamp,stamp),
    env.HUAU_DB.prepare(`INSERT INTO tournament_registrations (id,tournament_id,category_id,entry_id,user_id,registration_number,status,participant_count,price_scope,base_amount_minor,discount_minor,final_amount_minor,currency,waitlist_position,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,1)`).bind(registrationId,tournament.id,category.id,entryId,user.id,number,regStatus,1,pricing.resolution.priceScope,amount,amount,category.currency??"UYU",capacity.waitlistPosition,stamp,stamp),
  ]);
  if(category.entryType==="individual")await syncLegacyAssignment(env,playerProfileId,category.id,null);
  if(category.entryType==="pair"){
    const email=normalizeEmail(body.partnerEmail??"");if(!email){await cancelRegistrationInternal(env,registrationId);return json({ok:false,code:"PARTNER_EMAIL_REQUIRED"},{status:400});}
    try{await inviteEmail(env,{registrationId,entryId,tournamentId:tournament.id,categoryId:category.id,inviter:user,email,role:"player"});}catch(error){await cancelRegistrationInternal(env,registrationId);return json({ok:false,code:error instanceof Error?error.message:"INVITATION_FAILED"},{status:409});}
  }
  if(category.entryType==="team"){
    const items=(body.memberEmails??[]).map(item=>typeof item==="string"?{email:item,role:"player" as const}: {email:item.email,role:item.role??"player"});
    for(const item of items){if(!item.email)continue;try{await inviteEmail(env,{registrationId,entryId,tournamentId:tournament.id,categoryId:category.id,inviter:user,email:item.email,role:item.role});}catch(error){return json({ok:false,code:error instanceof Error?error.message:"INVITATION_FAILED",registrationId},{status:409});}}
  }
  await recalcRegistration(env,registrationId);
  return json({ok:true,registrationId,entryId,status:regStatus,waitlistPosition:capacity.waitlistPosition},{status:201});
}

async function cancelRegistrationInternal(env:Env,registrationId:string){const reg=await env.HUAU_DB.prepare(`SELECT entry_id as entryId,category_id as categoryId,waitlist_position as waitlistPosition FROM tournament_registrations WHERE id=?`).bind(registrationId).first<{entryId:string|null;categoryId:string;waitlistPosition:number|null}>();if(!reg)return;const stamp=now();await env.HUAU_DB.batch([env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status='cancelled',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp,registrationId),...(reg.entryId?[env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='withdrawn',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp,reg.entryId),env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='cancelled',updated_at=? WHERE registration_id=? AND status='pending'`).bind(stamp,registrationId)]:[])]);if(reg.waitlistPosition)await compactWaitlist(env,reg.categoryId);}
async function compactWaitlist(env:Env,categoryId:string){const rows=await env.HUAU_DB.prepare(`SELECT id,entry_id as entryId FROM tournament_registrations WHERE category_id=? AND status='waitlisted' ORDER BY waitlist_position,created_at,id`).bind(categoryId).all<{id:string;entryId:string|null}>();const statements:D1PreparedStatement[]=[];rows.results.forEach((row,index)=>{statements.push(env.HUAU_DB.prepare(`UPDATE tournament_registrations SET waitlist_position=?,updated_at=? WHERE id=?`).bind(index+1,now(),row.id));if(row.entryId)statements.push(env.HUAU_DB.prepare(`UPDATE tournament_entries SET waitlist_position=?,updated_at=? WHERE id=?`).bind(index+1,now(),row.entryId));});if(statements.length)await env.HUAU_DB.batch(statements);}

async function respondInvitation(invitationId:string,request:Request,env:Env,access:AccessHelpers){
  const user=await access.requireUser(request,env);if(!user)return json({ok:false,code:"UNAUTHENTICATED"},{status:401});const body=await readJson<{response?:"accept"|"decline"}>(request);if(body.response!=="accept"&&body.response!=="decline")return json({ok:false,code:"INVALID_RESPONSE"},{status:400});
  const invitation=await env.HUAU_DB.prepare(`SELECT i.*,tr.status as registrationStatus FROM entry_invitations i JOIN tournament_registrations tr ON tr.id=i.registration_id WHERE i.id=?`).bind(invitationId).first<Record<string,unknown>>();if(!invitation)return json({ok:false,code:"INVITATION_NOT_FOUND"},{status:404});
  const inviteeEmail=normalizeEmail(String(invitation.invitee_email??""));if(inviteeEmail!==normalizeEmail(user.email))return json({ok:false,code:"INVITATION_NOT_FOR_USER"},{status:403});if(invitation.status!=="pending")return json({ok:false,code:"INVITATION_ALREADY_RESOLVED"},{status:409});if(Number(invitation.expires_at??0)<now())return json({ok:false,code:"INVITATION_EXPIRED"},{status:409});
  const stamp=now();if(body.response==="decline"){await env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='declined',invitee_user_id=?,responded_at=?,updated_at=? WHERE id=?`).bind(user.id,stamp,stamp,invitationId).run();return json({ok:true,status:"declined"});}
  const tournament=await tournamentById(env,String(invitation.tournament_id));const category=await categoryById(env,String(invitation.category_id));const profile=await profileForUser(env,user.id);if(!tournament||!category||!profile)return json({ok:false,code:"PROFILE_REQUIRED"},{status:409});
  if(tournament.structureLocked||category.structureLocked)return json({ok:false,code:"COMPETITION_STRUCTURE_LOCKED"},{status:409});
  const eligibility=evaluateRegistrationEligibility(category,profile,dateFromUnix(tournament.startAt));if(!eligibility.eligible)return json({ok:false,code:eligibility.code},{status:409});const entryId=String(invitation.entry_id);if(await userAlreadyInCategory(env,user.id,category.id,entryId))return json({ok:false,code:"ALREADY_REGISTERED_IN_CATEGORY"},{status:409});
  const limit=await categoryLimitCode(env,tournament.id,user.id);if(limit.reached)return json({ok:false,code:"MAX_CATEGORIES_REACHED",maxCategoriesPerPlayer:limit.settings.maxCategoriesPerPlayer,activeCategoryCount:limit.activeCategoryCount},{status:409});
  const personId=await ensureOrganizationPerson(env,tournament,user,profile);const playerProfileId=await ensureTournamentPlayerProfile(env,tournament,personId,profile,user);const existingMember=await env.HUAU_DB.prepare(`SELECT id FROM entry_members WHERE entry_id=? AND organization_person_id=?`).bind(entryId,personId).first<{id:string}>();
  if(existingMember)await env.HUAU_DB.prepare(`UPDATE entry_members SET member_role=?,status='accepted',invited_user_id=?,accepted_at=?,updated_at=? WHERE id=?`).bind(String(invitation.member_role),user.id,stamp,stamp,existingMember.id).run();else await env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,?,NULL,'accepted',?,?,?,?)`).bind(uuid(),entryId,personId,String(invitation.member_role),user.id,stamp,stamp,stamp).run();
  await env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='accepted',invitee_user_id=?,responded_at=?,updated_at=? WHERE id=?`).bind(user.id,stamp,stamp,invitationId).run();
  if(category.entryType==="pair"){const creator=await env.HUAU_DB.prepare(`SELECT pp.id as profileId FROM tournament_registrations tr JOIN user_profiles up ON up.user_id=tr.user_id JOIN organization_people op ON op.organization_id=? AND op.user_id=tr.user_id JOIN tournament_player_profiles pp ON pp.tournament_id=tr.tournament_id AND pp.organization_person_id=op.id WHERE tr.id=?`).bind(tournament.organizerOrganizationId,String(invitation.registration_id)).first<{profileId:string}>();if(creator){await syncLegacyAssignment(env,creator.profileId,category.id,playerProfileId);await syncLegacyAssignment(env,playerProfileId,category.id,creator.profileId);}}
  await recalcRegistration(env,String(invitation.registration_id));return json({ok:true,status:"accepted"});
}

type RegistrationViewerRow={
  id:string;registrationNumber:number;status:string;participantCount:number;finalAmountMinor:number;currency:string|null;waitlistPosition:number|null;
  tournamentId:string;tournamentName:string;slug:string;categoryId:string;categoryName:string;entryType:"individual"|"pair"|"team";entryName:string|null;entryId:string|null;
  isOwner:number;viewerRole:string|null;
};

type RegistrationMemberView={personId:string;name:string;email:string|null;memberRole:string;status:string;userId:string|null};
type RegistrationInvitationView={id:string;inviteeEmail:string;memberRole:string;status:string;expiresAt:number;inviteeUserId:string|null};

async function registrationRosterMeta(env:Env,category:CategoryRow){
  if(category.entryType!=="team")return {min:null as number|null,max:null as number|null};
  const formatRow=await env.HUAU_DB.prepare(`SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`).bind(category.id).first<{configJson:string}>();
  if(!formatRow)return {min:null,max:null};
  try{const format=parseTeamFormat(JSON.parse(formatRow.configJson) as unknown);return {min:format.roster.min,max:format.roster.max};}catch{return {min:null,max:null};}
}

async function registrationDetails(env:Env,row:RegistrationViewerRow){
  if(!row.entryId)return {...row,members:[],entryInvitations:[],canManageInvitations:false,rosterMin:null,rosterMax:null};
  const [membersResult,invitationsResult,category]=await Promise.all([
    env.HUAU_DB.prepare(`SELECT op.id as personId,TRIM(op.first_name||' '||op.last_name) as name,op.email,em.member_role as memberRole,em.status,op.user_id as userId FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND em.status IN ('accepted','manual') ORDER BY em.created_at`).bind(row.entryId).all<RegistrationMemberView>(),
    env.HUAU_DB.prepare(`SELECT id,invitee_email as inviteeEmail,member_role as memberRole,status,expires_at as expiresAt,invitee_user_id as inviteeUserId FROM entry_invitations WHERE registration_id=? AND status IN ('pending','accepted','declined') ORDER BY created_at`).bind(row.id).all<RegistrationInvitationView>(),
    categoryById(env,row.categoryId),
  ]);
  const roster=category?await registrationRosterMeta(env,category):{min:null,max:null};
  const canManageInvitations=row.entryType==="pair"?Boolean(row.viewerRole||row.isOwner):row.entryType==="team"?Boolean(row.isOwner||row.viewerRole==="captain"):false;
  return {...row,members:membersResult.results,entryInvitations:invitationsResult.results,canManageInvitations,rosterMin:roster.min,rosterMax:roster.max};
}

async function myRegistrations(request:Request,env:Env,access:AccessHelpers){
  const user=await access.requireUser(request,env);if(!user)return json({ok:false,code:"UNAUTHENTICATED"},{status:401});
  const registrations=await env.HUAU_DB.prepare(`SELECT tr.id,tr.registration_number as registrationNumber,tr.status,tr.participant_count as participantCount,tr.final_amount_minor as finalAmountMinor,tr.currency,tr.waitlist_position as waitlistPosition,t.id as tournamentId,t.name as tournamentName,t.slug,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,e.display_name as entryName,tr.entry_id as entryId,CASE WHEN tr.user_id=? THEN 1 ELSE 0 END as isOwner,(SELECT em.member_role FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=tr.entry_id AND op.user_id=? AND em.status IN ('accepted','manual') LIMIT 1) as viewerRole FROM tournament_registrations tr JOIN tournaments t ON t.id=tr.tournament_id JOIN tournament_categories tc ON tc.id=tr.category_id LEFT JOIN tournament_entries e ON e.id=tr.entry_id WHERE tr.user_id=? OR EXISTS(SELECT 1 FROM entry_members em2 JOIN organization_people op2 ON op2.id=em2.organization_person_id WHERE em2.entry_id=tr.entry_id AND op2.user_id=? AND em2.status IN ('accepted','manual')) ORDER BY tr.created_at DESC`).bind(user.id,user.id,user.id,user.id).all<RegistrationViewerRow>();
  const detailed=await Promise.all(registrations.results.map(row=>registrationDetails(env,row)));
  const invitations=await env.HUAU_DB.prepare(`SELECT i.id,i.status,i.member_role as memberRole,i.invitee_email as inviteeEmail,i.expires_at as expiresAt,t.name as tournamentName,t.slug,tc.name as categoryName,tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.min_age as minAge,tc.max_age as maxAge,e.display_name as entryName,u.name as inviterName FROM entry_invitations i JOIN tournaments t ON t.id=i.tournament_id JOIN tournament_categories tc ON tc.id=i.category_id JOIN tournament_entries e ON e.id=i.entry_id JOIN user u ON u.id=i.inviter_user_id WHERE lower(i.invitee_email)=lower(?) AND i.status='pending' ORDER BY i.created_at DESC`).bind(user.email).all();
  const profile=await profileForUser(env,user.id);return json({ok:true,profile:profile??null,registrations:detailed,invitations:invitations.results});
}

async function registrationManageAccess(registrationId:string,request:Request,env:Env,access:AccessHelpers,allowAdmin=false){
  const user=await access.requireUser(request,env);if(!user)return {response:json({ok:false,code:"UNAUTHENTICATED"},{status:401})};
  const row=await env.HUAU_DB.prepare(`SELECT tr.id,tr.tournament_id as tournamentId,tr.category_id as categoryId,tr.entry_id as entryId,tr.user_id as ownerUserId,tr.status,tc.entry_type as entryType FROM tournament_registrations tr JOIN tournament_categories tc ON tc.id=tr.category_id WHERE tr.id=?`).bind(registrationId).first<{id:string;tournamentId:string;categoryId:string;entryId:string|null;ownerUserId:string;status:string;entryType:"individual"|"pair"|"team"}>();
  if(!row||!row.entryId)return {response:json({ok:false,code:"REGISTRATION_NOT_FOUND"},{status:404})};
  const tournament=await tournamentById(env,row.tournamentId);const category=await categoryById(env,row.categoryId);if(!tournament||!category)return {response:json({ok:false,code:"REGISTRATION_NOT_FOUND"},{status:404})};
  let viewerRole:string|null=null;
  const member=await env.HUAU_DB.prepare(`SELECT em.member_role as memberRole FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND op.user_id=? AND em.status IN ('accepted','manual') LIMIT 1`).bind(row.entryId,user.id).first<{memberRole:string}>();viewerRole=member?.memberRole??null;
  const admin=allowAdmin?await access.isOrgAdmin(user.id,tournament.organizerOrganizationId,env,request):false;
  const canManage=admin||row.ownerUserId===user.id||(row.entryType==="pair"&&Boolean(viewerRole))||(row.entryType==="team"&&viewerRole==="captain");
  if(!canManage)return {response:json({ok:false,code:"FORBIDDEN"},{status:403})};
  return {user,row,tournament,category,admin,viewerRole};
}

async function createOrReplaceInvitation(registrationId:string,request:Request,env:Env,access:AccessHelpers,allowAdmin=false){
  const allowed=await registrationManageAccess(registrationId,request,env,access,allowAdmin);if("response" in allowed)return allowed.response;
  const {row,tournament,category,user}=allowed;if(row.entryType==="individual")return json({ok:false,code:"INVITATIONS_NOT_SUPPORTED"},{status:409});
  if(tournament.structureLocked||category.structureLocked)return json({ok:false,code:"COMPETITION_STRUCTURE_LOCKED"},{status:409});
  type InvitationBody={email?:string;role?:"player"|"substitute"};
  const body:InvitationBody=await readJson<InvitationBody>(request).catch(()=>({}));const email=normalizeEmail(body.email??"");if(!email)return json({ok:false,code:"INVITEE_EMAIL_REQUIRED"},{status:400});
  const accepted=await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM entry_members WHERE entry_id=? AND status IN ('accepted','manual')`).bind(row.entryId).first<{count:number}>();
  if(row.entryType==="pair"&&Number(accepted?.count??0)>=2)return json({ok:false,code:"PAIR_ALREADY_COMPLETE"},{status:409});
  if(row.entryType==="team"){
    const meta=await registrationRosterMeta(env,category);const pending=await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM entry_invitations WHERE registration_id=? AND status='pending'`).bind(registrationId).first<{count:number}>();
    if(meta.max!==null&&Number(accepted?.count??0)+Number(pending?.count??0)>=meta.max)return json({ok:false,code:"TEAM_ROSTER_FULL"},{status:409});
  }
  const existingUser=await env.HUAU_DB.prepare(`SELECT id FROM user WHERE lower(email)=?`).bind(email).first<{id:string}>();
  if(existingUser){
    const alreadyMember=await env.HUAU_DB.prepare(`SELECT 1 as found FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND op.user_id=? AND em.status IN ('accepted','manual') LIMIT 1`).bind(row.entryId,existingUser.id).first<{found:number}>();
    if(alreadyMember)return json({ok:false,code:"INVITEE_ALREADY_IN_ENTRY"},{status:409});
    if(await userAlreadyInCategory(env,existingUser.id,category.id,row.entryId??undefined))return json({ok:false,code:"INVITEE_ALREADY_REGISTERED_IN_CATEGORY"},{status:409});
  }
  if(row.entryType==="pair")await env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='cancelled',updated_at=? WHERE registration_id=? AND status='pending'`).bind(now(),registrationId).run();
  else await env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='cancelled',updated_at=? WHERE registration_id=? AND lower(invitee_email)=lower(?) AND status='pending'`).bind(now(),registrationId,email).run();
  try{await inviteEmail(env,{registrationId,entryId:row.entryId!,tournamentId:row.tournamentId,categoryId:row.categoryId,inviter:user,email,role:body.role??"player"});}catch(error){return json({ok:false,code:error instanceof Error?error.message:"INVITATION_FAILED"},{status:409});}
  await recalcRegistration(env,registrationId);return json({ok:true});
}

async function cancelManagedInvitation(registrationId:string,invitationId:string,request:Request,env:Env,access:AccessHelpers,allowAdmin=false){
  const allowed=await registrationManageAccess(registrationId,request,env,access,allowAdmin);if("response" in allowed)return allowed.response;
  const invitation=await env.HUAU_DB.prepare(`SELECT id,status FROM entry_invitations WHERE id=? AND registration_id=?`).bind(invitationId,registrationId).first<{id:string;status:string}>();if(!invitation)return json({ok:false,code:"INVITATION_NOT_FOUND"},{status:404});if(invitation.status!=="pending")return json({ok:false,code:"INVITATION_ALREADY_RESOLVED"},{status:409});
  await env.HUAU_DB.prepare(`UPDATE entry_invitations SET status='cancelled',updated_at=? WHERE id=?`).bind(now(),invitationId).run();await recalcRegistration(env,registrationId);return json({ok:true});
}

async function cancelRegistration(registrationId:string,request:Request,env:Env,access:AccessHelpers){const user=await access.requireUser(request,env);if(!user)return json({ok:false,code:"UNAUTHENTICATED"},{status:401});const row=await env.HUAU_DB.prepare(`SELECT user_id as userId,status FROM tournament_registrations WHERE id=?`).bind(registrationId).first<{userId:string;status:string}>();if(!row)return json({ok:false,code:"REGISTRATION_NOT_FOUND"},{status:404});if(row.userId!==user.id)return json({ok:false,code:"FORBIDDEN"},{status:403});if(row.status==="cancelled")return json({ok:true});await cancelRegistrationInternal(env,registrationId);return json({ok:true});}

async function adminAccess(tournamentId:string,request:Request,env:Env,access:AccessHelpers){const user=await access.requireUser(request,env);if(!user)return {response:json({ok:false,code:"UNAUTHENTICATED"},{status:401})};const tournament=await tournamentById(env,tournamentId);if(!tournament)return {response:json({ok:false,code:"TOURNAMENT_NOT_FOUND"},{status:404})};if(!await access.isOrgAdmin(user.id,tournament.organizerOrganizationId,env,request))return {response:json({ok:false,code:"FORBIDDEN"},{status:403})};return {user,tournament};}

async function adminRegistrations(tournamentId:string,request:Request,env:Env,access:AccessHelpers){
  const allowed=await adminAccess(tournamentId,request,env,access);if("response" in allowed)return allowed.response;
  const rows=await env.HUAU_DB.prepare(`SELECT tr.id,tr.registration_number as registrationNumber,tr.status,tr.participant_count as participantCount,tr.price_scope as priceScope,tr.base_amount_minor as baseAmountMinor,tr.discount_minor as discountMinor,tr.final_amount_minor as finalAmountMinor,tr.currency,tr.waitlist_position as waitlistPosition,tr.created_at as createdAt,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,e.display_name as entryName,tr.entry_id as entryId,u.name as userName,u.email as userEmail FROM tournament_registrations tr JOIN tournament_categories tc ON tc.id=tr.category_id JOIN user u ON u.id=tr.user_id LEFT JOIN tournament_entries e ON e.id=tr.entry_id WHERE tr.tournament_id=? ORDER BY tc.sort_order,tr.created_at`).bind(tournamentId).all<RegistrationViewerRow&{priceScope:string;baseAmountMinor:number;discountMinor:number;createdAt:number;userName:string;userEmail:string}>();
  const detailed=await Promise.all(rows.results.map(row=>registrationDetails(env,{...row,tournamentId, tournamentName:allowed.tournament.name,slug:allowed.tournament.slug,isOwner:1,viewerRole:null})));
  return json({ok:true,registrations:detailed,publicUrl:`/tournaments/${allowed.tournament.slug}`});
}

async function adminPromote(registrationId:string,request:Request,env:Env,access:AccessHelpers){const row=await env.HUAU_DB.prepare(`SELECT tr.tournament_id as tournamentId,tr.category_id as categoryId,tr.entry_id as entryId,tr.status FROM tournament_registrations tr WHERE tr.id=?`).bind(registrationId).first<{tournamentId:string;categoryId:string;entryId:string|null;status:string}>();if(!row)return json({ok:false,code:"REGISTRATION_NOT_FOUND"},{status:404});const allowed=await adminAccess(row.tournamentId,request,env,access);if("response" in allowed)return allowed.response;if(row.status!=="waitlisted")return json({ok:false,code:"REGISTRATION_NOT_WAITLISTED"},{status:409});const category=await categoryById(env,row.categoryId);if(!category)return json({ok:false,code:"CATEGORY_NOT_FOUND"},{status:404});const occupied=await categoryOccupied(env,row.categoryId);if(category.maxEntries!==null&&occupied>=category.maxEntries)return json({ok:false,code:"CATEGORY_STILL_FULL"},{status:409});const stamp=now();await env.HUAU_DB.batch([env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status='inviting',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp,registrationId),...(row.entryId?[env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='inviting',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp,row.entryId)]:[])]);await compactWaitlist(env,row.categoryId);await recalcRegistration(env,registrationId);return json({ok:true});}

async function adminAdjustment(registrationId:string,request:Request,env:Env,access:AccessHelpers){const row=await env.HUAU_DB.prepare(`SELECT tr.tournament_id as tournamentId,tr.base_amount_minor as baseAmountMinor,tr.entry_id as entryId FROM tournament_registrations tr WHERE tr.id=?`).bind(registrationId).first<{tournamentId:string;baseAmountMinor:number;entryId:string|null}>();if(!row)return json({ok:false,code:"REGISTRATION_NOT_FOUND"},{status:404});const allowed=await adminAccess(row.tournamentId,request,env,access);if("response" in allowed)return allowed.response;const body=await readJson<{kind?:"discount"|"courtesy"|"fixed_total";amountMinor?:number;note?:string}>(request);if(!body.kind||!["discount","courtesy","fixed_total"].includes(body.kind))return json({ok:false,code:"INVALID_ADJUSTMENT"},{status:400});const amount=Math.max(0,Math.trunc(Number(body.amountMinor??0)));const stamp=now();let discount=0;if(body.kind==="courtesy")discount=row.baseAmountMinor;else if(body.kind==="discount")discount=Math.min(row.baseAmountMinor,amount);else discount=Math.max(0,row.baseAmountMinor-amount);await env.HUAU_DB.batch([env.HUAU_DB.prepare(`INSERT INTO registration_adjustments (id,registration_id,kind,amount_minor,note,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)`).bind(uuid(),registrationId,body.kind,amount,body.note?.trim()||null,allowed.user.id,stamp),env.HUAU_DB.prepare(`UPDATE tournament_registrations SET discount_minor=?,final_amount_minor=MAX(0,base_amount_minor-?),updated_at=?,version=version+1 WHERE id=?`).bind(discount,discount,stamp,registrationId)]);await recalcRegistration(env,registrationId);return json({ok:true});}

export async function handleRegistrationApi(request:Request,env:Env,access:AccessHelpers):Promise<Response|null>{
  const url=new URL(request.url);
  const pub=url.pathname.match(/^\/api\/public\/tournaments\/([^/]+)$/);if(pub&&request.method==="GET")return publicTournament(decodeURIComponent(pub[1]!),request,env,access);
  const create=url.pathname.match(/^\/api\/tournaments\/([^/]+)\/categories\/([^/]+)\/register$/);if(create&&request.method==="POST")return createRegistration(decodeURIComponent(create[1]!),decodeURIComponent(create[2]!),request,env,access);
  if(url.pathname==="/api/me/tournament-registrations"&&request.method==="GET")return myRegistrations(request,env,access);
  const invite=url.pathname.match(/^\/api\/entry-invitations\/([^/]+)\/respond$/);if(invite&&request.method==="POST")return respondInvitation(decodeURIComponent(invite[1]!),request,env,access);
  const manageInvite=url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/invitations$/);if(manageInvite&&request.method==="POST")return createOrReplaceInvitation(decodeURIComponent(manageInvite[1]!),request,env,access);
  const removeInvite=url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/invitations\/([^/]+)$/);if(removeInvite&&request.method==="DELETE")return cancelManagedInvitation(decodeURIComponent(removeInvite[1]!),decodeURIComponent(removeInvite[2]!),request,env,access);
  const cancel=url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/cancel$/);if(cancel&&request.method==="POST")return cancelRegistration(decodeURIComponent(cancel[1]!),request,env,access);
  const admin=url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/registrations$/);if(admin&&request.method==="GET")return adminRegistrations(decodeURIComponent(admin[1]!),request,env,access);
  const adminInvite=url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/invitations$/);if(adminInvite&&request.method==="POST")return createOrReplaceInvitation(decodeURIComponent(adminInvite[1]!),request,env,access,true);
  const adminRemoveInvite=url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/invitations\/([^/]+)$/);if(adminRemoveInvite&&request.method==="DELETE")return cancelManagedInvitation(decodeURIComponent(adminRemoveInvite[1]!),decodeURIComponent(adminRemoveInvite[2]!),request,env,access,true);
  const promote=url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/promote$/);if(promote&&request.method==="POST")return adminPromote(decodeURIComponent(promote[1]!),request,env,access);
  const adjustment=url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/adjustment$/);if(adjustment&&request.method==="POST")return adminAdjustment(decodeURIComponent(adjustment[1]!),request,env,access);
  return null;
}
