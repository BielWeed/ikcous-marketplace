-- Rollback manual da 20261386000000 (o preco do produto passa a deixar historico).
-- PARA de gravar: tira o gatilho tr_produto_historico_de_preco, a funcao registrar_historico_de_preco() e a politica de leitura.
-- NADA e' redefinido: a migration so criou objetos novos, entao nao ha corpo anterior para devolver. O salvamento de produto
-- (salvar_produto_com_grade, UPDATE/INSERT diretos) volta a ser exatamente o de antes: nenhuma funcao, politica ou grant dele foi tocado.
-- DADOS: a tabela public.produto_historico_preco FICA, com as linhas, selada (RLS ligada e nenhuma politica: ninguem de aplicacao
-- le). O historico ja gravado nao e' perdido por este arquivo. Apaga-la e' o rollback-manual-destrutivo-20261386000000 (so depois
-- deste, com confirmacao, e com copia antes: nao ha PITR). Tirar a politica tambem destrava o rollback da 20261197, que recusa
-- enquanto qualquer politica fora dela ainda cita rls_admin_atual().
-- Reaplicar a 20261386000000 depois deste rollback e' seguro: a tabela e as linhas sobrevivem, o backfill so cobre produto sem linha
-- (o produto que mudou de preco no intervalo NAO ganha linha nova: a ultima linha dele fica velha ate a proxima mudanca e as mudancas
-- do intervalo nao ficam registradas; quem le o historico nao pode supor que a ultima linha e' sempre o preco de hoje depois de um rollback).
-- LOCK: o DROP TRIGGER pega ACCESS EXCLUSIVE em produtos ate o COMMIT (ate a vitrine espera uns instantes); o lock_timeout de 5s faz o
-- rollback falhar em vez de enfileirar a loja. Rode fora do horario de pico.
-- Ordem: antes do rollback da 20261197. Repetir e' no-op. Sem BEGIN/COMMIT: transacao do aplicador.

SET LOCAL lock_timeout = '5s';

-- Primeiro o gatilho (depende da funcao dele), depois a funcao. Sem CASCADE: dependente que escapou faz o Postgres recusar em vez
-- de apagar o objeto junto.
DROP TRIGGER IF EXISTS tr_produto_historico_de_preco ON public.produtos;
DROP FUNCTION IF EXISTS public.registrar_historico_de_preco();

DO $rollback_politica_20261386000000$
BEGIN
  IF to_regclass('public.produto_historico_preco') IS NOT NULL THEN
    DROP POLICY IF EXISTS produto_historico_preco_select_policy ON public.produto_historico_preco;
  END IF;
END $rollback_politica_20261386000000$;

NOTIFY pgrst, 'reload schema';
