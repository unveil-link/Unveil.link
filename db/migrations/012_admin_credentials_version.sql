-- 012: close the "login in flight during --reset-password" race (QA NEW-4). Additive + re-runnable; 001-011 untouched.
-- admins.credentials_version is bumped (by a trigger, so SQL-level changes count too) whenever the password hash changes or the account
-- is disabled/enabled. A session records the version it was minted under and is only ever valid while it still matches:
--   * loginAdmin inserts the session with INSERT ... SELECT ... FROM admins WHERE credentials_version = <version the password was checked
--     against> AND disabled_at IS NULL FOR SHARE, so a reset/disable that commits between the credential check and the insert wins;
--   * readAdminToken also compares the versions, so a session that somehow exists from before a reset is dead anyway.
ALTER TABLE admins         ADD COLUMN IF NOT EXISTS credentials_version integer NOT NULL DEFAULT 1;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS credentials_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION admins_bump_credentials_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR (NEW.disabled_at IS NULL) <> (OLD.disabled_at IS NULL) THEN
    NEW.credentials_version := OLD.credentials_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admins_bump_credentials_version ON admins;
CREATE TRIGGER admins_bump_credentials_version BEFORE UPDATE OF password_hash, disabled_at ON admins
  FOR EACH ROW EXECUTE FUNCTION admins_bump_credentials_version();
