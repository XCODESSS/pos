CREATE TABLE cash_shifts (
    id uuid PRIMARY KEY,
    sequence bigserial UNIQUE NOT NULL,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    reference_text text NOT NULL,
    opening_paise bigint NOT NULL CHECK (opening_paise BETWEEN 0 AND 1000000000000),
    sales_paise bigint NOT NULL DEFAULT 0 CHECK (sales_paise BETWEEN 0 AND 1000000000000),
    expenses_paise bigint NOT NULL DEFAULT 0 CHECK (expenses_paise BETWEEN 0 AND 1000000000000),
    supplier_paise bigint NOT NULL DEFAULT 0 CHECK (supplier_paise BETWEEN 0 AND 1000000000000),
    expected_paise bigint NOT NULL CHECK (expected_paise BETWEEN -1000000000000 AND 1000000000000),
    version bigint NOT NULL DEFAULT 0,
    fingerprint text NOT NULL,
    opened_by uuid NOT NULL REFERENCES staff(id),
    opened_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    close_command_id uuid UNIQUE,
    close_fingerprint text,
    counted_paise bigint CHECK (counted_paise BETWEEN 0 AND 1000000000000),
    discrepancy_paise bigint,
    close_reason text,
    closed_by uuid REFERENCES staff(id),
    closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_drawer ON cash_shifts(status) WHERE status='OPEN';
CREATE TABLE cash_movements (
    sequence bigserial PRIMARY KEY,
    shift_id uuid NOT NULL REFERENCES cash_shifts(id),
    kind text NOT NULL CHECK (kind IN ('SALE','CHECK_PAYMENT','EXPENSE','SUPPLIER_PAYMENT')),
    source_id uuid NOT NULL,
    amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 0 AND 1000000000000),
    delta_paise bigint NOT NULL,
    balance_paise bigint NOT NULL,
    actor_id uuid NOT NULL REFERENCES staff(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, source_id)
);
CREATE INDEX cash_movements_shift ON cash_movements(shift_id,sequence);
ALTER TABLE orders ADD COLUMN cash_shift_id uuid REFERENCES cash_shifts(id);
ALTER TABLE check_payments ADD COLUMN cash_shift_id uuid REFERENCES cash_shifts(id);
ALTER TABLE supplier_payments ADD COLUMN cash_shift_id uuid REFERENCES cash_shifts(id);
CREATE TABLE operating_expenses (
    id uuid PRIMARY KEY,
    sequence bigserial UNIQUE NOT NULL,
    payee text NOT NULL,
    category text NOT NULL,
    reference_text text NOT NULL,
    expense_date date NOT NULL,
    amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 1000000000000),
    method text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','UPI','OTHER')),
    cash_shift_id uuid REFERENCES cash_shifts(id),
    fingerprint text NOT NULL,
    actor_id uuid NOT NULL REFERENCES staff(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((method='CASH') = (cash_shift_id IS NOT NULL))
);
