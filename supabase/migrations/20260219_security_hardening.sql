-- Ultimate Recovery Migration: Indexing, Security & RPCs
-- Date: 2026-02-19
-- Description: Consolidated script for Phase 2 & 3 of Deep Audit.

-- ==============================================================================
-- 1. INDEXES (Performance Optimization)
-- ==============================================================================
create index if not exists idx_marketplace_orders_created_at on public.marketplace_orders(created_at desc);
create index if not exists idx_marketplace_orders_status on public.marketplace_orders(status);
create index if not exists idx_marketplace_orders_user_id on public.marketplace_orders(user_id);
create index if not exists idx_marketplace_order_items_order_id on public.marketplace_order_items(order_id);
create index if not exists idx_marketplace_order_items_product_id on public.marketplace_order_items(product_id);
create index if not exists idx_profiles_role on public.profiles(role);

-- ==============================================================================
-- 2. CORE FUNCTIONS
-- ==============================================================================
create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
as $$
begin
    return exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
end;
$$;

-- ==============================================================================
-- 3. SECURE RPCs (Audit Phase 2 & 3)
-- ==============================================================================

-- Unified Executive Summary for Analytics
create or replace function public.get_admin_dashboard_summary()
returns jsonb
language plpgsql
security definer
as $$
declare
    result jsonb;
    today_revenue numeric;
    today_count bigint;
    pending_count bigint;
    month_revenue numeric;
    month_count bigint;
    avg_ticket numeric;
    rev_history jsonb;
    top_prods jsonb;
begin
    if not public.is_admin() then raise exception 'Unauthorized'; end if;

    select coalesce(sum(total), 0), count(*) into today_revenue, today_count from public.marketplace_orders where created_at >= date_trunc('day', now());
    select count(*) into pending_count from public.marketplace_orders where status in ('new', 'processing');
    select coalesce(sum(total), 0), count(*) into month_revenue, month_count from public.marketplace_orders where created_at >= date_trunc('month', now());
    select coalesce(avg(total), 0) into avg_ticket from public.marketplace_orders;

    with days as (select generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day')::date as day)
    select jsonb_agg(h) into rev_history from (select to_char(d.day, 'DD/MM') as date, d.day::text as full_date, coalesce(sum(o.total), 0) as revenue from days d left join public.marketplace_orders o on date_trunc('day', o.created_at)::date = d.day group by d.day order by d.day) h;

    select jsonb_agg(p) into top_prods from (
        select i.product_id, i.product_name as name, sum(i.quantity) as sold, sum(i.price * i.quantity) as total, max(i.image_url) as image 
        from public.marketplace_order_items i 
        group by i.product_id, i.product_name 
        order by sold desc limit 5
    ) p;

    result := jsonb_build_object('today', jsonb_build_object('revenue', today_revenue, 'count', today_count, 'pending', pending_count), 'month', jsonb_build_object('revenue', month_revenue, 'count', month_count), 'averageTicket', avg_ticket, 'revenueHistory', rev_history, 'topProducts', top_prods);
    return result;
end;
$$;

-- Product Management Stats
create or replace function public.get_product_stats()
returns setof jsonb
language plpgsql
security definer
as $$
begin
    if not public.is_admin() then raise exception 'Unauthorized'; end if;
    return query
    select jsonb_build_object('id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'categoria', p.categoria, 'preco_venda', p.preco_venda, 'custo', p.custo, 'estoque', p.estoque, 'ativo', p.ativo, 'imagem_url', p.imagem_url, 'tags', p.tags, 'sold', coalesce(sum(i.quantity), 0), 'created_at', p.data_cadastro, 'product_variants', (select jsonb_agg(v) from public.product_variants v where v.product_id = p.id))
    from public.produtos p left join public.marketplace_order_items i on i.product_id = p.id group by p.id order by p.nome;
end;
$$;

-- Restrict execution to Admins/Authenticated
revoke execute on function public.get_admin_dashboard_summary from public;
grant execute on function public.get_admin_dashboard_summary to service_role, authenticated;
revoke execute on function public.get_product_stats from public;
grant execute on function public.get_product_stats to service_role, authenticated;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (The Shield)
-- ==============================================================================

-- Profiles
alter table public.profiles enable row level security;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Products & Variants
alter table public.produtos enable row level security;
drop policy if exists "Public can view active products" on public.produtos;
create policy "Public can view active products" on public.produtos for select using (ativo = true);
drop policy if exists "Admins can manage products" on public.produtos;
create policy "Admins can manage products" on public.produtos for all using (public.is_admin());

alter table public.product_variants enable row level security;
drop policy if exists "Public can view active variants" on public.product_variants;
create policy "Public can view active variants" on public.product_variants for select using (exists (select 1 from public.produtos p where p.id = product_variants.product_id and p.ativo = true));
drop policy if exists "Admins can manage variants" on public.product_variants;
create policy "Admins can manage variants" on public.product_variants for all using (public.is_admin());

-- Orders & Items (Critical Security)
alter table public.marketplace_orders enable row level security;
drop policy if exists "Admins full access, users see own orders" on public.marketplace_orders;
create policy "Admins full access, users see own orders" on public.marketplace_orders for all using (public.is_admin() or auth.uid() = user_id);

alter table public.marketplace_order_items enable row level security;
drop policy if exists "Admins full access, users see through orders" on public.marketplace_order_items;
create policy "Admins full access, users see through orders" on public.marketplace_order_items for all using (public.is_admin() or exists (select 1 from public.marketplace_orders where id = order_id and user_id = auth.uid()));

-- Auxiliary Tables (Coupons, Reviews, QA, Push)
alter table public.coupons enable row level security;
drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons for all using (public.is_admin());
drop policy if exists "Public view active coupons" on public.coupons;
create policy "Public view active coupons" on public.coupons for select using (active = true);

alter table public.reviews enable row level security;
drop policy if exists "Public view reviews" on public.reviews;
create policy "Public view reviews" on public.reviews for select using (true);
drop policy if exists "Users review own orders" on public.reviews;
create policy "Users review own orders" on public.reviews for insert with check (auth.uid() = user_id);
drop policy if exists "Admins manage reviews" on public.reviews;
create policy "Admins manage reviews" on public.reviews for all using (public.is_admin());

alter table public.questions enable row level security;
drop policy if exists "Public view QA" on public.questions;
create policy "Public view QA" on public.questions for select using (true);
drop policy if exists "Users ask questions" on public.questions;
create policy "Users ask questions" on public.questions for insert with check (auth.uid() = user_id);
drop policy if exists "Admins manage QA" on public.questions;
create policy "Admins manage QA" on public.questions for all using (public.is_admin());

alter table public.push_subscriptions enable row level security;
drop policy if exists "Admins view subscriptions" on public.push_subscriptions;
create policy "Admins view subscriptions" on public.push_subscriptions for select using (public.is_admin());
drop policy if exists "Users manage own subscriptions" on public.push_subscriptions;
create policy "Users manage own subscriptions" on public.push_subscriptions for all using (auth.uid() = user_id);

alter table public.push_notifications_log enable row level security;
drop policy if exists "Admins manage push logs" on public.push_notifications_log;
create policy "Admins manage push logs" on public.push_notifications_log for all using (public.is_admin());



