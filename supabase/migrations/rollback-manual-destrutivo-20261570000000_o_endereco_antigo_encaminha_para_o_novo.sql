-- ROLLBACK DESTRUTIVO 20261570000000 - SO COM O DONO.
-- Apaga public.frota_enderecos_que_encaminham (a tabela e TODAS as linhas: cada endereco antigo, www e endereco novo em preparo de cada
-- loja) e a funcao do gatilho dela. Esse dado NAO tem como ser recuperado, e TODO endereco antigo que encaminhava volta a mostrar "loja
-- em manutencao" (o porteiro deixa de achar o endereco). As lojas (frota_lojas), o endereco principal de cada uma, as chaves e o segredo
-- da frota ficam. Faca copia antes:
--   SELECT host, loja_id, motivo, criado_em, quem FROM public.frota_enderecos_que_encaminham ORDER BY loja_id, host;
-- So depois do rollback comum (rollback-manual-20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql: as portas ausentes), numa
-- transacao do caller, com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao
-- inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR';
-- Com qualquer linha na tabela, recusa (CADERNETA_SEMEADA) mesmo com o APAGAR: e o banco que guarda a caderneta de producao, e apagar
-- os enderecos tira do ar todo link antigo da frota. So com o dono, na mesma transacao, alem do APAGAR:
--   SET LOCAL ikcous.apagar_caderneta = 'sim';
-- O rollback da 20261141000000 (DROP TABLE frota_lojas) so roda DEPOIS deste: a chave estrangeira da tabela depende de frota_lojas.
-- Repetir e' no-op (IF EXISTS). Sem BEGIN/COMMIT de nivel superior: transacao do aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261570000000$
DECLARE
  v_tem_linha boolean;
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_enderecos_que_encaminham', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'ENDERECOS_QUE_ENCAMINHAM_SO_COM_O_DONO: confirme antes de apagar os enderecos que encaminham (public.frota_enderecos_que_encaminham).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_encaminhamento', 'frota_trocar_dominio')) THEN
    RAISE EXCEPTION 'ENDERECOS_QUE_ENCAMINHAM_ROLLBACK_COMUM_PRIMEIRO: tire as portas (rollback comum) antes de apagar os enderecos que encaminham.';
  END IF;
  -- A trava de escrita (SHARE) vale ate o fim da transacao: ninguem grava linha entre a conferencia e o DROP.
  IF to_regclass('public.frota_enderecos_que_encaminham') IS NOT NULL
     AND COALESCE(current_setting('ikcous.apagar_caderneta', true), '') <> 'sim' THEN
    LOCK TABLE public.frota_enderecos_que_encaminham IN SHARE MODE;
    SELECT EXISTS (SELECT 1 FROM public.frota_enderecos_que_encaminham) INTO v_tem_linha;
    IF v_tem_linha THEN
      RAISE EXCEPTION 'CADERNETA_SEMEADA: public.frota_enderecos_que_encaminham tem linha - apaga-la tira do ar todo endereco antigo da frota. Nada foi apagado. So com o dono: SET LOCAL ikcous.apagar_caderneta = ''sim'' na mesma transacao.';
    END IF;
  END IF;
END $destrutivo_20261570000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto. O gatilho sai com a tabela.
DROP TABLE IF EXISTS public.frota_enderecos_que_encaminham;
DROP FUNCTION IF EXISTS public.frota_enderecos_que_encaminham_nao_e_principal();

DO $posvoo_destrutivo_20261570000000$
BEGIN
  IF to_regclass('public.frota_enderecos_que_encaminham') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_enderecos_que_encaminham_nao_e_principal') THEN
    RAISE EXCEPTION 'POSVOO_DESTRUTIVO_20261570000000: a tabela ou a funcao do gatilho ainda existe';
  END IF;
END $posvoo_destrutivo_20261570000000$;

NOTIFY pgrst, 'reload schema';
