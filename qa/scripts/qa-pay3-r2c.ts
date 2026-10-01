// @ts-nocheck
/* eslint-disable */
// Round 2 QA: BUG-8 config matrix (in-process, one child per case), migration 007 notes handled in qa-pay-mig.sh
import { execFileSync } from "node:child_process";
import { check, assert, eq, save, done } from "./qa-pay3-lib";

function allowed(env: Record<string, string | undefined>): string {
  const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(NODE_ENV|MOCK_PAYMENTS_ENABLED|MOCK_PAYMENTS_LOCAL_BUILD|APP_URL)$/.test(k)) e[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) e[k] = v;
  return execFileSync("npx", ["tsx", "-e", "import {config} from './src/server/config'; console.log(config.mockPaymentsAllowed)"], { env: e }).toString().trim();
}
const L = "http://localhost:3000";
const matrix: [string, Record<string, string | undefined>, string][] = [
  ["NODE_ENV unset, no flag", { APP_URL: L }, "false"],
  ["NODE_ENV unset, flag=1, loopback", { APP_URL: L, MOCK_PAYMENTS_ENABLED: "1" }, "true"],
  ["NODE_ENV unset, flag=1, public APP_URL", { APP_URL: "https://unveil.link", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["production, no flag", { NODE_ENV: "production", APP_URL: L }, "false"],
  ["production, flag=1, public", { NODE_ENV: "production", APP_URL: "https://unveil.link", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["production, flag=1, loopback (documented e2e exception)", { NODE_ENV: "production", APP_URL: L, MOCK_PAYMENTS_ENABLED: "1" }, "true"],
  ["staging, no flag, loopback", { NODE_ENV: "staging", APP_URL: L }, "false"],
  ["staging, flag=1, public", { NODE_ENV: "staging", APP_URL: "https://staging.unveil.link", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["'Production' (case), no flag", { NODE_ENV: "Production", APP_URL: L }, "false"],
  ["'prod', no flag", { NODE_ENV: "prod", APP_URL: L }, "false"],
  ["'Development' (case), no flag", { NODE_ENV: "Development", APP_URL: L }, "false"],
  ["'development ' (trailing space)", { NODE_ENV: "development ", APP_URL: L }, "false"],
  ["'' empty NODE_ENV", { NODE_ENV: "", APP_URL: L }, "false"],
  ["development (by design)", { NODE_ENV: "development", APP_URL: "https://unveil.link" }, "true"],
  ["test (by design)", { NODE_ENV: "test", APP_URL: "https://unveil.link" }, "true"],
  ["flag='true' (not '1'), loopback", { NODE_ENV: "production", APP_URL: L, MOCK_PAYMENTS_ENABLED: "true" }, "false"],
  ["flag='0'", { NODE_ENV: "production", APP_URL: L, MOCK_PAYMENTS_ENABLED: "0" }, "false"],
  ["flag=' 1'", { NODE_ENV: "production", APP_URL: L, MOCK_PAYMENTS_ENABLED: " 1" }, "false"],
  ["OLD flag MOCK_PAYMENTS_LOCAL_BUILD=1 no longer honoured", { NODE_ENV: "production", APP_URL: L, MOCK_PAYMENTS_LOCAL_BUILD: "1" }, "false"],
  ["loopback 127.0.0.1", { NODE_ENV: "production", APP_URL: "http://127.0.0.1:3000", MOCK_PAYMENTS_ENABLED: "1" }, "true"],
  ["loopback [::1]", { NODE_ENV: "production", APP_URL: "http://[::1]:3000", MOCK_PAYMENTS_ENABLED: "1" }, "true"],
  ["deceptive localhost.evil.com", { NODE_ENV: "production", APP_URL: "http://localhost.evil.com", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive localhost@evil.com", { NODE_ENV: "production", APP_URL: "http://localhost@evil.com", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive 127.0.0.1.evil.com", { NODE_ENV: "production", APP_URL: "http://127.0.0.1.evil.com", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive evil.com/localhost", { NODE_ENV: "production", APP_URL: "http://evil.com/localhost", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive user:pass localhost:80@evil.com", { NODE_ENV: "production", APP_URL: "http://localhost:80@evil.com", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive evil.com#@localhost", { NODE_ENV: "production", APP_URL: "http://evil.com#@localhost", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive evil.com?x=localhost", { NODE_ENV: "production", APP_URL: "http://evil.com/?h=localhost", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["deceptive 0.0.0.0", { NODE_ENV: "production", APP_URL: "http://0.0.0.0:3000", MOCK_PAYMENTS_ENABLED: "1" }, "NOTE"],
  ["deceptive 127.1 (short loopback form)", { NODE_ENV: "production", APP_URL: "http://127.1:3000", MOCK_PAYMENTS_ENABLED: "1" }, "NOTE"],
  ["deceptive 127.0.0.2", { NODE_ENV: "production", APP_URL: "http://127.0.0.2:3000", MOCK_PAYMENTS_ENABLED: "1" }, "NOTE"],
  ["APP_URL unset (default) + flag", { NODE_ENV: "production", MOCK_PAYMENTS_ENABLED: "1" }, "NOTE"],
  ["APP_URL garbage + flag", { NODE_ENV: "production", APP_URL: "not a url", MOCK_PAYMENTS_ENABLED: "1" }, "false"],
  ["APP_URL empty + flag", { NODE_ENV: "production", APP_URL: "", MOCK_PAYMENTS_ENABLED: "1" }, "NOTE"],
];
(async () => {
  for (const [i, [label, env, want]] of matrix.entries()) {
    await check(`BUG-8-${String(i + 1).padStart(2, "0")}`, label, async () => {
      const got = allowed(env);
      if (want === "NOTE") return `mockPaymentsAllowed=${got} (informational)`;
      eq(got, want, label); return `mockPaymentsAllowed=${got}`;
    });
  }
  save("pay3-old-r2c-results.json"); await done();
})();
