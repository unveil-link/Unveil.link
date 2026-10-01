/* eslint-disable */
// QA: real-browser double click on the Buy button -> how many POST /api/checkout fire / how many pending tx are created.
import { createRequire } from "node:module";
const require = createRequire("/workspace/qa-pay4/package.json");
const { chromium } = require("playwright-core");
const [base, link] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.56.1." + (1 + Math.floor(Math.random() * 200)) } });
const p = await ctx.newPage(); const posts = [];
p.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/checkout")) posts.push(r.url()); });
await p.goto(`${base}/u/${link}`); await p.waitForSelector('[data-testid="buy-form"]');
await p.fill('input[type="email"]', "dbl-ui@example.test"); await p.check('[data-testid="over18"]');
await p.dblclick('[data-testid="buy-button"]', { delay: 10, noWaitAfter: true }); await p.waitForTimeout(1500);
console.log(JSON.stringify({ checkoutPostsFromDoubleClick: posts.length, finalUrl: p.url() }));
await b.close();
