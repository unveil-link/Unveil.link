import { chromium } from "playwright-core"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE=process.env.BASE, MAIL=process.env.MAIL; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const log=console.log;
const e=`qa-misc-${crypto.randomBytes(3).toString("hex")}@example.com`; const hd={"content-type":"application/json",origin:BASE};
await fetch(BASE+"/api/auth/signup",{method:"POST",headers:hd,body:JSON.stringify({email:e,password:"Sunrise-Harbor-4821",displayName:"Misc"})});
const b0=new Set(fs.readdirSync(MAIL)); await fetch(BASE+"/api/auth/forgot-password",{method:"POST",headers:hd,body:JSON.stringify({email:e})}); let mail; for(let i=0;i<30&&!mail;i++){await sleep(300);const f=fs.readdirSync(MAIL).filter(x=>!b0.has(x)); if(f.length) mail=JSON.parse(fs.readFileSync(MAIL+"/"+f[0],"utf8"));}
const tok=mail.text.match(/token=([^\s]+)/)[1];
const b=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]}); const c=await b.newContext({viewport:{width:1280,height:900}}); const p=await c.newPage(); const T=async()=>(await p.locator("main").innerText()).replace(/\n+/g," | ");
await p.goto(`${BASE}/reset-password?token=${tok}`); await p.fill('input[name="password"]',"short"); await p.locator('form button[type=submit]').click(); await sleep(400); log("[reset] short pw on submit:", (await p.locator('[role=alert]').allInnerTexts()).join("|"));
await p.fill('input[name="password"]',e.split("@")[0]+"1234"); await p.locator('form button[type=submit]').click(); await sleep(400); log("[reset] pw containing own email local-part:", (await p.locator('[role=alert]').allInnerTexts()).join("|"));
await p.fill('input[name="password"]',"Zebra-Quartz-9315-x"); await p.locator('form button[type=submit]').click(); await p.waitForSelector("[data-testid=reset-done]"); log("[reset] success text:", (await p.locator("[data-testid=reset-done]").innerText()).replace(/\n+/g," | "));
await p.goto(`${BASE}/reset-password?token=${tok}`); await p.fill('input[name="password"]',"Another-Strong-7731-y"); await p.locator('form button[type=submit]').click(); await sleep(900); log("[reset] reuse of used token in UI:", (await T()).slice(0,260));
// login + sign out
await p.goto(BASE+"/login"); await p.fill('input[name="email"]',e); await p.fill('input[name="password"]',"Zebra-Quartz-9315-x"); await Promise.all([p.waitForURL("**/dashboard**"),p.locator('form button[type=submit]').click()]);
const ck=(await c.cookies()).find(x=>/unveil/i.test(x.name)); const cookie=ck?`${ck.name}=${ck.value}`:"";
await p.locator('button:has-text("Sign out")').first().click(); await p.waitForURL(u=>!/\/dashboard/.test(u.pathname),{timeout:8000}).catch(()=>{}); log("[signout] after click url:", p.url());
log("[signout] old cookie replay /api/auth/me:", (await fetch(BASE+"/api/auth/me",{headers:{cookie}})).status, "| /dashboard w/o cookie:", (await fetch(BASE+"/dashboard",{redirect:"manual"})).status);
await p.goto(BASE+"/dashboard"); log("[signout] visiting /dashboard now ->", p.url());
// mobile sign out reachable?
const m=await b.newContext({viewport:{width:390,height:844}}); const mp=await m.newPage(); await mp.goto(BASE+"/login"); await mp.fill('input[name="email"]',e); await mp.fill('input[name="password"]',"Zebra-Quartz-9315-x"); await Promise.all([mp.waitForURL("**/dashboard**"),mp.locator('form button[type=submit]').click()]);
log("[mobile] sign-out control visible on 390px dashboard:", await mp.locator('button:has-text("Sign out")').evaluateAll(a=>a.filter(x=>x.offsetParent&&x.getBoundingClientRect().width>0).length));
await b.close();
