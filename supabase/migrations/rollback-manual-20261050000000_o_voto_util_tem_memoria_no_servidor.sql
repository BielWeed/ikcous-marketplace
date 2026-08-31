-- ROLLBACK MANUAL de 20261050000000_o_voto_util_tem_memoria_no_servidor.sql
-- (laudo ofensiva 3108, achado N2 — o voto útil ganha memória no servidor).
--
-- O QUE ESTE ROLLBACK DESFAZ:
--   1. Restaura `increment_helpful` para o corpo ANTERIOR (baseline
--      20260806000000, com a guarda de login) — sem deduplicação: o contador
--      volta a andar a cada chamada. Corpo VERBATIM do que estava vivo,
--      apenas com CREATE OR REPLACE para o avaliarFase0 aceitar.
--   2. Derruba a tabela `review_votes` (com as policies dela, que morrem
--      junto com a tabela).
--
-- O QUE NÃO VOLTA:
--   Os votos dados enquanto a tabela esteve viva continuam contando no
--   `helpful` (o número já foi somado). Voltar é voltar para o estado
--   fabricável do achado N2 — só fazer se estiver reverting o conserto
--   de propósito.
--
-- SEM BEGIN/COMMIT (regra da casa).

CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    UPDATE public.reviews
    SET helpful = COALESCE(helpful, 0) + 1
    WHERE id = review_id;
END;
$function$;

DROP TABLE IF EXISTS public.review_votes;
