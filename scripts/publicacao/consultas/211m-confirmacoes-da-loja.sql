-- 211m-confirmacoes-da-loja: ANTES de decidir aplicar a 20261655000000 numa loja; responde se a ficha id = 1 de
-- store_config ja tem as duas confirmacoes da 20261652000000 ("Esta certo" da Loja pronta). A trava interna da 1655
-- (TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO) so protege loja com pedido; loja sem pedido e sem confirmacao aplicaria e
-- deixaria de oferecer a entrega na cidade ou o pagamento na entrega.
-- Leitura: entrega_ok/pagamento_ok = true so com a coluna preenchida. ZERO linhas = NAO MEDIU (ficha id = 1 ausente ou
-- escondida da leitura), nunca "false". Coluna ausente = erro (a 20261652000000 nao esta na loja).
-- SO LEITURA: uma linha, dois booleanos; nem a data da confirmacao nem qualquer outro dado da loja ou de cliente sai.
SELECT entrega_confirmada_em IS NOT NULL AS entrega_ok,
       pagamento_confirmado_em IS NOT NULL AS pagamento_ok
  FROM public.store_config
 WHERE id = 1
