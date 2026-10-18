CREATE TABLE recipe_versions (
    item_id TEXT NOT NULL REFERENCES menu_items(id),
    kind TEXT NOT NULL CHECK (kind IN ('BASE','VARIANT','ADDON')),
    choice_key TEXT NOT NULL DEFAULT '',
    version BIGINT NOT NULL CHECK (version > 0),
    components JSONB NOT NULL CHECK (jsonb_typeof(components) = 'array'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID NOT NULL REFERENCES staff(id),
    PRIMARY KEY(item_id,kind,choice_key,version),
    CHECK ((kind = 'BASE' AND choice_key = '') OR (kind <> 'BASE' AND choice_key <> ''))
);
CREATE TABLE order_inventory (
    order_id UUID PRIMARY KEY REFERENCES orders(id),
    snapshot JSONB NOT NULL
);
-- No historical backfill: old bills retain unknown stock/recipe history.
