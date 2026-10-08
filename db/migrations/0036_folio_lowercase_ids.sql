-- 0035 built Folio ids from uniqueidentifier text, which SQL Server returns in upper case; Folio ids are lower case (L124).
UPDATE dbo.folio_items
SET item_id = LOWER(item_id)
WHERE item_id <> LOWER(item_id);
