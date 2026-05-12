-- Fix items unique constraint to include item_type.
-- Without item_type in the key, an item and a pet with the same name (e.g., 卡卡特
-- exists as both) collide at insert. Any batch containing both fails entirely.

DROP INDEX IF EXISTS idx_items_name_level;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_type_level
ON items (name, item_type, COALESCE(item_level, 0));
