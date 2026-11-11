-- Additive only: legacy sales and stock remain unchanged.
ALTER TYPE "SaleStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "SaleStatus" ADD VALUE 'FULFILLED';
ALTER TABLE sales ADD COLUMN confirmed_at TIMESTAMPTZ(3), ADD COLUMN fulfilled_at TIMESTAMPTZ(3), ADD COLUMN completed_at TIMESTAMPTZ(3), ADD COLUMN cancelled_at TIMESTAMPTZ(3), ADD COLUMN cancellation_reason TEXT;
CREATE TABLE order_receipts (
 id UUID PRIMARY KEY, actor_id UUID NOT NULL, operation VARCHAR(16) NOT NULL,
 key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL, order_id UUID NOT NULL,
 response JSONB NOT NULL,
 CONSTRAINT order_receipts_order_id_fkey FOREIGN KEY(order_id) REFERENCES sales(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX order_receipts_actor_id_operation_key_key ON order_receipts(actor_id,operation,key);
CREATE INDEX order_receipts_order_id_idx ON order_receipts(order_id);
-- One SALE deduction per item, irrespective of actor/key. Legacy rows remain valid.
CREATE UNIQUE INDEX stock_movements_sale_item_once ON stock_movements(sale_item_id) WHERE type = 'SALE' AND sale_item_id IS NOT NULL;
