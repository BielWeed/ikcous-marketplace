-- Migration: Add `get_retention_rate` for Admin Analytics
-- Description: Calculates percentage of repeated customers (customers with > 1 order).

create or replace function public.get_retention_rate()
returns numeric
language plpgsql
security definer
as $$
declare
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
begin
    -- Check total unique customers who bought
    select count(distinct coalesce(user_id::text, customer_name))
    into total_customers
    from public.marketplace_orders
    where status not in ('cancelled', 'refunded');

    -- Check how many of those made more than 1 order
    if total_customers > 0 then
        with order_counts as (
            select count(*) as purchase_count
            from public.marketplace_orders
            where status not in ('cancelled', 'refunded')
            group by coalesce(user_id::text, customer_name)
        )
        select count(*)
        into repeated_customers
        from order_counts
        where purchase_count > 1;

        retention_rate := (repeated_customers::numeric / total_customers::numeric) * 100.0;
    end if;

    return round(retention_rate, 1);
end;
$$;
