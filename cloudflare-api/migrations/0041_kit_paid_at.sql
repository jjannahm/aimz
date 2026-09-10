-- When an administrator marked a kit order paid. Null until they do, which is
-- what keeps an order in the queue: the status says where it sits, this says
-- when it moved and survives it being moved back.
ALTER TABLE kit_orders ADD COLUMN paid_at TEXT;
