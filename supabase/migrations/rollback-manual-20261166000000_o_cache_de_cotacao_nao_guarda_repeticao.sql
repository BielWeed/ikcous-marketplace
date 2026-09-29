-- ROLLBACK MANUAL — 20261166000000_o_cache_de_cotacao_nao_guarda_repeticao
--
-- Devolve os quatro pontos que a migration tocou, na ordem inversa:
-- gatilho, função de limpeza, índice e a chave única. O dedup do passo (1)
-- NÃO é reversível — e não precisa ser: as linhas apagadas eram
-- DUPLICATAS de cache (a mais recente de cada chave continua), dado
-- regenerável que a próxima cotação da transportadora reescreve.
DROP TRIGGER IF EXISTS shipping_quotes_cache_limpa_ao_gravar
    ON public.shipping_quotes_cache;

DROP FUNCTION IF EXISTS public.limpar_cotacoes_fora_da_janela();

DROP INDEX IF EXISTS public.shipping_quotes_cache_created_at_idx;

ALTER TABLE public.shipping_quotes_cache
    DROP CONSTRAINT IF EXISTS shipping_quotes_cache_chave_unica;
