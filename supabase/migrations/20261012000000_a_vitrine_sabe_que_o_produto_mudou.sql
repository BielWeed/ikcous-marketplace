-- A vitrine sabe que o produto mudou
-- SEM BEGIN/COMMIT: quem abre a transacao e' quem aplica.
--
-- O DEFEITO. `realtimeSyncEngine.ts:884-921` (catchUp) e' o unico reestimulo
-- quando o app volta do segundo plano: ele compara `produtos.ultima_atualizacao`
-- do servidor com o `updatedAt` do cofre local e rebusca so' os que
-- divergirem. Medido no disco em 26/08/2026: NENHUM `CREATE TRIGGER` toca
-- `produtos` ou `product_variants` em migration nenhuma, e nenhum caminho de
-- `src/hooks/useProducts.ts` (updateProduct, updateProductsStatus,
-- deleteProduct, updateVariant, deleteVariant, fila offline) escreve
-- `ultima_atualizacao`. A coluna so' ganha valor no INSERT (DEFAULT now()) —
-- depois disso `serverTime == localTime` para sempre, e o catchUp nunca
-- rebusca nada.
--
-- EFEITO PARA QUEM USA A LOJA: preco, estoque e foto ANTIGOS na vitrine
-- mesmo com a pessoa online; e variante que a lojista apagou continua sendo
-- oferecida (o cliente escolhe e a compra falha sem explicacao).
--
-- O QUE ESTA MIGRATION FAZ. Dois gatilhos novos, nenhuma funcao existente
-- tocada:
--   1. BEFORE UPDATE em produtos, FOR EACH ROW: marca
--      `NEW.ultima_atualizacao = now()` a cada UPDATE.
--   2. AFTER INSERT OR UPDATE OR DELETE em product_variants, FOR EACH ROW:
--      propaga a mesma marca para o PRODUTO PAI, porque a vitrine mostra
--      preco/estoque da variante dentro do card do produto, e
--      product_variants NAO TEM coluna de tempo de atualizacao propria
--      (colunas reais, conferidas na baseline: id, product_id, sku, name,
--      value, stock_increment, price_override, active, created_at,
--      image_url).
--
-- DECISOES DESTA MIGRATION, e o porque de cada uma:
--
-- (a) NOMES. `handle_produto_atualizado` e `handle_variant_atualiza_produto`
--     seguem o prefixo `handle_` ja em uso na baseline para funcao de
--     gatilho (handle_updated_at, handle_public_profile_sync,
--     handle_default_address). Os nomes dos gatilhos
--     (`set_ultima_atualizacao`, `sync_produto_ultima_atualizacao`) espelham
--     os irmaos mais proximos por FORMA: `set_updated_at` (BEFORE UPDATE na
--     propria linha, em cart_items) e `sync_public_profile` (AFTER
--     INSERT/UPDATE/DELETE que propaga para OUTRA tabela, em profiles) —
--     exatamente as duas formas que estes dois gatilhos tem aqui.
--
-- (b) SEARCH_PATH E SECURITY.
--     - `handle_produto_atualizado` (gatilho 1) toca so' a PROPRIA linha
--       (NEW.ultima_atualizacao) — mesmo formato de `handle_updated_at`, que
--       NAO e' SECURITY DEFINER. Segue o mesmo: `LANGUAGE plpgsql` +
--       `SET search_path TO 'public'`, sem SECURITY DEFINER. Nao precisa de
--       privilegio elevado porque nao le nem escreve fora da linha que o
--       proprio UPDATE ja estava autorizado a mudar.
--     - `handle_variant_atualiza_produto` (gatilho 2) escreve numa tabela
--       DIFERENTE da que disparou o gatilho (product_variants -> produtos).
--       O precedente estrutural exato na baseline e' `handle_public_profile_sync`
--       (AFTER INSERT/UPDATE/DELETE em profiles, escreve em
--       public_profiles): ela E' SECURITY DEFINER com
--       `SET search_path TO 'public'`. Sigo o mesmo par aqui, pelo mesmo
--       motivo — quem dispara o INSERT/UPDATE/DELETE em product_variants
--       (painel admin via RLS, ou create_marketplace_order_v22 debitando
--       stock_increment durante o checkout) nao deveria precisar CARREGAR
--       permissao de UPDATE em produtos so' para o efeito colateral de
--       marcar a hora — o gatilho e' o dono desse efeito, nao quem chamou.
--     - NENHUMA das duas funcoes tem REVOKE: funcao de gatilho retorna o
--       pseudo-tipo `trigger` e o Postgres recusa chama-la fora de um
--       gatilho ("trigger functions can only be called as triggers") —
--       diferente de `pagamentos_a_reconciliar` (SECURITY DEFINER, mas
--       RETURNS TABLE, chamavel direto por SELECT), que por isso PRECISA do
--       REVOKE. `handle_public_profile_sync` e `handle_updated_at`, os dois
--       precedentes usados aqui, tambem nao tem REVOKE na baseline — mesma
--       razao.
--
-- (c) RECURSAO — nao ha. O gatilho 2 dispara um UPDATE em produtos, que
--     ACORDA o gatilho 1 (BEFORE UPDATE em produtos) — isso e' esperado e
--     inofensivo: o gatilho 1 so' mexe em NEW.ultima_atualizacao da PROPRIA
--     linha, nao volta a tocar product_variants. Nao ha gatilho de UPDATE ou
--     DELETE em produtos que mexa em product_variants, entao a cadeia para
--     em UMA unica idade e vira: variante muda -> produto e' marcado ->
--     (gatilho 1 roda, mesma marca, sem sair de produtos) -> fim.
--
--     Caso lateral aceito, sem guarda extra: quando um produto e' apagado,
--     `product_variants_product_id_fkey ... ON DELETE CASCADE` derruba as
--     variantes DENTRO da mesma instrucao, e o gatilho 2 dispara um UPDATE
--     em produtos por variante.
--
--     MEDIDO pela revisao de contexto limpo (transacao com ROLLBACK,
--     PostgreSQL 17.6), e o numero corrige o que a primeira versao deste
--     comentario afirmava: quando os gatilhos AFTER das variantes disparam,
--     a linha do produto pai JA SUMIU — entao cada um desses N UPDATEs casa
--     ZERO linhas, e nao "atualiza a linha que esta sendo apagada". E' mais
--     barato do que a versao anterior deste texto prometia. Um produto com
--     50 variantes levou 205 ms, sem erro. Hoje o maior produto do banco tem
--     1 variante; o ponto de dor estimado fica na casa de milhares de
--     variantes num unico DELETE.
--
--     Nao vale guarda: evitar esses UPDATEs custaria uma consulta extra POR
--     VARIANTE para economizar um UPDATE que ja' casa zero linhas.
--
-- (d) SOBRESCREVER SEMPRE, NUNCA RESPEITAR UM VALOR EXPLICITO DO CHAMADOR.
--     O gatilho 1 ignora o que o UPDATE tentou gravar em
--     `NEW.ultima_atualizacao` e sempre poe `now()` — igual a
--     `handle_updated_at`, que faz `NEW.updated_at = now()` sem condicional
--     nenhuma. A razao e' o proprio motivo desta migration existir: se o
--     chamador pudesse escolher um valor (inclusive um valor ANTIGO, de
--     proposito ou por acidente), a vitrine voltaria a nao perceber a
--     mudanca — exatamente o defeito que este arquivo fecha. Dispara em
--     TODO UPDATE, mesmo um que reescreve os mesmos valores (`UPDATE
--     produtos SET nome = nome`): o custo de um refetch a mais no cliente e'
--     pequeno; o custo de PERDER um refetch de verdade e' o defeito
--     original.
CREATE OR REPLACE FUNCTION public.handle_produto_atualizado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
    NEW.ultima_atualizacao = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_ultima_atualizacao
    BEFORE UPDATE ON public.produtos
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_produto_atualizado();

CREATE OR REPLACE FUNCTION public.handle_variant_atualiza_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- UPDATE que troca a variante de produto (reparenting): o produto ANTIGO
    -- perde uma oferta e o produto NOVO ganha uma — os dois precisam avisar
    -- a vitrine, nao so' um dos dois.
    IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
        UPDATE public.produtos SET ultima_atualizacao = now() WHERE id = OLD.product_id;
        UPDATE public.produtos SET ultima_atualizacao = now() WHERE id = NEW.product_id;
    ELSE
        UPDATE public.produtos SET ultima_atualizacao = now()
         WHERE id = COALESCE(NEW.product_id, OLD.product_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER sync_produto_ultima_atualizacao
    AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_variant_atualiza_produto();
