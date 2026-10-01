"use strict";

/**
 * PROVA VIVA DE COMPORTAMENTO das permissões: depois do pacote do job, cada
 * PAPEL (anon, authenticated, service_role, postgres) ainda faz o que o app
 * precisa e deixou de fazer o que não devia.
 *
 * DOIS PACOTES (variável PACOTE_ACL, um job do workflow cada):
 *   seis  — PRIMÁRIO: fecha 6 funções de pagamento para anon/authenticated.
 *   amplo — SECUNDÁRIO: a convergência completa (estado da Savy).
 * Os casos de bloqueio que só o pacote AMPLO produz (produtos.custo, UPDATE
 * direto de status, check_is_admin) são ASSERTIVOS no amplo e saem como `INFO`
 * (resultado real, sem decidir o job) no pacote pequeno, onde continuam abertos.
 *
 * Cada caso roda na PRÓPRIA transação, com fixtures montadas como `postgres`
 * (cliente, outro cliente, admin conforme `is_admin()`, produto com imagem e
 * custo, pedido do cliente com item e cobrança PIX, config do cartão ligada) e
 * termina em ROLLBACK — nada vaza de um caso para o outro nem para as provas
 * seguintes. O "login" é o par que as outras provas de tests/banco já usam:
 * `SET LOCAL ROLE <papel>` + `set_config('request.jwt.claims', …, true)` (que
 * o `is_admin()` lê) + `app.rpc.user_id` (que o `auth.uid()` emulado lê).
 *
 * Cada caso imprime UMA linha:
 *     OK <grupo> <caso>
 *     FALHA <grupo> <caso>: <SQLSTATE> <mensagem>
 *     INFO <grupo> <caso>: <resultado real>      (não decide o job)
 * e o processo sai ≠ 0 se houver qualquer FALHA.
 *
 * GRUPOS (um passo do workflow por grupo):
 *   CHECKOUT_CARTAO · PIX_ONLINE · MEUS_PEDIDOS_FOTOS · PAINEL ·
 *   WEBHOOK_RECONCILIACAO · GRANTS_POR_PAPEL · CONTROLE
 *
 * CONTROLE roda no template `acl_antes` (o estado de produção, ANTES do
 * pacote): lá o que o pacote fecha tem de estar ABERTO (as 6 executam sem
 * 42501; no amplo também custo legível e UPDATE de status aceito) — prova que
 * o teste distingue os dois estados. Só `confirmar_pagamento` já nasce fechada
 * ali (emergência de 01/10).
 *
 * USO: PACOTE_ACL=seis|amplo node tests/banco/convergencia-acl/convergencia-acl-viva.cjs [GRUPO]
 *      (sem grupo: todos)
 */

const {
  BANCO_ANTES,
  DUAS_FECHADAS,
  Falha,
  PUBLICAS_EXPLICITAS,
  SEIS,
  SETE_PRIVILEGIOS,
  ausenciasDoServidor,
  conectar,
  criarRelator,
  diferencas,
  exigirAusenciasIguais,
  falhar,
  fotografar,
  lerFotografia,
  lerPrincipalAcl,
  lerSavyAcl,
  lerSavyTabPriv,
  medirFuncoes,
  medirRelacoes,
  mudancasAlemDasFechadas,
  mudancasForaDeAnonEAuth,
  pacoteDoJob,
  resumir,
} = require("./comum.cjs");

// ---- Identidades e fixtures -------------------------------------------------

const U_CLIENTE = "a0c10000-0000-4000-8000-000000000001";
const U_OUTRO = "a0c10000-0000-4000-8000-000000000002";
const U_ADMIN = "a0c10000-0000-4000-8000-000000000003";
const P_ID = "a0c10000-0000-4000-8000-0000000000a1";
const O_PIX = "a0c10000-0000-4000-8000-0000000000b1"; // aguardando, PIX GW-ACL-1
const O_PAGO = "a0c10000-0000-4000-8000-0000000000b2"; // pago, p/ estorno
const REFUND = "a0c10000-0000-4000-8000-0000000000c1";
const GW_PIX = "GW-ACL-1";
const IMAGEM = "https://acl.teste/produto.png";
const IMAGENS = ["https://acl.teste/p1.png", "https://acl.teste/p2.png"];
const VALORES = { O_PIX, GW_PIX, REFUND };

async function montar(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'cliente@acl.teste', '{}'::jsonb),
       ($2, 'outro@acl.teste', '{}'::jsonb),
       ($3, 'admin@acl.teste', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE, U_OUTRO, U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.produtos
       (id, nome, preco_venda, custo, estoque, estoque_minimo, ativo, categoria,
        imagem_url, imagem_urls)
     VALUES ($1, 'Produto ACL', 50.00, 12.34, 10, 1, true, 'Prova', $2, $3::text[])`,
    [P_ID, IMAGEM, IMAGENS],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, gateway_payment_id, metodo_online)
     VALUES
       ($1, $3, 'Cliente ACL', '{}'::jsonb, 50, 50, 'pending', 'online',
        'online', 'aguardando', now() + interval '30 minutes', $4, 'pix'),
       ($2, $3, 'Cliente ACL', '{}'::jsonb, 50, 50, 'processing', 'online',
        'online', 'pago', now() + interval '30 minutes', 'GW-ACL-2', 'pix')`,
    [O_PIX, O_PAGO, U_CLIENTE, GW_PIX],
  );
  await c.query(
    "UPDATE public.marketplace_orders SET paid_at = now() WHERE id = $1",
    [O_PAGO],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items
       (id, order_id, product_id, product_name, quantity, price)
     VALUES (gen_random_uuid(), $1, $3, 'Produto ACL', 1, 50),
            (gen_random_uuid(), $2, $3, 'Produto ACL', 1, 50)`,
    [O_PIX, O_PAGO, P_ID],
  );
  await c.query(
    `INSERT INTO public.order_refunds (id, order_id, amount, solicitado_por, status)
     VALUES ($1, $2, 10, 'lojista', 'em_processamento')`,
    [REFUND, O_PAGO],
  );
  await c.query(
    `INSERT INTO public.config_pagamento_cartao (id, credito, debito, parcelas_max)
     VALUES (1, true, true, 6)
     ON CONFLICT (id) DO UPDATE
       SET credito = true, debito = true, parcelas_max = 6`,
  );
  // Loja fixture do checkout (mesma receita de invariantes-dinheiro.cjs):
  // frete grátis e cobertura nacional, para o pedido não morrer em regra de CEP.
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national')
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage`,
  );
}

// ---- Papéis -----------------------------------------------------------------

const PAPEIS = ["anon", "authenticated", "service_role"];

/** Entra no papel DENTRO da transação (SET LOCAL) com o "login" das provas. */
async function como(c, papel, { uid = "", admin = false } = {}) {
  if (!PAPEIS.includes(papel)) throw new Error(`papel inválido: ${papel}`);
  const claims = { role: papel };
  if (uid) claims.sub = uid;
  if (admin) claims.app_metadata = { role: "admin" };
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, JSON.stringify(claims)],
  );
  await c.query(`SET LOCAL ROLE ${papel}`);
}

async function comoPostgres(c) {
  await c.query("RESET ROLE");
}

const CLIENTE = { uid: U_CLIENTE };
const ADMIN = { uid: U_ADMIN, admin: true };

// ---- Chamadas que não derrubam a transação ---------------------------------

async function tenta(c, sql, params = []) {
  await c.query("SAVEPOINT acl_s");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT acl_s");
    return { ok: true, r };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT acl_s");
    await c.query("RELEASE SAVEPOINT acl_s");
    return { ok: false, code: erro.code, message: erro.message };
  }
}

/** A chamada TEM de ser recusada por falta de privilégio (42501, "permission denied"). */
async function recusada(c, sql, params = []) {
  const t = await tenta(c, sql, params);
  if (t.ok) throw new Falha("esperava 42501 e a chamada PASSOU");
  if (t.code !== "42501" || !/permission denied/i.test(t.message)) {
    throw new Falha(
      `esperava 42501 permission denied e veio ${t.code} ${t.message}`,
    );
  }
  return `42501 ${t.message}`;
}

/** A chamada pode dar certo OU esbarrar em regra de negócio; só NÃO pode ser 42501. */
async function executavel(c, sql, params = []) {
  const t = await tenta(c, sql, params);
  if (t.ok) return { sucesso: true, texto: "sucesso", r: t.r };
  if (t.code === "42501") {
    throw new Falha(`recusada por privilégio: ${t.message}`);
  }
  const msg = String(t.message).slice(0, 90);
  return {
    sucesso: false,
    texto: `erro de regra de negócio (${t.code}: ${msg})`,
  };
}

/** Exige sucesso real (nem 42501 nem erro de regra). */
async function funciona(c, sql, params = []) {
  const t = await tenta(c, sql, params);
  if (!t.ok) throw new Falha(`falhou: ${t.code} ${t.message}`);
  return t.r;
}

function igual(obtido, esperado, rotulo) {
  if (String(obtido) !== String(esperado)) {
    throw new Falha(`${rotulo}: obtido '${obtido}', esperado '${esperado}'`);
  }
}

/**
 * Bloqueio que só o pacote AMPLO produz. No amplo é assertivo (tem de ser
 * 42501); no pequeno é só observação: devolve { info } com o resultado real.
 */
async function bloqueioDoAmplo(c, pacote, sql, params = []) {
  if (pacote.id === "amplo") return recusada(c, sql, params);
  const t = await tenta(c, sql, params);
  const real = t.ok
    ? `PASSOU — continua aberto neste pacote (${t.r.rowCount} linha(s))`
    : `recusado: ${t.code} ${String(t.message).slice(0, 80)}`;
  return {
    info: `[bloqueio do pacote AMPLO] resultado real no pacote pequeno: ${real}`,
  };
}

const valoresDe = (nomes) => nomes.map((n) => VALORES[n]);

// ---- Os grupos --------------------------------------------------------------

const ARGS_V24 = [
  JSON.stringify([{ product_id: P_ID, variant_id: null, quantity: 1 }]),
  50,
  0,
  "pix",
  null,
  null,
  "Cliente ACL",
  "5539000000000",
  null,
  JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
  "38500-000",
  "local-delivery",
  null,
];
const SQL_V24 = `SELECT public.create_marketplace_order_v24(
    $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
    $6::text, $7::text, $8::text, $9::text, $10::jsonb,
    $11::text, $12::text, $13::uuid) AS id`;

const SQL_CONFIG_CARTAO =
  "SELECT credito, debito, parcelas_max FROM public.config_pagamento_cartao WHERE id = 1";

async function leConfigDoCartao(c, papel, quem) {
  await como(c, papel, quem);
  const r = await funciona(c, SQL_CONFIG_CARTAO);
  if (r.rowCount !== 1)
    throw new Falha(`${r.rowCount} linha(s) em config_pagamento_cartao`);
  const l = r.rows[0];
  if (l.credito !== true || l.debito !== true || l.parcelas_max !== 6) {
    throw new Falha(`config lida errada: ${JSON.stringify(l)}`);
  }
  return `credito=${l.credito} debito=${l.debito} parcelas_max=${l.parcelas_max}`;
}

async function checkoutExecuta(c, papel, quem) {
  await como(c, papel, quem);
  const t = await executavel(c, SQL_V24, ARGS_V24);
  return t.sucesso ? `sucesso (pedido ${t.r.rows[0].id})` : t.texto;
}

/** Cada uma das 6 chamada por anon e por authenticated; `exigir` decide o veredito. */
async function seisParaOsDoisPapeis(c, item, exigir) {
  const params = valoresDe(item.params);
  const saidas = [];
  for (const [papel, quem] of [
    ["anon", {}],
    ["authenticated", CLIENTE],
  ]) {
    await como(c, papel, quem);
    saidas.push(`${papel}: ${await exigir(c, item.sql, params)}`);
    await comoPostgres(c);
  }
  return saidas.join(" | ");
}

async function contagem(c, coluna, esperado) {
  const n = (await medirFuncoes(c)).filter((l) => l[coluna]).length;
  if (n !== esperado) throw new Falha(`${n} funções (esperado ${esperado})`);
  return String(n);
}

async function grantsDosGrantees(c, nomesProc) {
  const r = await c.query(
    `SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
            CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
    [nomesProc],
  );
  const porFn = new Map();
  for (const l of r.rows) {
    if (!porFn.has(l.fn)) porFn.set(l.fn, new Set());
    porFn.get(l.fn).add(l.grantee);
  }
  return porFn;
}

function construirGrupos(pacote) {
  const amplo = pacote.id === "amplo";
  const sigsSeis = SEIS.map((s) => s.sig);

  return {
    CHECKOUT_CARTAO: {
      banco: "base",
      casos: [
        ["anon_le_config_do_cartao", (c) => leConfigDoCartao(c, "anon", {})],
        [
          "authenticated_le_config_do_cartao",
          (c) => leConfigDoCartao(c, "authenticated", CLIENTE),
        ],
        [
          "anon_nao_le_custo_do_produto",
          async (c) => {
            await como(c, "anon");
            return bloqueioDoAmplo(
              c,
              pacote,
              "SELECT custo FROM public.produtos WHERE id = $1",
              [P_ID],
            );
          },
        ],
        [
          "authenticated_nao_le_custo_do_produto",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return bloqueioDoAmplo(
              c,
              pacote,
              "SELECT custo FROM public.produtos WHERE id = $1",
              [P_ID],
            );
          },
        ],
        [
          "anon_executa_create_marketplace_order_v24",
          (c) => checkoutExecuta(c, "anon", {}),
        ],
        [
          "authenticated_executa_create_marketplace_order_v24",
          (c) => checkoutExecuta(c, "authenticated", CLIENTE),
        ],
        [
          "anon_executa_validate_coupon_secure_v2",
          async (c) => {
            await como(c, "anon");
            return (
              await executavel(
                c,
                "SELECT public.validate_coupon_secure_v2('ACL10', 50)",
              )
            ).texto;
          },
        ],
        [
          "authenticated_executa_validate_coupon_secure_v2",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return (
              await executavel(
                c,
                "SELECT public.validate_coupon_secure_v2('ACL10', 50)",
              )
            ).texto;
          },
        ],
        [
          "anon_executa_forma_de_pagamento_aceita",
          async (c) => {
            await como(c, "anon");
            return (
              await executavel(
                c,
                "SELECT public.forma_de_pagamento_aceita('pix')",
              )
            ).texto;
          },
        ],
        [
          "authenticated_executa_forma_de_pagamento_aceita",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return (
              await executavel(
                c,
                "SELECT public.forma_de_pagamento_aceita('pix')",
              )
            ).texto;
          },
        ],
      ],
    },

    PIX_ONLINE: {
      banco: "base",
      casos: [
        [
          "cliente_le_total_metodo_online_e_gateway_do_proprio_pedido",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            const r = await funciona(
              c,
              "SELECT total, metodo_online, gateway_payment_id FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(`${r.rowCount} linha(s), esperava 1`);
            igual(r.rows[0].total, "50.00", "total");
            igual(r.rows[0].metodo_online, "pix", "metodo_online");
            igual(r.rows[0].gateway_payment_id, GW_PIX, "gateway_payment_id");
            return "total, metodo_online, gateway_payment_id";
          },
        ],
        [
          "cliente_le_payment_status_e_expires_at",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            const r = await funciona(
              c,
              "SELECT payment_status, expires_at FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(`${r.rowCount} linha(s), esperava 1`);
            igual(r.rows[0].payment_status, "aguardando", "payment_status");
            if (!r.rows[0].expires_at) throw new Falha("expires_at veio vazio");
            return "payment_status, expires_at";
          },
        ],
        [
          "cliente_le_status",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            const r = await funciona(
              c,
              "SELECT status FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(`${r.rowCount} linha(s), esperava 1`);
            igual(r.rows[0].status, "pending", "status");
            return "status";
          },
        ],
        [
          "outro_cliente_nao_ve_o_pedido",
          async (c) => {
            await como(c, "authenticated", { uid: U_OUTRO });
            const r = await funciona(
              c,
              "SELECT id FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 0)
              throw new Falha(`outro cliente enxergou ${r.rowCount} linha(s)`);
            return "0 linhas (RLS intacta)";
          },
        ],
        [
          "service_role_confirma_pagamento_e_o_pedido_fica_pago",
          async (c) => {
            await como(c, "service_role");
            const r = await funciona(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text) AS r",
              [O_PIX, GW_PIX, "pago"],
            );
            igual(r.rows[0].r, "pago", "retorno de confirmar_pagamento");
            await comoPostgres(c);
            const o = await funciona(
              c,
              "SELECT payment_status, paid_at FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            igual(o.rows[0].payment_status, "pago", "payment_status depois");
            if (!o.rows[0].paid_at)
              throw new Falha("paid_at não foi carimbado");
            return "retorno 'pago', payment_status=pago, paid_at carimbado";
          },
        ],
        [
          "anon_nao_executa_confirmar_pagamento",
          async (c) => {
            await como(c, "anon");
            return recusada(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text)",
              [O_PIX, GW_PIX, "pago"],
            );
          },
        ],
        [
          "authenticated_nao_executa_confirmar_pagamento",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            const d = await recusada(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text)",
              [O_PIX, GW_PIX, "pago"],
            );
            await comoPostgres(c);
            const o = await funciona(
              c,
              "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            igual(
              o.rows[0].payment_status,
              "aguardando",
              "pedido não pode ter mudado",
            );
            return d;
          },
        ],
        [
          // O cancelamento do cliente chama devolver_estoque POR DENTRO (função
          // fechada pelo pacote): só funciona se a RPC roda como o dono.
          "cliente_cancela_o_proprio_pedido_pela_rpc_e_o_estoque_volta",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            await funciona(
              c,
              "SELECT public.update_order_status_atomic($1::uuid, 'cancelled'::text)",
              [O_PIX],
            );
            await comoPostgres(c);
            const o = await funciona(
              c,
              "SELECT status FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            igual(
              o.rows[0].status,
              "cancelled",
              "status depois do cancelamento",
            );
            const p = await funciona(
              c,
              "SELECT estoque FROM public.produtos WHERE id = $1",
              [P_ID],
            );
            return `status=cancelled, estoque do produto=${p.rows[0].estoque}`;
          },
        ],
      ],
    },

    MEUS_PEDIDOS_FOTOS: {
      banco: "base",
      casos: [
        [
          "cliente_ve_a_foto_do_produto_nos_itens_do_pedido",
          async (c) => {
            // Equivalente SQL do embed de fetchUserOrders (useOrders.ts):
            //   marketplace_orders(*, items:marketplace_order_items(*,
            //     product:produtos(imagem_url, imagem_urls)), address:user_addresses(*))
            await como(c, "authenticated", CLIENTE);
            const r = await funciona(
              c,
              `SELECT o.*, to_jsonb(i.*) AS item, p.imagem_url AS foto, p.imagem_urls AS fotos,
                      to_jsonb(a.*) AS address
                 FROM public.marketplace_orders o
                 LEFT JOIN public.marketplace_order_items i ON i.order_id = o.id
                 LEFT JOIN public.produtos p ON p.id = i.product_id
                 LEFT JOIN public.user_addresses a ON a.id = o.address_id
                WHERE o.user_id = $1 AND o.id = $2`,
              [U_CLIENTE, O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(
                `${r.rowCount} linha(s) (1 pedido × 1 item), esperava 1`,
              );
            igual(r.rows[0].foto, IMAGEM, "imagem_url do produto");
            igual(
              JSON.stringify(r.rows[0].fotos),
              JSON.stringify(IMAGENS),
              "imagem_urls do produto",
            );
            return "pedido → itens → produtos(imagem_url, imagem_urls)";
          },
        ],
        [
          "anon_le_vw_produtos_public",
          async (c) => {
            await como(c, "anon");
            const r = await funciona(
              c,
              "SELECT id, nome, imagem_url, imagem_urls FROM public.vw_produtos_public WHERE id = $1",
              [P_ID],
            );
            if (r.rowCount !== 1)
              throw new Falha(`${r.rowCount} linha(s), esperava 1`);
            igual(r.rows[0].imagem_url, IMAGEM, "imagem_url na vitrine");
            return "vitrine devolve a foto";
          },
        ],
      ],
    },

    PAINEL: {
      banco: "base",
      casos: [
        [
          "admin_atualiza_tracking_code_do_pedido",
          async (c) => {
            await como(c, "authenticated", ADMIN);
            const r = await funciona(
              c,
              "UPDATE public.marketplace_orders SET tracking_code = 'BR-ACL-123' WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(`atualizou ${r.rowCount} linha(s), esperava 1`);
            return "tracking_code";
          },
        ],
        [
          "admin_atualiza_notes_do_pedido",
          async (c) => {
            await como(c, "authenticated", ADMIN);
            const r = await funciona(
              c,
              "UPDATE public.marketplace_orders SET notes = 'nota do painel' WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 1)
              throw new Falha(`atualizou ${r.rowCount} linha(s), esperava 1`);
            return "notes";
          },
        ],
        [
          "admin_nao_atualiza_status_direto",
          async (c) => {
            await como(c, "authenticated", ADMIN);
            const d = await bloqueioDoAmplo(
              c,
              pacote,
              "UPDATE public.marketplace_orders SET status = 'processing' WHERE id = $1",
              [O_PIX],
            );
            if (amplo) {
              await comoPostgres(c);
              const o = await funciona(
                c,
                "SELECT status FROM public.marketplace_orders WHERE id = $1",
                [O_PIX],
              );
              igual(o.rows[0].status, "pending", "status não pode ter mudado");
            }
            return d;
          },
        ],
        [
          "admin_muda_o_status_pela_rpc_update_order_status_atomic",
          async (c) => {
            await como(c, "authenticated", ADMIN);
            await funciona(
              c,
              "SELECT public.update_order_status_atomic($1::uuid, 'processing'::text)",
              [O_PIX],
            );
            await comoPostgres(c);
            const o = await funciona(
              c,
              "SELECT status FROM public.marketplace_orders WHERE id = $1",
              [O_PIX],
            );
            igual(o.rows[0].status, "processing", "status depois da RPC");
            return "status=processing pela RPC (o caminho legítimo do painel)";
          },
        ],
        [
          "admin_atualiza_produto_ativo",
          async (c) => {
            await como(c, "authenticated", ADMIN);
            const r = await funciona(
              c,
              "UPDATE public.produtos SET ativo = false WHERE id = $1",
              [P_ID],
            );
            if (r.rowCount !== 1)
              throw new Falha(`atualizou ${r.rowCount} linha(s), esperava 1`);
            return "produtos.ativo";
          },
        ],
        [
          "cliente_comum_nao_altera_o_rastreio",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            const r = await funciona(
              c,
              "UPDATE public.marketplace_orders SET tracking_code = 'HACK' WHERE id = $1",
              [O_PIX],
            );
            if (r.rowCount !== 0)
              throw new Falha(`cliente comum alterou ${r.rowCount} linha(s)`);
            return "0 linhas (RLS de UPDATE só para admin)";
          },
        ],
        // O painel chama RPCs que por dentro usam ajudantes (fin__*, crm__*) que o
        // pacote amplo fecha: tem de seguir funcionando para o admin.
        ...[
          [
            "admin_abre_o_inicio_painel_inicio",
            "SELECT public.painel_inicio() AS r",
            [],
          ],
          [
            "admin_le_o_financeiro_fin_resumo",
            "SELECT public.fin_resumo(current_date - 29, current_date) AS r",
            [],
          ],
          [
            "admin_le_o_crm_crm_visao",
            "SELECT public.crm_visao(current_date - 29, current_date) AS r",
            [],
          ],
        ].map(([nome, sql, params]) => [
          nome,
          async (c) => {
            await como(c, "authenticated", ADMIN);
            await funciona(c, sql, params);
            return "sucesso";
          },
        ]),
      ],
    },

    WEBHOOK_RECONCILIACAO: {
      banco: "base",
      casos: [
        // service_role executa as 6 (mais confirmar_pagamento e devolver_uso_cupom).
        ...SEIS.map((item) => [
          `service_role_executa_${item.sig.split("(")[0]}`,
          async (c) => {
            await como(c, "service_role");
            const t = await executavel(c, item.sql, valoresDe(item.params));
            return t.sucesso
              ? `sucesso (${JSON.stringify(t.r.rows[0].r)})`
              : t.texto;
          },
        ]),
        [
          "service_role_executa_confirmar_pagamento",
          async (c) => {
            await como(c, "service_role");
            const r = await funciona(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text) AS r",
              [O_PIX, GW_PIX, "pago"],
            );
            igual(r.rows[0].r, "pago", "retorno");
            return "pago";
          },
        ],
        [
          "service_role_concluir_estorno_conclui_de_verdade",
          async (c) => {
            await como(c, "service_role");
            const r = await funciona(
              c,
              "SELECT public.concluir_estorno($1::uuid, 'mp-acl-1', 'approved', 'accredited') AS r",
              [REFUND],
            );
            if (r.rows[0].r.concluido !== true)
              throw new Falha(
                `estorno não concluído: ${JSON.stringify(r.rows[0].r)}`,
              );
            return JSON.stringify(r.rows[0].r);
          },
        ],
        [
          "service_role_liberar_cobranca_solta_a_vaga",
          async (c) => {
            await como(c, "service_role");
            const r = await funciona(
              c,
              "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS r",
              [O_PIX, GW_PIX],
            );
            igual(r.rows[0].r, true, "liberou a vaga");
            return "vaga liberada";
          },
        ],
        [
          "service_role_executa_devolver_uso_cupom",
          async (c) => {
            await como(c, "service_role");
            const r = await funciona(
              c,
              "SELECT public.devolver_uso_cupom($1::uuid) AS r",
              [O_PIX],
            );
            return `retorno ${r.rows[0].r}`;
          },
        ],
        // postgres (o pg_cron roda como postgres; só expirar_pedidos_vencidos e
        // devolver_cupons_de_pedidos_mortos são agendadas, mas as 6 valem).
        ...SEIS.map((item) => [
          `postgres_executa_${item.sig.split("(")[0]}`,
          async (c) => {
            const r = await funciona(c, item.sql, valoresDe(item.params));
            return `sucesso (${JSON.stringify(r.rows[0].r)})`;
          },
        ]),
        // anon e authenticated recebem 42501 nas 6.
        ...SEIS.map((item) => [
          `${item.sig.split("(")[0]}_fechada_para_anon_e_authenticated`,
          (c) => seisParaOsDoisPapeis(c, item, recusada),
        ]),
        [
          "anon_nao_executa_devolver_uso_cupom",
          async (c) => {
            await como(c, "anon");
            return recusada(c, "SELECT public.devolver_uso_cupom($1::uuid)", [
              O_PIX,
            ]);
          },
        ],
        [
          "authenticated_nao_executa_devolver_uso_cupom",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return recusada(c, "SELECT public.devolver_uso_cupom($1::uuid)", [
              O_PIX,
            ]);
          },
        ],
      ],
    },

    GRANTS_POR_PAPEL: {
      banco: "base",
      semFixtures: true,
      casos: [
        [
          `anon_executa_${pacote.anon}_funcoes`,
          (c) => contagem(c, "anon", pacote.anon),
        ],
        [
          `authenticated_executa_${pacote.auth}_funcoes`,
          (c) => contagem(c, "auth", pacote.auth),
        ],
        // O servidor NÃO "executa tudo" (a Savy tem ausências intencionais): o
        // pacote tem de deixar o conjunto de ausências EXATAMENTE como achou.
        [
          "ausencias_do_servidor_iguais_as_do_antes",
          async (c) => {
            const antes = lerFotografia("ausencias-servidor-antes");
            const depois = await ausenciasDoServidor(c);
            exigirAusenciasIguais(antes, depois, "depois do pacote × antes");
            return `${depois.length} ausência(s), lista idêntica à de antes (impressa no log)`;
          },
        ],
        [
          "servidor_executa_as_8_funcoes_de_dinheiro",
          async (c) => {
            const oito = new Set([...sigsSeis, ...DUAS_FECHADAS]);
            const banco = (await medirFuncoes(c)).filter((l) => oito.has(l.fn));
            const sem = banco.filter((l) => !l.sr).map((l) => l.fn);
            if (banco.length !== 8 || sem.length) {
              throw new Falha(
                `servidor sem EXECUTE em ${sem.length} das 8 (achei ${banco.length})`,
                sem,
              );
            }
            return "8 de 8";
          },
        ],
        [
          "as_6_fechadas_para_anon_e_authenticated_e_abertas_para_service_role",
          async (c) => {
            const banco = new Map(
              (await medirFuncoes(c)).map((l) => [l.fn, l]),
            );
            const ruins = [];
            for (const sig of sigsSeis) {
              const l = banco.get(sig);
              if (!l) ruins.push(`${sig}: não existe`);
              else if (l.anon || l.auth || !l.sr)
                ruins.push(
                  `${sig}: anon=${l.anon} authenticated=${l.auth} service_role=${l.sr}`,
                );
            }
            if (ruins.length)
              throw new Falha(`${ruins.length} das 6 fora do esperado`, ruins);
            return "6 de 6";
          },
        ],
        [
          "as_2_de_emergencia_seguem_so_postgres_e_service_role",
          async (c) => {
            const porFn = await grantsDosGrantees(c, [
              "confirmar_pagamento",
              "devolver_uso_cupom",
            ]);
            if (porFn.size !== 2)
              throw new Falha(`achei ${porFn.size} das 2 funções`);
            const ruins = [...porFn]
              .map(([fn, g]) => [fn, [...g].sort().join(",")])
              .filter(([, g]) => g !== "postgres,service_role")
              .map(([fn, g]) => `${fn}: ${g}`);
            if (ruins.length)
              throw new Falha("função com grantee a mais ou a menos", ruins);
            return DUAS_FECHADAS.join(" e ");
          },
        ],
        [
          "funcoes_iguais_ao_esperado_zero_diferencas",
          async (c) => {
            const banco = new Map(
              (await medirFuncoes(c)).map((l) => [l.fn, l]),
            );
            // amplo: o que a Savy mede. seis: produção (principal-acl.txt) menos as 6.
            const esperado = amplo
              ? lerSavyAcl().map((l) => ({
                  fn: l.fn,
                  anon: l.anon,
                  auth: l.auth,
                }))
              : lerPrincipalAcl().map((l) => {
                  const aberta = l.marca === "AU" && !sigsSeis.includes(l.fn);
                  return { fn: l.fn, anon: aberta, auth: aberta };
                });
            const dif = [];
            for (const e of esperado) {
              const real = banco.get(e.fn);
              if (!real) {
                dif.push(`${e.fn}: não existe no banco`);
                continue;
              }
              if (real.anon !== e.anon)
                dif.push(
                  `${e.fn} / anon: esperado ${e.anon}, obtido ${real.anon}`,
                );
              if (real.auth !== e.auth)
                dif.push(
                  `${e.fn} / authenticated: esperado ${e.auth}, obtido ${real.auth}`,
                );
            }
            const nomes = new Set(esperado.map((e) => e.fn));
            for (const nome of banco.keys()) {
              if (!nomes.has(nome))
                dif.push(`${nome}: existe no banco e não no esperado`);
            }
            if (dif.length)
              throw new Falha(
                `${dif.length} diferença(s) função a função`,
                dif,
              );
            return `${esperado.length} funções × anon e authenticated, zero diferenças`;
          },
        ],
        [
          "relacoes_iguais_ao_esperado_zero_diferencas",
          async (c) => {
            const savy = lerSavyTabPriv();
            const todos = SETE_PRIVILEGIOS.join("");
            const banco = new Map();
            for (const l of await medirRelacoes(c)) {
              if (!banco.has(l.relname)) banco.set(l.relname, {});
              banco.get(l.relname)[l.papel] = l.privs;
            }
            const dif = [];
            for (const [rel, papeis] of savy) {
              for (const papel of ["anon", "authenticated"]) {
                // amplo: o que a Savy mede. seis: produção = os 7 em tudo.
                const esperado = amplo ? (papeis[papel] ?? "") : todos;
                const real = banco.get(rel)?.[papel];
                if (real === undefined)
                  dif.push(`${rel} / ${papel}: relação não existe no banco`);
                else if (real !== esperado)
                  dif.push(
                    `${rel} / ${papel}: esperado '${esperado}', obtido '${real}'`,
                  );
              }
            }
            for (const rel of banco.keys()) {
              if (!savy.has(rel))
                dif.push(`${rel}: existe no banco e não na lista de 55`);
            }
            if (dif.length)
              throw new Falha(
                `${dif.length} diferença(s) tabela a tabela`,
                dif,
              );
            return `${savy.size} relações × anon e authenticated × 7 privilégios, zero diferenças`;
          },
        ],
        [
          "fotografia_depois_x_antes_so_o_esperado_mudou",
          async (c) => {
            const antes = lerFotografia("antes");
            const depois = await fotografar(c);
            const ruins = mudancasForaDeAnonEAuth(antes, depois);
            if (!amplo)
              ruins.push(...mudancasAlemDasFechadas(antes, depois, sigsSeis));
            if (ruins.length) {
              throw new Falha(
                `${ruins.length} mudança(s) fora do que o pacote declara`,
                ruins,
              );
            }
            const { soNoA, soNoB } = diferencas(antes, depois);
            if (soNoA.length + soNoB.length === 0)
              throw new Falha("o pacote não mudou NADA na fotografia");
            return amplo
              ? `${soNoA.length + soNoB.length} linhas mudaram, todas de anon/authenticated (service_role, PUBLIC e dono intocados)`
              : `exatamente as 6 funções mudaram (${soNoA.length} linhas saíram, ${soNoB.length} entraram)`;
          },
        ],
        [
          "as_16_funcoes_com_PUBLIC_seguem_com_PUBLIC",
          async (c) => {
            const achadas = (await medirFuncoes(c))
              .filter((l) => l.public_explicito)
              .map((l) => l.fn);
            const { soNoA, soNoB } = diferencas(PUBLICAS_EXPLICITAS, achadas);
            if (soNoA.length || soNoB.length) {
              throw new Falha(
                `PUBLIC explícito: ${achadas.length} (esperado 16, o pacote não mexe nelas)`,
                [
                  ...soNoA.map((n) => `perdeu o PUBLIC: ${n}`),
                  ...soNoB.map((n) => `ganhou PUBLIC: ${n}`),
                ],
              );
            }
            return "16";
          },
        ],
        [
          "37_colunas_com_grant_proprio_intactas",
          async (c) => {
            const r = await c.query(`
              SELECT count(DISTINCT (c.relname, a.attname))::int AS n
                FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
                 AND a.attacl IS NOT NULL`);
            if (r.rows[0].n !== 37)
              throw new Falha(`${r.rows[0].n} colunas (esperado 37)`);
            return "37";
          },
        ],
        [
          "dono_de_todas_as_funcoes_segue_postgres",
          async (c) => {
            const outros = (await medirFuncoes(c))
              .filter((l) => l.dono !== "postgres")
              .map((l) => `${l.fn} (${l.dono})`);
            if (outros.length)
              throw new Falha(
                `${outros.length} função(ões) com outro dono`,
                outros,
              );
            return "160 de 160";
          },
        ],
        [
          "authenticated_nao_executa_check_is_admin",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return bloqueioDoAmplo(c, pacote, "SELECT public.check_is_admin()");
          },
        ],
      ],
    },

    CONTROLE: {
      banco: "antes",
      casos: [
        // No estado de antes, as 6 estão ABERTAS: o mesmo teste que as vê fechadas
        // depois passa aqui sem 42501 — prova que ele distingue os dois estados.
        ...SEIS.map((item) => [
          `${item.sig.split("(")[0]}_ABERTA_no_estado_de_antes`,
          (c) =>
            seisParaOsDoisPapeis(
              c,
              item,
              async (cc, sql, params) =>
                (await executavel(cc, sql, params)).texto,
            ),
        ]),
        [
          "confirmar_pagamento_JA_fechada_no_antes_para_authenticated",
          async (c) => {
            await como(c, "authenticated", CLIENTE);
            return recusada(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text)",
              [O_PIX, GW_PIX, "pago"],
            );
          },
        ],
        [
          "confirmar_pagamento_JA_fechada_no_antes_para_anon",
          async (c) => {
            await como(c, "anon");
            return recusada(
              c,
              "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text)",
              [O_PIX, GW_PIX, "pago"],
            );
          },
        ],
        // Casos de bloqueio do pacote AMPLO, medidos no estado de antes: lá passam.
        ...(amplo
          ? [
              [
                "anon_LE_o_custo_no_estado_de_antes",
                async (c) => {
                  await como(c, "anon");
                  const r = await funciona(
                    c,
                    "SELECT custo FROM public.produtos WHERE id = $1",
                    [P_ID],
                  );
                  igual(r.rows[0].custo, "12.34", "custo lido");
                  return "lido (sem 42501) — o teste de bloqueio distingue os estados";
                },
              ],
              [
                "authenticated_LE_o_custo_no_estado_de_antes",
                async (c) => {
                  await como(c, "authenticated", CLIENTE);
                  const r = await funciona(
                    c,
                    "SELECT custo FROM public.produtos WHERE id = $1",
                    [P_ID],
                  );
                  igual(r.rows[0].custo, "12.34", "custo lido");
                  return "lido (sem 42501)";
                },
              ],
              [
                "admin_ATUALIZA_status_direto_no_estado_de_antes",
                async (c) => {
                  await como(c, "authenticated", ADMIN);
                  const t = await tenta(
                    c,
                    "UPDATE public.marketplace_orders SET status = 'processing' WHERE id = $1",
                    [O_PIX],
                  );
                  if (!t.ok && t.code === "42501") {
                    throw new Falha(
                      `o UPDATE de status JÁ era recusado no estado de antes: ${t.message}`,
                    );
                  }
                  return t.ok
                    ? `aceito (${t.r.rowCount} linha) — sem 42501`
                    : `sem 42501 (regra de negócio ${t.code}: ${String(t.message).slice(0, 80)})`;
                },
              ],
              [
                "authenticated_executa_check_is_admin_no_estado_de_antes",
                async (c) => {
                  await como(c, "authenticated", CLIENTE);
                  const t = await executavel(
                    c,
                    "SELECT public.check_is_admin()",
                  );
                  return `${t.texto} — sem 42501`;
                },
              ],
            ]
          : [
              // No pacote pequeno estes três continuam abertos DEPOIS também;
              // aqui só se registra o que o estado de antes responde.
              [
                "custo_no_estado_de_antes",
                async (c) => {
                  await como(c, "authenticated", CLIENTE);
                  const t = await tenta(
                    c,
                    "SELECT custo FROM public.produtos WHERE id = $1",
                    [P_ID],
                  );
                  return {
                    info: `authenticated lê custo no estado de antes: ${t.ok ? "SIM (aberto)" : `não (${t.code})`}`,
                  };
                },
              ],
            ]),
      ],
    },
  };
}

// ---- Execução ---------------------------------------------------------------

async function rodarGrupo(nomeGrupo, grupo, clientes, relator) {
  const c = clientes[grupo.banco];
  for (const [nome, corpo] of grupo.casos) {
    await c.query("BEGIN");
    try {
      if (!grupo.semFixtures) await montar(c);
      const saida = await corpo(c);
      if (saida && typeof saida === "object" && "info" in saida) {
        relator.info(nomeGrupo, nome, saida.info);
      } else {
        relator.ok(nomeGrupo, nome, saida);
      }
    } catch (erro) {
      relator.falha(nomeGrupo, nome, erro);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  }
}

/** Aviso (não falha): MAINTAIN do PG 17 que os REVOKE do pacote amplo não cobrem. */
async function avisarMaintainResidual(c, relator) {
  const savy = lerSavyTabPriv();
  const todos = SETE_PRIVILEGIOS.join("");
  const r = await c.query(`
    SELECT c.relname, pg_get_userbyid(x.grantee) AS papel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
       AND x.privilege_type = 'MAINTAIN'
       AND pg_get_userbyid(x.grantee) IN ('anon', 'authenticated')
     ORDER BY 1, 2`);
  const residuais = r.rows
    .filter((l) => (savy.get(l.relname)?.[l.papel] ?? "") !== todos)
    .map((l) => `${l.relname} / ${l.papel}`);
  if (residuais.length) {
    relator.aviso(
      "GRANTS_POR_PAPEL",
      "MAINTAIN_residual",
      `${residuais.length} combinação(ões) relação×papel ficaram com MAINTAIN (PG 17) mesmo fora dos 7 privilégios da Savy — o pacote só revoga os 7 por nome (informativo)`,
      residuais,
    );
  }
}

async function main() {
  const pacote = pacoteDoJob();
  const grupos = construirGrupos(pacote);
  const escolhido = process.argv[2];
  const nomes = escolhido ? [escolhido] : Object.keys(grupos);
  for (const nome of nomes) {
    if (!Object.hasOwn(grupos, nome)) {
      falhar(
        "USO",
        `Grupo desconhecido '${nome}'. Válidos: ${Object.keys(grupos).join(", ")}`,
      );
    }
  }
  console.log(`[ACL] pacote: ${pacote.rotulo}`);

  const clientes = {};
  const relator = criarRelator();
  try {
    for (const nome of nomes) {
      const alvo = grupos[nome].banco;
      if (!clientes[alvo]) {
        clientes[alvo] = await conectar(
          alvo === "antes" ? BANCO_ANTES : undefined,
        );
      }
    }
    for (const nome of nomes) {
      console.log(`\n=== ${nome} ===`);
      await rodarGrupo(nome, grupos[nome], clientes, relator);
      if (nome === "GRANTS_POR_PAPEL" && pacote.id === "amplo") {
        await avisarMaintainResidual(clientes.base, relator);
      }
    }
  } finally {
    for (const c of Object.values(clientes)) await c.end().catch(() => {});
  }

  const { resultado } = relator;
  if (resultado.ok + resultado.falhas === 0) {
    falhar("FALHOU", "Nenhum caso rodou — prova vazia não vale.");
  }
  resumir(`Permissões (${pacote.id}) — ${nomes.join(" + ")}`, resultado);
  console.log(
    `\n${resultado.ok} OK · ${resultado.falhas} FALHA · ${resultado.infos} INFO`,
  );
  if (resultado.falhas > 0) process.exit(1);
}

/**
 * Usado pelo teste de ROLLBACK: service_role e postgres (o pg_cron) executam
 * as 6 NESTE banco (numa transação com fixtures, desfeita no fim). Devolve uma
 * linha por função; lança Falha se alguma for recusada por privilégio.
 */
async function seisExecutamParaServidor(cliente) {
  const linhas = [];
  await cliente.query("BEGIN");
  try {
    await montar(cliente);
    for (const item of SEIS) {
      const params = valoresDe(item.params);
      await como(cliente, "service_role");
      const t = await executavel(cliente, item.sql, params);
      await comoPostgres(cliente);
      await funciona(cliente, item.sql, params);
      linhas.push(`${item.sig}: service_role ${t.texto}; postgres sucesso`);
    }
  } finally {
    await cliente.query("ROLLBACK").catch(() => {});
  }
  return linhas;
}

module.exports = { seisExecutamParaServidor };

if (require.main === module) {
  main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
}
