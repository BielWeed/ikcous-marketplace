-- ============================================================================
-- Rollback manual — gravacao concorrente da identidade (20261122000000)
-- ============================================================================
-- Reverter PRIMEIRO o front que chama read_store_identity/save_store_identity;
-- so depois rodar isto. Executar sob transacao externa (db-apply ou psql -1).
-- Sem BEGIN/COMMIT de proposito: o aplicador abre a transacao.
--
-- O QUE APAGA: o gatilho e a funcao de revisao, as duas RPCs, a constraint e a
-- coluna identity_revision (identificador de ocorrencia, nao contagem) e a
-- sequencia. Se a API for reaberta depois, a revisao recomeca em 0 e o cliente
-- que guardou uma revisao antiga recebe conflito na primeira gravacao — e o
-- comportamento previsto pelo SDK (compara texto, nunca converte para numero).
-- O QUE PRESERVA: todas as linhas de store_config e todos os objetos da A2.
-- IF EXISTS permite repetir sem erro.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.store_config IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS branding_a5_track_revision ON public.store_config;
DROP FUNCTION IF EXISTS public.branding_a5_track_revision();
DROP FUNCTION IF EXISTS public.read_store_identity();
DROP FUNCTION IF EXISTS public.save_store_identity(text,jsonb,jsonb);
ALTER TABLE public.store_config
  DROP CONSTRAINT IF EXISTS store_config_identity_revision_a5_check,
  DROP COLUMN IF EXISTS identity_revision;
DROP SEQUENCE IF EXISTS public.branding_a5_revision_seq;
