// @ts-nocheck
import { execFileSync } from "node:child_process";
import { Http, makeSeller, makeDrop, sell, sendWebhook, cbEv, stamp, db, done } from "/workspace/qa-pay3/qa/scripts/qa-pay3-lib";
(async()=>{
 const PW="Qa-Admin-Passphrase-93!x"; const email=`adm-note-${stamp}@example.test`; execFileSync("npx",["tsx","scripts/create-admin.ts",email],{env:{...process.env,ADMIN_PASSWORD:PW}});
 const A=new Http(); await A.json("POST","/api/admin/login",{json:{email,password:PW}});
 const notes:[string,string][]=[["NUL","abc\u0000def"],["surrogate","abc\ud800def"],["emoji","ok 😀 note"],["html","<script>alert(1)</script>"],["crlf","line1\r\nFAKE audit line"],["ansi","\u001b[31mred\u001b[0m note"],["sql","'); DELETE FROM audit_log;--"],["500","n".repeat(500)]];
 for(const [nm,note] of notes){ const s=await makeSeller("nt"+nm.slice(0,3).toLowerCase()); const dd=await makeDrop(s,2000); for(let i=0;i<3;i++){const t=await sell(dd.link,2000); await sendWebhook(cbEv(t,null,1));}
  const r=await A.json("POST",`/api/admin/sellers/${s.id}/clear-flag`,{raw:JSON.stringify({note})}); const fl=(await db.query("select risk_flagged_at is not null f from sellers where id=$1",[s.id])).rows[0].f; const au=(await db.query("select target from audit_log where action='seller_flag_cleared' and target like $1",[`seller:${s.id}%`])).rows;
  console.log(nm.padEnd(10), r.status, r.text.slice(0,70), "| flag still set:",fl,"| audit rows:",au.length, au[0]? JSON.stringify(au[0].target.slice(-40)):""); }
 await done();})();
