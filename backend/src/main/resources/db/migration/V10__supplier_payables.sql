CREATE TABLE supplier_bills (
    id uuid PRIMARY KEY,
    sequence bigserial UNIQUE NOT NULL,
    supplier_id uuid NOT NULL REFERENCES suppliers(id),
    supplier_name text NOT NULL,
    purchase_order_id uuid REFERENCES purchase_orders(id),
    reference_text text NOT NULL,
    reference_key text NOT NULL,
    bill_date date NOT NULL,
    due_date date NOT NULL CHECK (due_date >= bill_date),
    total_paise bigint NOT NULL CHECK (total_paise BETWEEN 1 AND 1000000000000),
    paid_paise bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
    version bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','VOID')),
    fingerprint text NOT NULL,
    actor_id uuid NOT NULL REFERENCES staff(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    void_command_id uuid UNIQUE,
    void_fingerprint text,
    void_reason text,
    voided_by uuid REFERENCES staff(id),
    voided_at timestamptz,
    UNIQUE(supplier_id, reference_key)
);
CREATE TABLE supplier_payments (
    id uuid PRIMARY KEY,
    sequence bigserial UNIQUE NOT NULL,
    bill_id uuid NOT NULL REFERENCES supplier_bills(id),
    amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 1000000000000),
    payment_date date NOT NULL,
    method text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','UPI','OTHER')),
    reference_text text NOT NULL,
    fingerprint text NOT NULL,
    actor_id uuid NOT NULL REFERENCES staff(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX supplier_payments_bill ON supplier_payments(bill_id, sequence);
