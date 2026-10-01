// @ts-nocheck
import { execFileSync } from "node:child_process";
import { makeSeller, makeDrop, sell, sendWebhook, cbEv, stamp, checkout, paySale, db, done } from "/workspace/qa-pay3/qa/scripts/qa-pay3-lib";
(async()=>{ const email=`adm-ui-${stamp}@example.test`; const PW="Qa-Admin-Passphrase-93!x"; execFileSync("npx",["tsx","scripts/create-admin.ts",email],{env:{...process.env,ADMIN_PASSWORD:PW}});
 const s=await makeSeller("adminui"); const d=await makeDrop(s,2000); for(let i=0;i<3;i++){const t=await sell(d.link,2000); await sendWebhook(cbEv(t,null,1));}
 const c=await checkout(d.link); await db.query("update transactions set created_at=now()-interval '26 hours' where id=$1",[c.json.transactionId]); await paySale(c.json.transactionId,2000);
 const c2=await checkout(d.link); await db.query("update transactions set created_at=now()-interval '26 hours' where id=$1",[c2.json.transactionId]); await paySale(c2.json.transactionId,2000); await db.query("update transactions set refund_requested_at=NULL, void_refund_attempts=5, void_refund_last_error='provider unavailable' where id=$1",[c2.json.transactionId]);
 console.log(email, PW, s.id); await done(); })();
