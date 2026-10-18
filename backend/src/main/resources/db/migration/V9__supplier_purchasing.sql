CREATE TABLE suppliers (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX supplier_name_unique ON suppliers(lower(name));
CREATE TABLE purchase_orders (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_name TEXT NOT NULL,
    reference_text TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RECEIVED','CLOSED')),
    lines JSONB NOT NULL,
    close_command_id UUID UNIQUE,
    close_fingerprint TEXT,
    close_reason TEXT,
    closed_by UUID REFERENCES staff(id),
    closed_at TIMESTAMPTZ,
    CHECK ((status = 'CLOSED' AND close_command_id IS NOT NULL AND close_fingerprint IS NOT NULL AND close_reason IS NOT NULL AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
        OR (status <> 'CLOSED' AND close_command_id IS NULL AND close_fingerprint IS NULL AND close_reason IS NULL AND closed_by IS NULL AND closed_at IS NULL))
);
CREATE TABLE purchase_receipts (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    reference_text TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lines JSONB NOT NULL
);
CREATE INDEX purchase_receipt_history ON purchase_receipts(purchase_order_id,sequence);
ALTER TABLE stock_movements ADD COLUMN purchase_receipt_id UUID REFERENCES purchase_receipts(id);
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK (kind IN ('RECEIPT','WASTE','ADJUSTMENT','CONSUMPTION','COUNT','PURCHASE_RECEIPT'));
ALTER TABLE stock_movements DROP CONSTRAINT stock_movement_source_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_source_check CHECK (
    (kind = 'CONSUMPTION' AND order_id IS NOT NULL AND command_id IS NULL AND fingerprint IS NULL AND stock_count_id IS NULL AND purchase_receipt_id IS NULL)
    OR (kind = 'COUNT' AND stock_count_id IS NOT NULL AND command_id IS NULL AND fingerprint IS NULL AND order_id IS NULL AND purchase_receipt_id IS NULL)
    OR (kind = 'PURCHASE_RECEIPT' AND purchase_receipt_id IS NOT NULL AND stock_count_id IS NULL AND command_id IS NULL AND fingerprint IS NULL AND order_id IS NULL)
    OR (kind IN ('RECEIPT','WASTE','ADJUSTMENT') AND order_id IS NULL AND stock_count_id IS NULL AND purchase_receipt_id IS NULL AND command_id IS NOT NULL AND fingerprint IS NOT NULL)
);
CREATE UNIQUE INDEX purchase_receipt_ingredient_once ON stock_movements(purchase_receipt_id,ingredient_id) WHERE purchase_receipt_id IS NOT NULL;
