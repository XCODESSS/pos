-- Additive migration: historical bill snapshots and fingerprints are untouched.
ALTER TABLE menu_items ADD COLUMN variants JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE menu_items ADD COLUMN addons JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE dining_tables (
    id UUID PRIMARY KEY,
    label TEXT NOT NULL,
    floor TEXT NOT NULL,
    seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 100),
    active BOOLEAN NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    create_fingerprint TEXT NOT NULL
);
CREATE UNIQUE INDEX dining_table_location ON dining_tables(lower(floor), lower(label));
CREATE TABLE running_checks (
    id UUID PRIMARY KEY,
    check_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    table_id UUID NOT NULL REFERENCES dining_tables(id),
    opening_table_id UUID NOT NULL REFERENCES dining_tables(id),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL REFERENCES staff(id),
    closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_open_check_per_table ON running_checks(table_id) WHERE closed_at IS NULL;
ALTER TABLE orders ADD COLUMN check_id UUID REFERENCES running_checks(id);
CREATE INDEX orders_check_id ON orders(check_id) WHERE check_id IS NOT NULL;
CREATE TABLE check_commands (
    id UUID PRIMARY KEY,
    check_id UUID NOT NULL REFERENCES running_checks(id),
    fingerprint TEXT NOT NULL
);
CREATE TABLE check_payments (
    id UUID PRIMARY KEY REFERENCES check_commands(id),
    check_id UUID NOT NULL REFERENCES running_checks(id),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_by UUID NOT NULL REFERENCES staff(id)
);
CREATE INDEX check_payments_check_id ON check_payments(check_id);
