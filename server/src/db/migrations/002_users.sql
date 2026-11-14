-- XAIGC schema v2: user accounts (Google sign-in), account-owned licenses.

CREATE TABLE users (
  id             uuid PRIMARY KEY,
  google_sub     text NOT NULL UNIQUE,     -- Google's stable account id
  email          text NOT NULL,            -- verified by Google
  name           text,
  blocked        boolean NOT NULL DEFAULT false,
  blocked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_created_idx ON users (created_at DESC);

-- The account a browser is signed in to. auto_attach is false after the user
-- removes the account's license from this browser, so it is not put straight
-- back the next time the account is looked at.
ALTER TABLE devices ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN auto_attach boolean NOT NULL DEFAULT true;
CREATE INDEX devices_user_idx ON devices (user_id);

-- The account a license belongs to. A license follows its owner to every
-- browser they sign in on, within the license's device limit.
ALTER TABLE licenses ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX licenses_user_idx ON licenses (user_id);

-- One row per sign-in in progress. `state` goes to Google and comes back to
-- the server; `code` is handed to the browser that finished the sign-in and
-- must be presented by the same install that started it.
CREATE TABLE auth_flows (
  state_hash text PRIMARY KEY,
  device_id  uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  nonce      text NOT NULL,
  code_hash  text UNIQUE,
  identity   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_flows_device_idx ON auth_flows (device_id);
CREATE INDEX auth_flows_expires_idx ON auth_flows (expires_at);

-- Row level security with no policies: the server connects as the table
-- owner and is unaffected, while any other database role gets nothing. This
-- matters on hosts that expose the database through an auto-generated API
-- (Supabase does), where tables without RLS can be read with a public key.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_counters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_flows        ENABLE ROW LEVEL SECURITY;
