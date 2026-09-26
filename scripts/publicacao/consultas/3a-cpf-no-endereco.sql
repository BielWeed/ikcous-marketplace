-- Pedidos com CPF gravado DENTRO de customer_data.address (janela 23/09-26/09,
-- banco na 71 com front já mandando o CPF). Só contagem, nenhum CPF na saída.
-- Zero linhas = nada a limpar.
--
-- O WHERE é IDÊNTICO ao da CTE `alvo` da migration 20261182000000
-- (o_cpf_da_janela_sai_do_endereco, ainda fora desta árvore) — de
-- propósito: esta contagem prévia tem de alcançar EXATAMENTE o mesmo
-- conjunto de linhas que a migration vai tocar, nem mais nem menos.
--
-- `ja_tem_cpf_na_raiz` agora exige TEXTO NÃO-VAZIO no campo da raiz
-- (NULLIF(btrim(...)), IS NOT NULL) — a MESMA regra da CTE `alvo` daquela
-- migration (chave presente com `null`/vazio não conta como "já tem CPF";
-- a versão anterior desta consulta usava só presença da chave, que dava
-- falso positivo nesse caso). As colunas abaixo dão apoio à OPÇÃO DO DONO
-- daquela migration (mover vs. apagar cancelado/expirado sem etiqueta,
-- ainda não decidida):
-- `so_apaga_por_opcao_de_frete` (sem opção de frete, local-delivery ou
-- store-pickup nunca recebem CPF na raiz, com ou sem a opção ligada),
-- `payment_status_nulo` (a migration trata isso como não
-- cancelado/expirado — sempre movido) e `pago_apos_expirar` (sempre
-- movido, nunca apagado, mesmo com a opção ligada e status cancelado).
SELECT
  (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date                        AS dia_brasilia,
  count(*)                                                                      AS pedidos_com_cpf_no_endereco,
  count(*) FILTER (WHERE (o.customer_data -> 'address') - 'cpf' = '{}'::jsonb)  AS endereco_era_so_o_cpf,
  count(*) FILTER (WHERE NULLIF(btrim(o.customer_data ->> 'cpf'), '') IS NOT NULL) AS ja_tem_cpf_na_raiz,
  count(*) FILTER (WHERE regexp_replace(COALESCE(o.customer_data -> 'address' ->> 'cpf', ''), '\D', '', 'g') !~ '^\d{11}$') AS cpf_sem_11_digitos,
  count(*) FILTER (WHERE o.user_id IS NULL)                                     AS de_convidado,
  count(*) FILTER (WHERE o.status = 'cancelled')                                AS cancelados,
  count(*) FILTER (WHERE o.shipping_label_id IS NOT NULL)                       AS com_etiqueta,
  count(*) FILTER (
    WHERE NULLIF(btrim(COALESCE(o.customer_data ->> 'shipping_option_id', '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(o.customer_data ->> 'shipping_option_id', '')), '') IN ('local-delivery', 'store-pickup')
  )                                                                              AS so_apaga_por_opcao_de_frete,
  count(*) FILTER (WHERE o.payment_status IS NULL)                              AS payment_status_nulo,
  count(*) FILTER (WHERE o.payment_status = 'pago_apos_expirar')                AS pago_apos_expirar,
  min(o.created_at) AS primeiro_utc,
  max(o.created_at) AS ultimo_utc
FROM public.marketplace_orders o
WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
  AND (o.customer_data -> 'address') ? 'cpf'
GROUP BY 1
ORDER BY 1;
