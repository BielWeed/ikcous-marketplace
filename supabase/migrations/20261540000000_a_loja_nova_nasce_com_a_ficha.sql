-- A LOJA NOVA NASCE COM A FICHA (26/11/2026; bloqueava a 1a loja nova)
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Grava UMA linha que so nasce onde falta
-- (a ficha id = 1 de public.store_config) e UMA marca no catalogo (o comentario da tabela, que hoje e' NULL). Nenhuma funcao, politica, gatilho,
-- grant, coluna ou restricao e' criado, redefinido ou removido.
--
-- O DEFEITO: loja recem-instalada ficava com public.store_config VAZIA. Nenhuma migration grava a linha id = 1 (os INSERT INTO store_config das
-- migrations antigas estao todos DENTRO do corpo de upsert_store_config, que so roda quando o painel salva) e o instalador
-- (scripts/frota/instalador-banco.mjs) tambem nao. Sem a ficha:
--   - o porteiro (src/hospedagem/porteiro.ts, leitura de v_store_config com id = 1) responde 503 "Esta loja esta em manutencao" em TODAS as rotas,
--     e por isso a lojista nem chega ao painel onde o upsert criaria a linha;
--   - forma_de_pagamento_aceita (20261174000000) devolve false para tudo: todo pedido e' recusado;
--   - calculate-shipping quebra; credenciais-mercado-pago devolve FICHA_NAO_EXISTE;
--   - read_store_identity e save_store_identity levantam IDENTITY_MISSING.
-- O conserto era um INSERT manual no runbook (docs/runbooks/producao-unica-fonte.md), nunca ensaiado.
--
-- O QUE ENTRA:
--   (1) INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING — o mesmo padrao da politica_devolucao (20261175000000) e da
--       config_pagamento_cartao (20261176000000). Todas as outras colunas nascem do DEFAULT de cada uma (o pre-voo recusa se alguma NOT NULL
--       alem de id estiver sem default). dominio_publico fica NULL: quem o grava e' o instalador, por loja (UPDATE pelo dono do banco).
--   (2) COMMENT ON TABLE public.store_config IS 'ficha_da_loja_20261540000000' — a MARCA (molde da 20261260000000). A prova da casa e' POR
--       OBJETO, nunca pelo ledger, e na IKCOUS e na Savy a linha ja existe: sem a marca a 191a sairia POSITIVA antes do apply e o portao da
--       release (decidirLote) PARARIA por "objetos ja no banco, ledger sem a versao". Com ela, a 191a so fica positiva depois do apply.
--
-- O QUE CADA GATILHO BEFORE INSERT DE store_config FAZ COM ESTE INSERT (eles disparam sobre a linha candidata MESMO quando o ON CONFLICT desvia):
--   - branding_a5_track_revision (20261122000000): grava identity_revision = nextval(branding_a5_revision_seq). Na loja que JA tem a linha, o
--     numero da sequencia e' consumido e descartado (a linha nao muda; buraco na sequencia e' normal e ninguem depende da contiguidade);
--   - store_config_exige_forma_de_pagamento (20261174000000): sai cedo se a linha id = 1 ja existe; senao confere o default
--     formas_pagamento_entrega = {pix,card,cash} (3 formas): passa;
--   - store_config_so_retirada_exige_retirada (20261244000000): sai cedo se a linha ja existe; senao local_delivery_enabled nasce true: passa;
--   - dominio_publico_so_muda_pela_frota_no_insert (20261150000000): nem dispara (WHEN exige dominio_publico, mp_public_key ou vapid_public_key
--     preenchidos, ou pagamento_online/manutencao fora de false; aqui todos nascem NULL/false).
--
-- DADOS EXISTENTES: na loja que ja tem a ficha (IKCOUS, Savy) o INSERT nao faz nada e a linha fica byte a byte como estava; so o comentario da
-- tabela, que era NULL, passa a ser a marca. Linhas com outro id (se houver) nao sao lidas nem tocadas. Na loja nova a ficha nasce com os defaults.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs / instalador abrem BEGIN, aplicam o arquivo e
-- fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (com eles o ROLLBACK da
-- prova viraria no-op). Idempotente: o INSERT so cria o que falta e o COMMENT grava o mesmo texto; rodar duas vezes nao erra e nao muda a linha.
-- Nao exige nenhuma migration especifica: o pre-voo confere o que o INSERT precisa (chave em id, NOT NULL com default) no schema que estiver
-- la. Nenhuma edge nem front precisa mudar: todos ja leem a linha id = 1; so passam a acha-la.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT, nada escrito): public.store_config ausente; sem chave primaria ou unica exatamente em (id) (o
-- ON CONFLICT (id) depende dela); alguma coluna NOT NULL alem de id sem default (o INSERT so com id falharia); ou o comentario da tabela
-- preenchido com outro texto que nao a marca (nao se sobrescreve comentario de ninguem).
-- POS-VOO (B2_POSVOO_DIVERGENTE): a linha id = 1 existe e o comentario e' a marca.
--
-- ROLLBACK: rollback-manual-20261540000000_a_loja_nova_nasce_com_a_ficha.sql tira SO a marca (o comentario volta a NULL). A FICHA FICA: apagar a
-- linha id = 1 derruba a loja (porteiro 503, todo pedido recusado, identidade ausente) e pode levar dado que a lojista ja preencheu.
-- TIPOS: nada muda em src/types/database.types.ts (nenhuma coluna, funcao ou tabela nova).
-- FICHA DE VERIFICACAO: consultas 191b (antes) e 191a (depois); prova viva tests/banco/a-loja-nova-nasce-com-a-ficha-viva.cjs (rpc-ci).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261540000000$
DECLARE
  v_sem_default text;
BEGIN
  IF to_regclass('public.store_config') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config ausente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint k
     WHERE k.conrelid = 'public.store_config'::regclass
       AND k.contype IN ('p', 'u')
       AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = 'public.store_config'::regclass AND a.attname = 'id' AND NOT a.attisdropped)]::smallint[]
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config sem chave primaria ou unica exatamente em (id); o ON CONFLICT (id) nao teria alvo.';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
    INTO v_sem_default
    FROM pg_attribute a
   WHERE a.attrelid = 'public.store_config'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attnotnull
     AND NOT a.atthasdef
     AND a.attidentity = ''
     AND a.attgenerated = ''
     AND a.attname <> 'id';
  IF v_sem_default IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: coluna(s) NOT NULL sem default em public.store_config (%): o INSERT so com id falharia.', v_sem_default;
  END IF;

  IF obj_description('public.store_config'::regclass, 'pg_class') IS NOT NULL
     AND obj_description('public.store_config'::regclass, 'pg_class') IS DISTINCT FROM 'ficha_da_loja_20261540000000' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config ja tem outro comentario de tabela (%); conferir antes de aplicar.',
      obj_description('public.store_config'::regclass, 'pg_class');
  END IF;
END $preflight_20261540000000$;

-- ===== a ficha e a marca =====

INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.store_config IS 'ficha_da_loja_20261540000000';

-- ===== pos-voo =====

DO $posvoo_20261540000000$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_config WHERE id = 1) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a ficha (public.store_config id = 1) nao existe depois do INSERT.';
  END IF;
  IF obj_description('public.store_config'::regclass, 'pg_class') IS DISTINCT FROM 'ficha_da_loja_20261540000000' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o comentario de public.store_config nao e a marca desta migration.';
  END IF;
END $posvoo_20261540000000$;
