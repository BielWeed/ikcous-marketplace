-- Só depois de a 9a dar toda ok=true (rol fechado) E de a leitura prévia do ledger
-- ser a lacuna da CAF (o conferir-banco.cjs confere os dois ANTES de chegar aqui).
-- BACKFILL do REGISTRO das 7 migrations 20261160..20261166 (exclusivo da CAF,
-- `ikcous-publicada`): o efeito delas está VIVO no banco (achado de 21/09) e o
-- ledger salta de 20261150 para 20261167. NENHUM objeto é criado, e a faixa NUNCA
-- se reaplica.
--
-- UM statement só, GUARDADO: o `INSERT ... SELECT` só escreve se o ledger, no
-- snapshot DESTE comando, ainda tem a 20261150 e a 20261167 e ainda não tem
-- nenhuma versão em 20261160..20261166. A guarda REDUZ o risco de gravar sobre uma
-- forma inesperada já visível; ela NÃO serializa: sob READ COMMITTED cada comando
-- vê o próprio snapshot, e um INSERT concorrente da faixa ainda não confirmado
-- não é visto (o ON CONFLICT DO NOTHING só poupa a linha de mesma versão). A
-- EVIDÊNCIA de que o registro ficou certo é a leitura pós-gravação do
-- conferir-banco.cjs, que confere exatamente as 7 versões com os nomes e a 150 e a
-- 167; a exclusão contra um apply simultâneo é o grupo de concorrência do
-- workflow, não este SQL. Reexecutar grava 0 linhas (as 7 já estão lá).
INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT v.version, v.name
  FROM (VALUES
    ('20261160000000', 'o_codigo_de_barras_e_o_canal_nascem_no_banco'),
    ('20261161000000', 'o_balcao_acha_o_produto_pelo_codigo'),
    ('20261162000000', 'a_venda_no_balcao_nasce_inteira'),
    ('20261163000000', 'a_lista_de_pedidos_filtra_por_canal'),
    ('20261164000000', 'a_varredura_de_cancelados_enxerga_o_cancelamento'),
    ('20261165000000', 'a_loja_nasce_com_frete_gratis_desligado'),
    ('20261166000000', 'o_cache_de_cotacao_nao_guarda_repeticao')
  ) AS v(version, name)
 WHERE EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261150000000')
   AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261167000000')
   AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                    WHERE version >= '20261160000000' AND version < '20261167000000')
ON CONFLICT (version) DO NOTHING;
