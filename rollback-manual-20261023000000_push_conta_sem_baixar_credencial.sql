-- Reversao manual da migration 20261023000000_push_conta_sem_baixar_credencial.sql
--
-- A funcao de contagem sai; a tela volta a medir publico com
-- get_segmented_push_targets (que continua existindo — ela e a que o ENVIO
-- usa). Sem a emenda do front, a tela volta a baixar credencial para contar:
-- so reverta se a funcao nova se provar errada na loja.
--
-- Sem BEGIN/COMMIT de proposito: com eles o ROLLBACK do script de prova vira
-- no-op e a mudanca fica gravada no banco mesmo assim.

DROP FUNCTION IF EXISTS public.get_segmented_push_count(
    p_segment text DEFAULT 'all'::text,
    p_min_ltv numeric DEFAULT 150,
    p_days_inactive integer DEFAULT 30
);
