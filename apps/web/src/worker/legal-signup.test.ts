import { describe, expect, it, vi } from "vitest";
import { signupWithLegalAcceptance, reconcileLegalSignupAcceptance } from "./legal-signup";
const email="athlete@example.test",token="71448121-612a-43c0-b0c7-7283c227912b";
const request=(hasToken=true)=>new Request("https://huau.app/api/auth/sign-up/email",{
  method:"POST",headers:{"content-type":"application/json",...(hasToken?{"x-huau-legal-token":token}:{})},
  body:JSON.stringify({email,password:"examplepassword",name:"Test Athlete"})});
function mockDb(onRun:(sql:string)=>Promise<unknown>,onFirst?:(sql:string)=>Promise<unknown>){
 return {HUAU_DB:{prepare:(sql:string)=>({bind:(..._args:unknown[])=>({
   run:()=>onRun(sql),first:()=>onFirst?onFirst(sql):Promise.resolve(null)})})}} as unknown as Env;
}
describe("HUAU legal signup audit recovery",()=>{
 it("keeps successful Better Auth response when D1 post-create update fails",async()=>{
   const sqls:string[]=[];
   const env=mockDb(async(sql)=>{sqls.push(sql);if(sql.includes("status='started', started_at="))return {meta:{changes:1}};
     if(sql.includes("status='recorded'"))throw new Error("D1_UNAVAILABLE");throw Error("Unexpected SQL")});
   const handler=vi.fn(async()=>Response.json({user:{id:"u1",email}}));
   const resp=await signupWithLegalAcceptance(request(),env,handler);
   expect(resp.status).toBe(200);expect(handler).toHaveBeenCalledTimes(1);
   expect(sqls.some(sql=>sql.includes("status='recorded'"))).toBe(true);
 });
 it("recovers audit after login with a matching account",async()=>{
   const sqls:string[]=[];
   const env=mockDb(async(sql)=>{sqls.push(sql);return {meta:{changes:1}}},
     async()=>({id:"u1",createdAt:Math.floor(Date.now()/1000)}));
   await reconcileLegalSignupAcceptance("u1",email,env);
   expect(sqls).toHaveLength(1);expect(sqls[0]).toContain("status='started'");
 });
 it("rejects signup without token before invoking Better Auth",async()=>{
   const handler=vi.fn(async()=>Response.json({ok:true}));
   const resp=await signupWithLegalAcceptance(request(false),mockDb(async()=>{throw Error("No")}),handler);
   expect(resp.status).toBe(400);expect(handler).not.toHaveBeenCalled();
 });
});
