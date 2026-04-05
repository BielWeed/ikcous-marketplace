-- 20260327_backfill_order_images.sql
-- Goal: Backfill missing image_url in marketplace_order_items from the produtos table

UPDATE public.marketplace_order_items
SET image_url = p.imagem_url
FROM public.produtos p
WHERE marketplace_order_items.product_id = p.id
AND (marketplace_order_items.image_url IS NULL OR marketplace_order_items.image_url = '');
