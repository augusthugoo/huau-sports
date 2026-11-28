/* eslint-disable @typescript-eslint/no-explicit-any */
/** Only these audited result commands may cross the Organizer Day write boundary. */
import type { TeamResultParticipants } from "@huau/core";
import { cloneDay, setLocalStandardResult, setLocalTeamResult, type StandardResultInput, type TournamentDaySnapshot } from "./TournamentDayEngine";
import { initializeReformSnapshot, markLiveDirty, type TournamentDayReformSnapshot } from "./TournamentDayReformEngine";

export type OrganizerResultOperation =
  | { kind: "standard"; categoryId: string; encounterId: string; result: StandardResultInput }
  | ({ kind: "team"; categoryId: string; encounterId: string; matchId: string; sets: Array<{ scoreA: number; scoreB: number }> } & TeamResultParticipants);

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300;
const isScore = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999;
function validateSets(value: unknown): asserts value is Array<{ scoreA: number; scoreB: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
      value.some((row) => !row || typeof row !== "object" ||
        !isScore(row.scoreA) || !isScore(row.scoreB) || row.scoreA === row.scoreB)) {
    throw new Error("ORGANIZER_DAY_INVALID_SCORE");
  }
}
export function organizerResultKey(op: OrganizerResultOperation): string {
  return `${op.kind}:${op.categoryId}:${op.encounterId}:${op.kind === "team" ? op.matchId : ""}`;
}
export function validateOrganizerResultOperations(value: unknown): OrganizerResultOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 600) {
    throw new Error("ORGANIZER_DAY_INVALID_OPERATIONS");
  }
  const seen = new Set<string>();
  const operations: OrganizerResultOperation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || !isId(raw.categoryId) || !isId(raw.encounterId)) {
      throw new Error("ORGANIZER_DAY_INVALID_OPERATION");
    }
    if (raw.kind === "standard") {
      const r = raw.result;
      if (!r || typeof r !== "object") throw new Error("ORGANIZER_DAY_INVALID_SCORE");
      if ("sets" in r) validateSets(r.sets);
      else if (!isScore(r.scoreA) || !isScore(r.scoreB) || r.scoreA === r.scoreB) throw new Error("ORGANIZER_DAY_INVALID_SCORE");
      const op: OrganizerResultOperation = { kind: "standard", categoryId: raw.categoryId, encounterId: raw.encounterId,
        result: "sets" in r ? { sets: r.sets.map((s: any) => ({ scoreA: s.scoreA, scoreB: s.scoreB })) } : { scoreA: r.scoreA, scoreB: r.scoreB } };
      const key = organizerResultKey(op);
      if (seen.has(key)) throw new Error("ORGANIZER_DAY_DUPLICATE_RESULT");
      seen.add(key); operations.push(op);
    } else if (raw.kind === "team" && isId(raw.matchId)) {
      validateSets(raw.sets);
      if (![raw.sideAPlayerIds,raw.sideBPlayerIds].every(ids=>Array.isArray(ids) && ids.length>=1 && ids.length<=2 && ids.every(isId))) {
        throw new Error("ORGANIZER_DAY_INVALID_PARTICIPANTS");
      }
      const op: OrganizerResultOperation = { kind: "team", categoryId: raw.categoryId, encounterId: raw.encounterId,
        matchId: raw.matchId, sets: raw.sets.map((s: any) => ({ scoreA: s.scoreA, scoreB: s.scoreB })), sideAPlayerIds: [...raw.sideAPlayerIds], sideBPlayerIds: [...raw.sideBPlayerIds] };
      const key = organizerResultKey(op);
      if (seen.has(key)) throw new Error("ORGANIZER_DAY_DUPLICATE_RESULT");
      seen.add(key); operations.push(op);
    } else throw new Error("ORGANIZER_DAY_INVALID_OPERATION");
  }
  return operations;
}
/** Deterministic re-play from a *trusted* checkpoint; the client cannot submit a structure. */
export function applyOrganizerResultOperations(base: TournamentDaySnapshot, value: unknown): TournamentDayReformSnapshot {
  const operations = validateOrganizerResultOperations(value);
  const next = initializeReformSnapshot(cloneDay(base) as TournamentDayReformSnapshot);
  for (const op of operations) {
    if (op.kind === "standard") {
      const competition = (next.workspace.standard.competitions as any[]).find((c) => String(c.categoryId) === op.categoryId);
      const target = competition?.encounters?.find((m: any) => String(m.id) === op.encounterId);
      if (!target || !target.entryA || !target.entryB || ["bye", "skipped"].includes(String(target.status))) {
        throw new Error("ORGANIZER_DAY_MATCH_NOT_READY");
      }
      // No destructive cascade; completed finals are protected by the existing engine.
      setLocalStandardResult(next, op.categoryId, op.encounterId, op.result, { cascade: false });
    } else {
      const category = (next.team.categories as any[]).find((c) => String(c.id) === op.categoryId);
      const enc = category?.encounters?.find((e: any) => String(e.id) === op.encounterId);
      const match = enc?.matches?.find((m: any) => String(m.id) === op.matchId);
      if (!match || ["bye", "skipped", "pending"].includes(String(match.status))) {
        throw new Error("ORGANIZER_DAY_MATCH_NOT_READY");
      }
      setLocalTeamResult(next, op.categoryId, op.encounterId, op.matchId, op.sets, {sideAPlayerIds:op.sideAPlayerIds,sideBPlayerIds:op.sideBPlayerIds});
    }
    markLiveDirty(next);
  }
  return next;
}
