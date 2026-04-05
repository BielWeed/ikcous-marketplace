-- Add user_id to marketplace_orders
alter table public.marketplace_orders 
add column if not exists user_id uuid references auth.users(id);

create index if not exists idx_marketplace_orders_user_id on public.marketplace_orders(user_id);

-- Enable RLS if not already (it likely is)
alter table public.marketplace_orders enable row level security;

-- Policies
create policy "Users can view their own orders"
  on public.marketplace_orders for select
  using (auth.uid() = user_id);

create policy "Users can insert their own orders"
  on public.marketplace_orders for insert
  with check (auth.uid() = user_id);
