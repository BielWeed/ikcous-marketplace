-- Migration: Fix Admin Profile and Auto-creation Trigger
-- Date: 2026-02-27

-- 1. Create the trigger function
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Usuário'),
    'customer'
  );
  return new;
end;
$$;

-- 2. Attach the trigger to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. Manually restore Gabriel's profile as Admin
-- Using the ID found in auth.users: eaaf85fc-62c0-4356-9a25-e51b64fb4620
insert into public.profiles (id, full_name, role)
values (
  'eaaf85fc-62c0-4356-9a25-e51b64fb4620',
  'Gabriel (Admin)',
  'admin'
)
on conflict (id) do update 
set role = 'admin';

-- 4. Ensure is_admin function is correct and has permissions
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

grant execute on function public.is_admin() to authenticated, service_role;
