CREATE TABLE staff (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    password_hash TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE staff_sessions (
    token_hash BYTEA PRIMARY KEY,
    staff_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX staff_sessions_staff_idx ON staff_sessions(staff_id);
CREATE INDEX staff_sessions_expiry_idx ON staff_sessions(expires_at);
CREATE TABLE login_buckets (
    key TEXT PRIMARY KEY,
    window_started TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX login_buckets_age_idx ON login_buckets(window_started);
CREATE TABLE audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id UUID REFERENCES staff(id),
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE menu_items ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0);
ALTER TABLE menu_items ADD COLUMN create_fingerprint TEXT;
ALTER TABLE orders ADD COLUMN created_by UUID REFERENCES staff(id);
ALTER TABLE orders ADD COLUMN paid_by UUID REFERENCES staff(id);
-- Existing bills remain immutable and retain unknown historical staff attribution.
