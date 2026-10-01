import crypto from "node:crypto";
import { query, queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { config } from "../config";
import { hashPassword } from "../auth/password";
import { checkPasswordStrength } from "../auth/password-policy";
import { revokeAllSessions } from "../auth/session";
import { sendMail } from "../mail";
import { resetLoginThrottle } from "../ratelimit/login-throttle";

export const RESET_TTL_MINUTES = 60;
const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/**
 * Creates a reset token for the account (if any) and emails the link. Never reveals whether the
 * email exists: callers always respond identically. Only the SHA-256 of the token is stored.
 */
export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const seller = await queryOne<{ id: string }>("SELECT id FROM sellers WHERE email = $1", [email]);
  if (!seller) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await withTx(async (c) => {
    // only the newest link is valid
    await c.query("UPDATE password_reset_tokens SET used_at = now() WHERE seller_id = $1 AND used_at IS NULL", [seller.id]);
    await c.query(
      `INSERT INTO password_reset_tokens (seller_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [seller.id, hashToken(token), RESET_TTL_MINUTES],
    );
  });
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await sendMail({
    to: email,
    subject: "Reset your Unveil password",
    text:
      `We received a request to reset your Unveil password.\n\nOpen this link within ${RESET_TTL_MINUTES} minutes to choose a new one:\n${link}\n\n` +
      `If you didn't ask for this, you can ignore this email — your password won't change.`,
    html:
      `<p>We received a request to reset your Unveil password.</p><p><a href="${link}">Choose a new password</a> (valid for ${RESET_TTL_MINUTES} minutes).</p>` +
      `<p>If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
  });
}

/** Consumes the token (single use), sets the new password and revokes ALL of the seller's sessions. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const bad = () => new HttpError(400, "This reset link is invalid or has expired. Request a new one.", "invalid_token");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw bad();
  const th = hashToken(token);
  const row = await queryOne<{ seller_id: string; email: string; display_name: string }>(
    `SELECT t.seller_id, s.email, s.display_name FROM password_reset_tokens t JOIN sellers s ON s.id = t.seller_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
    [th],
  );
  if (!row) throw bad();
  const weak = checkPasswordStrength(newPassword, { email: row.email, displayName: row.display_name });
  if (weak) throw new HttpError(400, weak, "weak_password");
  const hash = await hashPassword(newPassword);
  await withTx(async (c) => {
    // atomic single-use claim: only one concurrent request can flip used_at
    const claimed = await c.query(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING seller_id`,
      [th],
    );
    if (claimed.rowCount !== 1) throw bad();
    await c.query("UPDATE sellers SET password_hash = $2 WHERE id = $1", [row.seller_id, hash]);
    await c.query("UPDATE password_reset_tokens SET used_at = now() WHERE seller_id = $1 AND used_at IS NULL", [row.seller_id]);
    await revokeAllSessions(row.seller_id, c);
    await resetLoginThrottle(row.email, c); // owner proved control of the mailbox: clear any login delay
  });
}

export async function purgeExpiredResetTokens() {
  await query("DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'");
}
