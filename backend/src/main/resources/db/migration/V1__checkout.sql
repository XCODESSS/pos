CREATE TABLE menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_paise BIGINT NOT NULL CHECK (price_paise > 0),
    cgst_bps INTEGER NOT NULL CHECK (cgst_bps BETWEEN 0 AND 10000),
    sgst_bps INTEGER NOT NULL CHECK (sgst_bps BETWEEN 0 AND 10000),
    vegetarian BOOLEAN NOT NULL,
    available BOOLEAN NOT NULL DEFAULT TRUE
);

-- Demo menu only. Tax rates must be validated for each real outlet and item.
INSERT INTO menu_items (id, name, category, price_paise, cgst_bps, sgst_bps, vegetarian) VALUES
('masala-dosa', 'Masala dosa', 'South Indian', 14000, 250, 250, TRUE),
('idli', 'Idli sambar', 'South Indian', 8000, 250, 250, TRUE),
('paneer-tikka', 'Paneer tikka', 'Starters', 24000, 250, 250, TRUE),
('dal-tadka', 'Dal tadka', 'Mains', 18000, 250, 250, TRUE),
('veg-biryani', 'Vegetable biryani', 'Mains', 22000, 250, 250, TRUE),
('chicken-biryani', 'Chicken biryani', 'Mains', 28000, 250, 250, FALSE),
('butter-naan', 'Butter naan', 'Breads', 4500, 250, 250, TRUE),
('filter-coffee', 'Filter coffee', 'Beverages', 6000, 250, 250, TRUE);

CREATE TABLE orders (
    id UUID PRIMARY KEY,
    bill_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    request_fingerprint TEXT NOT NULL,
    bill JSONB NOT NULL,
    total_paise BIGINT NOT NULL CHECK (total_paise > 0),
    created_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    cash_received_paise BIGINT,
    CHECK ((paid_at IS NULL AND cash_received_paise IS NULL) OR
           (paid_at IS NOT NULL AND cash_received_paise >= total_paise))
);
CREATE INDEX orders_paid_at_idx ON orders(paid_at) WHERE paid_at IS NOT NULL;
