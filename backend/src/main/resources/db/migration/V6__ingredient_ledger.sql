CREATE TABLE ingredients (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('G','ML','EACH')),
    low_stock_milli BIGINT NOT NULL CHECK (low_stock_milli BETWEEN 0 AND 1000000000000),
    balance_milli BIGINT NOT NULL DEFAULT 0 CHECK (balance_milli BETWEEN -1000000000000 AND 1000000000000),
    version BIGINT NOT NULL DEFAULT 0,
    create_fingerprint TEXT NOT NULL
);
CREATE UNIQUE INDEX ingredient_name_unique ON ingredients(lower(name));
CREATE TABLE stock_movements (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    ingredient_name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('G','ML','EACH')),
    kind TEXT NOT NULL CHECK (kind IN ('RECEIPT','WASTE','ADJUSTMENT','CONSUMPTION')),
    delta_milli BIGINT NOT NULL CHECK (delta_milli <> 0),
    balance_milli BIGINT NOT NULL,
    command_id UUID UNIQUE,
    fingerprint TEXT,
    order_id UUID REFERENCES orders(id),
    reason TEXT NOT NULL,
    reference_text TEXT,
    actor_id UUID NOT NULL REFERENCES staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((kind = 'CONSUMPTION' AND order_id IS NOT NULL AND command_id IS NULL AND fingerprint IS NULL)
        OR (kind <> 'CONSUMPTION' AND order_id IS NULL AND command_id IS NOT NULL AND fingerprint IS NOT NULL))
);
CREATE INDEX stock_history ON stock_movements(ingredient_id,sequence DESC);
CREATE UNIQUE INDEX consume_ingredient_once ON stock_movements(order_id,ingredient_id) WHERE order_id IS NOT NULL;
