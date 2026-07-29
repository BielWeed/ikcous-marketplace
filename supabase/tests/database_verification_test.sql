begin;
select plan(6); -- planeja 6 testes

-- 1. Verifica se as tabelas existem no esquema public
select has_table('public', 'profiles', 'Tabela profiles deve existir.');
select has_table('public', 'orders', 'Tabela orders deve existir.');
select has_table('public', 'produtos', 'Tabela produtos deve existir.');

-- 2. Verifica se as tabelas críticas possuem RLS (Row Level Security) ativado
select is_empty(
    $$ select * from pg_tables where tablename = 'profiles' and rowsecurity = false $$,
    'A tabela profiles deve ter o RLS habilitado.'
);

select is_empty(
    $$ select * from pg_tables where tablename = 'orders' and rowsecurity = false $$,
    'A tabela orders deve ter o RLS habilitado.'
);

select is_empty(
    $$ select * from pg_tables where tablename = 'cart' and rowsecurity = false $$,
    'A tabela cart deve ter o RLS habilitado.'
);

select * from finish();
rollback;
