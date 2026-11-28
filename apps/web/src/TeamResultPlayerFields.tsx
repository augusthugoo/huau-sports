/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Locale } from "./i18n";
import { actualTeamPlayerIds } from "./TeamResultParticipants";

export function TeamResultPlayerFields({ locale, category, encounter, match }: { locale: Locale; category: any; encounter: any; match: any }) {
  const definition = category.format?.encounter?.rubbers?.find((row: any) => String(row.key) === String(match.rubberKey));
  const gender = definition?.gender ?? match.competitionGender ?? "open";
  const slots = (definition?.mode ?? match.mode) === "singles" ? 1 : 2;
  const tr = (es: string, en: string) => locale === "es" ? es : en;
  return <div className="td-lineup-sides" style={{gridColumn:"1 / -1",width:"100%",minWidth:0}}>
    {(["A", "B"] as const).map(side => {
      const entryId = side === "A" ? encounter.entryAId : encounter.entryBId;
      const entry = (category.entries ?? []).find((row: any) => String(row.id) === String(entryId));
      const existing = actualTeamPlayerIds(encounter, match, side);
      const roster = entry?.roster ?? [];
      const ordered = gender === "mixed" ? [...existing].sort((a,b) => Number(roster.find((m: any)=>m.personId===b)?.sportGender==="male")-Number(roster.find((m: any)=>m.personId===a)?.sportGender==="male")) : existing;
      return <div className="td-lineup-side" key={`${match.id}:${side}:${JSON.stringify(existing)}`}>
        <strong>{side === "A" ? encounter.sideA : encounter.sideB}</strong>
        <small>{tr("¿Quién jugó?", "Who played?")}</small>
        {Array.from({length:slots},(_,i) => {
          const requiredGender = gender === "mixed" ? (i===0?"male":"female") : gender;
          const eligible = roster.filter((member: any) => requiredGender === "open" || member.sportGender === requiredGender);
          return <label key={i}><span>{tr("Jugador", "Player")} {i+1}</span><select name={`actual-team-${side}`} required defaultValue={eligible.some((member: any)=>member.personId===ordered[i])?ordered[i]:""}>
            <option value="">{tr("Seleccionar", "Select")}</option>
            {eligible.map((member: any)=><option key={member.personId} value={member.personId}>{member.name}</option>)}
          </select></label>;
        })}
      </div>;
    })}
  </div>;
}
