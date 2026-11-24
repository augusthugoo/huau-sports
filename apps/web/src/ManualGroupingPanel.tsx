import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";

type Category = { id: string; name: string; entryType: "individual" | "pair" | "team" };
type Entry = { id: string; name: string; categoryId: string; entryType: string; sourceKind: string | null; teamPaymentMode: string | null; memberCount: number };
type Free = { id: string; categoryId: string; name: string };
type Player = { profileId: string; name: string; categoryId: string; entryType: string };
type JoinRequest = { id: string; profileId: string; categoryId: string; requestedBy: string; teamName: string | null };
type Model = { ok: true; participants: Player[]; entries: Entry[]; freeOnline: Free[]; requests: JoinRequest[] };
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

export function ManualGroupingPanel({ tournamentId, profileId, categories, assignments, locale, onChange }: {
  tournamentId: string; profileId: string; categories: Category[];
  assignments: Array<{ playerProfileId: string; categoryId: string }>;
  locale: Locale; onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Model | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [operation, setOperation] = useState("pair_online");
  const [teamId, setTeamId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/manual-management`;
  const assigned = useMemo(() => categories.filter(c => c.entryType !== "individual" && assignments.some(a => a.playerProfileId === profileId && a.categoryId === c.id)),[assignments,categories,profileId]);
  const selected = assigned.find(c => c.id === categoryId) ?? assigned[0];
  const selectedId = selected?.id ?? "";
  const effectiveOperation = selected?.entryType === "pair"
    ? (operation.startsWith("pair_") ? operation : "pair_online")
    : (["join_entry","create_team","add_online"].includes(operation) ? operation : "join_entry");
  const available = useMemo(() => {
    if (!data || !selectedId) return [] as Array<{id:string;name:string}>;
    if (effectiveOperation === "join_entry") return data.entries.filter(e => e.categoryId === selectedId && e.entryType === "team" && e.sourceKind !== "legacy_pair").map(e => ({id:e.id,name:`${e.name} (${e.memberCount})${e.teamPaymentMode === "team_full" ? " · pago completo" : ""}`}));
    if (effectiveOperation === "pair_online" || effectiveOperation === "add_online") return data.freeOnline.filter(p => p.categoryId === selectedId).map(p => ({id:p.id,name:p.name}));
    if (effectiveOperation === "pair_manual") return data.participants.filter(p=>p.categoryId===selectedId&&p.profileId!==profileId).map(p=>({id:p.profileId,name:p.name}));
    return [] as Array<{id:string;name:string}>;
  },[data,selectedId,effectiveOperation,profileId]);
  const get = useCallback(async () => {
    const response = await fetch(`${path}?profileId=${encodeURIComponent(profileId)}`);
    const result = await response.json() as Model & {code?:string};
    if (!response.ok) throw new Error(result.code || `HTTP_${response.status}`);
    setData(result);
  },[path,profileId]);
  useEffect(() => { if(open)void get().catch(e=>setError(e instanceof Error?e.message:"LOAD_FAILED")); },[open,get]);
  const action = async (body:Record<string,unknown>) => {
    if (!window.confirm(tr(locale,"Confirmá que los jugadores involucrados aceptaron este armado.","Confirm the players agreed to this pairing/roster."))) return;
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {ok:boolean;code?:string};
      if(!response.ok||!result.ok)throw new Error(result.code||`HTTP_${response.status}`);
      setMessage(tr(locale,"Cambio aplicado.","Change applied."));setTargetId("");await get();onChange();
    }catch(e){setError(e instanceof Error?e.message:"MANUAL_GROUPING_FAILED");}
    finally{setBusy(false);}
  };
  return <section className="participant-subpanel">
    <button className="ghost small" type="button" onClick={()=>setOpen(!open)}>{open?tr(locale,"Cerrar armado asistido","Close assisted grouping"):tr(locale,"Parejas / equipos asistidos","Assisted pairs / teams")}</button>
    {open && <div style={{display:"grid",gap:10,paddingTop:10}}>
      <p className="muted">{tr(locale,"Solo para jugadores inscriptos manualmente. Los vínculos los confirma el administrador; no requieren cuenta HUAU.","Administrator-confirmed grouping for manually entered players; no HUAU account required.")}</p>
      {!assigned.length && <p>{tr(locale,"Asignale primero una categoría de dobles o equipos y guardá la ficha.","Assign a pair/team category to this player first.")}</p>}
      {assigned.length>0 && <>
        <label><span>{tr(locale,"Categoría","Category")}</span><select value={selectedId} onChange={e=>{setCategoryId(e.target.value);setTargetId("");setOperation(categories.find(c=>c.id===e.target.value)?.entryType==="pair"?"pair_online":"join_entry");setTeamId("");}}>{assigned.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        {selected?.entryType==="pair" && <label><span>{tr(locale,"Acción","Action")}</span><select value={effectiveOperation} onChange={e=>{setOperation(e.target.value);setTargetId("");}}><option value="pair_online">{tr(locale,"Unir con jugador online libre","Pair with a free online player")}</option><option value="pair_manual">{tr(locale,"Unir con otro jugador manual","Pair with another manual player")}</option></select></label>}
        {selected?.entryType==="team" && <label><span>{tr(locale,"Acción","Action")}</span><select value={effectiveOperation} onChange={e=>{setOperation(e.target.value);setTargetId("");}}><option value="join_entry">{tr(locale,"Incorporar a equipo existente","Join an existing team")}</option><option value="create_team">{tr(locale,"Crear equipo con este jugador como capitán","Create team with this player as captain")}</option><option value="add_online">{tr(locale,"Agregar inscripto online al equipo manual","Add an online player to this manual team")}</option></select></label>}
        {effectiveOperation==="add_online" && selected?.entryType==="team" && <label><span>{tr(locale,"Equipo manual","Manual team")}</span><select value={teamId} onChange={e=>setTeamId(e.target.value)}><option value="">{tr(locale,"Seleccionar equipo","Select team")}</option>{data?.entries.filter(e=>e.categoryId===selectedId&&e.sourceKind==="manual_team").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
        {effectiveOperation==="create_team" && selected?.entryType==="team" ? <label><span>{tr(locale,"Nombre del equipo","Team name")}</span><input value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder={tr(locale,"Nombre del equipo","Team name")}/></label> : <label><span>{tr(locale,"Seleccionar jugador o equipo","Select player or team")}</span><select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">{tr(locale,"Elegí una opción","Choose an option")}</option>{available.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>}
        <button type="button" className="light small" disabled={busy||!selectedId||(effectiveOperation==="create_team"?!teamName.trim():!targetId)||(effectiveOperation==="add_online"&&!teamId)} onClick={()=>void action({action: effectiveOperation,profileId,categoryId:selectedId,...(effectiveOperation==="create_team"?{teamName}:effectiveOperation==="join_entry"?{entryId:targetId}:effectiveOperation==="add_online"?{entryId:teamId,targetRegistrationId:targetId}:effectiveOperation==="pair_manual"?{targetProfileId:targetId}:{targetRegistrationId:targetId})})}>{busy?"…":tr(locale,"Confirmar armado","Confirm grouping")}</button>
      </>}
      {data?.requests.filter(r=>r.profileId===profileId).map(r=><div key={r.id} className="panel" style={{padding:10}}><strong>{tr(locale,"Solicitud de incorporación","Join request")}</strong><p>{r.requestedBy}{r.teamName?` · ${r.teamName}`:""}</p><div className="form-actions"><button className="light small" disabled={busy} onClick={()=>void action({action:"resolve_request",requestId:r.id,decision:"approve"})}>{tr(locale,"Aprobar","Approve")}</button><button className="ghost small" disabled={busy} onClick={()=>void action({action:"resolve_request",requestId:r.id,decision:"reject"})}>{tr(locale,"Rechazar","Reject")}</button></div></div>)}
      {error&&<p className="registration-alert">{error}</p>}{message&&<p className="muted">{message}</p>}
    </div>}
  </section>;
}
