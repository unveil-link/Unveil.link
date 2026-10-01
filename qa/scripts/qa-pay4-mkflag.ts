// @ts-nocheck
import { makeSeller, db, dbReady, done, stamp } from "./qa-pay4-lib";
(async () => { const s = await makeSeller("uiflag"); await db.query("UPDATE sellers SET risk_flagged_at=now(), risk_flag_reason='3 chargebacks within 90 days <b>x</b>' WHERE id=$1", [s.id]); console.log(s.id); await done(); })();
