-- ============================================================================
-- Migration 20261070000000 — os GRANTS de coluna de `produtos` nascem no
-- repositório (laudo varredura profunda #2, achado I-1, 01/09/2026)
-- ============================================================================
--
-- O PROBLEMA: o baseline (20260806) foi dumpado com --no-privileges, e o
-- conserto que esconde `produtos.custo` do cliente (BANCO-010, #119 — 25/08)
-- mora numa migration ARQUIVADA (_arquivadas/20260805), fora do ledger. O
-- snapshot de policies do banco (`backups/politicas-*.sql`) é gitignored de
-- propósito. Resultado medido pela inspeção (db-inspect-grants-storage-0109):
-- um projeto Supabase novo provisionado só com as migrations vivas nasce com
-- os grants PADRÃO — anon e authenticated com SELECT de TABELA — e a policy
-- `produtos_select_policy` (linha, anon vê ativo) entrega `custo` (o preço de
-- compra) a qualquer visitante com a chave anônima pública:
--   GET /rest/v1/produtos?select=nome,preco_venda,custo  ->  200 com a margem.
--
-- O QUE ESTA MIGRATION FAZ — replica IDEMPOTENTEMENTE o estado VIVO do molde
-- (medido em 01/09/2026, scripts/db-inspect-grants-storage-0109.cjs):
--   * anon SEM SELECT nenhum em produtos (a vitrine lê via vw_produtos_public;
--     provado vivo: has_table_privilege('anon','produtos','SELECT') = false e a
--     vitrine do molde roda assim hoje);
--   * authenticated com SELECT por COLUNA nas 29 colunas públicas — todas
--     menos `custo` (provas vivas: has_column_privilege anon/authenticated
--     SELECT custo = false; authenticated SELECT por coluna = 29).
--   * Escrita (INSERT/UPDATE/DELETE) NÃO é tocada: nos dois mundos ela já é
--     recusada a anon pelas policies de linha (produtos_admin_*_policy são
--     TO authenticated com is_admin) e o grant de escrita que existe é o
--     mesmo de antes da migration.
--
-- IDEMPOTÊNCIA: REVOKE/GRANT por coluna re-executam para o mesmo estado.
-- No molde aplicado a migration é um no-op funcional (o estado já é este);
-- em cada loja vendida nova ela É o conserto.
--
-- COMO PROVAR (ficha db-prove, padrão da casa — medição em conexão nova):
--   node scripts/db-prove-onda-a-clone-novo.cjs
-- Provas de ROLLBACK: rollback-manual-20261070000000_*.sql versionado junto.
--
-- ROLLBACK (resumo): restaurar SELECT de TABELA para anon e authenticated —
-- ver rollback-manual-20261070000000_os_grants_de_coluna_nascem_no_repositorio.sql.
-- ATENÇÃO: o rollback REABRE o vazamento da margem; só executar se a
-- migration estiver causando dano comprovado.
-- ============================================================================

-- 1. anon perde o SELECT (o buraco do clone novo; no molde é no-op) ----------
REVOKE SELECT ON public.produtos FROM anon;

-- 2. authenticated volta a ler por COLUNA, sem o custo ------------------------
-- O REVOKE de TABELA é o que mata o grant padrão do clone novo (projeto
-- Supabase novo nasce com SELECT de tabela); no molde é no-op (o estado vivo
-- já é SELECT=false de tabela). A pegadinha foi pega pela prova
-- (db-prove-onda-a-clone-novo, FASE CONCERTO): REVOKE só da coluna custo NÃO
-- derrotava o grant de tabela do clone — o custo continuava legível.
REVOKE SELECT ON public.produtos FROM authenticated;
REVOKE SELECT (custo) ON public.produtos FROM authenticated;

GRANT SELECT (
    id,
    nome,
    descricao,
    categoria,
    codigo,
    preco_venda,
    preco_original,
    imagem_url,
    imagem_urls,
    estoque,
    estoque_minimo,
    ativo,
    deleted_at,
    data_cadastro,
    ultima_atualizacao,
    peso_kg,
    altura_cm,
    largura_cm,
    comprimento_cm,
    frete_gratis,
    tags,
    meta_title,
    meta_description,
    rating,
    review_count,
    sold,
    calculated_points,
    fornecedor_id,
    is_bestseller
) ON public.produtos TO authenticated;
