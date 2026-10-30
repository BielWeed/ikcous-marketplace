-- 117m — MEDICAO, so leitura: a loja esta pronta para vender online? Pedidos online ja feitos, chaves ligadas
-- (Mercado Pago, Melhor Envio, e-mail da loja) e o catalogo, sem expor nenhum segredo nem dado de cliente.
-- Nasceu na vistoria da Savy (30/10/2026): a ficha de agosto dizia "faltam as chaves dela" e o PIX aparecia ligado.
-- Molde da 45m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova de portao de release. Quem decide e a
-- pessoa que le a tabela.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu nas tabelas abaixo. Com a RLS
--              valendo, todo numero daquela tabela sai como INCONCLUSIVO (a RLS esconde as linhas de quem leu:
--              um 0 enganaria).
--   pedidos    pedidos do canal online: total, quantos pagos, por forma (pix|credito|debito), compradores
--              distintos (so a quantidade), datas do primeiro e do ultimo.
--   catalogo   produtos nao apagados, ativos, ativos com estoque.
--   loja       store_config: CEP de origem preenchido?, provedor de frete, pagamento online ligado?, chave
--              publica do Mercado Pago preenchida? (sim/nao, nunca o valor).
--   frete      uma linha por provedor em store_shipping_credentials: o campo `token` esta preenchido? (sim/nao) e
--              a DATA da ultima gravacao. A data diz se o token mudou depois de uma data conhecida.
--   mercado_pago  registro do lojista em app_settings: existe? token e chave de notificacoes cifrados presentes?
--              ambiente do ultimo teste (producao|teste), se conectou, e as DATAS do ultimo teste e da ultima
--              gravacao. O apelido da conta NAO sai (o painel mostra; o log do run e publico).
--   email      registro `email_da_loja` em app_settings: existe? senha cifrada presente? DATA da gravacao.
--   etiquetas  eventos de etiqueta por tipo (etiqueta_gerada|rastreio_consultado|erro): so contagem.
-- NENHUM DADO PESSOAL: so contagens, sim/nao e datas; nenhum id, nome, e-mail, telefone, CPF, endereco, nome de
-- produto, valor de chave ou apelido de conta. O log do run e legivel por quem le o repositorio: o que sai daqui
-- e so agregado. tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH papel AS (
  SELECT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS super,
         (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) AS bypass
), rls AS (
  SELECT (SELECT row_security_active(to_regclass('public.marketplace_orders'))) AS pedidos,
         (SELECT row_security_active(to_regclass('public.app_settings'))) AS ajustes,
         (SELECT row_security_active(to_regclass('public.store_shipping_credentials'))) AS frete,
         (SELECT row_security_active(to_regclass('public.order_shipping_events'))) AS eventos
), ped AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE payment_status = 'pago') AS pagos,
         count(*) FILTER (WHERE metodo_online = 'pix') AS pix,
         count(*) FILTER (WHERE metodo_online = 'credito') AS credito,
         count(*) FILTER (WHERE metodo_online = 'debito') AS debito,
         count(DISTINCT user_id) AS compradores,
         min(created_at)::date AS primeiro,
         max(created_at)::date AS ultimo
    FROM public.marketplace_orders
   WHERE canal = 'online'
), cat AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE ativo IS TRUE) AS ativos,
         count(*) FILTER (WHERE ativo IS TRUE AND COALESCE(estoque, 0) > 0) AS ativos_com_estoque
    FROM public.produtos
   WHERE deleted_at IS NULL
), mp AS (
  SELECT s.updated_at::date AS gravado,
         (CASE WHEN s.value ~ '^s*{' THEN s.value::jsonb END) AS j
    FROM public.app_settings s
   WHERE s.key = 'pagamentos_mercado_pago'
), em AS (
  SELECT s.updated_at::date AS gravado,
         (CASE WHEN s.value ~ '^s*{' THEN s.value::jsonb END) AS j
    FROM public.app_settings s
   WHERE s.key = 'email_da_loja'
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || COALESCE((SELECT super FROM papel)::text, '?')
       || '|bypassrls=' || COALESCE((SELECT bypass FROM papel)::text, '?')
       || '|rls_vale_em_pedidos=' || COALESCE((SELECT pedidos FROM rls)::text, '?')
       || '|rls_vale_em_ajustes=' || COALESCE((SELECT ajustes FROM rls)::text, '?')
       || '|rls_vale_no_frete=' || COALESCE((SELECT frete FROM rls)::text, '?')
       || '|rls_vale_nos_eventos=' || COALESCE((SELECT eventos FROM rls)::text, '?') AS detalhe
UNION ALL
SELECT 'pedidos', 'canal online',
       CASE WHEN (SELECT pedidos FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            ELSE 'total=' || (SELECT total FROM ped)::text
                 || '|pagos=' || (SELECT pagos FROM ped)::text
                 || '|pix=' || (SELECT pix FROM ped)::text
                 || '|credito=' || (SELECT credito FROM ped)::text
                 || '|debito=' || (SELECT debito FROM ped)::text
                 || '|compradores_distintos=' || (SELECT compradores FROM ped)::text
                 || '|primeiro=' || COALESCE((SELECT primeiro FROM ped)::text, 'sem_pedido')
                 || '|ultimo=' || COALESCE((SELECT ultimo FROM ped)::text, 'sem_pedido') END
UNION ALL
SELECT 'catalogo', 'produtos nao apagados',
       'total=' || (SELECT total FROM cat)::text
       || '|ativos=' || (SELECT ativos FROM cat)::text
       || '|ativos_com_estoque=' || (SELECT ativos_com_estoque FROM cat)::text
UNION ALL
SELECT 'loja', 'store_config',
       'linhas=' || (SELECT count(*) FROM public.store_config)::text
       || '|cep_de_origem_preenchido=' || COALESCE((SELECT bool_or(origin_cep IS NOT NULL AND origin_cep <> '') FROM public.store_config)::text, 'sem_linha')
       || '|provedor_de_frete=' || COALESCE((SELECT max(shipping_provider) FROM public.store_config), 'vazio')
       || '|pagamento_online=' || COALESCE((SELECT bool_or(pagamento_online) FROM public.store_config)::text, 'sem_linha')
       || '|chave_publica_mp_preenchida=' || COALESCE((SELECT bool_or(mp_public_key IS NOT NULL AND mp_public_key <> '') FROM public.store_config)::text, 'sem_linha')
UNION ALL
SELECT 'frete', 'provedores em store_shipping_credentials',
       CASE WHEN (SELECT frete FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            ELSE COALESCE((SELECT string_agg(c.provider || ':token_preenchido='
                                  || (COALESCE(c.credentials ->> 'token', '') <> '')::text
                                  || ':gravado_em=' || c.updated_at::date::text, ' ; ' ORDER BY c.provider)
                             FROM public.store_shipping_credentials c), 'nenhuma_linha') END
UNION ALL
SELECT 'mercado_pago', 'registro do lojista (app_settings)',
       CASE WHEN (SELECT ajustes FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            WHEN NOT EXISTS (SELECT 1 FROM mp) THEN 'sem_registro'
            ELSE 'registro=sim'
                 || '|token_cifrado=' || ((SELECT j FROM mp) ->> 'token_cifrado' IS NOT NULL)::text
                 || '|chave_de_notificacoes_cifrada=' || ((SELECT j FROM mp) ->> 'webhook_cifrado' IS NOT NULL)::text
                 || '|ambiente_do_ultimo_teste=' || COALESCE((SELECT j FROM mp) -> 'ultimo_teste' ->> 'ambiente', 'sem_teste')
                 || '|conectou=' || COALESCE((SELECT j FROM mp) -> 'ultimo_teste' ->> 'conectado', 'sem_teste')
                 || '|ultimo_teste_em=' || COALESCE(left((SELECT j FROM mp) -> 'ultimo_teste' ->> 'quando', 10), 'sem_teste')
                 || '|gravado_em=' || (SELECT gravado FROM mp)::text END
UNION ALL
SELECT 'email', 'registro email_da_loja (app_settings)',
       CASE WHEN (SELECT ajustes FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            WHEN NOT EXISTS (SELECT 1 FROM em) THEN 'sem_registro'
            ELSE 'registro=sim'
                 || '|senha_cifrada=' || ((SELECT j FROM em) ->> 'senha_cifrada' IS NOT NULL)::text
                 || '|gravado_em=' || (SELECT gravado FROM em)::text END
UNION ALL
SELECT 'etiquetas', 'eventos por tipo (order_shipping_events)',
       CASE WHEN (SELECT eventos FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            ELSE COALESCE((SELECT string_agg(e.event_type || '=' || e.n::text, ' ; ' ORDER BY e.event_type)
                             FROM (SELECT event_type, count(*) AS n
                                     FROM public.order_shipping_events
                                    GROUP BY event_type) e), 'nenhum_evento') END;
