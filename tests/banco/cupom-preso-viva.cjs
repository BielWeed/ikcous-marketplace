"use strict";

/**
 * PROVA VIVA do "cupom preso" (issues #210 e #116; pedido do dono de
 * 09/10/2026) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * O defeito: o pedido que o cliente cancela (ou que expira) continua segurando
 * a vaga do cupom até a varredura devolver_cupons_de_pedidos_mortos() (que
 * roda a cada 15 min) achar o pedido, e a tela só dizia "Cupom atingiu o
 * limite de uso." sem explicar que a vaga era dele nem quando voltava.
 *
 * MIGRATION 20261205000000 (esta prova, até o bloco "M1"): duas funções NOVAS,
 * nenhuma existente é redefinida.
 *   - cupom__vaga_volta_em(...): auxiliar com PARÂMETROS SIMPLES (nunca a linha
 *     da tabela: o PostgREST a exporia como coluna calculada) que diz QUANDO a
 *     varredura devolve a vaga de um pedido; espelha exatamente a varredura
 *     20260970.
 *   - vaga_do_cupom_presa(p_code): só LEITURA; diz ao cliente se a vaga está
 *     presa num pedido cancelado DELE e em quantos minutos volta.
 *
 * O que se prova aqui:
 *   (0) fixtures.
 *   (1) catálogo e ACL: a RPC só para authenticated (anon, service_role e PUBLIC
 *       não), SECURITY DEFINER com search_path fixo; o auxiliar não é de
 *       ninguém.
 *   (2) TABELA DE CASOS, pedidos criados pelos caminhos REAIS (v23, v24,
 *       cancelamento do cliente, da borda e do admin, confirmar_pagamento,
 *       expirar_pedidos_vencidos, envio, retorno): o auxiliar diz "volta antes
 *       de agora" SE E SOMENTE SE a varredura devolve o pedido; a RPC diz
 *       "presa" SE E SOMENTE SE a varredura VAI devolver um dia; e os minutos
 *       batem. A vaga volta de verdade: a validação do cupom recusa antes e
 *       aceita depois.
 *   (3) só o DONO: outro usuário, outro código, cupom inativo, sem sessão e convidado
 *       recebem a MESMA resposta byte a byte (a RPC não vira sonda de código); anon, sem EXECUTE.
 *   (4) vários pedidos: vale o que volta primeiro.
 *   (5) MIGRATION: reaplicar é idempotente; pré-voo recusa SEM gravar, com o
 *       NOME do que falta ou diverge (inclusive 1 byte a mais no corpo da
 *       varredura); pós-voo; rollback derruba só as duas funções, recusa corpo
 *       de outra migration e varredura diferente da 20260970.
 *   (6) MUTANTES: cada guarda tirada deixa a prova certa VERMELHA.
 *
 * MIGRATION 20261206000000 (provas "M2" e "7x", depois de reaplicá-la): a vaga do
 * pedido NUNCA COBRADO (sem id de cobrança gravado E zero tentativas) volta 45
 * min depois de expires_at, e não mais em 24 h; a varredura passa a perguntar
 * ao auxiliar. A ordem dos arquivos importa: o banco que chega aqui (CI) tem as
 * duas migrations, e a prova "(1-M2)" desfaz a segunda pelo rollback (provando
 * que ele restaura byte a byte) para as provas da 20261205 rodarem no estado em
 * que só ela existe; "(M2-a)" reaplica a segunda.
 *   (7a) tabela de casos da pista rápida (fronteiras de 45 min, cobrança gravada,
 *        tentativa, pago, enviado...); (7b) o cenário do crítico: com a vaga de
 *        cobrança vazia nenhum pagamento se liga ao pedido (`divergente`);
 *        (7c) duas varreduras em conexões reais: uma devolução só; (7d-g)
 *        reaplicar, pré-voo, pós-voo e rollback; (8) mutantes.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupom-preso-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome fixo
 * (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME_M1 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";

// Leitura SOB DEMANDA: com a migration ainda ausente a prova falha por
// asserção de comportamento (função inexistente), não por ENOENT no carregar.
const ler = (nome) => fs.readFileSync(path.join(PASTA, nome), "utf8");
const lerM1 = () => ler(NOME_M1);
const lerRollbackM1 = () => ler(`rollback-manual-${NOME_M1}`);
const NOME_M2 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const NOME_970 = "20260970000000_cancelamento_respeita_o_envio.sql";
const lerM2 = () => ler(NOME_M2);
const lerRollbackM2 = () => ler(`rollback-manual-${NOME_M2}`);

const CAB_AUX = "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(";
const CAB_VARREDURA =
  "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()";
const TAG_FN = "$function$";
const TAG_VARREDURA = "$devolver_cupons_mortos$";

const sha256 = (s) =>
  crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** O corpo de uma função dentro de um arquivo, entre `AS $tag$` e `$tag$;` (LF). */
function corpoDe(texto, cabecalho, tag) {
  const t = texto.replace(/\r\n/g, "\n");
  const ini = t.indexOf(cabecalho);
  assert.ok(ini >= 0, `cabeçalho não achado: ${cabecalho}`);
  const abre = t.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  return t.slice(abre, t.indexOf(`${tag};`, abre));
}
/** sha256 do corpo como o banco o guarda: texto em LF e em CRLF. */
const shas = (corpo) => [sha256(corpo), sha256(corpo.replace(/\n/g, "\r\n"))];

const SHA_AUX_V1 = () => shas(corpoDe(lerM1(), CAB_AUX, TAG_FN));
const SHA_AUX_V2 = () => shas(corpoDe(lerM2(), CAB_AUX, TAG_FN));
const SHA_VARREDURA_970 = () =>
  shas(corpoDe(ler(NOME_970), CAB_VARREDURA, TAG_VARREDURA));
const SHA_VARREDURA_V2 = () =>
  shas(corpoDe(lerM2(), CAB_VARREDURA, TAG_VARREDURA));

/** O comentário da varredura como a 20260901000000 o deixou (e o rollback da M2 o restaura). */
const COMENTARIO_VARREDURA_970 =
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito. Só age sobre pedido definitivamente morto -- PIX que ja nao pode mais ser pago, pelo mesmo criterio de pagamentos_a_reconciliar (expires_at + 24h) -- e nunca deduz "ja devolvido" do estado: le e grava o fato na coluna coupon_usage_returned. Agendada via pg_cron a cada 15 minutos, ver abaixo.';
/** O comentário do auxiliar como a M1 o deixou. */
const comentarioDoAuxiliarNaM1 = () => {
  const m =
    /COMMENT ON FUNCTION public\.cupom__vaga_volta_em\([^)]*\) IS '([^']*)';/.exec(
      lerM1(),
    );
  assert.ok(m, "COMMENT do auxiliar não achado na M1");
  return m[1];
};

/** Estado COMPLETO de uma função: corpo, definição, ACL e comentário. */
async function estadoDe(c, assinatura) {
  return (
    await c.query(
      `SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') AS sha, pg_get_functiondef(oid) AS def,
              proacl::text AS acl, obj_description(oid, 'pg_proc') AS comentario
         FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [assinatura],
    )
  ).rows[0];
}

const FN_AUX =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamp with time zone, boolean, timestamp with time zone, text, integer)";
const FN_RPC = "public.vaga_do_cupom_presa(text)";
const FN_VARREDURA = "public.devolver_cupons_de_pedidos_mortos()";

const U_COMPRADOR = "c5000000-0000-4000-8000-000000000001";
const U_OUTRO = "c5000000-0000-4000-8000-000000000002";
const U_ADMIN = "c5000000-0000-4000-8000-000000000003";
const P_PRODUTO = "c5aaaaaa-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM_POR_NOME = {
  anon: { papel: "anon", uid: "", jwt: "" },
  comprador: {
    papel: "authenticated",
    uid: U_COMPRADOR,
    jwt: claims(U_COMPRADOR, null),
  },
  outro: { papel: "authenticated", uid: U_OUTRO, jwt: claims(U_OUTRO, null) },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  // Papel authenticated, mas SEM uid na sessão (auth.uid() NULL).
  semSessao: { papel: "authenticated", uid: "", jwt: "" },
  service: { papel: "service_role", uid: "", jwt: "" },
};
// Map em vez de indexação dinâmica (security/detect-object-injection).
const QUEM = new Map(Object.entries(QUEM_POR_NOME));

// ---------------------------------------------------------------- utilitários

/** Roda `sql` COMO `quem` dentro da transação aberta; um erro não aborta a transação. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma transação que SEMPRE desfaz (ou commita, se pedido). */
async function emTx(c, corpo, { commit = false } = {}) {
  await c.query("BEGIN");
  try {
    const r = await corpo();
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

async function tentarSql(c, sql) {
  await c.query("SAVEPOINT sp_sql");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sql");
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: false, message: e.message };
  }
}

/** Uma conexão NOVA (para as provas de concorrência, que precisam de duas sessões reais). */
async function novoCliente() {
  const cl = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await cl.connect();
  return cl;
}

/** Obriga o resultado de `como` a ter dado certo (asserção, nunca exceção solta). */
function exigirOk(r, rotulo) {
  assert.ok(r.ok, `${rotulo}: ${r.message}`);
  return r.rows;
}

const vagaPresa = async (c, quem, codigo) =>
  exigirOk(
    await como(c, quem, "SELECT public.vaga_do_cupom_presa($1) AS r", [codigo]),
    `vaga_do_cupom_presa(${quem}, ${codigo})`,
  )[0].r;

const varrer = async (c) =>
  Number((await c.query(`SELECT ${FN_VARREDURA} AS n`)).rows[0].n);

/** O que o auxiliar diz de UM pedido, chamado com as colunas dele. */
async function veredictoDoAuxiliar(c, id) {
  return (
    await c.query(
      `SELECT v < now() AS volta_antes_de_agora, v = 'infinity'::timestamptz AS nunca
         FROM (SELECT public.cupom__vaga_volta_em(
                 o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned,
                 o.expires_at, o.cancelled_after_shipping, o.returned_to_seller_at,
                 o.gateway_payment_id, o.tentativas_de_pagamento) AS v
                 FROM public.marketplace_orders o WHERE o.id = $1) t`,
      [id],
    )
  ).rows[0];
}

const pedido = async (c, id) =>
  (await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [id]))
    .rows[0];

const usos = async (c, cupomId) =>
  Number(
    (
      await c.query("SELECT usage_count FROM public.coupons WHERE id = $1", [
        cupomId,
      ])
    ).rows[0].usage_count,
  );

const validar = async (c, codigo) =>
  (
    await c.query(
      "SELECT public.validate_coupon_secure_v2($1, 100::numeric) AS r",
      [codigo],
    )
  ).rows[0].r;

// ----------------------------------------------------- cenários (caminhos REAIS)

/** Cupom novo de R$ 10, limite de uso 1 (por padrão), vaga livre. */
async function novoCupom(c, limite = 1) {
  const codigo = `PRESO${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const id = (
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
       VALUES ($1, 'fixed', 10, true, 0, $2) RETURNING id`,
      [codigo, limite],
    )
  ).rows[0].id;
  return { id, codigo };
}

/** Pedido criado pelo caminho de produção (v23 = "na entrega", v24 = PIX). */
async function criarPedido(c, rpc, quem, cupomCodigo) {
  const metodo = rpc === "create_marketplace_order_v24" ? "pix" : "cash";
  const r = await como(
    c,
    quem,
    `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, $4::text,
       'Comprador', '5539000000000', NULL::text, $5::jsonb, '38500-000', 'local-delivery', $6::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
      ]),
      cupomCodigo ? 90 : 100,
      metodo,
      cupomCodigo,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      crypto.randomUUID(),
    ],
  );
  return exigirOk(r, `${rpc} como ${quem}`)[0].id;
}

const cancelarComo = async (c, quem, id) =>
  exigirOk(
    await como(
      c,
      quem,
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled') AS r",
      [id],
    ),
    `cancelar como ${quem}`,
  );

/** O que cada tipo de pedido tem de ser DEPOIS de montado (a pré-condição do caso). */
const ESTADO_ESPERADO = new Map([
  ["v23-cancelado", ["cancelled", null, 0, false, false, false, true, false]],
  [
    "v24-cancelado",
    ["cancelled", "aguardando", 0, false, false, false, true, true],
  ],
  [
    "v24-recusa-antes",
    ["cancelled", "aguardando", 1, false, false, false, true, true],
  ],
  [
    "v24-com-qr",
    ["cancelled", "aguardando", 0, true, false, false, true, true],
  ],
  [
    "v24-pago-apos-expirar",
    ["cancelled", "pago_apos_expirar", 0, true, false, false, true, true],
  ],
  [
    "v24-pago-cancelado",
    ["cancelled", "pago", 0, true, false, false, true, true],
  ],
  [
    "v24-expirado",
    ["cancelled", "expirado", 0, false, false, false, true, true],
  ],
  [
    "v24-pendente",
    ["pending", "aguardando", 0, false, false, false, true, true],
  ],
  [
    "v23-enviado-cancelado",
    ["cancelled", null, 0, false, true, false, true, false],
  ],
  [
    "v23-enviado-retornado",
    ["cancelled", null, 0, false, true, true, true, false],
  ],
  [
    "v24-enviado-cancelado",
    ["cancelled", "aguardando", 0, false, true, false, true, true],
  ],
  [
    "v24-vaga-liberada",
    ["cancelled", "aguardando", 1, false, false, false, true, true],
  ],
  ["v23-sem-cupom", ["cancelled", null, 0, false, false, false, false, false]],
]);

function projetar(p) {
  return [
    p.status,
    p.payment_status,
    p.tentativas_de_pagamento,
    p.gateway_payment_id !== null,
    p.cancelled_after_shipping,
    p.returned_to_seller_at !== null,
    p.coupon_id !== null,
    p.expires_at !== null,
  ];
}

/**
 * Monta UM pedido do tipo `kind` pelos caminhos reais e põe o relógio por
 * UPDATE de expires_at (`offsetSec` = quantos segundos ATRÁS o PIX venceu;
 * null deixa como está — o pedido "na entrega" nasce sem expires_at).
 */
async function montar(c, { kind, offsetSec = null, cupom = null }) {
  const cup = cupom || (await novoCupom(c));
  const v23 = kind.startsWith("v23");
  const rpc = v23
    ? "create_marketplace_order_v23"
    : "create_marketplace_order_v24";
  const codigo = kind === "v23-sem-cupom" ? null : cup.codigo;
  const id = await criarPedido(c, rpc, "comprador", codigo);

  switch (kind) {
    case "v23-cancelado":
    case "v24-cancelado":
    case "v23-sem-cupom":
      await cancelarComo(c, "comprador", id);
      break;
    case "v24-recusa-antes": {
      // Cartão recusado antes de existir cobrança: só conta a tentativa.
      const lib = await c.query(
        "SELECT public.liberar_cobranca_do_pedido($1::uuid, NULL) AS ok",
        [id],
      );
      assert.equal(
        lib.rows[0].ok,
        true,
        "liberar_cobranca_do_pedido não contou",
      );
      await cancelarComo(c, "comprador", id);
      break;
    }
    case "v24-com-qr":
      // criar-pagamento grava o id da cobrança; o cancelamento com cobrança
      // aberta só passa pela edge (p_pela_edge), que anula no MP antes.
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-QR-1' WHERE id = $1",
        [id],
      );
      await c.query(
        "SELECT public.pedido__mudar_status($1::uuid, 'cancelled', NULL, $2::uuid, false, true)",
        [id, U_COMPRADOR],
      );
      break;
    case "v24-pago-apos-expirar": {
      await cancelarComo(c, "comprador", id);
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-TARDIO-1' WHERE id = $1",
        [id],
      );
      const conf = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, 'MP-TARDIO-1', 'pago') AS r",
        [id],
      );
      assert.equal(conf.rows[0].r, "pago_apos_expirar");
      break;
    }
    case "v24-pago-cancelado": {
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-PAGO-1' WHERE id = $1",
        [id],
      );
      const conf = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, 'MP-PAGO-1', 'pago') AS r",
        [id],
      );
      assert.equal(conf.rows[0].r, "pago");
      await cancelarComo(c, "admin", id);
      break;
    }
    case "v24-expirado": {
      await c.query(
        "UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [id],
      );
      const n = await c.query("SELECT public.expirar_pedidos_vencidos() AS n");
      assert.equal(Number(n.rows[0].n), 1, "expirar_pedidos_vencidos");
      break;
    }
    case "v24-pendente":
      break;
    case "v24-vaga-liberada": {
      // cobrança gravada e depois liberada (cartão recusado): a vaga de
      // cobrança volta a ficar VAZIA, sempre com tentativas + 1
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-LIB-1' WHERE id = $1",
        [id],
      );
      const lib = await c.query(
        "SELECT public.liberar_cobranca_do_pedido($1::uuid, 'MP-LIB-1') AS ok",
        [id],
      );
      assert.equal(
        lib.rows[0].ok,
        true,
        "liberar_cobranca_do_pedido não liberou",
      );
      await cancelarComo(c, "comprador", id);
      break;
    }
    case "v24-enviado-cancelado":
    case "v23-enviado-cancelado":
    case "v23-enviado-retornado":
      exigirOk(
        await como(
          c,
          "admin",
          "SELECT public.update_order_status_atomic($1::uuid, 'shipping') AS r",
          [id],
        ),
        "admin envia o pedido",
      );
      await cancelarComo(c, "comprador", id);
      if (kind === "v23-enviado-retornado") {
        exigirOk(
          await como(
            c,
            "admin",
            "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
            [id],
          ),
          "admin confirma o retorno do produto",
        );
      }
      break;
    default:
      throw new Error(`tipo de pedido desconhecido: ${kind}`);
  }

  if (offsetSec !== null) {
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - make_interval(secs => $2) WHERE id = $1",
      [id, offsetSec],
    );
  }
  const p = await pedido(c, id);
  const esperado = ESTADO_ESPERADO.get(kind);
  // a pré-condição do caso: o pedido É o que o tipo diz (senão o caso mente)
  assert.deepEqual(
    projetar(p).slice(0, 7),
    esperado.slice(0, 7),
    `pré-condição do tipo ${kind}`,
  );
  assert.equal(p.coupon_usage_returned, false);
  if (offsetSec === null) {
    assert.equal(
      p.expires_at !== null,
      esperado[7],
      `${kind}: expires_at nasce ${esperado[7] ? "preenchido" : "vazio"}`,
    );
  }
  return { id, cupom: cup, codigo };
}

// ------------------------------------------------------------ a tabela de casos

const MIN = 60;
/**
 * `devolve`: a varredura devolve AGORA. `presa`: a varredura VAI devolver um dia
 * (a RPC diz "presa"). `minutos`: o que a RPC promete (espera até a hora + 15
 * min do ciclo do agendamento), com os números POR EXTENSO.
 * Valem para o corpo da 20260970 (espera de 24 h depois de expires_at).
 */
const CASOS_M1 = [
  {
    nome: "na entrega (v23, sem expires_at) cancelado: volta no próximo ciclo",
    kind: "v23-cancelado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX cancelado, venceu há 24 h 01 min: volta",
    kind: "v24-cancelado",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX cancelado, venceu há 23 h 59 min: falta 1 min",
    kind: "v24-cancelado",
    offsetSec: 1439 * MIN,
    devolve: false,
    presa: true,
    minutos: 16,
  },
  {
    nome: "PIX cancelado, venceu há 23 h: faltam 60 min",
    kind: "v24-cancelado",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
  {
    nome: "PIX cancelado, venceu há 50 min: faltam 1390 min",
    kind: "v24-cancelado",
    offsetSec: 50 * MIN,
    devolve: false,
    presa: true,
    minutos: 1405,
  },
  {
    nome: "faltam 90 s: arredonda PARA CIMA (2 min, não 1)",
    kind: "v24-cancelado",
    offsetSec: 1440 * MIN - 90,
    devolve: false,
    presa: true,
    minutos: 17,
  },
  {
    nome: "PIX expirado pela varredura, venceu há 10 min",
    kind: "v24-expirado",
    offsetSec: 10 * MIN,
    devolve: false,
    presa: true,
    minutos: 1445,
  },
  {
    nome: "cartão recusado antes da cobrança (1 tentativa), 24 h 01 min: volta",
    kind: "v24-recusa-antes",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "cartão recusado antes da cobrança, 23 h: espera",
    kind: "v24-recusa-antes",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
  {
    nome: "com QR/cobrança gravada, 24 h 01 min: volta",
    kind: "v24-com-qr",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "com QR/cobrança gravada, 50 min: espera",
    kind: "v24-com-qr",
    offsetSec: 50 * MIN,
    devolve: false,
    presa: true,
    minutos: 1405,
  },
  {
    nome: "pago depois de expirar: NUNCA",
    kind: "v24-pago-apos-expirar",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pago e depois cancelado pelo lojista: NUNCA",
    kind: "v24-pago-cancelado",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pedido ainda pendente (não cancelado): não é vaga presa",
    kind: "v24-pendente",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "cancelado DEPOIS do envio, produto não voltou: NUNCA (ainda)",
    kind: "v23-enviado-cancelado",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "cancelado depois do envio e o lojista registrou o retorno: volta",
    kind: "v23-enviado-retornado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "pedido sem cupom: nada a devolver",
    kind: "v23-sem-cupom",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "PIX enviado e cancelado depois do envio, produto não voltou: NUNCA",
    kind: "v24-enviado-cancelado",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "vaga de cobrança esvaziada (liberar_cobranca_do_pedido), 24 h 01 min: volta",
    kind: "v24-vaga-liberada",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "vaga de cobrança esvaziada, 23 h: espera 60 min",
    kind: "v24-vaga-liberada",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
];

/**
 * Valem para a 20261206000000: a pista RÁPIDA (pedido NUNCA cobrado = sem id de
 * cobrança gravado E zero tentativas de pagamento) espera 45 min depois de
 * expires_at; qualquer outro pedido segue com as 24 h. Minutos por EXTENSO.
 */
const CASOS_M2 = [
  {
    nome: "na entrega (v23, sem expires_at) cancelado: volta no próximo ciclo",
    kind: "v23-cancelado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX cancelado sem cobrança, venceu há 46 min: volta",
    kind: "v24-cancelado",
    offsetSec: 46 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "venceu há 45 min 30 s: passou 30 s da espera, volta",
    kind: "v24-cancelado",
    offsetSec: 45 * MIN + 30,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "venceu há 44 min: falta 1 min",
    kind: "v24-cancelado",
    offsetSec: 44 * MIN,
    devolve: false,
    presa: true,
    minutos: 16,
  },
  {
    nome: "faltam 90 s: arredonda PARA CIMA (2 min, não 1)",
    kind: "v24-cancelado",
    offsetSec: 45 * MIN - 90,
    devolve: false,
    presa: true,
    minutos: 17,
  },
  {
    nome: "venceu há 10 min: faltam 35 min",
    kind: "v24-cancelado",
    offsetSec: 10 * MIN,
    devolve: false,
    presa: true,
    minutos: 50,
  },
  {
    nome: "venceu há 23 h: já voltou há muito",
    kind: "v24-cancelado",
    offsetSec: 1380 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX expirado pela varredura, venceu há 10 min",
    kind: "v24-expirado",
    offsetSec: 10 * MIN,
    devolve: false,
    presa: true,
    minutos: 50,
  },
  {
    nome: "PIX expirado pela varredura, venceu há 46 min",
    kind: "v24-expirado",
    offsetSec: 46 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "cartão recusado antes da cobrança (1 tentativa), 46 min: a vaga JÁ foi ocupada uma vez, segue as 24 h",
    kind: "v24-recusa-antes",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: true,
    minutos: 1409,
  },
  {
    nome: "cartão recusado antes da cobrança, 23 h: ainda espera",
    kind: "v24-recusa-antes",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
  {
    nome: "cartão recusado antes da cobrança, 24 h 01 min: volta",
    kind: "v24-recusa-antes",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "vaga de cobrança esvaziada por liberar_cobranca_do_pedido (tentativa +1), 46 min: 24 h",
    kind: "v24-vaga-liberada",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: true,
    minutos: 1409,
  },
  {
    nome: "vaga de cobrança esvaziada, 24 h 01 min: volta",
    kind: "v24-vaga-liberada",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "com QR/cobrança gravada, 46 min: vaga OCUPADA, segue as 24 h",
    kind: "v24-com-qr",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: true,
    minutos: 1409,
  },
  {
    nome: "com QR/cobrança gravada, 24 h 01 min: volta",
    kind: "v24-com-qr",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "pago depois de expirar, 46 min: NUNCA",
    kind: "v24-pago-apos-expirar",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pago depois de expirar, 24 h 01 min: NUNCA",
    kind: "v24-pago-apos-expirar",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pago e depois cancelado pelo lojista, 46 min: NUNCA",
    kind: "v24-pago-cancelado",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pedido ainda pendente (não cancelado), 46 min: não é vaga presa",
    kind: "v24-pendente",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "PIX enviado e cancelado DEPOIS do envio, produto não voltou, 46 min: NUNCA (a pista rápida não pula essa guarda)",
    kind: "v24-enviado-cancelado",
    offsetSec: 46 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "PIX enviado e cancelado depois do envio, 24 h 01 min: NUNCA",
    kind: "v24-enviado-cancelado",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "na entrega cancelado DEPOIS do envio, produto não voltou: NUNCA (ainda)",
    kind: "v23-enviado-cancelado",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "cancelado depois do envio e o lojista registrou o retorno: volta",
    kind: "v23-enviado-retornado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "pedido sem cupom: nada a devolver",
    kind: "v23-sem-cupom",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
];

/**
 * Cada caso, num estado novo (a transação desfaz). A ORDEM importa: a RPC e o
 * auxiliar LEEM antes de a varredura escrever; depois a varredura decide, e o
 * auxiliar tem de concordar com ela.
 */
async function rodarTabela(c, casos) {
  for (const cs of casos) {
    await emTx(c, async () => {
      const { id, cupom, codigo } = await montar(c, cs);
      const ro = `${cs.nome} [${cs.kind}]`;
      const temCupom = cs.kind !== "v23-sem-cupom";

      // a vaga está segurada: a validação recusa com a frase de sempre
      if (temCupom) {
        const v0 = await validar(c, codigo);
        assert.equal(v0.is_valid, false, `${ro}: vaga devia estar segurada`);
        assert.equal(v0.error_message, "Cupom atingiu o limite de uso.", ro);
      }

      // (a) a RPC do dono
      const r = await vagaPresa(c, "comprador", codigo);
      assert.equal(r.presa, cs.presa, `${ro}: presa`);
      assert.equal(r.volta_em_minutos, cs.minutos, `${ro}: minutos`);

      // (b) o auxiliar concorda com a varredura SE E SOMENTE SE
      const aux = await veredictoDoAuxiliar(c, id);
      assert.equal(
        aux.volta_antes_de_agora,
        cs.devolve,
        `${ro}: auxiliar diz volta_antes_de_agora=${aux.volta_antes_de_agora}`,
      );
      assert.equal(
        aux.nunca,
        !cs.presa,
        `${ro}: auxiliar diz nunca=${aux.nunca}`,
      );

      // (c) a varredura de verdade
      await varrer(c);
      const depois = await pedido(c, id);
      assert.equal(
        depois.coupon_usage_returned,
        cs.devolve,
        `${ro}: a varredura ${cs.devolve ? "devia devolver" : "NAO devia devolver"}`,
      );
      if (temCupom) {
        assert.equal(
          await usos(c, cupom.id),
          cs.devolve ? 0 : 1,
          `${ro}: usage_count`,
        );
        const v1 = await validar(c, codigo);
        assert.equal(
          v1.is_valid,
          cs.devolve,
          `${ro}: a vaga voltou de verdade?`,
        );
      }

      if (cs.devolve) {
        // devolvido: some da RPC, o auxiliar passa a dizer NUNCA, e a segunda
        // varredura não devolve de novo
        const r2 = await vagaPresa(c, "comprador", codigo);
        assert.deepEqual(
          r2,
          { presa: false, volta_em_minutos: null },
          `${ro}: depois de devolver`,
        );
        const aux2 = await veredictoDoAuxiliar(c, id);
        assert.equal(
          aux2.volta_antes_de_agora,
          false,
          `${ro}: devolvido, auxiliar ainda diz volta`,
        );
        assert.equal(
          aux2.nunca,
          true,
          `${ro}: devolvido, auxiliar nao diz nunca`,
        );
        await varrer(c);
        assert.equal(
          await usos(c, cupom.id),
          0,
          `${ro}: a 2a varredura devolveu em dobro`,
        );
      }
    });
  }
}

// ---------------------------------------------------------------- as provas

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("(0) fixtures", async (c) => {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [U_COMPRADOR, U_OUTRO, U_ADMIN]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@cupompreso.teste', '{}'::jsonb)`,
      [id],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Comprador Preso', 'customer'), ($2, 'Outro Preso', 'customer'), ($3, 'Admin Preso', 'admin')`,
    [U_COMPRADOR, U_OUTRO, U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons`,
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto cupom preso', 100, 100000, true, 40, false)`,
    [P_PRODUTO],
  );
});

// A árvore inteira (CI) chega aqui com as DUAS migrations aplicadas. As provas
// da 20261205 falam do estado em que SÓ ela existe (espera de 24 h para todo
// pedido): esta prova desfaz a 20261206 pelo rollback dela — e prova, no
// caminho, que o rollback restaura byte a byte — e deixa o banco nesse estado.
// A prova "(M2-a)" reaplica a 20261206 e começam as provas dela.
const FORA_DO_PAR = [
  "cupom__vaga_volta_em",
  "devolver_cupons_de_pedidos_mortos",
];

async function estadoDoPar(c) {
  return {
    aux: await estadoDe(c, FN_AUX),
    varredura: await estadoDe(c, FN_VARREDURA),
  };
}
const commitar = (c, sql) => emTx(c, () => c.query(sql), { commit: true });

prova(
  "(1-M2) rollback da 20261206 restaura o auxiliar e a varredura byte a byte (e reaplicar volta ao da 20261206); deixa o banco no estado da 20261205",
  async (c) => {
    const v2 = await estadoDoPar(c);
    assert.ok(
      SHA_AUX_V2().includes(v2.aux.sha),
      "o banco ainda não está no estado da 20261206 (auxiliar)",
    );
    assert.ok(
      SHA_VARREDURA_V2().includes(v2.varredura.sha),
      "o banco ainda não está no estado da 20261206 (varredura)",
    );
    const fora = await impressao(c, FORA_DO_PAR);
    // um pedido que existe antes e depois: o rollback não toca dado
    const id = await emTx(
      c,
      async () =>
        (await montar(c, { kind: "v24-cancelado", offsetSec: 600 })).id,
      { commit: true },
    );
    const pedidoAntes = await pedido(c, id);

    await commitar(c, lerRollbackM2());
    const v1 = await estadoDoPar(c);
    assert.ok(
      SHA_AUX_V1().includes(v1.aux.sha),
      "o auxiliar não voltou ao corpo da 20261205",
    );
    assert.ok(
      SHA_VARREDURA_970().includes(v1.varredura.sha),
      "a varredura não voltou ao corpo da 20260970",
    );
    assert.equal(v1.varredura.comentario, COMENTARIO_VARREDURA_970);
    assert.equal(v1.aux.comentario, comentarioDoAuxiliarNaM1());
    assert.equal(v1.aux.acl, v2.aux.acl, "ACL do auxiliar mudou");
    assert.equal(v1.varredura.acl, v2.varredura.acl, "ACL da varredura mudou");
    assert.deepEqual(
      await impressao(c, FORA_DO_PAR),
      fora,
      "o rollback mexeu em outra função",
    );
    assert.deepEqual(
      await pedido(c, id),
      pedidoAntes,
      "o rollback mexeu num pedido",
    );

    // idempotente: o segundo rollback não faz nada
    await commitar(c, lerRollbackM2());
    assert.deepEqual(await estadoDoPar(c), v1);

    // reaplicar a 20261206 volta ao estado dela, idêntico
    await commitar(c, lerM2());
    assert.deepEqual(
      await estadoDoPar(c),
      v2,
      "reaplicar não voltou ao estado idêntico",
    );

    // e o banco fica no estado da 20261205 para as provas dela
    await commitar(c, lerRollbackM2());
    assert.deepEqual(await estadoDoPar(c), v1);
  },
);

prova("(1) catálogo e ACL das duas funções novas", async (c) => {
  const r = await c.query(
    `SELECT (p.oid = to_regprocedure(CASE p.proname WHEN 'cupom__vaga_volta_em' THEN 'public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)' ELSE 'public.vaga_do_cupom_presa(text)' END)) AS exata, p.prosecdef, p.proconfig::text AS config,
            p.provolatile, p.prorettype::regtype::text AS ret,
            EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
            obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentada
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa')
      ORDER BY p.proname`,
  );
  assert.equal(
    r.rowCount,
    2,
    "as duas funções não existem (uma versão de cada)",
  );
  const [aux, rpc] = r.rows;

  assert.equal(aux.exata, true, "assinatura do auxiliar");
  assert.equal(aux.ret, "timestamp with time zone");
  assert.equal(aux.provolatile, "s", "o auxiliar é STABLE (usa now())");
  assert.equal(aux.config, "{search_path=public}");
  assert.equal(aux.prosecdef, false, "o auxiliar não é SECURITY DEFINER");
  assert.deepEqual(
    [aux.publico, aux.anon, aux.auth, aux.service],
    [false, false, false, false],
    "ninguém executa o auxiliar (só o dono e as funções SECURITY DEFINER dele)",
  );

  assert.equal(rpc.exata, true, "assinatura da RPC");
  assert.equal(rpc.ret, "jsonb");
  assert.equal(rpc.prosecdef, true);
  assert.equal(rpc.config, "{search_path=public}");
  assert.equal(rpc.publico, false, "PUBLIC com EXECUTE");
  assert.equal(rpc.anon, false, "anon com EXECUTE");
  assert.equal(rpc.auth, true, "authenticated sem EXECUTE");
  assert.equal(rpc.service, false, "service_role com EXECUTE");
  assert.equal(aux.comentada && rpc.comentada, true, "as duas têm COMMENT");

  // a varredura continua fechada para os papéis de aplicação
  const v = await c.query(
    `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`,
    [FN_VARREDURA],
  );
  assert.deepEqual(v.rows[0], { anon: false, auth: false });

  await emTx(c, async () => {
    for (const quem of ["anon", "service"]) {
      const a = await como(
        c,
        quem,
        "SELECT public.vaga_do_cupom_presa('X') AS r",
      );
      assert.equal(a.ok, false, `${quem} executou a RPC`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
    }
    for (const quem of ["anon", "comprador", "service", "admin"]) {
      const a = await como(
        c,
        quem,
        `SELECT ${FN_AUX.replace(/\(.*\)$/, "")}(NULL::uuid, NULL::text, NULL::text, NULL::boolean, NULL::timestamptz, NULL::boolean, NULL::timestamptz, NULL::text, NULL::integer) AS r`,
      );
      assert.equal(a.ok, false, `${quem} executou o auxiliar`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
    }
  });
});

async function tabelaM1(c) {
  await rodarTabela(c, CASOS_M1);
}
prova(
  "(2) tabela de casos: o auxiliar e a RPC concordam com a varredura 20260970, pedidos pelos caminhos reais",
  tabelaM1,
);

async function soODono(c) {
  const NADA = '{"presa":false,"volta_em_minutos":null}';
  // A RPC não pode virar sonda: cada "não" tem de ser BYTE A BYTE o mesmo.
  const bruto = async (quem, codigo) =>
    JSON.stringify(await vagaPresa(c, quem, codigo));
  await emTx(c, async () => {
    const { codigo, cupom, id } = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 1380 * MIN,
    });
    // o dono: presa, 60 + 15 min
    assert.equal(
      await bruto("comprador", codigo),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // minúsculas casam (a validação compara em UPPER)
    assert.equal(
      await bruto("comprador", codigo.toLowerCase()),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // OUTRO usuário e o ADMIN (que não é o dono do pedido): nada, nem que o pedido existe
    for (const quem of ["outro", "admin"]) {
      assert.equal(
        await bruto(quem, codigo),
        NADA,
        `${quem} viu o pedido do comprador`,
      );
    }
    // outro código, código inexistente, vazio, NULL: a MESMA resposta que o
    // código do pedido de outro usuário (quem de fora não distingue "o código
    // existe" de "não existe")
    const outroCupom = await novoCupom(c);
    for (const alvo of [codigo, outroCupom.codigo, "NAOEXISTE", "", null]) {
      assert.equal(await bruto("outro", alvo), NADA, `outro / ${alvo}`);
    }
    assert.equal(await bruto("comprador", outroCupom.codigo), NADA);
    assert.equal(await bruto("comprador", "NAOEXISTE"), NADA);
    assert.equal(await bruto("comprador", ""), NADA);
    assert.equal(await bruto("comprador", null), NADA);
    // SEM SESSÃO (authenticated com auth.uid() NULL): a mesma resposta, sem
    // erro de texto diferente, nem para o código do pedido que existe
    for (const alvo of [codigo, "NAOEXISTE", null]) {
      assert.equal(
        await bruto("semSessao", alvo),
        NADA,
        `sem sessão / ${alvo}`,
      );
    }
    // anon: sem EXECUTE, o MESMO erro (texto e código) para código que existe e
    // para o que não existe
    const negados = [];
    for (const alvo of [codigo, "NAOEXISTE"]) {
      const a = await como(
        c,
        "anon",
        "SELECT public.vaga_do_cupom_presa($1) AS r",
        [alvo],
      );
      assert.equal(a.ok, false);
      negados.push(`${a.code}|${a.message}`);
    }
    assert.equal(
      negados[0].replace(/.*\|/, ""),
      negados[1].replace(/.*\|/, ""),
    );
    assert.equal(negados[0].split("|")[0], "42501");
    // pedido de CONVIDADO (user_id NULL) fica de fora, para o dono e para quem
    // chama sem sessão (NULL = NULL nunca casa)
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = NULL WHERE id = $1",
      [id],
    );
    assert.equal(await bruto("comprador", codigo), NADA, "pedido de convidado");
    assert.equal(
      await bruto("semSessao", codigo),
      NADA,
      "convidado vs sem sessão",
    );
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = $2 WHERE id = $1",
      [id, U_COMPRADOR],
    );
    assert.equal(
      await bruto("comprador", codigo),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // cupom desativado: não é o caso da frase de limite, e a resposta é a mesma
    await c.query("UPDATE public.coupons SET active = false WHERE id = $1", [
      cupom.id,
    ]);
    assert.equal(await bruto("comprador", codigo), NADA, "cupom inativo");
  });
}
prova(
  '(3) só o dono vê a vaga presa; todo "não" é a mesma resposta (a RPC não vira sonda de código)',
  soODono,
);

/**
 * Só é "vaga presa" quando devolver a vaga DESTRAVA o cupom: com limite e no
 * limite exato. Limite rebaixado pelo lojista (mais usos que o limite), cupom
 * ilimitado (NULL ou 0, como a validação trata) e vaga ainda livre: presa=false
 * (falha segura = a frase antiga do front).
 */
async function soQuandoDestrava(c) {
  const NADA = { presa: false, volta_em_minutos: null };
  const PRESA = { presa: true, volta_em_minutos: 75 };
  const ajustar = (cupom, limite, usos) =>
    c.query(
      "UPDATE public.coupons SET usage_limit = $2, usage_count = $3 WHERE id = $1",
      [cupom.id, limite, usos],
    );
  await emTx(c, async () => {
    // dois pedidos do comprador seguram as duas vagas de um cupom de limite 2
    const cupom = await novoCupom(c, 2);
    await montar(c, { kind: "v24-cancelado", offsetSec: 1380 * MIN, cupom });
    await montar(c, { kind: "v24-cancelado", offsetSec: 1380 * MIN, cupom });
    assert.equal(await usos(c, cupom.id), 2);
    // o caso normal: no limite exato, devolver destrava
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      PRESA,
      "normal",
    );
    // limite REBAIXADO pelo lojista (2 usos, limite 1): uma vaga devolvida não destrava
    await ajustar(cupom, 1, 2);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      NADA,
      "limite rebaixado",
    );
    // limite 5 e 7 usos
    await ajustar(cupom, 5, 7);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      NADA,
      "limite 5, 7 usos",
    );
    // ilimitado: limite NULL, limite 0 (a validação trata 0 como sem limite), e 0 usos com limite 0
    for (const [limite, usosAgora] of [
      [null, 2],
      [0, 2],
      [0, 0],
      [null, 0],
    ]) {
      await ajustar(cupom, limite, usosAgora);
      assert.deepEqual(
        await vagaPresa(c, "comprador", cupom.codigo),
        NADA,
        `ilimitado (limite ${limite}, ${usosAgora} usos)`,
      );
    }
    // vaga ainda livre (1 uso, limite 2): o cupom não está no limite, não há o que explicar
    await ajustar(cupom, 2, 1);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      NADA,
      "vaga livre",
    );
    // voltou ao normal: a mesma resposta do início
    await ajustar(cupom, 2, 2);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      PRESA,
      "de volta ao limite exato",
    );
    // minúsculas casam com o mesmo cupom (UPPER, como a validação)
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo.toLowerCase()),
      PRESA,
    );
  });
}
prova(
  "(3b) só é vaga presa quando devolver a vaga destrava o cupom (limite rebaixado, ilimitado e vaga livre: não)",
  soQuandoDestrava,
);

async function variosPedidos(c) {
  await emTx(c, async () => {
    // Mesmo cupom (limite 3), três pedidos do comprador: um volta em 40 min,
    // um em 1340, e um que NUNCA volta (pago depois de expirar). Vale o primeiro.
    const cupom = await novoCupom(c, 3);
    const devagar = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 100 * MIN,
      cupom,
    });
    const rapido = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 1400 * MIN,
      cupom,
    });
    await montar(c, {
      kind: "v24-pago-apos-expirar",
      offsetSec: 1441 * MIN,
      cupom,
    });
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: true, volta_em_minutos: 55 },
      "vale o pedido que volta primeiro (40 min + 15)",
    );
    // pedido de OUTRO usuário no mesmo cupom, mais rápido ainda: não conta
    // (montar cria como comprador; o usuário do pedido é trocado só para a leitura)
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = $2 WHERE id = $1",
      [rapido.id, U_OUTRO],
    );
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: true, volta_em_minutos: 1355 },
      "o pedido do outro usuário não conta (1340 + 15)",
    );
    assert.deepEqual(await vagaPresa(c, "outro", cupom.codigo), {
      presa: true,
      volta_em_minutos: 55,
    });
    // a varredura devolve o do outro usuário e o dono do primeiro fica com o dele
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - interval '25 hours' WHERE id = $1",
      [devagar.id],
    );
    await varrer(c);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: false, volta_em_minutos: null },
      "tudo devolvido ou nunca: nada preso",
    );
  });
}
prova(
  "(4) vários pedidos: vale o que volta primeiro, só os do dono",
  variosPedidos,
);

// ------------------------------------------------------------------ migration

async function impressao(c, fora) {
  return (
    await c.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
                  || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                  E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname <> ALL ($1::text[])`,
      [fora],
    )
  ).rows[0];
}
const SO_AS_DUAS = ["cupom__vaga_volta_em", "vaga_do_cupom_presa"];

async function defs(c) {
  const r = await c.query(
    `SELECT p.oid::regprocedure::text AS f, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl,
            obj_description(p.oid, 'pg_proc') AS comentario, p.prosecdef, p.proconfig::text AS cfg,
            encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa')
      ORDER BY p.proname`,
  );
  return r.rows;
}

const existeFuncao = async (c, assinatura) =>
  (await c.query("SELECT to_regprocedure($1) AS f", [assinatura])).rows[0].f !==
  null;

const derrubarAsDuas = async (c) => {
  await c.query(`DROP FUNCTION IF EXISTS ${FN_RPC}`);
  await c.query(`DROP FUNCTION IF EXISTS ${FN_AUX}`);
};

async function reaplicarIdempotente(c, sqlM1 = lerM1()) {
  const antes = await defs(c);
  assert.equal(antes.length, 2);
  await emTx(c, async () => {
    await c.query(sqlM1);
    await c.query(sqlM1);
    assert.deepEqual(await defs(c), antes);
  });
  assert.deepEqual(await defs(c), antes);
}
prova(
  "(5a) reaplicar a migration é idempotente (mesmo corpo, mesma ACL, mesmo comentário)",
  (c) => reaplicarIdempotente(c),
);

/** O corpo vivo da varredura com 1 byte a mais (um espaço no fim). */
async function varreduraComUmByteAMais(c) {
  const live = (
    await c.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN_VARREDURA],
    )
  ).rows[0].prosrc;
  assert.ok(!live.includes("$x$"));
  await c.query(
    `CREATE OR REPLACE FUNCTION ${FN_VARREDURA} RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $x$${live} $x$`,
  );
}

async function preVoo(c, sqlM1 = lerM1()) {
  const quebras = [
    [
      "varredura com 1 byte a mais",
      varreduraComUmByteAMais,
      /PREFLIGHT_20261205.*corpo vivo de devolver_cupons_de_pedidos_mortos/,
    ],
    [
      "duas versões da varredura",
      (cc) =>
        cc.query(
          "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
        ),
      /PREFLIGHT_20261205.*exatamente uma/,
    ],
    [
      "devolver_uso_cupom ausente",
      (cc) =>
        cc.query(
          "ALTER FUNCTION public.devolver_uso_cupom(uuid) RENAME TO devolver_uso_cupom_x",
        ),
      /PREFLIGHT_20261205: falta a funcao public\.devolver_uso_cupom/,
    ],
    [
      "tabela coupons ausente",
      (cc) => cc.query("ALTER TABLE public.coupons RENAME TO coupons_x"),
      /PREFLIGHT_20261205: falta a tabela public\.coupons/,
    ],
    [
      "coluna tentativas_de_pagamento ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO tdp",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.tentativas_de_pagamento/,
    ],
    [
      "coluna coupon_usage_returned ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN coupon_usage_returned TO cur",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.coupon_usage_returned/,
    ],
    [
      "coluna cancelled_after_shipping ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN cancelled_after_shipping TO cas",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.cancelled_after_shipping/,
    ],
    [
      "coluna returned_to_seller_at ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN returned_to_seller_at TO rsa",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.returned_to_seller_at/,
    ],
    [
      "coluna coupons.code ausente",
      (cc) =>
        cc.query("ALTER TABLE public.coupons RENAME COLUMN code TO codigo_x"),
      /PREFLIGHT_20261205: falta a coluna public\.coupons\.code/,
    ],
  ];
  for (const [rotulo, quebra, esperado] of quebras) {
    await emTx(c, async () => {
      await derrubarAsDuas(c);
      await quebra(c);
      const antes = await impressao(c, SO_AS_DUAS);
      const r = await tentarSql(c, sqlM1);
      assert.equal(r.ok, false, `${rotulo}: a migration passou`);
      assert.match(r.message, esperado, rotulo);
      assert.equal(
        await existeFuncao(c, FN_AUX),
        false,
        `${rotulo}: criou o auxiliar apesar do pré-voo`,
      );
      assert.equal(
        await existeFuncao(c, FN_RPC),
        false,
        `${rotulo}: criou a RPC apesar do pré-voo`,
      );
      assert.deepEqual(
        await impressao(c, SO_AS_DUAS),
        antes,
        `${rotulo}: gravou algo`,
      );
    });
  }
  // Funções com o mesmo nome e OUTRO corpo: não sobrescreve (e não grava nada).
  const alheias = [
    [
      "auxiliar",
      `CREATE OR REPLACE FUNCTION ${FN_AUX.replace(/\(.*\)$/, "")}(p_coupon_id uuid, p_status text, p_payment_status text, p_coupon_usage_returned boolean, p_expires_at timestamptz, p_cancelled_after_shipping boolean, p_returned_to_seller_at timestamptz, p_gateway_payment_id text, p_tentativas integer) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$ SELECT now() $$`,
      /PREFLIGHT_20261205.*cupom__vaga_volta_em ja existe com outro corpo/,
    ],
    [
      "RPC",
      "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$",
      /PREFLIGHT_20261205.*vaga_do_cupom_presa ja existe com outro corpo/,
    ],
  ];
  for (const [rotulo, criar, esperado] of alheias) {
    await emTx(c, async () => {
      await derrubarAsDuas(c);
      await c.query(criar);
      const antes = await defs(c);
      const r = await tentarSql(c, sqlM1);
      assert.equal(r.ok, false, `${rotulo} alheio: a migration passou`);
      assert.match(r.message, esperado, rotulo);
      assert.deepEqual(
        await defs(c),
        antes,
        `${rotulo} alheio: foi sobrescrito`,
      );
    });
  }
}
prova(
  "(5b) pré-voo recusa SEM gravar, com o nome do que falta ou diverge",
  (c) => preVoo(c),
);

async function posVoo(c, sqlM1 = lerM1()) {
  // Se a função criada NÃO sai com o corpo previsto (aqui: 1 byte alterado no
  // auxiliar, o que o pré-voo não enxerga porque a função ainda não existe), a
  // migration inteira recusa e NADA fica.
  const marca = "ELSE p_expires_at + interval '24 hours'";
  cortarUma(sqlM1, marca, "pós-voo: corpo do auxiliar alterado");
  const alterada = sqlM1.replace(
    marca,
    () => `${marca} + interval '0 seconds'`,
  );
  await emTx(c, async () => {
    await derrubarAsDuas(c);
    const antes = await impressao(c, SO_AS_DUAS);
    const r = await tentarSql(c, alterada);
    assert.equal(r.ok, false, "a migration com o auxiliar alterado concluiu");
    assert.match(r.message, /POSVOO_20261205/);
    assert.equal(
      await existeFuncao(c, FN_AUX),
      false,
      "o auxiliar alterado ficou",
    );
    assert.equal(await existeFuncao(c, FN_RPC), false, "a RPC ficou");
    assert.deepEqual(await impressao(c, SO_AS_DUAS), antes);
  });
}
prova(
  "(5c) pós-voo: função que sai com outro corpo derruba a migration inteira",
  (c) => posVoo(c),
);

async function rollbackLimpo(c, sqlM1 = lerM1(), sqlRb = lerRollbackM1()) {
  await emTx(c, async () => {
    const id = (
      await montar(c, { kind: "v24-cancelado", offsetSec: 1380 * MIN })
    ).id;
    const pedidoAntes = await pedido(c, id);
    const def0 = await defs(c);
    const f0 = await impressao(c, SO_AS_DUAS);
    const varreduraAntes = (
      await c.query(
        "SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN_VARREDURA],
      )
    ).rows[0];

    await c.query(sqlRb);
    assert.equal(
      await existeFuncao(c, FN_AUX),
      false,
      "o auxiliar continua depois do rollback",
    );
    assert.equal(
      await existeFuncao(c, FN_RPC),
      false,
      "a RPC continua depois do rollback",
    );
    assert.deepEqual(
      await impressao(c, SO_AS_DUAS),
      f0,
      "o rollback mexeu em outra função",
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN_VARREDURA],
        )
      ).rows[0],
      varreduraAntes,
      "o rollback mexeu na varredura",
    );
    assert.deepEqual(
      await pedido(c, id),
      pedidoAntes,
      "o rollback mexeu num pedido",
    );
    assert.equal(
      await varrer(c),
      0,
      "a varredura segue como antes (23 h: ainda não)",
    );

    // idempotente
    await c.query(sqlRb);
    assert.equal(await existeFuncao(c, FN_RPC), false);

    // aplicar -> desfazer -> aplicar volta ao estado idêntico
    await c.query(sqlM1);
    assert.deepEqual(
      await defs(c),
      def0,
      "reaplicar não voltou ao estado idêntico",
    );
    assert.deepEqual(await impressao(c, SO_AS_DUAS), f0);
  });
}
prova(
  "(5d) rollback: derruba só as duas funções, sem tocar a varredura nem pedidos; idempotente; aplicar-desfazer-aplicar idêntico",
  (c) => rollbackLimpo(c),
);

async function rollbackRecusa(c, sqlRb = lerRollbackM1()) {
  const casos = [
    [
      "auxiliar de OUTRA migration",
      (cc) =>
        cc.query(
          `CREATE OR REPLACE FUNCTION ${FN_AUX.replace(/\(.*\)$/, "")}(p_coupon_id uuid, p_status text, p_payment_status text, p_coupon_usage_returned boolean, p_expires_at timestamptz, p_cancelled_after_shipping boolean, p_returned_to_seller_at timestamptz, p_gateway_payment_id text, p_tentativas integer) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$ SELECT now() $$`,
        ),
      /corpo vivo de cupom__vaga_volta_em .* nao e o da 20261205000000/,
      FN_AUX,
    ],
    [
      "RPC de OUTRA migration",
      (cc) =>
        cc.query(
          "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{\"posterior\":true}'::jsonb $$",
        ),
      /corpo vivo de vaga_do_cupom_presa .* nao e o da 20261205000000/,
      FN_RPC,
    ],
    [
      "varredura diferente da 20260970 (uma migration posterior a usa)",
      varreduraComUmByteAMais,
      /varredura .* nao e a da 20260970000000/,
      FN_AUX,
    ],
  ];
  for (const [rotulo, preparar, esperado, deveFicar] of casos) {
    await emTx(c, async () => {
      await preparar(c);
      const antes = await defs(c);
      const r = await tentarSql(c, sqlRb);
      assert.equal(r.ok, false, `${rotulo}: o rollback passou`);
      assert.match(r.message, esperado, rotulo);
      assert.ok(
        await existeFuncao(c, deveFicar),
        `${rotulo}: derrubou mesmo assim`,
      );
      assert.deepEqual(
        await defs(c),
        antes,
        `${rotulo}: o rollback gravou algo`,
      );
    });
  }
}
prova(
  "(5e) rollback recusa corpo de OUTRA migration e varredura diferente da 20260970",
  (c) => rollbackRecusa(c),
);

// ------------------------------------------------------------------- mutantes

function bloco(sql, cabecalho) {
  const ini = sql.indexOf(cabecalho);
  assert.ok(ini >= 0, `bloco não achado: ${cabecalho}`);
  const abre = sql.indexOf("AS $function$", ini);
  const fim = sql.indexOf("$function$;", abre) + "$function$;".length;
  assert.ok(abre > ini && fim > abre);
  return sql.slice(ini, fim);
}

function cortarUma(texto, buscar, rotulo) {
  assert.equal(
    texto.split(buscar).length - 1,
    1,
    `mutante "${rotulo}": o trecho a trocar tem de aparecer UMA vez`,
  );
}

async function sobreviveu(c, rotulo, proveCom, restaurar) {
  let morreuCom = null;
  try {
    for (const p of proveCom) {
      try {
        await p();
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        if (e instanceof assert.AssertionError || e.code === "ERR_ASSERTION") {
          morreuCom = e.message.split("\n")[0].slice(0, 110);
          break;
        }
        throw e;
      }
    }
  } finally {
    await restaurar();
  }
  assert.notEqual(morreuCom, null, `MUTANTE SOBREVIVEU: ${rotulo}`);
  console.log(`      mutante morto: ${rotulo}  <-  ${morreuCom}`);
}

/** Troca um pedaço do bloco de uma função, recria no banco e exige que alguma prova falhe. */
async function mutarFuncao(c, rotulo, blocoOriginal, buscar, trocar, proveCom) {
  cortarUma(blocoOriginal, buscar, rotulo);
  const mutada = blocoOriginal.replace(buscar, () => trocar);
  assert.notEqual(mutada, blocoOriginal);
  await c.query(mutada);
  await sobreviveu(
    c,
    rotulo,
    proveCom.map((p) => () => p(c)),
    () => c.query(blocoOriginal),
  );
}

/** Troca um pedaço de um ARQUIVO (migration ou rollback) e exige que a prova, rodada com o texto mutado, falhe. */
async function mutarTexto(c, rotulo, texto, buscar, trocar, proveCom) {
  cortarUma(texto, buscar, rotulo);
  const mutado = texto.replace(buscar, () => trocar);
  assert.notEqual(mutado, texto);
  await sobreviveu(
    c,
    rotulo,
    proveCom.map((p) => () => p(c, mutado)),
    async () => {},
  );
}

prova(
  "(6) mutantes: tirar cada guarda deixa a prova certa vermelha",
  async (c) => {
    const sqlM1 = lerM1();
    const sqlRb = lerRollbackM1();
    const aux = bloco(
      sqlM1,
      "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    );
    const rpc = bloco(
      sqlM1,
      "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(",
    );
    const antes = await defs(c);

    // ---- o auxiliar: cada WHEN é uma guarda
    const L = (condicao) =>
      `        WHEN ${condicao} THEN 'infinity'::timestamptz\n`;
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do cupom",
      aux,
      L("p_coupon_id IS NULL"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do status cancelado",
      aux,
      L("p_status IS DISTINCT FROM 'cancelled'"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda de pagamento (pago e pago_apos_expirar voltam)",
      aux,
      L("p_payment_status IN ('pago', 'pago_apos_expirar')"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar deixa pago_apos_expirar fora da guarda",
      aux,
      "('pago', 'pago_apos_expirar')",
      "('pago')",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do já devolvido (devolve em dobro)",
      aux,
      L("p_coupon_usage_returned IS DISTINCT FROM false"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do cancelado depois do envio",
      aux,
      L(
        "(p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE",
      ),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem tratar expires_at vazio (pedido na entrega nunca volta)",
      aux,
      "        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz\n",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar com espera de 23 h",
      aux,
      "ELSE p_expires_at + interval '24 hours'",
      "ELSE p_expires_at + interval '23 hours'",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar com espera de 25 h",
      aux,
      "ELSE p_expires_at + interval '24 hours'",
      "ELSE p_expires_at + interval '25 hours'",
      [tabelaM1],
    );

    // ---- a RPC
    await mutarFuncao(
      c,
      "RPC sem filtrar o dono do pedido",
      rpc,
      "     WHERE o.user_id = (SELECT auth.uid())\n       AND o.coupon_id IN (",
      "     WHERE o.coupon_id IN (",
      [soODono, variosPedidos],
    );
    await mutarFuncao(
      c,
      "RPC sem filtrar o código do cupom",
      rpc,
      `o.coupon_id IN (
           SELECT c.id FROM public.coupons c
            WHERE UPPER(c.code) = UPPER(p_code) AND c.active = true
              AND c.usage_limit > 0 AND c.usage_count = c.usage_limit)`,
      "o.coupon_id IS NOT NULL",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC sem exigir cupom ativo",
      rpc,
      "UPPER(c.code) = UPPER(p_code) AND c.active = true",
      "UPPER(c.code) = UPPER(p_code)",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC compara o código sem UPPER",
      rpc,
      "UPPER(c.code) = UPPER(p_code)",
      "c.code = p_code",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC sem exigir limite (cupom ilimitado conta)",
      rpc,
      " AND c.usage_limit > 0 AND c.usage_count = c.usage_limit",
      "",
      [soQuandoDestrava],
    );
    await mutarFuncao(
      c,
      "RPC trata limite 0 como limite",
      rpc,
      "AND c.usage_limit > 0 AND",
      "AND",
      [soQuandoDestrava],
    );
    await mutarFuncao(
      c,
      "RPC aceita limite rebaixado (usos acima do limite)",
      rpc,
      "c.usage_count = c.usage_limit",
      "c.usage_count >= c.usage_limit",
      [soQuandoDestrava],
    );
    await mutarFuncao(
      c,
      "RPC aceita vaga ainda livre (usos abaixo do limite)",
      rpc,
      "c.usage_count = c.usage_limit",
      "c.usage_count <= c.usage_limit",
      [soQuandoDestrava],
    );
    await mutarFuncao(
      c,
      "RPC deixa NULL casar com NULL (convidado e chamada sem sessão)",
      rpc,
      "o.user_id = (SELECT auth.uid())",
      "o.user_id IS NOT DISTINCT FROM (SELECT auth.uid())",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC sem o GREATEST (pedido na entrega: -infinito)",
      rpc,
      "    v_volta := GREATEST(v_volta, now());\n",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC sem recusar o infinito (só pedidos que nunca voltam)",
      rpc,
      " OR v_volta = 'infinity'::timestamptz",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC sem os 15 min do ciclo",
      rpc,
      "/ 60.0)::integer + 15;",
      "/ 60.0)::integer;",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC arredonda para baixo",
      rpc,
      "ceil(extract(epoch",
      "floor(extract(epoch",
      [tabelaM1],
    );

    // ---- o pré-voo e o pós-voo
    const quebra = (msg) => [`RAISE EXCEPTION '${msg}`, `RAISE NOTICE '${msg}`];
    for (const [rotulo, msg] of [
      [
        "pré-voo sem conferir o corpo da varredura",
        "PREFLIGHT_20261205: corpo vivo de devolver_cupons_de_pedidos_mortos",
      ],
      [
        "pré-voo sem exigir UMA versão da varredura",
        "PREFLIGHT_20261205: esperava exatamente uma",
      ],
      ["pré-voo sem as dependências", "PREFLIGHT_20261205: falta a funcao"],
      ["pré-voo sem as tabelas", "PREFLIGHT_20261205: falta a tabela"],
      ["pré-voo sem as colunas", "PREFLIGHT_20261205: falta a coluna"],
      [
        "pré-voo sobrescreve o auxiliar alheio",
        "PREFLIGHT_20261205: public.cupom__vaga_volta_em ja existe com outro corpo",
      ],
      [
        "pré-voo sobrescreve a RPC alheia",
        "PREFLIGHT_20261205: public.vaga_do_cupom_presa ja existe com outro corpo",
      ],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlM1, a, b, [preVoo]);
    }
    {
      const [a, b] = quebra("POSVOO_20261205");
      await mutarTexto(
        c,
        "pós-voo sem recusar função com outro corpo",
        sqlM1,
        a,
        b,
        [posVoo],
      );
    }

    // ---- o rollback
    for (const [rotulo, msg] of [
      [
        "rollback derruba o auxiliar de outra migration",
        "corpo vivo de cupom__vaga_volta_em",
      ],
      [
        "rollback derruba a RPC de outra migration",
        "corpo vivo de vaga_do_cupom_presa",
      ],
      [
        "rollback derruba por baixo de uma varredura que usa o auxiliar",
        "a varredura devolver_cupons_de_pedidos_mortos",
      ],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlRb, a, b, [rollbackRecusa]);
    }

    assert.deepEqual(await defs(c), antes, "as funções não foram restauradas");
  },
);

// =============================================================== 20261206000000
// A vaga do cupom de um pedido NUNCA COBRADO volta em ~1 h (45 min depois de
// expires_at, mais o ciclo de 15 min). Daqui para baixo o banco está no estado
// das DUAS migrations.

prova(
  "(M2-a) aplica a 20261206 e confere o estado: auxiliar e varredura novos, ACL e RPC intactas",
  async (c) => {
    const antes = await estadoDoPar(c);
    const aclRpc = (
      await c.query(
        "SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN_RPC],
      )
    ).rows[0].acl;
    await commitar(c, lerM2());
    const v2 = await estadoDoPar(c);
    assert.ok(
      SHA_AUX_V2().includes(v2.aux.sha),
      "o auxiliar não saiu com o corpo da M2",
    );
    assert.ok(
      SHA_VARREDURA_V2().includes(v2.varredura.sha),
      "a varredura não saiu com o corpo da M2",
    );
    assert.equal(v2.aux.acl, antes.aux.acl, "ACL do auxiliar mudou");
    assert.equal(
      v2.varredura.acl,
      antes.varredura.acl,
      "ACL da varredura mudou",
    );
    assert.equal(
      (
        await c.query(
          "SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN_RPC],
        )
      ).rows[0].acl,
      aclRpc,
      "ACL da RPC mudou",
    );
    // a varredura segue fechada para os papéis de aplicação e agendada a cada 15 min
    const v = await c.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
            (SELECT count(*)::int FROM cron.job WHERE jobname = 'devolver-cupons-de-pedidos-mortos' AND schedule = '*/15 * * * *') AS job`,
      [FN_VARREDURA],
    );
    assert.deepEqual(v.rows[0], { anon: false, auth: false, job: 1 });
  },
);

async function tabelaM2(c) {
  await rodarTabela(c, CASOS_M2);
}
prova(
  "(7a) tabela de casos da 20261206: a pista rápida só vale para pedido NUNCA cobrado; o auxiliar e a RPC seguem a varredura caso a caso",
  tabelaM2,
);

/**
 * O cenário do crítico de desenho: o que impede o cupom de valer DUAS vezes na
 * pista rápida não é o relógio de 45 min, é que, com a vaga de cobrança vazia
 * (sem id de gateway gravado), nenhum pagamento se liga ao pedido.
 */
async function pagamentoFantasma(c) {
  await emTx(c, async () => {
    const { id, cupom, codigo } = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 46 * MIN,
    });
    assert.equal(await usos(c, cupom.id), 1, "a vaga está segurada");
    await varrer(c);
    assert.equal(await usos(c, cupom.id), 0, "a pista rápida devolveu a vaga");
    assert.equal((await pedido(c, id)).coupon_usage_returned, true);

    // o pagamento "fantasma": chega um id de cobrança para um pedido SEM vaga de cobrança
    for (const idPagamento of ["MP-FANTASMA-1", null]) {
      const r = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
        [id, idPagamento],
      );
      assert.equal(
        r.rows[0].r,
        "divergente",
        `confirmar_pagamento(${idPagamento})`,
      );
    }
    const p = await pedido(c, id);
    assert.equal(p.payment_status, "aguardando", "o pedido virou pago");
    assert.equal(p.status, "cancelled");
    assert.equal(p.gateway_payment_id, null);
    assert.equal(p.paid_at, null);
    assert.equal(await usos(c, cupom.id), 0, "o uso do cupom mudou");

    // o cupom de uso único vale para o próximo cliente e não estoura o limite
    const v = await validar(c, codigo);
    assert.equal(v.is_valid, true, "a vaga devolvida não valida");
    const outro = await criarPedido(
      c,
      "create_marketplace_order_v24",
      "outro",
      codigo,
    );
    assert.equal(await usos(c, cupom.id), 1);
    const r2 = await c.query(
      "SELECT public.confirmar_pagamento($1::uuid, 'MP-FANTASMA-2', 'pago') AS r",
      [id],
    );
    assert.equal(
      r2.rows[0].r,
      "divergente",
      "o pagamento fantasma achou pedido",
    );
    assert.equal(await usos(c, cupom.id), 1);
    assert.equal((await pedido(c, outro)).coupon_usage_returned, false);
  });
}
prova(
  "(7b) cenário do crítico: vaga devolvida na pista rápida e pagamento tardio é `divergente` (payment_status segue aguardando, usage_count não muda)",
  pagamentoFantasma,
);

async function duasVarreduras(c) {
  // Esta prova COMMITA um pedido elegível: um mutante que a derruba no meio
  // deixaria o pedido para a rodada seguinte contar dois. Zera antes.
  await varrer(c);
  const { id, cupom } = await emTx(
    c,
    () => montar(c, { kind: "v24-cancelado", offsetSec: 46 * MIN }),
    { commit: true },
  );
  const A = await novoCliente();
  const B = await novoCliente();
  try {
    await A.query("BEGIN");
    const ra = await A.query(`SELECT ${FN_VARREDURA} AS n`);
    assert.equal(Number(ra.rows[0].n), 1, "a 1a varredura devolve o pedido");
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '1500ms'");
    let rb;
    try {
      rb = await B.query(`SELECT ${FN_VARREDURA} AS n`);
    } catch (e) {
      assert.fail(
        `a 2a varredura ESPEROU a linha da 1a (sem SKIP LOCKED): ${e.message}`,
      );
    }
    assert.equal(
      Number(rb.rows[0].n),
      0,
      "a 2a varredura pulou a linha travada",
    );
    await A.query("COMMIT");
    const rb2 = await B.query(`SELECT ${FN_VARREDURA} AS n`);
    assert.equal(
      Number(rb2.rows[0].n),
      0,
      "depois do commit, nada a devolver de novo",
    );
    await B.query("COMMIT");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end();
    await B.end();
  }
  assert.equal(
    await usos(c, cupom.id),
    0,
    "devolvida exatamente UMA vez (nunca negativo)",
  );
  assert.equal((await pedido(c, id)).coupon_usage_returned, true);
}
prova(
  "(7c) duas varreduras em conexões reais (SKIP LOCKED): uma devolução só",
  duasVarreduras,
);

// --------------------------------------------------------------- migration M2

const alterarAuxiliarUmByte = async (c) => {
  const def = (await estadoDe(c, FN_AUX)).def;
  const i = def.lastIndexOf("$function$");
  await c.query(`${def.slice(0, i)} ${def.slice(i)}`);
};

async function reaplicarM2(c, sqlM2 = lerM2()) {
  const antes = await estadoDoPar(c);
  await emTx(c, async () => {
    await c.query(sqlM2);
    await c.query(sqlM2);
    assert.deepEqual(await estadoDoPar(c), antes);
  });
  assert.deepEqual(await estadoDoPar(c), antes);
}
prova(
  "(7d) reaplicar a 20261206 é idempotente (mesmo corpo, ACL e comentário)",
  (c) => reaplicarM2(c),
);

async function preVooM2(c, sqlM2 = lerM2()) {
  const quebras = [
    [
      "varredura com 1 byte a mais",
      varreduraComUmByteAMais,
      /PREFLIGHT_20261206: corpo vivo de devolver_cupons_de_pedidos_mortos/,
    ],
    [
      "duas versões da varredura",
      (cc) =>
        cc.query(
          "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
        ),
      /PREFLIGHT_20261206: esperava exatamente uma/,
    ],
    [
      "auxiliar com 1 byte a mais",
      alterarAuxiliarUmByte,
      /PREFLIGHT_20261206: corpo vivo de cupom__vaga_volta_em/,
    ],
    [
      "20261205 não aplicada (sem auxiliar nem RPC)",
      derrubarAsDuas,
      /PREFLIGHT_20261206: falta a funcao public\.cupom__vaga_volta_em/,
    ],
    [
      "RPC ausente",
      (cc) => cc.query(`DROP FUNCTION ${FN_RPC}`),
      /PREFLIGHT_20261206: falta a funcao public\.vaga_do_cupom_presa/,
    ],
    [
      "devolver_uso_cupom ausente",
      (cc) =>
        cc.query(
          "ALTER FUNCTION public.devolver_uso_cupom(uuid) RENAME TO devolver_uso_cupom_x",
        ),
      /PREFLIGHT_20261206: falta a funcao public\.devolver_uso_cupom/,
    ],
    [
      "coluna gateway_payment_id ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN gateway_payment_id TO gpi",
        ),
      /PREFLIGHT_20261206: falta a coluna public\.marketplace_orders\.gateway_payment_id/,
    ],
    [
      "coluna tentativas_de_pagamento ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO tdp",
        ),
      /PREFLIGHT_20261206: falta a coluna public\.marketplace_orders\.tentativas_de_pagamento/,
    ],
  ];
  for (const [rotulo, quebra, esperado] of quebras) {
    await emTx(c, async () => {
      await quebra(c);
      const antes = [await impressao(c, []), await estadoDoPar(c)];
      const r = await tentarSql(c, sqlM2);
      assert.equal(r.ok, false, `${rotulo}: a migration passou`);
      assert.match(r.message, esperado, rotulo);
      assert.deepEqual(
        [await impressao(c, []), await estadoDoPar(c)],
        antes,
        `${rotulo}: gravou algo`,
      );
    });
  }
}
prova(
  "(7e) pré-voo da 20261206 recusa SEM gravar, com o nome do que falta ou diverge",
  (c) => preVooM2(c),
);

async function posVooM2(c, sqlM2 = lerM2()) {
  const marca = "interval '45 minutes'";
  cortarUma(sqlM2, marca, "pós-voo da M2: corpo do auxiliar alterado");
  const alterada = sqlM2.replace(
    marca,
    () => `${marca} + interval '0 seconds'`,
  );
  await emTx(c, async () => {
    const antes = [await impressao(c, []), await estadoDoPar(c)];
    const r = await tentarSql(c, alterada);
    assert.equal(r.ok, false, "a migration com o auxiliar alterado concluiu");
    assert.match(r.message, /POSVOO_20261206/);
    assert.deepEqual(
      [await impressao(c, []), await estadoDoPar(c)],
      antes,
      "algo ficou",
    );
  });
}
prova(
  "(7f) pós-voo da 20261206: auxiliar que sai com outro corpo derruba a migration inteira",
  (c) => posVooM2(c),
);

async function rollbackM2Recusa(c, sqlRb = lerRollbackM2()) {
  const casos = [
    [
      "auxiliar de OUTRA migration",
      alterarAuxiliarUmByte,
      /corpo vivo de cupom__vaga_volta_em .* nao e o da 20261206000000/,
    ],
    [
      "varredura de OUTRA migration",
      varreduraComUmByteAMais,
      /a varredura devolver_cupons_de_pedidos_mortos .* nao e a da 20261206000000/,
    ],
  ];
  for (const [rotulo, preparar, esperado] of casos) {
    await emTx(c, async () => {
      await preparar(c);
      const antes = await estadoDoPar(c);
      const r = await tentarSql(c, sqlRb);
      assert.equal(r.ok, false, `${rotulo}: o rollback passou`);
      assert.match(r.message, esperado, rotulo);
      assert.deepEqual(
        await estadoDoPar(c),
        antes,
        `${rotulo}: o rollback gravou algo`,
      );
    });
  }
}
prova(
  "(7g) rollback da 20261206 recusa corpo de OUTRA migration e não derruba nada",
  (c) => rollbackM2Recusa(c),
);

// ------------------------------------------------------------ mutantes da M2

prova(
  "(8) mutantes da 20261206: tirar cada guarda deixa a prova certa vermelha",
  async (c) => {
    const sqlM2 = lerM2();
    const sqlRb = lerRollbackM2();
    const aux = bloco(
      sqlM2,
      "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    );
    const antes = await estadoDoPar(c);

    const varredura = (() => {
      const ini = sqlM2.indexOf(CAB_VARREDURA);
      const fim = sqlM2.indexOf(
        TAG_VARREDURA,
        sqlM2.indexOf(`AS ${TAG_VARREDURA}`, ini) + 30,
      );
      assert.ok(ini > 0 && fim > ini);
      return sqlM2.slice(ini, fim + TAG_VARREDURA.length + 1);
    })();

    // ---- o auxiliar: as guardas herdadas da M1 e a pista rápida
    const L = (condicao) =>
      `        WHEN ${condicao} THEN 'infinity'::timestamptz\n`;
    for (const [rotulo, condicao] of [
      ["sem a guarda do cupom", "p_coupon_id IS NULL"],
      [
        "sem a guarda do status cancelado",
        "p_status IS DISTINCT FROM 'cancelled'",
      ],
      [
        "sem a guarda de pagamento",
        "p_payment_status IN ('pago', 'pago_apos_expirar')",
      ],
      [
        "sem a guarda do já devolvido",
        "p_coupon_usage_returned IS DISTINCT FROM false",
      ],
      [
        "sem a guarda do cancelado depois do envio",
        "(p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE",
      ],
    ]) {
      await mutarFuncao(c, `auxiliar v2 ${rotulo}`, aux, L(condicao), "", [
        tabelaM2,
      ]);
    }
    await mutarFuncao(
      c,
      "auxiliar v2 sem tratar expires_at vazio",
      aux,
      "        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz\n",
      "",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "pista rápida sem exigir a vaga de cobrança vazia (id de gateway)",
      aux,
      "WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN",
      "WHEN p_tentativas = 0 THEN",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "pista rápida sem exigir ZERO tentativas (vaga já esvaziada uma vez)",
      aux,
      "WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN",
      "WHEN p_gateway_payment_id IS NULL THEN",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "pista rápida com espera de 30 min",
      aux,
      "interval '45 minutes'",
      "interval '30 minutes'",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "pista rápida com espera de 60 min",
      aux,
      "interval '45 minutes'",
      "interval '60 minutes'",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "auxiliar v2 com espera de 23 h nas outras",
      aux,
      "ELSE p_expires_at + interval '24 hours'",
      "ELSE p_expires_at + interval '23 hours'",
      [tabelaM2],
    );

    // ---- a varredura reescrita
    const PRED = `          AND public.cupom__vaga_volta_em(
                coupon_id, status, payment_status, coupon_usage_returned, expires_at,
                cancelled_after_shipping, returned_to_seller_at,
                gateway_payment_id, tentativas_de_pagamento) < now()
`;
    await mutarFuncao(
      c,
      "varredura sem consultar o auxiliar (devolve todo cancelado com cupom, até pago)",
      varredura,
      PRED,
      "",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "varredura com folga de 1 h a mais no relógio",
      varredura,
      "gateway_payment_id, tentativas_de_pagamento) < now()",
      "gateway_payment_id, tentativas_de_pagamento) < now() + interval '1 hour'",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "varredura sem SKIP LOCKED (espera a linha travada)",
      varredura,
      "        FOR UPDATE SKIP LOCKED\n    LOOP",
      "        FOR UPDATE\n    LOOP",
      [duasVarreduras],
    );
    await mutarFuncao(
      c,
      "varredura sem trava nenhuma (dois ciclos devolvem o mesmo pedido)",
      varredura,
      "        FOR UPDATE SKIP LOCKED\n    LOOP",
      "    LOOP",
      [duasVarreduras],
    );
    await mutarFuncao(
      c,
      "varredura sem devolver o uso do cupom",
      varredura,
      "        PERFORM public.devolver_uso_cupom(v_pedido.id);\n",
      "",
      [tabelaM2],
    );
    await mutarFuncao(
      c,
      "varredura sem registrar o fato (devolve em dobro)",
      varredura,
      "           SET coupon_usage_returned = TRUE\n",
      "           SET coupon_usage_returned = coupon_usage_returned\n",
      [tabelaM2],
    );

    // ---- pré-voo, pós-voo e rollback
    const quebra = (msg) => [`RAISE EXCEPTION '${msg}`, `RAISE NOTICE '${msg}`];
    for (const [rotulo, msg] of [
      [
        "pré-voo da M2 sem exigir UMA varredura",
        "PREFLIGHT_20261206: esperava exatamente uma",
      ],
      [
        "pré-voo da M2 sem conferir o corpo da varredura",
        "PREFLIGHT_20261206: corpo vivo de devolver_cupons_de_pedidos_mortos",
      ],
      [
        "pré-voo da M2 sem conferir o corpo do auxiliar",
        "PREFLIGHT_20261206: corpo vivo de cupom__vaga_volta_em",
      ],
      [
        "pré-voo da M2 sem exigir a 20261205 e as dependências",
        "PREFLIGHT_20261206: falta a funcao",
      ],
      ["pré-voo da M2 sem as colunas", "PREFLIGHT_20261206: falta a coluna"],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlM2, a, b, [preVooM2]);
    }
    {
      const [a, b] = quebra("POSVOO_20261206");
      await mutarTexto(
        c,
        "pós-voo da M2 sem recusar corpo diferente",
        sqlM2,
        a,
        b,
        [posVooM2],
      );
    }
    for (const [rotulo, msg] of [
      [
        "rollback da M2 derruba auxiliar de outra migration",
        "corpo vivo de cupom__vaga_volta_em",
      ],
      [
        "rollback da M2 derruba varredura de outra migration",
        "a varredura devolver_cupons_de_pedidos_mortos",
      ],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlRb, a, b, [rollbackM2Recusa]);
    }

    assert.deepEqual(await estadoDoPar(c), antes, "o par não foi restaurado");
  },
);

// -------------------------------------------------------------------- runner

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resultados = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      const t0 = Date.now();
      try {
        await corpo(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        resultados.push({ nome, ok: false, erro: e.stack || String(e) });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    await c.end();
  }
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${resultados.length - falhas.length}/${resultados.length} provas do cupom preso verdes.`;
  console.log(`\n[cupom-preso] ${resumo}`);
  anexarAoSummary(
    "Prova viva: cupom preso (20261205000000)",
    falhas.length
      ? `**${falhas.length} falha(s)**:\n\n${falhas.map((f) => `- ${f.nome}`).join("\n")}`
      : `**${resumo}**`,
  );
  if (falhas.length) process.exit(1);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
