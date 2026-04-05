-- Migration: Optimize Admin Queries and Database Performance
-- Date: 2026-02-18

-- 1. Create Indexes for common query patterns
create index if not exists idx_marketplace_orders_created_at on public.marketplace_orders(created_at desc);
create index if not exists idx_marketplace_orders_status on public.marketplace_orders(status);
create index if not exists idx_marketplace_orders_user_id on public.marketplace_orders(user_id);
create index if not exists idx_marketplace_order_items_order_id on public.marketplace_order_items(order_id);
create index if not exists idx_marketplace_order_items_product_id on public.marketplace_order_items(product_id);

-- 2. RPC: get_admin_dashboard_summary
-- Aggregates all necessary KPIs for the dashboard in one single roundtrip.
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
    -- Today stats
    select 
        coalesce(sum(total), 0), 
        count(*)
    into today_revenue, today_count
    from public.marketplace_orders
    where created_at >= date_trunc('day', now());

    select count(*)
    into pending_count
    from public.marketplace_orders
    where status in ('new', 'processing');

    -- Month stats
    select 
        coalesce(sum(total), 0), 
        count(*)
    into month_revenue, month_count
    from public.marketplace_orders
    where created_at >= date_trunc('month', now());

    -- Global stats (All time for avg ticket)
    select coalesce(avg(total), 0)
    into avg_ticket
    from public.marketplace_orders;

    -- Revenue history (last 7 days including today)
    with days as (
        select generate_series(
            date_trunc('day', now()) - interval '6 days',
            date_trunc('day', now()),
            interval '1 day'
        )::date as day
    )
    select jsonb_agg(h)
    into rev_history
    from (
        select 
            to_char(d.day, 'DD/MM') as date,
            d.day::text as full_date,
            coalesce(sum(o.total), 0) as revenue
        from days d
        left join public.marketplace_orders o on date_trunc('day', o.created_at)::date = d.day
        group by d.day
        order by d.day
    ) h;

    -- Top products (all time)
    select jsonb_agg(p)
    into top_prods
    from (
        select 
            i.product_id,
            i.product_name as name,
            sum(i.quantity) as quantity,
            sum(i.price * i.quantity) as total,
            max(i.image_url) as image
        from public.marketplace_order_items i
        group by i.product_id, i.product_name
        order by quantity desc
        limit 5
    ) p;

    result := jsonb_build_object(
        'today', jsonb_build_object('revenue', today_revenue, 'count', today_count, 'pending', pending_count),
        'month', jsonb_build_object('revenue', month_revenue, 'count', month_count),
        'averageTicket', avg_ticket,
        'revenueHistory', rev_history,
        'topProducts', top_prods
    );

    return result;
end;
$$;

-- 3. RPC: get_product_stats
-- Returns products with pre-calculated sales counts and active status
create or replace function public.get_product_stats()
returns setof jsonb
language plpgsql
security definer
as $$
begin
    return query
    select jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'descricao', p.descricao,
        'categoria', p.categoria,
        'preco_venda', p.preco_venda,
        'custo', p.custo,
        'estoque', p.estoque,
        'ativo', p.ativo,
        'imagem_url', p.imagem_url,
        'tags', p.tags,
        'sold', coalesce(sum(i.quantity), 0),
        'created_at', p.data_cadastro,
        'product_variants', (
            select jsonb_agg(v)
            from public.product_variants v
            where v.product_id = p.id
        )
    )
    from public.produtos p
    left join public.marketplace_order_items i on i.product_id = p.id
    group by p.id
    order by p.nome;
end;
$$;

-- 4. Refine RLS for Profiles
-- Ensure role based access
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

-- Update marketplace_orders policy
drop policy if exists "Enable all access for authenticated users" on public.marketplace_orders;
create policy "Admins have full access, users see their own" 
on public.marketplace_orders 
for all 
using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "Enable all access for authenticated users" on public.marketplace_order_items;
create policy "Admins have full access, users see through orders" 
on public.marketplace_order_items 
for all 
using (
    public.is_admin() or 
    exists (
        select 1 from public.marketplace_orders 
        where id = order_id and user_id = auth.uid()
    )
);
