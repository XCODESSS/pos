CREATE TABLE stock_counts (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lines JSONB NOT NULL
);

ALTER TABLE stock_movements ADD COLUMN stock_count_id UUID REFERENCES stock_counts(id);
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
    CHECK (kind IN ('RECEIPT','WASTE','ADJUSTMENT','CONSUMPTION','COUNT'));
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_source_check CHECK (
    (kind = 'CONSUMPTION' AND order_id IS NOT NULL AND command_id IS NULL AND fingerprint IS NULL AND stock_count_id IS NULL)
    OR (kind = 'COUNT' AND stock_count_id IS NOT NULL AND command_id IS NULL AND fingerprint IS NULL AND order_id IS NULL)
    OR (kind IN ('RECEIPT','WASTE','ADJUSTMENT') AND order_id IS NULL AND stock_count_id IS NULL AND command_id IS NOT NULL AND fingerprint IS NOT NULL)
);
CREATE UNIQUE INDEX count_ingredient_once ON stock_movements(stock_count_id,ingredient_id) WHERE stock_count_id IS NOT NULL;
