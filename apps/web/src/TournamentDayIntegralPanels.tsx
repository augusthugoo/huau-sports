/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Locale } from "./i18n";
import type { TournamentDaySession } from "./TournamentDayStorage";
import type { TournamentDaySnapshot } from "./TournamentDayEngine";
import {
  generateLocalTeamStructure,
  localDateTimeToUnix,
  saveLocalTeamLineup,
  unixToLocalDateTime,
} from "./TournamentDayEngine";
import type { TeamFormat, TeamLineupAssignment, TeamRosterMember } from "@huau/core";
import {
  addDayParticipant,
  addScheduleBreak,
  assignParticipantToCategory,
  clearDayCategoryResults,
  clearDaySchedule,
  closeCourt,
  createDayTeam,
  deleteDayTeam,
  ensureDayLocalMeta,
  markStructureDirty,
  moveLocalStandardEntryToGroup,
  moveLocalTeamEntryToGroup,
  participantImpact,
  regenerateGlobalSchedule,
  removeParticipantFromCategory,
  resetDayCategoryCompetition,
  restoreParticipant,
  setParticipantNoShow,
  setScheduleUnitLocked,
  teamEntryRating,
  updateDayParticipant,
  updateDayTeam,
  updateScheduleUnit,
  type AdminMergePreview,
  type TournamentDayReformSnapshot,
} from "./TournamentDayReformEngine";

export type DayMutate = (
  fn: (snapshot: TournamentDayReformSnapshot) => void,
  message?: string,
  kind?: "structure" | "live" | "neutral",
) => Promise<void>;

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const rating = (value: number) => value > 0 ? value.toFixed(3) : "—";

function categoryNames(snapshot: TournamentDayReformSnapshot, profileId: string) {
  const names = new Map((snapshot.workspace.core.categories as any[]).map((category) => [String(category.id), String(category.name)] as const));
  return (snapshot.workspace.participants.playerCategories as any[])
    .filter((row) => String(row.playerProfileId) === profileId)
    .map((row) => names.get(String(row.categoryId)) ?? String(row.categoryId));
}

function playerTeam(snapshot: TournamentDayReformSnapshot, player: any) {
  const personId = String(player.organizationPersonId ?? player.id);
  for (const category of snapshot.team.categories as any[]) {
    for (const entry of category.entries ?? []) {
      if ((entry.roster ?? []).some((member: any) => String(member.personId) === personId)) return entry.displayName;
    }
  }
  return "—";
}

export function IntegralParticipantsPanel({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const [mode, setMode] = useState<"players" | "teams">("players");
  const teamCategories = snapshot.team.categories as any[];
  return (
    <section className="td-stack">
      <article className="panel td-dense-panel">
        <div className="panel-title">
          <div><div className="eyebrow">OPERACIÓN</div><h2>{tr(locale, "Participantes", "Participants")}</h2></div>
          <div className="td-segmented">
            <button className={mode === "players" ? "active" : ""} onClick={() => setMode("players")}>{tr(locale, "Jugadores", "Players")}</button>
            {teamCategories.length ? <button className={mode === "teams" ? "active" : ""} onClick={() => setMode("teams")}>{tr(locale, "Equipos", "Teams")}</button> : null}
          </div>
        </div>
      </article>
      {mode === "players" ? <PlayerTable locale={locale} snapshot={snapshot} mutate={mutate} /> : <TeamCards locale={locale} snapshot={snapshot} mutate={mutate} />}
    </section>
  );
}

function PlayerTable({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const meta = ensureDayLocalMeta(snapshot);
  const categories = snapshot.workspace.core.categories as any[];
  const players = snapshot.workspace.participants.players as any[];
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [gender, setGender] = useState("");
  const [source, setSource] = useState("");
  const visible = players.filter((player) => {
    const text = `${player.displayName ?? ""} ${player.club ?? ""} ${player.contact ?? ""}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (gender && String(player.sportGender) !== gender) return false;
    if (source === "local" && !meta.localParticipantIds.includes(String(player.id))) return false;
    if (source === "admin" && meta.localParticipantIds.includes(String(player.id))) return false;
    if (category && !(snapshot.workspace.participants.playerCategories as any[]).some((row) => String(row.playerProfileId) === String(player.id) && String(row.categoryId) === category)) return false;
    return true;
  });
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const categoryIds = categories.filter((cat) => data.get(`cat:${cat.id}`) === "on").map((cat) => String(cat.id));
    await mutate((next) => addDayParticipant(next, {
      name: String(data.get("name") ?? "").trim(),
      sportGender: String(data.get("sportGender") ?? "unspecified") as any,
      club: String(data.get("club") ?? "").trim(),
      contact: String(data.get("contact") ?? "").trim(),
      duprSingles: Number(data.get("duprSingles") ?? 0),
      duprDoubles: Number(data.get("duprDoubles") ?? 0),
      categoryIds,
    }), tr(locale, "Jugador creado localmente.", "Player created locally."));
    form.reset();
  };
  return <>
    <article className="panel td-dense-panel">
      <form className="td-inline-form td-inline-dense" onSubmit={add}>
        <label><span>{tr(locale,"Nombre","Name")}</span><input name="name" required /></label>
        <label><span>{tr(locale,"Género","Gender")}</span><select name="sportGender" defaultValue="unspecified"><option value="unspecified">—</option><option value="male">M</option><option value="female">F</option></select></label>
        <label><span>Club</span><input name="club" /></label><label><span>{tr(locale,"Contacto","Contact")}</span><input name="contact" /></label>
        <label><span>DUPR S</span><input name="duprSingles" type="number" min="0" max="8" step=".001" /></label><label><span>DUPR D</span><input name="duprDoubles" type="number" min="0" max="8" step=".001" /></label>
        <details className="td-inline-details"><summary>{tr(locale,"Categorías","Categories")}</summary><div className="td-chip-list">{categories.map((cat)=><label className="check" key={cat.id}><input type="checkbox" name={`cat:${cat.id}`} /><span>{cat.name}</span></label>)}</div></details>
        <button className="light">{tr(locale,"Agregar","Add")}</button>
      </form>
    </article>
    <article className="panel wide td-dense-panel">
      <div className="td-filterbar"><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder={tr(locale,"Buscar jugador…","Search player…")} /><select value={category} onChange={(e)=>setCategory(e.target.value)}><option value="">{tr(locale,"Todas las categorías","All categories")}</option>{categories.map((cat)=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select><select value={gender} onChange={(e)=>setGender(e.target.value)}><option value="">{tr(locale,"Todos los géneros","All genders")}</option><option value="male">M</option><option value="female">F</option><option value="unspecified">—</option></select><select value={source} onChange={(e)=>setSource(e.target.value)}><option value="">{tr(locale,"Admin + local","Admin + local")}</option><option value="admin">Admin</option><option value="local">Local</option></select><span>{visible.length}/{players.length}</span></div>
      <div className="table-wrap"><table className="td-compact-table"><thead><tr><th>{tr(locale,"Jugador","Player")}</th><th>{tr(locale,"Sexo","Sex")}</th><th>DUPR S</th><th>DUPR D</th><th>{tr(locale,"Categorías","Categories")}</th><th>{tr(locale,"Equipo","Team")}</th><th>{tr(locale,"Estado","Status")}</th><th /></tr></thead><tbody>{visible.map((player)=><PlayerRow key={player.id} locale={locale} snapshot={snapshot} player={player} mutate={mutate} />)}</tbody></table></div>
    </article>
  </>;
}

function PlayerRow({ locale, snapshot, player, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; player: any; mutate: DayMutate }) {
  const categories = snapshot.workspace.core.categories as any[];
  const assigned = new Set((snapshot.workspace.participants.playerCategories as any[]).filter((row)=>String(row.playerProfileId)===String(player.id)).map((row)=>String(row.categoryId)));
  const tombstoned = Boolean(ensureDayLocalMeta(snapshot).participantTombstones[String(player.id)]);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); await mutate((next) => {
    updateDayParticipant(next, String(player.id), { displayName:String(data.get("displayName")??"").trim(), sportGender:String(data.get("sportGender")??"unspecified") as any, club:String(data.get("club")??"").trim(), contact:String(data.get("contact")??"").trim(), duprSingles:Number(data.get("duprSingles")??0), duprDoubles:Number(data.get("duprDoubles")??0) });
    const current = new Set((next.workspace.participants.playerCategories as any[]).filter((row)=>String(row.playerProfileId)===String(player.id)).map((row)=>String(row.categoryId)));
    for (const category of categories) {
      const categoryId = String(category.id);
      const wanted=data.get(`cat:${category.id}`)==="on";
      const has=current.has(categoryId);
      if (wanted&&!has) assignParticipantToCategory(next,String(player.id),categoryId);
      if (!wanted&&has) removeParticipantFromCategory(next,String(player.id),categoryId);
    }
  }, tr(locale,"Jugador actualizado localmente.","Player updated locally.")); };
  const toggleNoShow = async () => {
    if (tombstoned) return mutate((next)=>restoreParticipant(next,String(player.id)),tr(locale,"Jugador restaurado localmente.","Player restored locally."));
    const impact = participantImpact(snapshot,String(player.id));
    if ((impact.structuredCategoryIds.length || impact.scheduledRows || impact.finishedMatches) && !window.confirm(tr(locale,`Este cambio afecta ${impact.structuredCategoryIds.length} categoría(s), ${impact.scheduledRows} bloque(s) programados y ${impact.finishedMatches} resultado(s). No se borrarán resultados silenciosamente. ¿Marcar no-show?`,`This affects ${impact.structuredCategoryIds.length} category structure(s), ${impact.scheduledRows} scheduled block(s) and ${impact.finishedMatches} result(s). Results will not be silently deleted. Mark no-show?`))) return;
    await mutate((next)=>setParticipantNoShow(next,String(player.id)),tr(locale,"Jugador marcado no-show localmente.","Player marked no-show locally."));
  };
  return <tr className={tombstoned?"is-muted":""}><td><strong>{player.displayName}</strong><small>{player.club||"—"}</small></td><td>{player.sportGender==="male"?"M":player.sportGender==="female"?"F":"—"}</td><td>{rating(Number(player.duprSingles??0))}</td><td>{rating(Number(player.duprDoubles??0))}</td><td><small>{categoryNames(snapshot,String(player.id)).join(" · ")||"—"}</small></td><td><small>{playerTeam(snapshot,player)}</small></td><td><span className="pill">{tombstoned?"NO SHOW":player.playerStatus}</span></td><td><details className="td-row-menu"><summary>•••</summary><form className="td-row-editor" onSubmit={save}><label><span>{tr(locale,"Nombre","Name")}</span><input name="displayName" defaultValue={player.displayName} required /></label><label><span>{tr(locale,"Género","Gender")}</span><select name="sportGender" defaultValue={player.sportGender??"unspecified"}><option value="unspecified">—</option><option value="male">M</option><option value="female">F</option></select></label><label><span>Club</span><input name="club" defaultValue={player.club??""} /></label><label><span>{tr(locale,"Contacto","Contact")}</span><input name="contact" defaultValue={player.contact??""} /></label><label><span>DUPR S</span><input name="duprSingles" type="number" step=".001" defaultValue={player.duprSingles??0} /></label><label><span>DUPR D</span><input name="duprDoubles" type="number" step=".001" defaultValue={player.duprDoubles??0} /></label><div className="td-chip-list">{categories.map((cat)=><label className="check compact-check" key={cat.id}><input type="checkbox" name={`cat:${cat.id}`} defaultChecked={assigned.has(String(cat.id))}/><span>{cat.name}</span></label>)}</div><button className="light small">{tr(locale,"Guardar","Save")}</button><button type="button" className={tombstoned?"ghost small":"danger small"} onClick={()=>void toggleNoShow()}>{tombstoned?tr(locale,"Restaurar","Restore"):tr(locale,"No-show / retirar","No-show / withdraw")}</button></form></details></td></tr>;
}

function TeamCards({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const categories = snapshot.team.categories as any[]; const [categoryId,setCategoryId]=useState(String(categories[0]?.id??"")); const [openId,setOpenId]=useState("");
  const category=categories.find((c)=>String(c.id)===categoryId)??categories[0];
  if(!category)return <div className="empty-state">{tr(locale,"No hay categorías Team.","No Team categories.")}</div>;
  const create=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=e.currentTarget;const d=new FormData(f);await mutate(next=>{createDayTeam(next,String(category.id),String(d.get("name")??"").trim())},tr(locale,"Equipo creado localmente.","Team created locally."));f.reset()};
  return <><article className="panel td-dense-panel"><div className="td-category-tabs">{categories.map((c)=><button key={c.id} className={String(c.id)===String(category.id)?"light small":"ghost small"} onClick={()=>setCategoryId(String(c.id))}>{c.name}</button>)}</div><form className="td-inline-form td-inline-dense" onSubmit={create}><label><span>{tr(locale,"Nombre del equipo","Team name")}</span><input name="name" required /></label><button className="light small">{tr(locale,"Crear equipo","Create team")}</button></form></article><div className="td-team-compact-grid">{category.entries.map((entry:any)=>{const captain=(entry.roster??[]).find((m:any)=>m.role==="captain");return <article className="td-team-compact-card" key={entry.id}><div><span className="eyebrow">{category.name}</span><h3>{entry.displayName}</h3></div><dl><div><dt>{tr(locale,"Jugadores","Players")}</dt><dd>{entry.roster?.length??0}</dd></div><div><dt>{tr(locale,"Capitán","Captain")}</dt><dd>{captain?.name??"—"}</dd></div><div><dt>DUPR</dt><dd>{rating(teamEntryRating(snapshot,String(category.id),String(entry.id)))}</dd></div></dl><div className="form-actions"><button className="ghost small" onClick={()=>setOpenId(String(entry.id))}>{tr(locale,"Abrir roster","Open roster")}</button><button className="danger small" onClick={()=>{if(window.confirm(tr(locale,"¿Eliminar este equipo operativo?","Delete this operational team?")))void mutate(next=>deleteDayTeam(next,String(category.id),String(entry.id)),tr(locale,"Equipo eliminado localmente.","Team deleted locally."))}}>×</button></div></article>})}</div>{openId?<RosterDrawer locale={locale} snapshot={snapshot} category={category} entry={category.entries.find((e:any)=>String(e.id)===openId)} mutate={mutate} close={()=>setOpenId("")} />:null}</>;
}

function RosterDrawer({locale,snapshot,category,entry,mutate,close}:{locale:Locale;snapshot:TournamentDayReformSnapshot;category:any;entry:any;mutate:DayMutate;close:()=>void}){
  const [search,setSearch]=useState(""); const profiles=snapshot.team.profiles as any[]; const occupied=new Map<string,string>(); for(const other of category.entries){if(String(other.id)===String(entry.id))continue;for(const member of other.roster??[])occupied.set(String(member.personId),String(other.displayName))}
  const rosterById=new Map((entry.roster??[]).map((m:any)=>[String(m.personId),m])); const candidates=profiles.filter((p)=>!search||String(p.displayName).toLowerCase().includes(search.toLowerCase()));
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const d=new FormData(e.currentTarget);const roster:TeamRosterMember[]=profiles.filter((p)=>d.get(`member:${p.personId}`)==="on").map((p)=>({personId:String(p.personId),name:String(p.displayName),sportGender:p.sportGender,role:String(d.get(`role:${p.personId}`)??"player") as any}));await mutate(next=>updateDayTeam(next,String(category.id),String(entry.id),{name:String(d.get("teamName")??entry.displayName).trim(),roster}),tr(locale,"Roster guardado localmente.","Roster saved locally."));close()};
  return <div className="td-drawer-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)close()}}><aside className="td-drawer"><header><div><span className="eyebrow">{category.name}</span><h2>{entry.displayName}</h2></div><button className="ghost small" onClick={close}>×</button></header><form onSubmit={save}><label><span>{tr(locale,"Nombre","Name")}</span><input name="teamName" defaultValue={entry.displayName} /></label><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder={tr(locale,"Buscar jugadores…","Search players…")} /><div className="td-roster-current"><strong>{tr(locale,"Roster","Roster")}</strong>{candidates.map((profile)=>{const member=rosterById.get(String(profile.personId)) as any;const owner=occupied.get(String(profile.personId));return <div key={profile.personId} className={owner?"is-disabled":""}><label className="check"><input type="checkbox" name={`member:${profile.personId}`} defaultChecked={Boolean(member)} disabled={Boolean(owner)} /><span>{profile.displayName} · {profile.sportGender==="male"?"M":profile.sportGender==="female"?"F":"—"} · D {rating(Number(profile.duprDoubles??0))}{owner?` · ${owner}`:""}</span></label><select name={`role:${profile.personId}`} defaultValue={member?.role??"player"} disabled={Boolean(owner)}><option value="player">Player</option><option value="captain">Captain</option><option value="substitute">Sub</option></select></div>})}</div><button className="light full">{tr(locale,"Guardar roster","Save roster")}</button></form></aside></div>;
}

export function FormatSimulator({ locale, snapshot }: { locale: Locale; snapshot: TournamentDayReformSnapshot }) {
  const settings=snapshot.workspace.core.settings as any; const [entries,setEntries]=useState(12);const [groups,setGroups]=useState(3);const [minutes,setMinutes]=useState(Number(settings.defaultMatchMinutes??30));const [courts,setCourts]=useState(Number(snapshot.workspace.core.tournament.courtCount??1));
  const sizes=Array.from({length:Math.max(1,Math.min(groups,entries))},(_,i)=>Math.floor(entries/groups)+(i<entries%groups?1:0)); const groupMatches=sizes.reduce((sum,size)=>sum+size*(size-1)/2,0); const qualifiers=Math.min(entries,Math.max(2,groups*2)); const draw=Math.pow(2,Math.ceil(Math.log2(qualifiers))); const playoff=Math.max(1,draw-1); const matches=Math.round(groupMatches+playoff); const courtMinutes=Math.ceil(matches/Math.max(1,courts))*minutes; const [sh=9,sm=0]=String(settings.dailyStart??"09:00").split(":").map(Number),[eh=20,em=0]=String(settings.dailyEnd??"20:00").split(":").map(Number); const available=(eh*60+em)-(sh*60+sm);
  return <article className="panel td-format-simulator"><div className="eyebrow">SIMULADOR</div><h2>{tr(locale,"Simular capacidad","Capacity simulator")}</h2><div className="td-inline-form td-inline-dense"><label><span>{tr(locale,"Entradas","Entries")}</span><input type="number" min="2" value={entries} onChange={(e)=>setEntries(Math.max(2,Number(e.target.value)))}/></label><label><span>{tr(locale,"Grupos","Groups")}</span><input type="number" min="1" value={groups} onChange={(e)=>setGroups(Math.max(1,Number(e.target.value)))}/></label><label><span>{tr(locale,"Canchas","Courts")}</span><input type="number" min="1" value={courts} onChange={(e)=>setCourts(Math.max(1,Number(e.target.value)))}/></label><label><span>Min</span><input type="number" min="5" value={minutes} onChange={(e)=>setMinutes(Math.max(5,Number(e.target.value)))}/></label></div><div className="td-sim-output"><span><b>{matches}</b>{tr(locale,"partidos aprox.","approx. matches")}</span><span><b>{Math.floor(courtMinutes/60)}h {courtMinutes%60}m</b>{tr(locale,"tiempo por cancha aprox.","approx. court time")}</span><span><b>{sizes.join(" / ")}</b>{tr(locale,"balance grupos","group balance")}</span><span className={courtMinutes>available?"bad":"good"}><b>{courtMinutes>available?tr(locale,"No entra","Doesn't fit"):tr(locale,"Viable","Feasible")}</b>{tr(locale,"ventana diaria","daily window")}</span></div></article>;
}

export function IntegralTeamCompetitionPanel({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const categories = snapshot.team.categories as any[];
  const [categoryId, setCategoryId] = useState(String(categories[0]?.id ?? ""));
  const [method, setMethod] = useState<"rating" | "manual" | "random" | "live">("rating");
  const [liveOrder, setLiveOrder] = useState<string[]>([]);
  const [liveGroupCount, setLiveGroupCount] = useState(1);
  const [revealed, setRevealed] = useState(0);
  const category = categories.find((candidate) => String(candidate.id) === categoryId) ?? categories[0];
  if (!category) return null;
  const entries = [...(category.entries ?? [])];
  const orderedEntries = [...entries].sort(
    (a: any, b: any) =>
      Number(a.seedOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.seedOrder ?? Number.MAX_SAFE_INTEGER) ||
      teamEntryRating(snapshot, String(category.id), String(b.id)) - teamEntryRating(snapshot, String(category.id), String(a.id)) ||
      String(a.displayName).localeCompare(String(b.displayName)),
  );
  const setManualOrder = (entryId: string, direction: -1 | 1) => {
    const ids = orderedEntries.map((entry: any) => String(entry.id));
    const index = ids.indexOf(entryId);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ids.length) return;
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
    void mutate((next) => {
      const nextCategory = (next.team.categories as any[]).find((candidate) => String(candidate.id) === String(category.id));
      nextCategory.entries.forEach((entry: any) => {
        const position = ids.indexOf(String(entry.id));
        entry.seedOrder = position >= 0 ? position + 1 : Number.MAX_SAFE_INTEGER;
      });
      markStructureDirty(next);
    }, tr(locale, "Orden manual actualizado.", "Manual order updated."));
  };
  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const groups = Math.max(1, Number(data.get("groups") ?? 1));
    if (method === "live") {
      const order = [...entries].sort(() => Math.random() - 0.5).map((entry: any) => String(entry.id));
      setLiveOrder(order);
      setLiveGroupCount(groups);
      setRevealed(0);
      return;
    }
    await mutate((next) => {
      const nextCategory = (next.team.categories as any[]).find((candidate) => String(candidate.id) === String(category.id));
      let ids = nextCategory.entries.map((entry: any) => String(entry.id));
      if (method === "rating") {
        ids = [...nextCategory.entries]
          .sort((a: any, b: any) => teamEntryRating(next, String(category.id), String(b.id)) - teamEntryRating(next, String(category.id), String(a.id)))
          .map((entry: any) => String(entry.id));
      } else if (method === "random") {
        ids = [...ids].sort(() => Math.random() - 0.5);
      }
      nextCategory.entries.forEach((entry: any) => {
        const position = ids.indexOf(String(entry.id));
        entry.seedOrder = position >= 0 ? position + 1 : Number.MAX_SAFE_INTEGER;
        entry.seedRating = teamEntryRating(next, String(category.id), String(entry.id));
      });
      generateLocalTeamStructure(next, String(category.id), groups);
      markStructureDirty(next);
    }, tr(locale, "Estructura Team generada.", "Team structure generated."));
  };
  const finishLive = async () => {
    if (revealed < liveOrder.length) return;
    await mutate((next) => {
      const nextCategory = (next.team.categories as any[]).find((candidate) => String(candidate.id) === String(category.id));
      nextCategory.entries.forEach((entry: any) => {
        const position = liveOrder.indexOf(String(entry.id));
        entry.seedOrder = position >= 0 ? position + 1 : Number.MAX_SAFE_INTEGER;
        entry.seedRating = teamEntryRating(next, String(category.id), String(entry.id));
      });
      generateLocalTeamStructure(next, String(category.id), liveGroupCount);
      markStructureDirty(next);
    }, tr(locale, "Sorteo Team aplicado.", "Team live draw applied."));
    setLiveOrder([]);
  };
  const format = category.format as TeamFormat | null;
  return <section className="td-stack">
    <article className="panel td-dense-panel">
      <div className="panel-title"><div><div className="eyebrow">TEAM · COMPETENCIA</div><h2>{tr(locale,"Sembrado → Grupos → Cuadro","Seeding → Groups → Bracket")}</h2></div></div>
      <div className="td-category-tabs">{categories.map((candidate)=><button key={candidate.id} className={String(candidate.id)===String(category.id)?"light small":"ghost small"} onClick={()=>setCategoryId(String(candidate.id))}>{candidate.name}</button>)}</div>
      <form className="td-inline-form td-inline-dense" onSubmit={generate}>
        <label><span>{tr(locale,"Método","Method")}</span><select value={method} onChange={(event)=>setMethod(event.target.value as any)}><option value="rating">DUPR / rating</option><option value="manual">{tr(locale,"Manual","Manual")}</option><option value="random">{tr(locale,"Aleatorio","Random")}</option><option value="live">{tr(locale,"Sorteo en vivo","Live draw")}</option></select></label>
        <label><span>{tr(locale,"Grupos","Groups")}</span><input name="groups" type="number" min="1" max={Math.max(1,Math.floor(entries.length/2))} defaultValue={Math.max(1,new Set((category.groups??[]).map((group:any)=>group.id)).size||1)} /></label>
        <button className="light" disabled={!format||entries.length<2}>{tr(locale,"Generar / regenerar","Generate / regenerate")}</button>
      </form>
      <p className="muted">{tr(locale,"Rating Team = promedio de DUPR Doubles del roster activo. El orden manual, aleatorio o sorteado se persiste como seedOrder local.","Team rating = average Doubles DUPR across the active roster. Manual, random or live-draw order is persisted as local seedOrder.")}</p>
      <div className="td-seed-list">{orderedEntries.map((entry:any,index:number)=><span key={entry.id}><b>{index+1}</b>{entry.displayName}<em>{rating(teamEntryRating(snapshot,String(category.id),String(entry.id)))}</em>{method==="manual"?<span className="td-seed-actions"><button type="button" className="ghost small" disabled={index===0} onClick={()=>setManualOrder(String(entry.id),-1)}>↑</button><button type="button" className="ghost small" disabled={index===orderedEntries.length-1} onClick={()=>setManualOrder(String(entry.id),1)}>↓</button></span>:null}</span>)}</div>
    </article>
    {liveOrder.length?<article className="panel td-live-draw"><div className="eyebrow">LIVE DRAW</div><h2>{revealed?entries.find((entry:any)=>String(entry.id)===liveOrder[revealed-1])?.displayName:"—"}</h2><span>{revealed}/{liveOrder.length}</span><div className="form-actions"><button className="light" disabled={revealed>=liveOrder.length} onClick={()=>setRevealed(value=>Math.min(liveOrder.length,value+1))}>{tr(locale,"Sortear siguiente","Draw next")}</button><button className="ghost" disabled={revealed<liveOrder.length} onClick={()=>void finishLive()}>{tr(locale,"Aplicar sorteo","Apply draw")}</button></div></article>:null}
    {category.groups?.length?<TeamGroupEditor locale={locale} category={category} mutate={mutate}/>:null}
    {category.encounters?.length?<TeamLineups locale={locale} category={category} mutate={mutate}/>:null}
    {category.standings?.length?<article className="panel wide"><div className="eyebrow">STANDINGS</div><div className="td-standing-grid">{category.standings.map((standing:any)=><div className="td-standing-card" key={standing.groupId}><strong>{tr(locale,"Grupo","Group")} {standing.groupName}</strong>{standing.rows.map((row:any,index:number)=><span key={row.entryId}>{index+1}. {row.entryName} · <b>{row.standingPoints} PTS</b> · {row.wins}-{row.losses}</span>)}</div>)}</div></article>:null}
  </section>;
}

function TeamGroupEditor({locale,category,mutate}:{locale:Locale;category:any;mutate:DayMutate}){const groupIds:string[]=[...new Set<string>((category.groups??[]).map((r:any)=>String(r.id)))];return <article className="panel wide td-dense-panel"><div className="eyebrow">GRUPOS EDITABLES</div><h2>{tr(locale,"Asignación manual Team","Manual Team assignment")}</h2><div className="td-group-grid">{groupIds.map((id)=>{const rows=category.groups.filter((r:any)=>String(r.id)===id);return <div key={id}><strong>{tr(locale,"Grupo","Group")} {rows[0]?.name}</strong>{rows.map((row:any,i:number)=><span key={row.entryId}><b>{i+1}.</b>{row.entryName}<select value={id} onChange={(e)=>void mutate(next=>moveLocalTeamEntryToGroup(next,String(category.id),String(row.entryId),e.target.value),tr(locale,"Equipo movido y estructura Team recalculada.","Team moved and Team structure rebuilt."))}>{groupIds.map((gid)=>{const target=category.groups.find((r:any)=>String(r.id)===gid);return <option key={gid} value={gid}>{tr(locale,"Grupo","Group")} {target?.name}</option>})}</select></span>)}</div>})}</div></article>}

function TeamLineups({locale,category,mutate}:{locale:Locale;category:any;mutate:DayMutate}){return <article className="panel wide"><div className="eyebrow">LINEUPS</div><h2>{tr(locale,"Alineaciones por serie","Encounter lineups")}</h2><div className="td-lineup-list">{category.encounters.filter((e:any)=>e.status!=="bye").map((enc:any)=><LineupEncounter key={enc.id} locale={locale} category={category} encounter={enc} mutate={mutate}/>)}</div></article>}
function LineupEncounter({locale,category,encounter,mutate}:{locale:Locale;category:any;encounter:any;mutate:DayMutate}){const side=(entryId:string,label:string)=>{const entry=category.entries.find((e:any)=>String(e.id)===String(entryId));const existing=encounter.lineups?.find((l:any)=>String(l.entryId)===String(entryId));const checked=new Set((existing?.assignments??[]).map((a:any)=>`${a.rubberKey}:${a.personId}`));const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const d=new FormData(e.currentTarget);const assignments:TeamLineupAssignment[]=category.format.encounter.rubbers.map((r:any)=>({rubberKey:r.key,personIds:(entry.roster??[]).filter((m:any)=>d.get(`${r.key}:${m.personId}`)==="on").map((m:any)=>m.personId)}));await mutate(next=>saveLocalTeamLineup(next,String(category.id),String(encounter.id),String(entryId),assignments),tr(locale,"Alineación bloqueada localmente.","Lineup locked locally."))};return <form className="td-lineup-side" onSubmit={save}><h4>{label}</h4>{category.format.encounter.rubbers.map((r:any)=><div className="td-lineup-rubber" key={r.key}><strong>{r.label}</strong><div>{(entry.roster??[]).map((m:any)=><label className="check compact-check" key={m.personId}><input type="checkbox" name={`${r.key}:${m.personId}`} defaultChecked={checked.has(`${r.key}:${m.personId}`)}/><span>{m.name}</span></label>)}</div></div>)}<button className="light small">{existing?tr(locale,"Rebloquear","Relock"):tr(locale,"Bloquear","Lock")}</button></form>};return <details className="td-lineup-encounter"><summary><strong>{encounter.sideA} vs {encounter.sideB}</strong><span>{encounter.roundLabel??encounter.stage}</span></summary><div className="td-lineup-sides">{encounter.entryAId?side(encounter.entryAId,encounter.sideA):null}{encounter.entryBId?side(encounter.entryBId,encounter.sideB):null}</div></details>}

export function IntegralStandardGroupEditor({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const competitions=(snapshot.workspace.standard.competitions as any[]).filter((competition)=>competition.groups?.length); const [categoryId,setCategoryId]=useState(String(competitions[0]?.categoryId??"")); const competition=competitions.find((candidate)=>String(candidate.categoryId)===categoryId)??competitions[0]; if(!competition)return null;
  return <article className="panel wide td-dense-panel"><div className="panel-title"><div><div className="eyebrow">STANDARD · GRUPOS EDITABLES</div><h2>{tr(locale,"Asignación manual","Manual assignment")}</h2></div></div><div className="td-category-tabs">{competitions.map((candidate)=><button key={candidate.categoryId} className={String(candidate.categoryId)===String(competition.categoryId)?"light small":"ghost small"} onClick={()=>setCategoryId(String(candidate.categoryId))}>{(snapshot.workspace.core.categories as any[]).find((c)=>String(c.id)===String(candidate.categoryId))?.name??candidate.categoryId}</button>)}</div><div className="td-group-grid">{competition.groups.map((group:any)=><div key={group.id}><strong>{tr(locale,"Grupo","Group")} {group.name}</strong>{group.entries.map((entry:any,index:number)=><span key={entry.id}><b>{index+1}.</b> {entry.name}<select value={group.id} onChange={(e)=>void mutate(next=>moveLocalStandardEntryToGroup(next,String(competition.categoryId),String(entry.id),e.target.value),tr(locale,"Entrada movida y grupo recalculado.","Entry moved and group rebuilt."))}>{competition.groups.map((target:any)=><option key={target.id} value={target.id}>{tr(locale,"Grupo","Group")} {target.name}</option>)}</select></span>)}</div>)}</div></article>;
}

export function IntegralSchedulePanel({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: DayMutate }) {
  const schedule=[...(snapshot.workspace.schedule.schedule as any[])].sort((a,b)=>Number(a.startAt)-Number(b.startAt)||String(a.courtLabel).localeCompare(String(b.courtLabel)));
  const scheduleMeta=ensureDayLocalMeta(snapshot).schedule;
  const settings=snapshot.workspace.core.settings as any;
  const saveOperatingWindow=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);await mutate(next=>{const target=next.workspace.core.settings as any;target.dailyStart=String(data.get("dailyStart")??"09:00");target.dailyEnd=String(data.get("dailyEnd")??"20:00");target.defaultMatchMinutes=Math.max(5,Number(data.get("matchMinutes")??30));target.minimumRestSlots=Math.max(0,Number(data.get("minimumRestSlots")??1));target.preferredRestSlots=Math.max(target.minimumRestSlots,Number(data.get("preferredRestSlots")??target.minimumRestSlots));},tr(locale,"Ventana operativa actualizada. Regenerá el cronograma para aplicarla.","Operating window updated. Regenerate the schedule to apply it."),"structure");};
  const conflicts=scheduleMeta.lastConflicts;
  const blocks=useMemo(()=>{const map=new Map<string,any[]>();for(const row of schedule){const key=String(row.scheduleUnitId??row.id);const list=map.get(key)??[];list.push(row);map.set(key,list)}return [...map.entries()]},[schedule]);
  const addCourtClosure=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const start=String(data.get("start")??"");const end=String(data.get("end")??"");await mutate(next=>closeCourt(next,Math.max(1,Number(data.get("court")??1)),localDateTimeToUnix(start.slice(0,10),start.slice(11,16)),localDateTimeToUnix(end.slice(0,10),end.slice(11,16)),String(data.get("label")??"").trim()||tr(locale,"Cancha cerrada","Court closed")),tr(locale,"Cierre de cancha agregado.","Court closure added."));};
  const addBreak=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);const start=String(data.get("start")??"");const end=String(data.get("end")??"");await mutate(next=>addScheduleBreak(next,localDateTimeToUnix(start.slice(0,10),start.slice(11,16)),localDateTimeToUnix(end.slice(0,10),end.slice(11,16)),String(data.get("label")??"").trim()||tr(locale,"Descanso","Break")),tr(locale,"Descanso agregado al scheduler.","Scheduler break added."));};
  return <section className="td-stack">
    <article className="panel td-dense-panel">
      <div className="panel-title"><div><div className="eyebrow">GLOBAL SCHEDULER</div><h2>{tr(locale,"Cronograma completo","Complete schedule")}</h2></div><span>{blocks.length} {tr(locale,"bloques","blocks")}</span></div>
      <div className="form-actions"><button className="light" onClick={()=>void mutate(next=>{regenerateGlobalSchedule(next)},tr(locale,"Cronograma global regenerado.","Global schedule regenerated."))}>{tr(locale,"Regenerar cronograma completo","Regenerate complete schedule")}</button><button className="ghost" onClick={()=>void mutate(next=>{regenerateGlobalSchedule(next,{onlyUnlocked:true})},tr(locale,"Se regeneró sólo lo no bloqueado.","Only unlocked blocks were regenerated."))}>{tr(locale,"Regenerar solo no bloqueados","Regenerate unlocked only")}</button></div>
      <p className="muted">{tr(locale,"Standard y Team compiten por las mismas canchas. Team reserva la serie completa en una cancha. Descanso mínimo y fin de jornada son restricciones duras.","Standard and Team share the same court pool. Team reserves the full encounter on one court. Minimum rest and daily end are hard constraints.")}</p>
      <form className="td-inline-form td-inline-dense td-schedule-window" onSubmit={saveOperatingWindow}><label><span>{tr(locale,"Inicio","Start")}</span><input name="dailyStart" type="time" defaultValue={String(settings.dailyStart??"09:00")} required /></label><label><span>{tr(locale,"Fin duro","Hard end")}</span><input name="dailyEnd" type="time" defaultValue={String(settings.dailyEnd??"20:00")} required /></label><label><span>{tr(locale,"Duración","Duration")}</span><input name="matchMinutes" type="number" min="5" defaultValue={Number(settings.defaultMatchMinutes??30)} /></label><label><span>{tr(locale,"Descanso mínimo","Minimum rest")}</span><input name="minimumRestSlots" type="number" min="0" defaultValue={Number(settings.minimumRestSlots??1)} /></label><label><span>{tr(locale,"Descanso preferido","Preferred rest")}</span><input name="preferredRestSlots" type="number" min="0" defaultValue={Number(settings.preferredRestSlots??settings.minimumRestSlots??1)} /></label><button className="ghost small">{tr(locale,"Guardar ventana","Save window")}</button></form>
      {conflicts.length ? <details className="td-conflict-summary"><summary><div><b>{conflicts.length} {tr(locale,"bloque(s) no pudieron programarse","block(s) could not be scheduled")}</b><span>{tr(locale,"El scheduler respetó el fin duro, descansos y restricciones. Abrí para ver detalles técnicos.","The scheduler respected hard end, rest and restrictions. Open for technical details.")}</span></div><em>{tr(locale,"Ver detalles","Details")}</em></summary><div className="td-conflict-details">{conflicts.map((conflict,index)=><div className="warning-line" key={`${conflict.code}-${index}`}><b>{conflict.code}</b> · {conflict.message}</div>)}</div></details> : null}
    </article>
    <article className="panel td-schedule-constraints">
      <div className="panel-title"><div><div className="eyebrow">RESTRICCIONES MANUALES</div><h2>{tr(locale,"Canchas cerradas y descansos","Closed courts & breaks")}</h2></div></div>
      <div className="td-constraint-grid">
        <form className="td-inline-form td-inline-dense" onSubmit={addCourtClosure}><label><span>{tr(locale,"Cancha","Court")}</span><input name="court" type="number" min="1" max={Math.max(1,Number(snapshot.workspace.core.tournament.courtCount??1))} required /></label><label><span>{tr(locale,"Desde","From")}</span><input name="start" type="datetime-local" required /></label><label><span>{tr(locale,"Hasta","Until")}</span><input name="end" type="datetime-local" required /></label><label><span>{tr(locale,"Motivo","Reason")}</span><input name="label" /></label><button className="ghost small">{tr(locale,"Cerrar cancha","Close court")}</button></form>
        <form className="td-inline-form td-inline-dense" onSubmit={addBreak}><label><span>{tr(locale,"Desde","From")}</span><input name="start" type="datetime-local" required /></label><label><span>{tr(locale,"Hasta","Until")}</span><input name="end" type="datetime-local" required /></label><label><span>{tr(locale,"Etiqueta","Label")}</span><input name="label" /></label><button className="ghost small">{tr(locale,"Insertar descanso","Insert break")}</button></form>
      </div>
      <div className="td-chip-list">{scheduleMeta.closedCourts.map((item,index)=><span key={`court-${index}`}>Cancha {item.court} · {new Date(item.startAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–{new Date(item.endAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · {item.label}</span>)}{scheduleMeta.breaks.map((item,index)=><span key={`break-${index}`}>{item.label} · {new Date(item.startAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–{new Date(item.endAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>)}</div>
    </article>
    <div className="td-schedule-list">{blocks.map(([blockId,rows])=><ScheduleBlock key={blockId} blockId={blockId} rows={rows} locale={locale} mutate={mutate}/>)}</div>
  </section>;
}

function ScheduleBlock({blockId,rows,locale,mutate}:{blockId:string;rows:any[];locale:Locale;mutate:DayMutate}){const first=rows[0];const team=first.categoryEntryType==="team";const locked=rows.some((r)=>r.locked);const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const d=new FormData(e.currentTarget);const start=String(d.get("start")??"");const startAt=localDateTimeToUnix(start.slice(0,10),start.slice(11,16));const court=Number(String(d.get("court")??"1").replace(/\D/g,""))||1;await mutate(next=>updateScheduleUnit(next,blockId,{startAt,court}),tr(locale,"Bloque movido y validado.","Block moved and validated."))};return <form className={`td-schedule-row td-schedule-block ${team?"team-block":""}`} onSubmit={save}><div><strong>{first.sideA||first.roundLabel||first.categoryName}{first.sideB?` vs ${first.sideB}`:""}</strong><span>{first.categoryName} · {team?`${rows.length} rubbers · misma cancha`:first.stage} · {locked?"LOCKED":""}</span>{team?<small>{rows.map((r)=>String(r.rubberKey??"").toUpperCase()).filter(Boolean).join(" → ")}</small>:null}</div><label><span>{tr(locale,"Inicio","Start")}</span><input name="start" type="datetime-local" defaultValue={unixToLocalDateTime(Math.min(...rows.map((r)=>Number(r.startAt))))}/></label><label><span>{tr(locale,"Cancha","Court")}</span><input name="court" defaultValue={String(first.courtLabel).match(/\d+/)?.[0]??"1"}/></label><div className="form-actions"><button className="ghost small">{tr(locale,"Mover","Move")}</button><button type="button" className={locked?"light small":"ghost small"} onClick={()=>void mutate(next=>setScheduleUnitLocked(next,blockId,!locked),locked?tr(locale,"Bloque desbloqueado.","Block unlocked."):tr(locale,"Bloque bloqueado.","Block locked."))}>{locked?"🔒":"🔓"}</button></div></form>}

function scheduleIndex(snapshot:TournamentDayReformSnapshot){const map=new Map<string,number>();for(const row of snapshot.workspace.schedule.schedule as any[]){const id=String(row.matchId??row.encounterId??"");if(!id)continue;const t=Number(row.startAt??0);const old=map.get(id);if(old===undefined||t<old)map.set(id,t)}return map}
export function IntegralResultsPanel({locale,snapshot,renderStandard,renderTeamRubber}:{locale:Locale;snapshot:TournamentDayReformSnapshot;renderStandard:(match:any)=>ReactNode;renderTeamRubber:(category:any,encounter:any,match:any)=>ReactNode}){
  const order=scheduleIndex(snapshot); const now=Math.floor(Date.now()/1000); const standard=(snapshot.workspace.standard.matches as any[]).filter((m)=>m.entryAId&&m.entryBId&&!['bye','skipped'].includes(m.status)); const team=(snapshot.team.categories as any[]).flatMap((category)=>(category.encounters??[]).map((enc:any)=>({category,enc})));
  const bucket=(start:number|undefined,status:string)=>['finished','bye','skipped'].includes(status)?'finished':start&&start<=now&&now<=start+90*60?'now':start&&start>now?'next':'pending';
  const standardRows=standard.map((m)=>({type:'standard',match:m,start:order.get(String(m.matchId??m.encounterId)),bucket:bucket(order.get(String(m.matchId??m.encounterId)),m.status)})); const teamRows=team.map(({category,enc})=>{const starts=(enc.matches??[]).map((m:any)=>order.get(String(m.id))).filter(Boolean) as number[];const start=starts.length?Math.min(...starts):undefined;return{type:'team',category,enc,start,bucket:bucket(start,enc.status)}}); const rows=[...standardRows,...teamRows].sort((a:any,b:any)=>Number(a.start??Number.MAX_SAFE_INTEGER)-Number(b.start??Number.MAX_SAFE_INTEGER));
  const section=(key:string,title:string)=><article className="panel wide td-results-operational"><div className="panel-title"><h2>{title}</h2><span>{rows.filter((r:any)=>r.bucket===key).length}</span></div>{rows.filter((r:any)=>r.bucket===key).map((r:any)=>r.type==='standard'?<div key={`s-${r.match.matchId??r.match.encounterId}`}>{renderStandard(r.match)}</div>:<TeamEncounterResult key={`t-${r.enc.id}`} category={r.category} encounter={r.enc} renderRubber={renderTeamRubber}/>)}</article>;
  return <section className="td-stack">{section('now',tr(locale,'Ahora','Now'))}{section('next',tr(locale,'Próximos','Next'))}{section('pending',tr(locale,'Pendientes','Pending'))}{section('finished',tr(locale,'Terminados','Finished'))}</section>;
}
function TeamEncounterResult({category,encounter,renderRubber}:{category:any;encounter:any;renderRubber:(category:any,encounter:any,match:any)=>ReactNode}){let a=0,b=0;for(const m of encounter.matches??[]){if(!m.resultStatus)continue;const def=(category.format?.encounter?.rubbers??[]).find((r:any)=>r.key===m.rubberKey);const w=Number(def?.weight??1);if(m.winnerSide==='A')a+=w;if(m.winnerSide==='B')b+=w}return <details className="td-team-result-encounter" open={encounter.status==='in_progress'}><summary><span>{category.name} · {encounter.roundLabel??encounter.stage}</span><strong>{encounter.sideA} {a} — {b} {encounter.sideB}</strong></summary><div className="td-team-rubber-stack">{[...(encounter.matches??[])].sort((x:any,y:any)=>Number(x.rubberOrder)-Number(y.rubberOrder)).map((m:any)=><div key={m.id}>{renderRubber(category,encounter,m)}</div>)}</div></details>}

export function IntegralTournamentDayTV({snapshot,locale,embedded=false}:{snapshot:TournamentDayReformSnapshot;locale:Locale;embedded?:boolean}){const [mode,setMode]=useState<'auto'|'general'|'category'|'courts'>('auto');const [categoryId,setCategoryId]=useState('');const schedule=[...(snapshot.workspace.schedule.schedule as any[])].sort((a,b)=>Number(a.startAt)-Number(b.startAt));const now=Math.floor(Date.now()/1000);const categories=snapshot.workspace.core.categories as any[];const filtered=schedule.filter((r)=>mode!=='category'||!categoryId||String(r.categoryId)===categoryId);const active=filtered.filter((r)=>r.status!=='completed'&&r.status!=='cancelled').slice(0,10);const standards=snapshot.workspace.standard.standings as any[];const teams=(snapshot.team.categories as any[]).flatMap((c)=>(c.standings??[]).map((s:any)=>({categoryName:c.name,...s})));return <section className={`td-tv td-tv-integral ${embedded?'embedded':'fullscreen'}`}><header><div><div className="eyebrow">HUAU LIVE · LOCAL · 0 D1</div><h1>{snapshot.workspace.core.tournament.name}</h1></div><span className="td-live-dot">● LIVE</span></header><div className="td-tv-controls"><div className="td-segmented">{(['auto','general','category','courts'] as const).map((m)=><button key={m} className={mode===m?'active':''} onClick={()=>setMode(m)}>{m}</button>)}</div>{mode==='category'?<select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}><option value="">{tr(locale,'Todas','All')}</option>{categories.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:null}</div><div className="td-tv-grid"><article className="td-tv-next"><h2>{tr(locale,'Ahora / próximos','Now / next')}</h2>{active.map((row)=><div key={row.id} className={Number(row.startAt)<=now?'is-now':''}><span>{row.startAt?new Date(Number(row.startAt)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'—'} · {row.courtLabel}</span><strong>{row.sideA||row.roundLabel||row.categoryName}{row.sideB?` vs ${row.sideB}`:''}</strong><small>{row.categoryName}{row.rubberKey?` · ${String(row.rubberKey).toUpperCase()}`:''}</small></div>)}</article><article className="td-tv-tables"><h2>{tr(locale,'Tablas','Standings')}</h2>{[...standards.slice(0,2).map((s:any)=>({title:s.groupName,rows:s.rows.map((r:any)=>({id:r.entryId,name:r.name,value:`${r.wins}-${r.losses}`}))})),...teams.slice(0,2).map((s:any)=>({title:`${s.categoryName} · ${s.groupName}`,rows:s.rows.map((r:any)=>({id:r.entryId,name:r.entryName,value:`${r.standingPoints} PTS`}))}))].map((t:any,i)=><div className="td-tv-table" key={`${t.title}-${i}`}><strong>{t.title}</strong>{t.rows.slice(0,8).map((r:any,p:number)=><span key={r.id}><b>{p+1}</b>{r.name}<em>{r.value}</em></span>)}</div>)}</article></div></section>}

export function IntegralConfigurationPanel({locale,snapshot,session,busy,adminDiff,onPreviewAdmin,onApplyAdmin,onPublishStructure,onPublishLive,onCheckpoint,onFinalize,onExport,onImport,onReset,onReloadPublished,onReloadAdmin,onLoadQaFixture,mutate}:{locale:Locale;snapshot:TournamentDayReformSnapshot;session:TournamentDaySession<TournamentDaySnapshot>;busy:string;adminDiff:AdminMergePreview|null;onPreviewAdmin:()=>Promise<void>;onApplyAdmin:()=>Promise<void>;onPublishStructure:()=>Promise<void>;onPublishLive:()=>Promise<void>;onCheckpoint:()=>Promise<void>;onFinalize:()=>Promise<void>;onExport:()=>void;onImport:(file:File)=>Promise<void>;onReset:()=>Promise<void>;onReloadPublished:()=>Promise<void>;onReloadAdmin?:()=>Promise<void>;onLoadQaFixture?:()=>Promise<void>;mutate:DayMutate}) {
  const meta=ensureDayLocalMeta(snapshot); const publicState=meta.publicDirty; const categories=snapshot.workspace.core.categories as any[]; const [dangerCategory,setDangerCategory]=useState(String(categories[0]?.id??""));
  const deleteSchedule=()=>{if(!window.confirm(tr(locale,"¿Eliminar todo el cronograma local? Los resultados no se borran.","Delete the entire local schedule? Results are not deleted.")))return;void mutate(next=>clearDaySchedule(next),tr(locale,"Cronograma eliminado localmente.","Local schedule deleted."));};
  const clearResults=()=>{if(!dangerCategory)return;if(!window.confirm(tr(locale,"¿Borrar TODOS los resultados de esta categoría? Se recalcularán grupos/cuadro y se eliminará su cronograma. Esta acción es deliberadamente destructiva.","Delete ALL results in this category? Groups/bracket will be recalculated and its schedule removed. This action is deliberately destructive.")))return;void mutate(next=>clearDayCategoryResults(next,dangerCategory),tr(locale,"Resultados de categoría borrados.","Category results cleared."),"live");};
  const resetCompetition=()=>{if(!dangerCategory)return;if(!window.confirm(tr(locale,"¿Resetear por completo la competencia de esta categoría? Se borran grupos, cuadro, resultados y cronograma local de la categoría.","Fully reset this category competition? Groups, bracket, results and local category schedule will be deleted.")))return;void mutate(next=>resetDayCategoryCompetition(next,dangerCategory),tr(locale,"Competencia de categoría reseteada.","Category competition reset."));};
  return <section className="td-grid td-config-grid">
    <article className="panel wide"><div className="eyebrow">LOCAL</div><h2>{tr(locale,'Estado local','Local state')}</h2><div className="td-recovery-meta"><span><strong>{session.dirty?tr(locale,'Cambios locales','Local changes'):tr(locale,'Guardado','Saved')}</strong><small>IndexedDB</small></span><span><strong>{session.publishedRevision}</strong><small>{tr(locale,'checkpoint','checkpoint')}</small></span><span><strong>{new Date(session.updatedAt).toLocaleTimeString()}</strong><small>{tr(locale,'último guardado','last save')}</small></span><span><strong>{session.syncStatus.toUpperCase()}</strong><small>{tr(locale,'sync final','final sync')}</small></span></div><div className="form-actions"><button className="ghost" onClick={onExport}>{tr(locale,'Exportar backup','Export backup')}</button><label className="td-file-action">{tr(locale,'Importar backup','Import backup')}<input type="file" accept=".json,application/json" onChange={(event)=>{const file=event.currentTarget.files?.[0];if(file)void onImport(file);event.currentTarget.value=''}}/></label><button className="ghost" disabled={Boolean(busy)} onClick={()=>void onReloadPublished()}>{tr(locale,'Restaurar último checkpoint','Restore last checkpoint')}</button>{onReloadAdmin?<button className="ghost" disabled={Boolean(busy)} onClick={()=>void onReloadAdmin()}>{tr(locale,'Restaurar desde Administración','Restore from Administration')}</button>:null}{onLoadQaFixture?<button className="ghost" disabled={Boolean(busy)} onClick={()=>void onLoadQaFixture()}>QA · 65 jugadores / 6+7 Team</button>:null}<button className="light" disabled={Boolean(busy)} onClick={()=>void onCheckpoint()}>{tr(locale,'Guardar checkpoint','Save checkpoint')}</button></div></article>
    <article className="panel"><div className="eyebrow">ADMIN → DAY</div><h2>{tr(locale,'Actualizar desde Administración','Refresh from Administration')}</h2><p className="muted">{tr(locale,'Primero se muestra el diff. Tombstones y overrides locales no se pisan.','A diff is shown first. Local tombstones and overrides are never overwritten.')}</p><button className="ghost full" disabled={Boolean(busy)} onClick={()=>void onPreviewAdmin()}>{tr(locale,'Comparar con Administración','Compare with Administration')}</button>{adminDiff?<div className="td-admin-diff"><span>+ {adminDiff.summary.participantNew} players · + {adminDiff.summary.registrationNew} entries · + {adminDiff.summary.teamNew} teams</span><span>~ {adminDiff.summary.participantModified} players · ~ {adminDiff.summary.registrationModified} entries · ~ {adminDiff.summary.teamModified} teams</span><span>− {adminDiff.summary.participantCancelled} players · − {adminDiff.summary.registrationCancelled} entries · − {adminDiff.summary.teamCancelled} teams</span><span>⚠ {adminDiff.summary.conflicts}</span>{adminDiff.items.slice(0,12).map((item)=><small key={`${item.kind}-${item.id}`}>{item.conflict?'⚠':'✓'} {item.label} · {item.detail}</small>)}<button className="light full" onClick={()=>void onApplyAdmin()}>{tr(locale,'Aplicar cambios seguros','Apply safe changes')}</button></div>:null}</article>
    <article className="panel"><div className="eyebrow">PUBLICACIÓN</div><h2>{tr(locale,'Página pública','Public page')}</h2><div className="td-public-state"><span><b>{publicState.structure}</b>{tr(locale,'estructura pendiente','structure pending')}</span><span><b>{publicState.live}</b>{tr(locale,'resultados pendientes','results pending')}</span></div><div className="td-quick"><button className="light" disabled={Boolean(busy)} onClick={()=>void onPublishStructure()}>{tr(locale,'Publicar información','Publish structure')}</button><button className="light" disabled={Boolean(busy)} onClick={()=>void onPublishLive()}>{tr(locale,'Publicar resultados','Publish results')}</button></div>{publicState.lastStructurePublishedAt?<small>{tr(locale,'Estructura','Structure')}: {new Date(publicState.lastStructurePublishedAt).toLocaleString()}</small>:null}{publicState.lastLivePublishedAt?<small>{tr(locale,'Resultados','Results')}: {new Date(publicState.lastLivePublishedAt).toLocaleString()}</small>:null}</article>
    <article className="panel danger-zone wide"><div className="eyebrow">CIERRE / RECUPERACIÓN</div><h2>{tr(locale,'Cierre y zona peligrosa','Close & dangerous actions')}</h2><button className="ghost" disabled={Boolean(busy)} onClick={()=>void onFinalize()}>{tr(locale,'Cerrar / sincronizar final','Close / final sync')}</button><p className="muted">{tr(locale,'El cierre no reescribe inscripciones, pagos ni proofs de Administración. Las acciones destructivas de abajo afectan solo la isla local hasta un cierre explícito.','Final sync does not rewrite Administration registrations, payments or proofs. Destructive actions below affect only the local island until an explicit close.')}</p><div className="td-danger-tools"><button className="danger" onClick={deleteSchedule}>{tr(locale,'Eliminar cronograma','Delete schedule')}</button><select value={dangerCategory} onChange={(event)=>setDangerCategory(event.target.value)}>{categories.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select><button className="danger" onClick={clearResults}>{tr(locale,'Borrar resultados de categoría','Clear category results')}</button><button className="danger" onClick={resetCompetition}>{tr(locale,'Reset competencia','Reset competition')}</button><button className="danger" onClick={()=>void onReset()}>{tr(locale,'Borrar copia local','Delete local copy')}</button></div></article>
  </section>;
}

