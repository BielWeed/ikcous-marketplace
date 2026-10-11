-- ============================================================================
-- Migration 20261215000000 — a política de devolução não mostra quem a editou
-- (achado L da revisão de risco de 26/09/2026, ainda aberto)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: `public.politica_devolucao` (20261175)
-- dá `GRANT SELECT` da TABELA INTEIRA a `anon` e `authenticated`, e a política
-- RLS `politica_devolucao_publica_select_policy` é `USING (true)`. A política
-- é pública de propósito (o cliente vê as regras de troca antes de comprar),
-- mas a linha também carrega `updated_by`: o uuid do admin que salvou por
-- último. Qualquer visitante, sem login, lê esse uuid com
-- `GET /rest/v1/politica_devolucao?select=updated_by`. Não é dado público.
-- O mesmo achado já foi fechado em `config_pagamento_cartao` (20261176), com
-- grant por coluna; faltava esta tabela.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `REVOKE SELECT ON public.politica_devolucao FROM anon, authenticated`.
--      Num REVOKE de tabela, o Postgres tira também os privilégios de coluna
--      que sobraram, então o estado de partida é limpo qualquer que seja o
--      que estava concedido antes.
--   2. `GRANT SELECT (<15 colunas>)` a `anon, authenticated`: todas as
--      colunas, menos `updated_by`. A lista é a de `PoliticaDevolucao`
--      (src/types/devolucao.ts) mais `id`.
--   3. Pós-condição: um bloco DO aborta a migration se, ao final, `anon` ou
--      `authenticated` ainda leem `updated_by` ou a tabela inteira. Sem ele, um
--      REVOKE que não tirasse nada (grant concedido por outro papel) só
--      emitiria um WARNING e o apply terminaria "ok" com o vazamento aberto.
--
--   A política RLS não muda: continua `USING (true)` para `anon` e
--   `authenticated`; o grant por coluna só recorta QUAIS colunas a linha
--   mostra. Quem escreve continua sendo só `salvar_politica_de_devolucao`
--   (SECURITY DEFINER, gate de admin atual); `service_role` mantém o
--   `GRANT ALL`, e as funções SECURITY DEFINER que fazem `SELECT *` (como
--   `devolucao_elegibilidade`) rodam como o dono da função e leem a linha
--   inteira, `updated_by` incluso, sem depender destes grants.
--
-- QUEM LÊ A TABELA DIRETO COM `anon`/`authenticated` (checado ANTES de
-- restringir): só `PoliticaDeDevolucaoSection.tsx`, o painel do lojista, que
-- lia com `select("*")` e passa a ler as colunas da lista acima. Nenhuma
-- edge function lê a tabela (todas usam a chave de serviço) e nenhuma outra
-- tela a consulta; o cliente final recebe a política pelas RPCs.
--
-- ORDEM DE PUBLICAÇÃO: o ideal é o front com a lista explícita de colunas
-- sair ANTES desta migration (ele funciona com o grant antigo). Mas o portão
-- da release (scripts/frota/publicar-release.mjs) só promove o front com a
-- versão já no ledger da loja, ou seja, banco primeiro. Neste caminho há uma
-- janela: banco novo com front velho. Um `select("*")` depois do REVOKE falha
-- com "permission denied for table politica_devolucao", e a tela de Ajustes →
-- Pós-venda → Trocas e devoluções cai no estado de erro de leitura até o
-- front novo entrar no ar. O app instalado (PWA) atualiza por prompt
-- (`registerType: "prompt"`): quem ainda não aceitou a atualização, e um
-- rollback de deploy para uma versão anterior, ficam com o bundle antigo e a
-- tela não carrega até o admin aceitar a atualização do app. Nenhum dado se
-- perde, e o cliente final não é afetado (ele recebe a política pelas RPCs).
-- Se a janela incomodar, a saída é publicar o front numa release sozinha
-- antes de aplicar esta migration.
--
-- DADOS EXISTENTES: nenhuma linha é lida nem reescrita; só mudam privilégios.
-- O `updated_by` que já está gravado continua gravado (a tela de Ajustes não
-- o usa, e as RPCs o removem do retorno).
--
-- IDEMPOTÊNCIA: REVOKE e GRANT de privilégio são idempotentes. Reaplicar deixa
-- o mesmo conjunto de privilégios por coluna.
--
-- FORA DO ESCOPO: tirar a política do alcance de `anon` (a leitura pública é
-- requisito do produto); mudar a política RLS; qualquer outra tabela. Aplicar
-- em produção é passo à parte, pelo `aplicar-migrations.yml`, com o OK do dono.
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- supabase/migrations/20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql`
-- — sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa); quem abre
-- a transação é o aplicador.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (qualquer pessoa roda à mão):
--   1. Deve dar false:
--        SELECT has_column_privilege('anon', 'public.politica_devolucao',
--                                    'updated_by', 'SELECT');
--      e o mesmo com 'authenticated'.
--   2. Deve dar true nas 15 colunas públicas:
--        SELECT a.attname, has_column_privilege('anon',
--                 'public.politica_devolucao', a.attname, 'SELECT')
--          FROM pg_attribute a
--         WHERE a.attrelid = 'public.politica_devolucao'::regclass
--           AND a.attnum > 0 AND NOT a.attisdropped
--         ORDER BY a.attnum;
--   3. Deve dar false (o privilégio de tabela inteira saiu):
--        SELECT has_table_privilege('anon', 'public.politica_devolucao',
--                                   'SELECT');
--
-- ROLLBACK: `rollback-manual-20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql`
-- devolve o `GRANT SELECT` da tabela inteira a `anon` e `authenticated`
-- (reabre o achado L).

REVOKE SELECT ON public.politica_devolucao FROM anon, authenticated;

GRANT SELECT (
  id,
  prazo_arrependimento_dias,
  prazo_troca_dias,
  prazo_vicio_dias,
  aceita_troca,
  aceita_vale,
  exige_fotos_vicio,
  metodos_locais,
  metodos_nacionais,
  reembolso_momento,
  frete_troca_pago_por,
  categorias_sem_troca,
  texto_politica,
  endereco_devolucao,
  updated_at
) ON public.politica_devolucao TO anon, authenticated;

DO $pos$
BEGIN
  IF has_column_privilege('anon', 'public.politica_devolucao', 'updated_by', 'SELECT')
     OR has_column_privilege('authenticated', 'public.politica_devolucao', 'updated_by', 'SELECT')
     OR has_table_privilege('anon', 'public.politica_devolucao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.politica_devolucao', 'SELECT')
  THEN
    RAISE EXCEPTION 'politica_devolucao: anon/authenticated ainda leem updated_by ou a tabela inteira (achado L)';
  END IF;
END
$pos$;
