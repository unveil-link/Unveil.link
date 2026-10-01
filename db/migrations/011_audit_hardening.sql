-- 011: audit_log hardening (QA NEW-3). Additive + re-runnable; 001-010 untouched. Applies cleanly on a DB that already has audit rows.
--   1. audit_log becomes APPEND-ONLY (same mechanism as ledger_entries in 006): BEFORE UPDATE/DELETE row trigger and BEFORE TRUNCATE
--      statement trigger that raise restrict_violation. Neither the app role nor an ad-hoc SQL session can edit or delete a row.
--   2. Attribution survives: admin_email is snapshotted at write time (and the FK admin_id -> admins no longer SETs NULL on delete;
--      it is RESTRICT, and a guard trigger refuses to delete any admin that audit history mentions). Admins are DISABLED, not deleted.
--   3. New columns for failed-login records (ip, reason) + a small MUTABLE side table that bounds how many audit rows a flood can create.
--   4. Changes to admins.disabled_at are audited by a trigger, so disabling/enabling via plain SQL is not silent either.

-- 0. Re-run safety: drop our own triggers first so the backfill below is not blocked by them (they are re-created at the end, same tx).
DROP TRIGGER IF EXISTS audit_log_no_update   ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;

-- 1. columns
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS admin_email text,   -- email of the admin the row is about / was done by (or the ATTEMPTED email, sanitised, for failed logins)
  ADD COLUMN IF NOT EXISTS ip          text,   -- client IP (failed logins), when known
  ADD COLUMN IF NOT EXISTS reason      text;   -- machine-readable reason code (failed logins: unknown_email | bad_password | disabled | throttled)
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);

-- 2. backfill the snapshot for existing rows (actor via admin_id; CLI rows via the admin:<uuid> target). Only fills blanks.
UPDATE audit_log a SET admin_email = ad.email
  FROM admins ad WHERE a.admin_email IS NULL AND a.admin_id = ad.id;
UPDATE audit_log a SET admin_email = ad.email
  FROM admins ad WHERE a.admin_email IS NULL AND a.admin_id IS NULL AND left(a.target, 42) = 'admin:' || ad.id::text;

-- 3. FK: no more ON DELETE SET NULL (that silently rewrote history). RESTRICT = deleting an admin with audit rows fails.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, confdeltype FROM pg_constraint
            WHERE conrelid = 'audit_log'::regclass AND contype = 'f' AND confrelid = 'admins'::regclass LOOP
    IF c.confdeltype <> 'r' THEN
      EXECUTE format('ALTER TABLE audit_log DROP CONSTRAINT %I', c.conname);
      ALTER TABLE audit_log ADD CONSTRAINT audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE RESTRICT;
    END IF;
  END LOOP;
END $$;

-- 4. snapshot trigger: any writer that sets admin_id but not admin_email gets the email filled in automatically.
CREATE OR REPLACE FUNCTION audit_log_fill_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.admin_email IS NULL AND NEW.admin_id IS NOT NULL THEN
    SELECT email INTO NEW.admin_email FROM admins WHERE id = NEW.admin_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_log_fill_email ON audit_log;
CREATE TRIGGER audit_log_fill_email BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_fill_email();

-- 5. admins can't be deleted while audit history mentions them (as actor, or as the subject of an admin_* CLI row).
CREATE OR REPLACE FUNCTION admins_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_log WHERE admin_id = OLD.id OR left(target, 42) = 'admin:' || OLD.id::text) THEN
    RAISE EXCEPTION 'admin % has audit history and cannot be deleted; disable it instead (UPDATE admins SET disabled_at = now())', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS admins_guard_delete ON admins;
CREATE TRIGGER admins_guard_delete BEFORE DELETE ON admins FOR EACH ROW EXECUTE FUNCTION admins_guard_delete();

-- 6. audit every disable/enable of an admin, even when done with plain SQL.
CREATE OR REPLACE FUNCTION admins_audit_disable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.disabled_at IS NULL) <> (NEW.disabled_at IS NULL) THEN
    INSERT INTO audit_log (admin_id, admin_email, action, target)
    VALUES (NULL, NEW.email, CASE WHEN NEW.disabled_at IS NULL THEN 'admin_enabled' ELSE 'admin_disabled' END, 'admin:' || NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admins_audit_disable ON admins;
CREATE TRIGGER admins_audit_disable AFTER UPDATE OF disabled_at ON admins FOR EACH ROW EXECUTE FUNCTION admins_audit_disable();

-- 7. bounded failed-login auditing: this side table (NOT part of the trail; it may be updated/cleaned) counts failures per bucket so that
--    the application writes ONE audit row per (ip, reason, attempted-email) per window plus milestone summaries, and a global hourly cap.
CREATE TABLE IF NOT EXISTS admin_login_failure_buckets (
  bucket       text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  n            integer NOT NULL DEFAULT 0
);

-- 8. append-only enforcement (mirrors ledger_entries in 006). Created last so the backfill above is not blocked.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
