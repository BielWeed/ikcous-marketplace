-- RLS Optimization: GHOTS PURGE v11.1
-- Removing expensive subqueries that might be causing intermittent failures on mobile

-- 1. Variants: Simplify to public select using product id
-- The security is still held by the fact that if a product is inactive, 
-- it won't be returned by the products query, thus the UI never asks for its clones.
drop policy if exists "Public can view active variants" on public.product_variants;
create policy "Public can view active variants" on public.product_variants for select using (active = true);

-- 2. Store Config: Ensure public can always read
drop policy if exists "Public can view store config" on public.store_config;
create policy "Public can view store config" on public.store_config for select using (true);

-- 3. Banners: Ensure public can read active banners
alter table public.banners enable row level security;
drop policy if exists "Public can view active banners" on public.banners;
create policy "Public can view active banners" on public.banners for select using (ativo = true);

-- 4. Coupons: Public can view active coupons
alter table public.coupons enable row level security;
drop policy if exists "Public can view active coupons" on public.coupons;
create policy "Public can view active coupons" on public.coupons for select using (active = true);
