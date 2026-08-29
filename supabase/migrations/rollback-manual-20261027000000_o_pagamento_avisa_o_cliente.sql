-- ROLLBACK MANUAL da 20261027000000_o_pagamento_avisa_o_cliente.sql
-- (o pagamento avisa o cliente — trigger tr_pagamento_avisa_o_cliente)
--
-- O desfazer é o DROP dos dois objetos que a migration cria. As
-- notificações que nasceram enquanto a trigger viveu são avisos verdadeiros
-- já entregues ao cliente — histórico de sino não se apaga sem motivo.

DROP TRIGGER IF EXISTS tr_pagamento_avisa_o_cliente
  ON public.marketplace_orders;

DROP FUNCTION IF EXISTS public.notifica_cliente_de_mudanca_de_pagamento();
