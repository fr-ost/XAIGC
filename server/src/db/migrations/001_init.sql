-- XAIGC schema v1: licenses, devices, trial counters, usage.

CREATE TABLE licenses (
  id                 uuid PRIMARY KEY,
  key_hash           text NOT NULL UNIQUE,   -- sha256 of the normalized key; the key itself is never stored
  key_hint           text NOT NULL,          -- e.g. XAIGC-ABCDE-*****-*****-VWXYZ, for support lookups
  plan               text NOT NULL,
  status             text NOT NULL DEFAULT 'active',  -- active | revoked
  email              text,
  note               text,
  max_devices        integer,                -- NULL = plan default
  daily_limit        integer,                -- NULL = plan default
  expires_at         timestamptz,            -- NULL = never expires
  duration_days      integer,                -- when set, expires_at starts counting at first activation
  first_activated_at timestamptz,
  devices_reset_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licenses_email_idx ON licenses (lower(email));
CREATE INDEX licenses_created_idx ON licenses (created_at DESC);

CREATE TABLE devices (
  id                uuid PRIMARY KEY,
  token_hash        text NOT NULL UNIQUE,    -- sha256 of the bearer token
  install_hash      text NOT NULL UNIQUE,    -- sha256 of the extension's install id
  license_id        uuid REFERENCES licenses (id) ON DELETE SET NULL,
  activated_at      timestamptz,
  ip_hash           text NOT NULL,           -- keyed hash of the registration network, never the raw IP
  last_ip_hash      text,
  xh_hash           text,                    -- keyed hash of the X account last seen on this device
  client_version    text,
  blocked           boolean NOT NULL DEFAULT false,
  blocked_reason    text,
  rereg_day         text,                    -- UTC day of the latest token re-issue
  rereg_count       integer NOT NULL DEFAULT 0,
  total_generations integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_license_idx ON devices (license_id);
CREATE INDEX devices_ip_idx ON devices (ip_hash, created_at);

-- Trial allowance is counted against several identities at once:
--   dev:<device id>   the install itself
--   xh:<hash>         the X account in use (survives reinstalls)
--   ip:<hash>         the network (windowed, larger allowance)
CREATE TABLE trial_counters (
  key          text PRIMARY KEY,
  used         integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Daily counters. subject is 'lic:<license id>', 'global' or 'global:trial'.
CREATE TABLE usage_daily (
  subject    text NOT NULL,
  day        text NOT NULL,                  -- YYYY-MM-DD, UTC
  count      integer NOT NULL DEFAULT 0,
  tokens_in  bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, day)
);

-- One row per generation attempt. Holds no post text and no generated text.
CREATE TABLE usage_events (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  device_id  uuid,
  license_id uuid,
  plan       text,
  kind       text,
  status     text NOT NULL,
  model      text,
  tokens_in  integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  ip_hash    text
);
CREATE INDEX usage_events_ts_idx ON usage_events (ts);
CREATE INDEX usage_events_license_idx ON usage_events (license_id, ts);
CREATE INDEX usage_events_device_idx ON usage_events (device_id, ts);

-- Audit trail for licenses: created, activated, deactivated, revoked, restored, rotated, reset.
CREATE TABLE license_events (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  license_id uuid NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
  device_id  uuid,
  type       text NOT NULL,
  detail     text,
  ip_hash    text
);
CREATE INDEX license_events_license_idx ON license_events (license_id, ts);
