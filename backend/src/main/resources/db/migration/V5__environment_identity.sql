-- Bind a database to one immutable business and deployment environment.
CREATE TABLE environment_identity (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    name TEXT NOT NULL CHECK (name IN ('development', 'verification', 'staging')),
    tenant_id UUID NOT NULL
);
