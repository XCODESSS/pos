CREATE TABLE kitchen_tickets (
    order_id UUID PRIMARY KEY REFERENCES orders(id),
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PREPARING', 'READY', 'SERVED')),
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TIMESTAMPTZ NOT NULL
);

-- No historical backfill: old demo orders have unknown kitchen state and must
-- not be silently queued for preparation or falsely labelled as served.
CREATE INDEX kitchen_tickets_active_idx ON kitchen_tickets(order_id) WHERE status <> 'SERVED';
CREATE INDEX orders_open_bill_number_idx ON orders(bill_number DESC) WHERE paid_at IS NULL;
