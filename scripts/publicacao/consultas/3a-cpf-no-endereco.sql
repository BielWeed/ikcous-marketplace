-- Pedidos com CPF gravado DENTRO de customer_data.address (janela 23/09-26/09,
-- banco na 71 com front já mandando o CPF). Só contagem, nenhum CPF na saída.
-- Zero linhas = nada a limpar.
SELECT
  (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date                        AS dia_brasilia,
  count(*)                                                                      AS pedidos_com_cpf_no_endereco,
  count(*) FILTER (WHERE (o.customer_data -> 'address') - 'cpf' = '{}'::jsonb)  AS endereco_era_so_o_cpf,
  count(*) FILTER (WHERE o.customer_data ? 'cpf')                               AS ja_tem_cpf_na_raiz,
  count(*) FILTER (WHERE regexp_replace(COALESCE(o.customer_data -> 'address' ->> 'cpf', ''), '\D', '', 'g') !~ '^\d{11}$') AS cpf_sem_11_digitos,
  count(*) FILTER (WHERE o.user_id IS NULL)                                     AS de_convidado,
  count(*) FILTER (WHERE o.status = 'cancelled')                                AS cancelados,
  count(*) FILTER (WHERE o.shipping_label_id IS NOT NULL)                       AS com_etiqueta,
  min(o.created_at) AS primeiro_utc,
  max(o.created_at) AS ultimo_utc
FROM public.marketplace_orders o
WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
  AND (o.customer_data -> 'address') ? 'cpf'
GROUP BY 1
ORDER BY 1;
