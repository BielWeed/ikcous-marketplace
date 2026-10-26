-- O PRECO DO PRODUTO PASSA A DEIXAR HISTORICO (passo 1 de 3 da promocao sem "De" digitado; dinheiro + permissao; 26/10/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 1 tabela, 1 indice,
-- 1 politica, 1 funcao e 1 gatilho; nenhuma funcao, politica, grant ou gatilho que ja existia e' redefinido ou removido.
--
-- PRODUTO (decidido pelo dono em 26/10/2026): a promocao deixa de ter o "De" digitado. O "De" passara a ser o MENOR preco que o
-- produto teve nos 30 dias antes do corte de preco, calculado PELO BANCO a partir deste historico; subir o preco encerra a
-- promocao. ESTA migration e' so o PASSO 1: GRAVAR o historico. Nenhum preco cobrado muda, nenhuma tela muda, nenhuma funcao de
-- pedido/carrinho/vitrine muda. A regra do "De", a tela e a vitrine sao de outra tarefa (passos 2 e 3).
--
-- O QUE ENTRA (5 objetos novos):
--   (1) public.produto_historico_preco: uma linha por MUDANCA do preco de venda do produto.
--         produto_id      FK para public.produtos(id) ON DELETE CASCADE (apagar o produto de vez leva o historico dele junto);
--         preco           o preco de venda VALENDO a partir de mudado_em (e' produtos.preco_venda, o preco cobrado; nao e' o
--                         preco_original, que e' o "De" digitado de hoje);
--         preco_anterior  o preco de antes (NULL no cadastro e na migracao: antes nao havia registro);
--         mudado_em       quando passou a valer (a hora real do evento, nao a do inicio da transacao: duas mudancas na mesma
--                         transacao saem em ordem);
--         mudado_por      auth.uid() de quem mudou (NULL para service role, SQL direto e a propria migration). Sem FK de
--                         proposito: o registro sobrevive a quem sai (mesmo criterio de cargo_log);
--         origem          'cadastro' (produto nasceu) | 'mudanca' (o preco mudou) | 'migracao' (o que ja existia ao aplicar).
--       Indice por (produto_id, mudado_em DESC): "o preco do produto em tal dia" e "o menor preco dos ultimos 30 dias".
--   (2) Leitura so do admin ATUAL (rls_admin_atual(), a porta que as tabelas do painel usam desde a 20261197): cliente, visitante e
--       ex-admin nao leem. NINGUEM de aplicacao escreve (sem GRANT de escrita, sem politica de escrita): a unica escrita e' o
--       gatilho abaixo. As lojas clonadas tem ACL de fabrica diferente, entao o REVOKE e o GRANT sao explicitos (regra da
--       20261070000000), nunca dependem do default.
--   (3) public.registrar_historico_de_preco(): funcao do gatilho. SECURITY DEFINER (quem salva o produto nao escreve nesta tabela),
--       search_path fixo (pg_catalog, pg_temp; tudo qualificado, como a definir_cargo da 20261383000000), sem EXECUTE para ninguem
--       de aplicacao. Minima de proposito: UM INSERT, sem EXCEPTION que engula erro, sem laco, sem ler outra tabela.
--   (4) tr_produto_historico_de_preco: AFTER INSERT OR UPDATE OF preco_venda ON public.produtos, por linha.
--         INSERT  -> grava origem 'cadastro' (preco_anterior NULL);
--         UPDATE  -> grava origem 'mudanca' SO se NEW.preco_venda IS DISTINCT FROM OLD.preco_venda. Salvar o produto sem mexer
--                    no preco NAO grava nada (salvar_produto_com_grade da 20261352000000 reatribui preco_venda mesmo quando ele
--                    nao muda, e UPDATE OF dispara por coluna citada, nao por valor: por isso o teste de valor mora na funcao).
--       COBRE todos os caminhos que gravam produtos.preco_venda, sem tocar em nenhum: salvar_produto_com_grade, os UPDATE/INSERT/
--       upsert diretos de useProducts (PostgREST) e qualquer SQL de importacao ou reajuste em massa que um dia exista (o gatilho
--       e' por linha). NAO cobre (nao e' o preco do produto): product_variants.price_override (preco por variacao), produtos.
--       preco_original (o "De" digitado de hoje) e o preco gravado nos itens do pedido.
--   (5) NOTIFY pgrst: o PostgREST passa a ver a tabela.
--
-- O GATILHO NUNCA PODE IMPEDIR O SALVAMENTO DO PRODUTO. O que sobra de modo de falha, e por que nao ocorre: preco_venda e' NOT NULL
-- numeric(10,2) e a coluna da tabela nova tem a MESMA forma (nao estoura); a guarda NEW.preco_venda IS NULL cobre o dia em que
-- alguem afrouxar o NOT NULL (nao grava, nao falha); a FK aponta para a linha que acabou de nascer/existe (AFTER); o CHECK de
-- origem so recebe os tres literais da funcao; a tabela nao tem CHECK de valor que recuse um preco que produtos aceitou. Locks:
-- a FK pega FOR KEY SHARE na linha do produto que a MESMA transacao ja tem travada (UPDATE/INSERT), entao nao acrescenta espera nem
-- muda a ordem de travas da 20261350000000 (variacoes por id, depois produto).
--
-- DADOS EXISTENTES: nenhuma linha de produtos, product_variants, pedidos ou preco e' lida para fora nem alterada. O BACKFILL grava
-- UMA linha por produto que ainda nao tem historico (inclusive produto pausado ou na lixeira: e' o preco que ele tem), com
-- origem 'migracao', preco_anterior NULL e mudado_em = now() DA MIGRATION. NAO se inventa data antiga: o historico comeca
-- honestamente no dia em que a migration roda, e a regra do "De" do passo 2 tem de aceitar historico curto (loja nova nao tem 30
-- dias). Reaplicar nao duplica (so entra produto sem linha); produto novo depois do gatilho ja nasceu com a linha 'cadastro'.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e
-- fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). O GATILHO e' criado ANTES do
-- backfill de proposito: CREATE TRIGGER pega SHARE ROW EXCLUSIVE em produtos e segura ate o COMMIT, entao nenhum salvamento
-- concorrente passa entre "li os produtos" e "o gatilho existe" (produto novo ou preco mudado nessa janela ficaria sem linha).
-- O lock_timeout de 5s faz a migration FALHAR (e ser reaplicada) em vez de enfileirar todos os salvamentos da loja atras dela.
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE (funcao e gatilho), DROP POLICY IF EXISTS antes de recriar; rodar duas vezes nao erra e nao duplica linha.
-- Locks em produtos: so SHARE ROW EXCLUSIVE (FK da tabela nova e gatilho): salvamentos esperam o COMMIT, a leitura da vitrine nao.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se faltar produtos.id uuid, produtos.preco_venda numeric ou
-- rls_admin_atual(), ou se ja existir uma public.produto_historico_preco com forma diferente da desta migration.
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere RLS ligada, uma unica politica de leitura, ACL (anon sem nada, authenticated so SELECT),
-- gatilho ligado e funcao com search_path fixo, e que nenhum produto ficou sem linha de historico.
--
-- ROLLBACK: rollback-manual-20261386000000_o_preco_do_produto_deixa_historico.sql PARA de gravar (tira gatilho, funcao e politica) e
-- deixa a tabela selada com as linhas. rollback-manual-destrutivo-20261386000000_... apaga a tabela (so com confirmacao explicita);
-- sem backup nao ha como recuperar o historico depois. TIPOS: src/types/database.types.ts nao muda aqui (nada do front usa a tabela
-- ainda); regenerar quando o passo 2 passar a le-la.
-- Sem BEGIN/COMMIT: o aplicador controla a transacao (com eles o ROLLBACK da prova viraria no-op e a mudanca ficaria gravada).

SET LOCAL lock_timeout = '5s';

-- ===== pre-voo =====

DO $preflight_386$
DECLARE
  v_forma text;
BEGIN
  IF to_regclass('public.produtos') IS NULL
     OR to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam public.produtos ou public.rls_admin_atual().';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.produtos'::regclass AND attname = 'id'
                    AND atttypid = 'uuid'::regtype AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.produtos'::regclass AND attname = 'preco_venda'
                    AND atttypid = 'numeric'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos.id (uuid) ou produtos.preco_venda (numeric) nao tem a forma esperada.';
  END IF;
  IF to_regclass('public.produto_historico_preco') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.produto_historico_preco') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.produto_historico_preco') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'id:uuid:true,mudado_em:timestamp with time zone:true,mudado_por:uuid:false,origem:text:true,preco:numeric(10,2):true,preco_anterior:numeric(10,2):false,produto_id:uuid:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.produto_historico_preco existe e nao tem a forma desta migration (%).', v_forma;
    END IF;
  END IF;
END $preflight_386$;

-- ===== (1) a tabela =====

CREATE TABLE IF NOT EXISTS public.produto_historico_preco (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL,
  preco numeric(10,2) NOT NULL,
  preco_anterior numeric(10,2),
  mudado_em timestamptz NOT NULL DEFAULT now(),
  mudado_por uuid,
  origem text NOT NULL,
  CONSTRAINT produto_historico_preco_pkey PRIMARY KEY (id),
  CONSTRAINT produto_historico_preco_produto_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos (id) ON DELETE CASCADE,
  CONSTRAINT produto_historico_preco_origem_check CHECK (origem IN ('cadastro', 'mudanca', 'migracao'))
);

COMMENT ON TABLE public.produto_historico_preco IS 'Uma linha por mudanca do preco de venda do produto (produtos.preco_venda): preco = o que passou a valer em mudado_em. Origem: cadastro, mudanca ou migracao (o que ja existia ao aplicar; a data e a da migration, nao inventada). Escrita so pelo gatilho tr_produto_historico_de_preco; leitura so do admin atual.';
COMMENT ON COLUMN public.produto_historico_preco.preco IS 'produtos.preco_venda (o preco cobrado) valendo a partir de mudado_em. Nao e o preco_original (o De digitado).';
COMMENT ON COLUMN public.produto_historico_preco.mudado_por IS 'auth.uid() de quem mudou; NULL para service role, SQL direto e migracao. Sem FK de proposito: o registro sobrevive a quem sai.';

CREATE INDEX IF NOT EXISTS produto_historico_preco_produto_em_idx
  ON public.produto_historico_preco (produto_id, mudado_em DESC);

-- ===== (2) quem le e quem escreve =====

ALTER TABLE public.produto_historico_preco ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.produto_historico_preco FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.produto_historico_preco TO authenticated, service_role;

DROP POLICY IF EXISTS produto_historico_preco_select_policy ON public.produto_historico_preco;
CREATE POLICY produto_historico_preco_select_policy ON public.produto_historico_preco
  FOR SELECT TO authenticated
  USING ((SELECT public.rls_admin_atual()));

-- ===== (3) a funcao do gatilho =====

CREATE OR REPLACE FUNCTION public.registrar_historico_de_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  -- preco_venda e' NOT NULL hoje; se um dia deixar de ser, nao se grava linha sem preco (e o salvamento segue).
  IF NEW.preco_venda IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.produto_historico_preco (produto_id, preco, preco_anterior, mudado_em, mudado_por, origem)
    VALUES (NEW.id, NEW.preco_venda, NULL, clock_timestamp(), auth.uid(), 'cadastro');
  ELSIF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN
    INSERT INTO public.produto_historico_preco (produto_id, preco, preco_anterior, mudado_em, mudado_por, origem)
    VALUES (NEW.id, NEW.preco_venda, OLD.preco_venda, clock_timestamp(), auth.uid(), 'mudanca');
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_historico_de_preco() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.registrar_historico_de_preco() IS 'Gatilho de produtos: grava produto_historico_preco no cadastro e quando preco_venda muda. Um INSERT, sem engolir erro.';

-- ===== (4) o gatilho (ANTES do backfill: o lock dele fecha a janela) =====
-- CREATE OR REPLACE TRIGGER (PG14+), nao DROP + CREATE: o DROP TRIGGER pega ACCESS EXCLUSIVE em produtos (bloquearia ate a leitura da
-- vitrine ate o COMMIT); o OR REPLACE so pega SHARE ROW EXCLUSIVE (bloqueia escrita, nao leitura) e e' igualmente reaplicavel.

CREATE OR REPLACE TRIGGER tr_produto_historico_de_preco
  AFTER INSERT OR UPDATE OF preco_venda ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico_de_preco();

-- ===== o que ja existia: uma linha por produto sem historico, com a data de HOJE =====

INSERT INTO public.produto_historico_preco (produto_id, preco, preco_anterior, mudado_em, mudado_por, origem)
SELECT p.id, p.preco_venda, NULL, now(), NULL, 'migracao'
  FROM public.produtos p
 WHERE p.preco_venda IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.produto_historico_preco h WHERE h.produto_id = p.id);

-- ===== pos-voo =====

DO $posvoo_386$
DECLARE
  v_papel text;
  v_privilegio text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.produto_historico_preco') AND relrowsecurity) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a RLS de produto_historico_preco nao ficou ligada.';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.produto_historico_preco')) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.produto_historico_preco')
                      AND polname = 'produto_historico_preco_select_policy' AND polcmd = 'r') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: produto_historico_preco tem de ter exatamente uma politica, a de leitura.';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilegio IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_papel, 'public.produto_historico_preco', v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem % em produto_historico_preco.', v_papel, v_privilegio;
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('anon', 'public.produto_historico_preco', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.produto_historico_preco', 'SELECT') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: SELECT em produto_historico_preco tem de ser do authenticated e nunca do anon.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.produtos'::regclass AND t.tgname = 'tr_produto_historico_de_preco'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND f.oid = to_regprocedure('public.registrar_historico_de_preco()')
                    AND f.prosecdef AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o gatilho tr_produto_historico_de_preco nao esta ligado a funcao SECURITY DEFINER esperada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.produtos p
              WHERE p.preco_venda IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.produto_historico_preco h WHERE h.produto_id = p.id)) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: ficou produto sem nenhuma linha de historico depois do backfill.';
  END IF;
END $posvoo_386$;

NOTIFY pgrst, 'reload schema';
