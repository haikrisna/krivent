-- Additive: preserve all balances and historical movements; do not fabricate old snapshots.
ALTER TABLE products
 ADD COLUMN stock_version INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT products_inventory_metadata_nonnegative CHECK (stock_version >= 0 AND low_stock_threshold >= 0);
ALTER TABLE stock_movements
 ADD COLUMN before_balance INTEGER,
 ADD COLUMN after_balance INTEGER,
 ADD COLUMN stock_version INTEGER,
 ADD COLUMN idempotency_key VARCHAR(128),
 ADD COLUMN request_hash CHAR(64),
 ADD CONSTRAINT stock_movements_snapshot CHECK (
   (before_balance IS NULL AND after_balance IS NULL AND stock_version IS NULL AND idempotency_key IS NULL AND request_hash IS NULL)
   OR (before_balance IS NOT NULL AND after_balance IS NOT NULL AND stock_version IS NOT NULL
       AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL
       AND before_balance >= 0 AND after_balance >= 0 AND stock_version > 0
       AND after_balance::bigint = before_balance::bigint + quantity::bigint
       AND length(btrim(notes)) > 0 AND notes IS NOT NULL)
 );
CREATE UNIQUE INDEX stock_movements_created_by_id_idempotency_key_key ON stock_movements(created_by_id, idempotency_key);
CREATE UNIQUE INDEX stock_movements_product_id_stock_version_key ON stock_movements(product_id, stock_version);
CREATE INDEX stock_movements_type_created_at_id_idx ON stock_movements(type, created_at, id);
CREATE FUNCTION reject_stock_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Stock movement history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
 FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();

-- A stock update must have its exact ledger entry by COMMIT, including raw SQL writers.
-- Dynamic qualification keeps these triggers correct for isolated test schemas as well.
CREATE FUNCTION require_stock_change_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched BOOLEAN;
BEGIN
 IF NEW.stock_quantity = OLD.stock_quantity AND NEW.stock_version = OLD.stock_version THEN
   RETURN NULL;
 END IF;
 IF NEW.stock_version::bigint <> OLD.stock_version::bigint + 1 OR NEW.stock_quantity = OLD.stock_quantity THEN
   RAISE EXCEPTION 'Stock change requires a new version and a nonzero delta' USING ERRCODE = '23514';
 END IF;
 EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.stock_movements WHERE product_id=$1 AND stock_version=$2 AND before_balance=$3 AND after_balance=$4)', TG_TABLE_SCHEMA)
 INTO matched USING NEW.id, NEW.stock_version, OLD.stock_quantity, NEW.stock_quantity;
 IF NOT matched THEN
   RAISE EXCEPTION 'Stock change requires a matching ledger entry' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER products_require_stock_ledger AFTER UPDATE ON products
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_stock_change_ledger();

-- Existing legacy rows are preserved. Every newly inserted row must have full audit metadata.
CREATE FUNCTION validate_new_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched BOOLEAN;
BEGIN
 IF NEW.before_balance IS NULL OR NEW.after_balance IS NULL OR NEW.stock_version IS NULL THEN
   RAISE EXCEPTION 'New stock movements require audit snapshots' USING ERRCODE = '23514';
 END IF;
 EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.products WHERE id=$1 AND stock_version >= $2 AND (stock_version <> $2 OR stock_quantity=$3))', TG_TABLE_SCHEMA)
 INTO matched USING NEW.product_id, NEW.stock_version, NEW.after_balance;
 IF NOT matched THEN
   RAISE EXCEPTION 'Movement does not match stock balance/version' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER stock_movements_require_balance AFTER INSERT ON stock_movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_new_stock_movement();
