-- A LOJA PAUSA O PEDIDO NOVO (26/11/2026; plano PLANO-PAUSA-DE-VENDAS-LOTE1-26-11 com as correcoes da hub; decisao DECISAO-FIM-DO-TESTE-E-PAUSA-26-11)
-- RISCO: migration + gatilho BEFORE INSERT em marketplace_orders (o caminho do dinheiro) + gatilho em assinatura_da_loja (a porta do app de gestao). Revisao Opus antes de aplicar.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. NAO redefine as funcoes que criam pedido (v1, v23, v24), a venda de
-- balcao, a porta do cartao da assinatura nem o leitor dele. So CRIA: a tabela public.pausa_de_vendas (linha unica, nasce VAZIA) e as funcoes e gatilhos abaixo.
--
-- O DEFEITO: hoje nada no servidor recusa pedido. A manutencao (store_config.manutencao) so esconde a vitrine de quem abre o app; quem ja esta com ele aberto compra.
-- E a loja que nao paga a assinatura nao tem como parar de receber pedido novo sem fechar o painel junto.
--
-- O QUE CRIA:
--   (1) public.pausa_de_vendas (id smallint = 1, vale_pela_assinatura boolean NOT NULL DEFAULT false, ligada_em timestamptz, suspensa_desde date): RLS ligada SEM
--       politica e nada para PUBLIC, anon, authenticated nem service_role. So o dono (postgres) grava. Nasce VAZIA: sem a linha com vale_pela_assinatura = true a loja
--       NUNCA pausa por assinatura (Savy, IKCOUS e as lojas de teste nunca recebem true).
--
-- DADOS EXISTENTES: nenhuma linha de nenhuma tabela e' lida, reescrita ou apagada pelo apply.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro, inclusive o
-- pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui. Idempotente: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE com o mesmo corpo e REVOKE/GRANT
-- explicitos; rodar duas vezes nao erra e nao muda nada. lock_timeout de 5 s: um pedido em voo faz o arquivo FALHAR LIMPO (55P03) em vez de enfileirar o checkout; e' so
-- rodar de novo.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT), recusa sem escrever: falta papel de aplicacao; marketplace_orders sem canal (text NOT NULL) ou idempotency_key (uuid);
-- store_config sem manutencao (boolean NOT NULL); is_admin() ou is_admin_atual() ausentes; assinatura_da_loja sem a forma de 14 colunas da 20261590000000 (com pausa_em);
-- assinatura_da_loja_chave ausente ou torta; pausa_de_vendas ja existente com outra forma.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261600000000$
DECLARE
  v_forma text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'canal'
                    AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'idempotency_key'
                    AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders sem canal (text NOT NULL) ou idempotency_key (uuid) - aplique a 20261160000000 e a 20261203000000 antes.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'manutencao'
                    AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config sem manutencao (boolean NOT NULL) - aplique a 20261150000000 antes.';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: is_admin() ou is_admin_atual() ausente - aplique a 20261197000000 antes.';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja nao tem a forma de 14 colunas da 20261590000000 (com pausa_em) (%) - aplique a 20261590000000 antes.', COALESCE(v_forma, 'ausente');
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_chave ausente ou com outra forma (%) - aplique a 20261399998000 antes.', COALESCE(v_forma, 'ausente');
  END IF;

  IF to_regclass('public.pausa_de_vendas') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.pausa_de_vendas') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pausa_de_vendas ja existe com outra forma (%) - nao e a desta migration; revise antes de aplicar.', COALESCE(v_forma, 'nao e tabela');
    END IF;
  END IF;
END $preflight_20261600000000$;

-- ===== (1) a tabela: a chave que LIGA a pausa por assinatura nesta loja, e o dia em que o status virou suspensa =====

CREATE TABLE IF NOT EXISTS public.pausa_de_vendas (
  id smallint NOT NULL,
  vale_pela_assinatura boolean NOT NULL DEFAULT false,
  ligada_em timestamptz,
  suspensa_desde date,
  CONSTRAINT pausa_de_vendas_pkey PRIMARY KEY (id),
  CONSTRAINT pausa_de_vendas_linha_unica CHECK (id = 1)
);

ALTER TABLE public.pausa_de_vendas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pausa_de_vendas FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pausa_de_vendas IS 'Linha unica (id = 1) da pausa de vendas por assinatura. vale_pela_assinatura = true LIGA a pausa nesta loja (so o dono do banco grava; nasce vazia = nunca pausa; Savy e IKCOUS nunca recebem true). suspensa_desde = dia (Sao Paulo) em que assinatura_da_loja.status virou suspensa, gravado pelo gatilho tr_assinatura_marca_suspensa_desde. RLS sem politica: nenhum papel de aplicacao le nem grava.';
