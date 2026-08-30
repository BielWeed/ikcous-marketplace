-- ROLLBACK MANUAL da 20261026000000_o_pedido_avisa_o_cliente.sql
-- (o pedido avisa o cliente — trigger tr_pedido_avisa_o_cliente)
--
-- O desfazer é o DROP dos dois objetos que a migration cria. Nenhuma
-- notificação criada enquanto a trigger viveu precisa ser apagada: são
-- avisos verdadeiros que o cliente já leu (ou não) — apagar histórico de
-- sino do usuário seria destruição de dado sem motivo.

DROP TRIGGER IF EXISTS tr_pedido_avisa_o_cliente
  ON public.marketplace_orders;

DROP FUNCTION IF EXISTS public.notifica_cliente_de_mudanca_de_status();
