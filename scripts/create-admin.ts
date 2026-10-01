// usage:  npm run create-admin -- admin@example.com [--reset-password]
// The password is read from the ADMIN_PASSWORD env var if set, otherwise prompted (hidden) on the terminal. There is NO default admin,
// and the password is never accepted as a command-line argument (it would land in shell history / the process list).
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

function promptHidden(q: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("no TTY to prompt on: set ADMIN_PASSWORD in the environment"));
    process.stdout.write(q);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\u0003") { stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); return resolve(buf); }
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}

(async () => {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset-password");
  const email = args.find((a) => !a.startsWith("--"));
  if (!email || args.some((a) => a.startsWith("--") && a !== "--reset-password")) {
    console.error("usage: npm run create-admin -- <email> [--reset-password]   (password via ADMIN_PASSWORD env or hidden prompt)");
    process.exit(2);
  }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden("Password: ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) { console.error("passwords do not match"); process.exit(1); }
  }
  const { createAdmin } = await import("../src/server/admin/auth");
  const { pool } = await import("../src/server/db");
  try {
    const r = await createAdmin(email, password, { resetIfExists: reset });
    console.log(r.created ? `created admin ${email.toLowerCase()} (${r.id})` : `password reset for ${email.toLowerCase()} (${r.id}); existing sessions revoked`);
  } finally {
    await pool().end();
  }
})().catch((e) => {
  console.error("create-admin failed:", (e as Error).message);
  process.exit(1);
});
