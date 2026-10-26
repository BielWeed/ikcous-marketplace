-- Rollback manual da 20261389000000 (o frete tem limite de cotacoes por origem).
-- Tira a funcao public.frete_consumir_cota(text, integer, integer) e a tabela public.frete_cota_por_origem.
-- NADA e' redefinido: a migration so criou objetos novos, entao nao ha corpo anterior para devolver; nenhuma funcao, politica,
-- grant ou tabela que ja existia foi tocada.
-- DADOS: a tabela guarda so contadores de ate 5 minutos (e linhas de no maximo 1 hora, varridas pela propria funcao). Nada de negocio
-- se perde ao apaga-la; por isso este rollback nao tem versao "destrutiva" nem pede confirmacao.
-- EDGE: a calculate-shipping desta release continua cotando sem a funcao (falha aberta: o aviso `contador_de_cotacoes_indisponivel`
-- vai para o log e a cotacao segue); so o limite por origem deixa de valer. Reverter a edge e' outro passo (publicar a anterior).
-- Reaplicar a 20261389000000 depois e' seguro: tabela e funcao nascem vazias/iguais.
-- Repetir este rollback e' no-op (IF EXISTS). Sem BEGIN/COMMIT: transacao do aplicador.

SET LOCAL lock_timeout = '5s';

-- A funcao primeiro (usa a tabela). Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.frete_consumir_cota(text, integer, integer);
DROP TABLE IF EXISTS public.frete_cota_por_origem;

NOTIFY pgrst, 'reload schema';
