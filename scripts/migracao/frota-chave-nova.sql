-- Troca a chave pública gravada na caderneta da frota (frota_lojas) para a do
-- projeto novo. O backup trouxe a chave do projeto antigo (cafkrminfnokvgjqtkle);
-- com ela o porteiro acha a loja, mas o banco novo recusa a chave e a loja
-- continua fora do ar (503). A publishable key é pública: pode ficar aqui.
--
-- Uso: psql "<URI do session pooler>" -f frota-chave-nova.sql
\set ON_ERROR_STOP on

\echo '== Antes =='
SELECT id, nome, dominio_publico, project_ref, supabase_url,
       left(publishable_key, 16) || '…' AS chave, ativa
  FROM public.frota_lojas
 ORDER BY id;

BEGIN;
UPDATE public.frota_lojas
   SET publishable_key = 'sb_publishable_07V7N2KcNA3Kk7e4sxQVLA_dlOKUf14',
       updated_at = now()
 WHERE project_ref = 'dekxabvqdsuukijblazl'
   AND publishable_key IS DISTINCT FROM 'sb_publishable_07V7N2KcNA3Kk7e4sxQVLA_dlOKUf14';
COMMIT;

\echo '== Depois =='
SELECT id, nome, dominio_publico, project_ref, supabase_url,
       left(publishable_key, 16) || '…' AS chave, ativa
  FROM public.frota_lojas
 ORDER BY id;

\echo '== A caderneta confere a senha da frota com pgcrypto (tem que aparecer 1 linha, schema extensions) =='
SELECT extname, extnamespace::regnamespace AS schema
  FROM pg_extension
 WHERE extname = 'pgcrypto';

\echo '== Senha da frota veio no backup (tem que ser 1) =='
SELECT count(*) AS senhas FROM public.frota_segredo;

\echo '== Funções do banco que ainda citam o projeto antigo (o ideal é 0 linhas) =='
SELECT n.nspname AS schema, p.proname AS funcao
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosrc LIKE '%cafkrminfnokvgjqtkle%'
 ORDER BY 1, 2;
