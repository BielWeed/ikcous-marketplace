-- ROLLBACK MANUAL de 20261051000000_a_sonda_de_estoque_quebrada_sai_da_porta.sql
-- (laudo ofensiva 3108, achado N9 — faxina da sonda de estoque quebrada).
--
-- O QUE ESTE ROLLBACK DESFAZ: recria `check_stock_v1` com o corpo VERBATIM
-- do que estava vivo (baseline 20260806000000:3047, com CREATE OR REPLACE
-- para o avaliarFase0 aceitar). Os GRANT de EXECUTE para anon/authenticated/
-- service_role voltam com os DEFAULT PRIVILEGES do projeto; se o banco de
-- destino tiver privilégios padrão diferentes, re-conceder à mão:
--   GRANT EXECUTE ON FUNCTION public.check_stock_v1(uuid,uuid,integer) TO anon;
--
-- AVISO HONESTO: o corpo recriado mantém o DEFEITO que motivou o DROP —
-- referencia `produtos.stock`, que não existe, e toda chamada morre com
-- 42703. Voltar é reexpor a função quebrada; só usar para reverting de
-- propósito.
--
-- SEM BEGIN/COMMIT (regra da casa).

CREATE OR REPLACE FUNCTION public.check_stock_v1(p_product_id uuid, p_variant_id uuid, p_quantity integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stock INTEGER;
BEGIN
    IF p_variant_id IS NOT NULL THEN
        SELECT stock INTO v_stock FROM product_variants WHERE id = p_variant_id AND product_id = p_product_id;
    ELSE
        SELECT stock INTO v_stock FROM produtos WHERE id = p_product_id;
    END IF;

    RETURN COALESCE(v_stock, 0) >= p_quantity;
END;
$function$;
