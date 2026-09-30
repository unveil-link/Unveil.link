import bcrypt from "bcryptjs";

const COST = 12;
// Used to equalise timing when the account doesn't exist.
const DUMMY_HASH = bcrypt.hashSync("unveil-dummy-password", COST);

export const hashPassword = (pw: string) => bcrypt.hash(pw, COST);

export async function verifyPassword(pw: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(pw, hash ?? DUMMY_HASH);
  return hash !== null && ok;
}
