-- O CACHE DE COTAÇÃO NÃO GUARDA REPETIÇÃO
-- (fila do bastão 19/09, item 4; migration serializada — uma por vez)
--
-- O DEFEITO QUE ESTA MIGRATION FIXA: `shipping_quotes_cache` nasceu só com
-- PK em `id`, e a gravação concorrente do edge `calculate-shipping`
-- empilhava DUAS linhas para a mesma chave (origem, destino, carrinho) —
-- o bug index-880, que a leitura passou a tolerar (order desc limit 1) e a
-- gravação passou a compensar na mão (update→insert), sem nunca fechar a
-- corrida de verdade. A chave única aqui fecha: com ela, o `.upsert` do
-- supabase-js passa a ter alvo de conflito REAL e a gravação fica atômica.
--
-- ⚠️ ORDEM DE PUBLICAÇÃO (do dono, não desta migration): o edge
-- `calculate-shipping` só pode ir para produção com `.upsert` DEPOIS disto
-- aplicado no banco da loja — `.upsert` com `onConflict` numa tabela SEM a
-- constraint não conflita nada e volta a ser insert duplicado.

-- (1) Dedup do que o bug empilhou: por chave, fica a linha mais recente (a
-- mesma que a leitura tolerante já escolhia). Dado de CACHE regenerável —
-- nenhuma cotação é dado de negócio (histórico mora em
-- shipping_calculation_logs, que não é tocado aqui). O desempate por id
-- torna a escolha determinística mesmo com created_at empatado.
DELETE FROM public.shipping_quotes_cache a
    USING public.shipping_quotes_cache b
    WHERE a.origin_cep = b.origin_cep
      AND a.destination_cep = b.destination_cep
      AND a.cart_hash = b.cart_hash
      AND (a.created_at, a.id) < (b.created_at, b.id);

-- (2) A chave única de verdade: uma linha por (origem, destino, carrinho).
ALTER TABLE public.shipping_quotes_cache
    ADD CONSTRAINT shipping_quotes_cache_chave_unica
    UNIQUE (origin_cep, destination_cep, cart_hash);

-- (3) Índice para a limpeza abaixo varrer por data sem seq scan em tabela
-- grande (a UNIQUE não serve para isso: ela é da chave, não do tempo).
CREATE INDEX shipping_quotes_cache_created_at_idx
    ON public.shipping_quotes_cache (created_at);

-- (4) Gatilho de limpeza: a leitura do edge só aceita cotação das últimas
-- 2 HORAS (index.ts, `twoHoursAgo`) — linha mais velha que isso nunca mais
-- será lida por ninguém. A cada gravação, as velhas saem: a tabela deixa
-- de crescer sem dono (a alternativa era cron externo, que aqui não
-- existe). FOR EACH STATEMENT: uma varredura por gravação, não por linha.
CREATE OR REPLACE FUNCTION public.limpar_cotacoes_fora_da_janela()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    -- Linha de propósito ÚNICA: o marcador do VERIFICACOES conta ocorrência
    -- exata de texto, e quebra no meio escondia o DELETE do corpo extraído.
    DELETE FROM public.shipping_quotes_cache WHERE created_at < now() - interval '2 hours';
    RETURN NULL;
END;
$function$;

CREATE TRIGGER shipping_quotes_cache_limpa_ao_gravar
    AFTER INSERT OR UPDATE ON public.shipping_quotes_cache
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.limpar_cotacoes_fora_da_janela();
