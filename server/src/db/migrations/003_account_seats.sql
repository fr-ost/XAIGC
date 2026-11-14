-- XAIGC schema v3: tighten how accounts, emails and license seats relate.

-- An email address belongs to one Google account at a time, but an account
-- row only learns about a change when it next signs in. email_current marks
-- the row that most recently proved it holds the address; only that row can
-- claim a license issued to it.
ALTER TABLE users ADD COLUMN email_current boolean NOT NULL DEFAULT true;

-- The trial counter is keyed by a keyed hash of the Google account id rather
-- than by the row id, so deleting and recreating an account does not hand out
-- a second free trial. Accounts that already exist keep their counters.
ALTER TABLE users ADD COLUMN trial_key text;
UPDATE users SET trial_key = id::text WHERE trial_key IS NULL;
ALTER TABLE users ALTER COLUMN trial_key SET NOT NULL;

-- How a browser got its current license seat: 'key' (someone typed the key
-- there) or 'account' (it came with the signed-in account). Signing out takes
-- back only account seats.
ALTER TABLE devices ADD COLUMN seat_source text;

-- The account license the user removed from this browser. That one license is
-- not re-attached by itself; any other license the account has still is.
-- Replaces the browser-wide auto_attach switch from v2.
ALTER TABLE devices ADD COLUMN detached_license_id uuid REFERENCES licenses (id) ON DELETE SET NULL;
ALTER TABLE devices DROP COLUMN auto_attach;
