-- 32m — MEDICAO, so leitura, de QUANTOS clientes a busca antiga nao achava: o WhatsApp gravado MASCARADO
-- ("(34) 99999-1234", que so a busca por digitos da migration 20261230000000 acha digitando os numeros) e os
-- nomes ACENTUADOS ("Joao" x "João", que so a busca sem acento da migration 20261231000000 acha no CRM).
-- Molde da 18a/22m/27m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem decide
-- e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply, so para saber o
-- tamanho do que a correcao destrava; o apply nao muda nenhuma linha de cliente.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em profiles: com a RLS valendo,
--              toda contagem abaixo sai baixa e o numero nao e o da loja.
--   contagem   perfis (total), perfis com WhatsApp preenchido, com o WhatsApp MASCARADO (algum caractere que nao e
--              digito), so com digitos, com 12 ou 13 digitos comecando por 55 (gravados COM o +55), com nome
--              ACENTUADO (f_unaccent(nome) diferente do nome).
-- NENHUM DADO PESSOAL: so contagens; nenhum nome, nenhum numero, nenhum id. O log do run e legivel por quem le o
-- repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH p AS (
  SELECT NULLIF(btrim(COALESCE(pr.whatsapp, '')), '') AS zap,
         NULLIF(btrim(COALESCE(pr.full_name, '')), '') AS nome
    FROM public.profiles pr
), d AS (
  SELECT p.zap, p.nome,
         regexp_replace(COALESCE(p.zap, ''), '[^0-9]', '', 'g') AS digitos
    FROM p
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|rls_vale_em_profiles=' || (SELECT (c.relrowsecurity AND NOT COALESCE(r.rolbypassrls, false) AND NOT COALESCE(r.rolsuper, false))::text
                                         FROM pg_class c, pg_roles r
                                        WHERE c.oid = 'public.profiles'::regclass AND r.rolname = current_user) AS detalhe
UNION ALL
SELECT 'contagem', 'perfis', 'total=' || count(*)::text FROM d
UNION ALL
SELECT 'contagem', 'whatsapp preenchido', 'total=' || count(*) FILTER (WHERE zap IS NOT NULL)::text FROM d
UNION ALL
SELECT 'contagem', 'whatsapp mascarado (a busca antiga nao acha so pelos numeros)',
       'total=' || count(*) FILTER (WHERE zap IS NOT NULL AND zap ~ '[^0-9]')::text FROM d
UNION ALL
SELECT 'contagem', 'whatsapp so com digitos', 'total=' || count(*) FILTER (WHERE zap IS NOT NULL AND zap !~ '[^0-9]')::text FROM d
UNION ALL
SELECT 'contagem', 'whatsapp com 12 ou 13 digitos comecando por 55 (gravado com o +55)',
       'total=' || count(*) FILTER (WHERE length(digitos) IN (12, 13) AND left(digitos, 2) = '55')::text FROM d
UNION ALL
SELECT 'contagem', 'nome acentuado (a busca do CRM antiga nao acha sem o acento)',
       'total=' || count(*) FILTER (WHERE nome IS NOT NULL AND public.f_unaccent(nome) <> nome)::text FROM d;
