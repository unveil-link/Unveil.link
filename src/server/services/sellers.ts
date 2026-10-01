import { query, queryOne } from "../db";
import { HttpError } from "../errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { checkPasswordStrength } from "../auth/password-policy";

export interface Seller {
  id: string;
  email: string;
  display_name: string;
  avatar: string | null;
  bio: string | null;
  verification_status: "pending" | "verified" | "failed" | "manual_review";
  created_at: string;
}
const PUBLIC_COLS = "id, email, display_name, avatar, bio, verification_status, created_at";

export async function getSellerById(id: string): Promise<Seller | null> {
  return queryOne<Seller>(`SELECT ${PUBLIC_COLS} FROM sellers WHERE id = $1`, [id]);
}

export async function signupWithPassword(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<Seller> {
  const email = input.email.trim().toLowerCase();
  const weak = checkPasswordStrength(input.password, { email, displayName: input.displayName });
  if (weak) throw new HttpError(400, weak, "weak_password");
  const hash = await hashPassword(input.password);
  try {
    // verification_status is intentionally left to the column default ('pending').
    const rows = await query<Seller>(
      `INSERT INTO sellers (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING ${PUBLIC_COLS}`,
      [email, hash, input.displayName.trim()],
    );
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new HttpError(409, "An account with that email already exists", "email_taken");
    }
    throw e;
  }
}

export async function loginWithPassword(emailRaw: string, password: string): Promise<Seller> {
  const email = emailRaw.trim().toLowerCase();
  const row = await queryOne<Seller & { password_hash: string | null }>(
    `SELECT ${PUBLIC_COLS}, password_hash FROM sellers WHERE email = $1`,
    [email],
  );
  const ok = await verifyPassword(password, row?.password_hash ?? null);
  if (!row || !ok) throw new HttpError(401, "Invalid email or password", "invalid_credentials");
  const { password_hash: _ph, ...seller } = row;
  void _ph;
  return seller;
}

/** Find-or-create by Google identity. Links to an existing email account (Google verified the email). */
export async function upsertGoogleSeller(p: {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}): Promise<Seller> {
  const byGoogle = await queryOne<Seller>(`SELECT ${PUBLIC_COLS} FROM sellers WHERE google_id = $1`, [p.sub]);
  if (byGoogle) return byGoogle;
  const byEmail = await queryOne<Seller & { google_id: string | null }>(
    `SELECT ${PUBLIC_COLS}, google_id FROM sellers WHERE email = $1`,
    [p.email],
  );
  if (byEmail) {
    if (byEmail.google_id && byEmail.google_id !== p.sub) {
      throw new HttpError(409, "Email is linked to a different Google account");
    }
    const rows = await query<Seller>(
      `UPDATE sellers SET google_id = $2, avatar = COALESCE(avatar, $3) WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
      [byEmail.id, p.sub, p.picture],
    );
    return rows[0];
  }
  const rows = await query<Seller>(
    `INSERT INTO sellers (email, google_id, display_name, avatar)
     VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLS}`,
    [p.email, p.sub, p.name, p.picture],
  );
  return rows[0];
}
