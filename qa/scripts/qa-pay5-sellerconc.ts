// @ts-nocheck
import { Http, makeSeller, db, done } from "./qa-pay5-lib";
(async () => { const s = await makeSeller("conc"); await db.query("DELETE FROM login_throttle"); const outs = await Promise.all(Array.from({ length: 30 }, () => new Http().json("POST", "/api/auth/login", { json: { email: s.email, password: "Qa-Pay-Passw0rd!x" } }))); const c: any = {}; outs.forEach((o) => (c[o.status] = (c[o.status] ?? 0) + 1)); console.log("seller 30 parallel valid logins:", JSON.stringify(c)); await done(); })();
