-- ============================================================================
-- Rollback manual — o cartão em análise segura a expiração (20261186000000)
-- ============================================================================
-- Restaura, byte a byte, o corpo de `public.expirar_pedidos_vencidos` que a
-- 20260901000000 deixou — o predicado novo (cartão possivelmente vivo não
-- expira por 24 h) sai; nada mais muda (mesma assinatura, mesmo SECURITY
-- DEFINER, mesmo search_path, mesma ACL — este arquivo não toca ACL, pelo
-- mesmo motivo da migration: CREATE OR REPLACE preserva a ACL vigente).
--
-- Depois do rollback a varredura volta a cancelar pedido de cartão em análise
-- depois de 30 minutos (o defeito que a 20261186000000 corrige): reverter só
-- faz sentido se a regra nova estiver causando um problema pior. O corpo
-- restaurado não lê `metodo_online`, então não há dependência de coluna a
-- conferir (ao contrário da migration, que tem preflight).
--
-- Nenhuma migration depois da 20261186000000 depende do predicado novo.
-- Se alguma redefinir `expirar_pedidos_vencidos` no futuro, ela precisa do seu
-- próprio rollback e da sua própria guarda de ordem — reverter ESTE arquivo
-- por baixo dela apagaria a redefinição dela em silêncio.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED protege contra OUTRA varredura: se dois ciclos do
    -- pg_cron se sobrepuserem, o segundo pula a linha travada em vez de creditar
    -- estoque duas vezes. NAO resolve a corrida com o webhook da Fase 3: se a
    -- varredura pegar a trava primeiro, o UPDATE do webhook espera, reavalia o
    -- WHERE por id (que continua valendo) e sobrescreve — sai pedido 'pago' com
    -- status 'cancelled' e estoque ja devolvido. Tratar esse estado e' obrigacao
    -- de quem escrever o webhook; a CHECK ja reserva 'pago_apos_expirar' para
    -- ele. Este comentario e' o que a Fase 3 vai ler: nao prometa aqui garantia
    -- que o codigo nao da.
    --
    -- status = 'pending' e' o filtro que impede credito em dobro: quando o
    -- cliente cancela pelo app, a update_order_status_atomic JA devolve o
    -- estoque e NAO escreve payment_status. Sem este AND, o pedido cancelado as
    -- 10:05 seria varrido as 10:30 e creditado uma segunda vez. Vale tambem para
    -- o pedido que o admin adiantou para 'processing' dentro dos 30 minutos:
    -- venda fechada por fora nao pode ser cancelada por varredura.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND status = 'pending'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;
