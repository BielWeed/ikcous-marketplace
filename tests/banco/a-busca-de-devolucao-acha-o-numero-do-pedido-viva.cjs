"use strict";

/**
 * Prova VIVA da migration 20261395000000 (a busca de devolucao acha o numero do pedido: `admin_devolucoes_listar` ganha um ramo no
 * filtro: igualdade nos 6 ULTIMOS caracteres do id, sem caixa e sem o `#` da frente), num Postgres EFEMERO local, sem rede, com os
 * papeis de verdade. Esqueleto de migration em `prova-de-troca-de-corpo.cjs`.
 *
 *  ANTES      controle: o numero que o painel mostra ("3884BE", "#3884BE") nao acha a devolucao (o defeito); o comeco do id acha.
 *  DEPOIS     o numero acha (maiuscula, minuscula, com `#`, com espacos); pedaco do numero e curinga NAO acham; o comeco do id, o
 *             protocolo e o nome do cliente seguem achando; total e contagem por status; filtro de status e paginacao valem junto;
 *             so o admin ATUAL chama (cliente comum 42501, anon sem EXECUTE).
 *  DIFEREN.   para as buscas que nao usam o ramo novo, o JSON de depois e' IDENTICO ao de antes.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA.
 *  MIGRATION  ver o esqueleto.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-busca-de-devolucao-acha-o-numero-do-pedido-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de casos e de cenarios), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ = "20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql";
const FN = "admin_devolucoes_listar";
const SIG = "public.admin_devolucoes_listar(text,text,integer,integer)";
const ORDEM_ANTIGA = "            OR d.order_id::text ILIKE v_busca || '%')\n";
const RAMO =
  "            OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))))\n";

/** Desfaz a troca (escrita a parte, do zero): tira o comentario e o ramo novo e devolve o fecha-parenteses da linha antiga. */
function inverso(corpo) {
  const ini = corpo.indexOf(
    "            OR d.order_id::text ILIKE v_busca || '%'\n            -- 20261395000000:",
  );
  assert.ok(ini >= 0, "a troca nao foi achada no corpo novo");
  const fim = corpo.indexOf(RAMO, ini) + RAMO.length;
  assert.ok(fim > ini, "o ramo novo nao foi achado");
  return corpo.slice(0, ini) + ORDEM_ANTIGA + corpo.slice(fim);
}

const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: {
    arquivo: "20261199000000_portas_do_painel_exigem_admin_atual.sql",
  },
  fn: FN,
  delim: "$$",
  sig: SIG,
  hAntes: "5a632e0a239104598dcdc4eb323c09b1",
  hDepois: "989a6c6151eb35efc7c834c6cce20f01",
  volatil: "s",
  aclDeSempre: [
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "108a-conferir-a-busca-de-devolucao-acha-o-numero-do-pedido-aplicado",
    b: "108b-antes-a-busca-de-devolucao-acha-o-numero-do-pedido-base-vigente",
    rotulos: [
      "controle: funcoes de public visiveis a este papel",
      "admin_devolucoes_listar: corpo exato (md5)",
      "admin_devolucoes_listar: o corpo traz a busca pelo numero do pedido (uma vez)",
      "admin_devolucoes_listar: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, STABLE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    fixos: [
      "controle: funcoes de public visiveis a este papel",
      "admin_devolucoes_listar: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, STABLE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    attr: "admin_devolucoes_listar: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, STABLE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
});
// Sabotagem da marca: o comentario da troca repetido (o corpo muda e a marca aparece 2x).
{
  const dup = T.NOVA.corpo.replace(
    "            -- 20261395000000: o numero que o painel mostra",
    () =>
      "            -- 20261395000000: o numero que o painel mostra (copia)\n            -- 20261395000000: o numero que o painel mostra",
  );
  assert.notEqual(dup, T.NOVA.corpo);
  ESTRAGOS.push([
    T.decl(T.NOVA, dup),
    "admin_devolucoes_listar: o corpo traz a busca pelo numero do pedido (uma vez)",
  ]);
}

// ---------------------------------------------------------------------------
// Semente: 1 admin, 1 cliente, 5 pedidos entregues e pagos, 5 devolucoes
// ---------------------------------------------------------------------------
const ADMIN = "de395000-0000-4000-8000-0000000000a1";
const CLIENTE = "de395000-0000-4000-8000-0000000000c1";
// O numero que a lojista VE e' o fim do id em maiuscula.
const PED = {
  alfa: "c0395000-0000-4000-8000-0000003884be", // numero 3884BE
  beta: "c0395000-0000-4000-8000-00000000a1b2", // numero 00A1B2
  gama: "5555aa00-0000-4000-8000-000000000999", // o COMECO do id e' 5555aa00; numero 000999
  delta: "c0395000-0000-4000-8000-0000009f3884", // numero 9F3884
  eco: "c0395001-0000-4000-8000-0000003884be", // MESMO numero que o alfa (fim igual)
};
const DEV = {
  alfa: "d0395000-0000-4000-8000-000000000001",
  beta: "d0395000-0000-4000-8000-000000000002",
  gama: "d0395000-0000-4000-8000-000000000003",
  delta: "d0395000-0000-4000-8000-000000000004",
  eco: "d0395000-0000-4000-8000-000000000005",
};
const STATUS = {
  alfa: "recebida",
  beta: "solicitada",
  gama: "recebida",
  delta: "concluida",
  eco: "solicitada",
};
const NOME = {
  alfa: "Cliente Alfa",
  beta: "Cliente Beta",
  gama: "Cliente Gama",
  delta: "Cliente Delta",
  eco: "Cliente Eco",
};

async function semear() {
  const C = T.C;
  await C.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'admin395@fixture.test','{"role":"admin"}'),($2,'cliente395@fixture.test','{}')`,
    [ADMIN, CLIENTE],
  );
  await C.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')`,
    [ADMIN, CLIENTE],
  );
  let n = 0;
  for (const k of Object.keys(PED)) {
    n++;
    await C.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,
          payment_method,payment_status,paid_at,pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,$3,'{}',100,100,0,'delivered','online','online','pago',now(),now(),$4,0)`,
      [PED[k], CLIENTE, NOME[k], `ORD395-${n}`],
    );
    await C.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,metodo_retorno,
          status,valor_itens,valor_frete_ida,prazo_ate,politica,created_at)
       VALUES ($1,$2,$3,$4,'arrependimento','outro','reembolso','nacional','envio_proprio',
          $5,100,0,current_date+7,'{}', timestamptz '2026-10-01 12:00:00+00' - $6 * interval '1 minute')`,
      [DEV[k], `DEV395-${n}`, PED[k], CLIENTE, STATUS[k], n],
    );
  }
}

/** Chama a funcao como o admin ATUAL (papel authenticated + sessao de admin). */
async function listar(
  busca,
  { status = null, limite = 50, offset = 0, papel = "admin" } = {},
) {
  const C = T.C;
  const quem = papel === "admin" ? ADMIN : CLIENTE;
  const claims =
    papel === "admin"
      ? { role: "authenticated", app_metadata: { role: "admin" } }
      : { role: "authenticated" };
  await C.query("SAVEPOINT listar");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [quem, JSON.stringify(claims)],
    );
    await C.query("SET LOCAL ROLE authenticated");
    const r = (
      await C.query("SELECT public.admin_devolucoes_listar($1,$2,$3,$4) AS r", [
        status,
        busca,
        limite,
        offset,
      ])
    ).rows[0].r;
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT listar");
    return { r, ids: r.itens.map((i) => i.id) };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT listar");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}
const so = (x, ...chaves) =>
  JSON.stringify(x.ids ? [...x.ids].sort() : x.erro) ===
  JSON.stringify(chaves.map((k) => DEV[k]).sort());

const CHECKS = {
  /** O numero que o painel mostra acha a devolucao, de qualquer jeito de digitar. */
  async numero() {
    const f = [];
    // alfa e eco tem o MESMO numero (os 6 ultimos): os dois aparecem, e so eles.
    for (const termo of [
      "3884BE",
      "3884be",
      "3884Be",
      "#3884BE",
      "#3884be",
      " #3884BE ",
      "##3884BE",
      "# 3884BE",
    ]) {
      const x = await listar(termo);
      if (!so(x, "alfa", "eco"))
        f.push(
          `numero(${JSON.stringify(termo)}): ${JSON.stringify(x.ids ?? x.erro)} (esperado alfa e eco)`,
        );
      else if (x.r.total !== 2)
        f.push(
          `numero(${JSON.stringify(termo)}): total ${x.r.total} (esperado 2)`,
        );
    }
    const b = await listar("00A1B2");
    if (!so(b, "beta"))
      f.push(`numero(00A1B2): ${JSON.stringify(b.ids ?? b.erro)}`);
    const d = await listar("#9f3884");
    if (!so(d, "delta"))
      f.push(`numero(#9f3884): ${JSON.stringify(d.ids ?? d.erro)}`);
    return f;
  },
  /**
   * Pedaco do numero, numero maior, curinga e '#' sozinho NAO acham nada pelo ramo novo (a busca nao fica ampla). O que sobra e' so o
   * que os ramos de ANTES ja achavam (comeco do id, protocolo, nome): nenhum destes termos casa com eles na semente.
   */
  async estreita() {
    const f = [];
    const casos = [
      ["3884B", []],
      ["884BE", []],
      ["84BE", []],
      ["3884BEE", []],
      ["03884BE", []],
      ["38_4BE", []],
      ["3884B%", []],
      ["#", []],
      ["# ", []],
      ["##", []],
    ];
    for (const [termo, esperado] of casos) {
      const x = await listar(termo);
      if (!so(x, ...esperado))
        f.push(
          `estreita(${JSON.stringify(termo)}): ${JSON.stringify(x.ids ?? x.erro)} (esperado ${JSON.stringify(esperado)})`,
        );
    }
    return f;
  },
  /** O que ja achava continua achando: comeco do id, protocolo, nome do cliente, sem busca. */
  async comoSempre() {
    const f = [];
    const casos = [
      ["5555aa00", ["gama"]], // comeco do id (ramo antigo)
      ["c0395000", ["alfa", "beta", "delta"]], // comeco do id compartilhado
      ["DEV395-2", ["beta"]], // protocolo
      ["dev395", ["alfa", "beta", "gama", "delta", "eco"]],
      ["Cliente Delta", ["delta"]], // nome
      ["delta", ["delta"]],
      [null, ["alfa", "beta", "gama", "delta", "eco"]],
      ["", ["alfa", "beta", "gama", "delta", "eco"]],
      ["   ", ["alfa", "beta", "gama", "delta", "eco"]],
      ["inexistente", []],
    ];
    for (const [termo, esperado] of casos) {
      const x = await listar(termo);
      if (!so(x, ...esperado))
        f.push(
          `comoSempre(${JSON.stringify(termo)}): ${JSON.stringify(x.ids ?? x.erro)}`,
        );
    }
    return f;
  },
  /** O numero vale junto com o filtro de status, a paginacao e a contagem por status. */
  async junto() {
    const f = [];
    const a = await listar("3884BE", { status: "recebida" });
    if (!so(a, "alfa"))
      f.push(`junto(status recebida): ${JSON.stringify(a.ids ?? a.erro)}`);
    const b = await listar("3884BE", { status: "concluida" });
    if (!so(b))
      f.push(`junto(status concluida): ${JSON.stringify(b.ids ?? b.erro)}`);
    // Paginacao: 2 achados (alfa, eco), 1 por pagina, mais recente primeiro (alfa tem created_at mais novo que eco).
    const p0 = await listar("#3884BE", { limite: 1, offset: 0 });
    const p1 = await listar("#3884BE", { limite: 1, offset: 1 });
    if (!p0.ids || !p1.ids || p0.r.total !== 2 || p1.r.total !== 2)
      f.push(
        `junto(paginas): total ${p0.r?.total}/${p1.r?.total} (esperado 2/2)`,
      );
    else if (
      JSON.stringify([...p0.ids, ...p1.ids]) !==
      JSON.stringify([DEV.alfa, DEV.eco])
    )
      f.push(`junto(paginas): ordem ${JSON.stringify([...p0.ids, ...p1.ids])}`);
    // A contagem por status e' a da tabela inteira (nao do filtro), como sempre.
    const c = await listar("3884BE");
    const esperadoContagem = { solicitada: 2, recebida: 2, concluida: 1 };
    for (const [s, n] of Object.entries(esperadoContagem))
      if (c.r.contagem[s] !== n)
        f.push(`junto(contagem ${s}): ${c.r.contagem[s]} (esperado ${n})`);
    return f;
  },
  /** A porta: so o admin atual. */
  async porta() {
    const f = [];
    const x = await listar("3884BE", { papel: "cliente" });
    if (x.codigo !== "42501")
      f.push(`porta(cliente comum): ${x.codigo ?? "passou"} (esperado 42501)`);
    // anon nao tem EXECUTE.
    await T.C.query("SAVEPOINT anon");
    let anon;
    try {
      await T.C.query("SET LOCAL ROLE anon");
      await T.C.query(
        "SELECT public.admin_devolucoes_listar(NULL,'3884BE',50,0)",
      );
      anon = "passou";
    } catch (e) {
      anon = e.code;
    }
    await T.C.query("ROLLBACK TO SAVEPOINT anon");
    await T.C.query("RESET ROLE");
    if (anon !== "42501") f.push(`porta(anon): ${anon} (esperado 42501)`);
    return f;
  },
};

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------
T.prova(
  "ANTES: com o corpo antigo (o da 20261199, byte a byte) o numero que o painel mostra (3884BE, #3884BE) NAO acha a devolucao (o defeito); o comeco do id acha",
  () =>
    T.emTransacao(async () => {
      assert.equal(await T.prosrcVivo(), T.ANTIGA.corpo);
      await semear();
      for (const termo of ["3884BE", "3884be", "#3884BE"]) {
        const x = await listar(termo);
        assert.deepEqual(x.ids, [], `${termo}: o corpo antigo ja achava?`);
      }
      assert.ok(so(await listar("5555aa00"), "gama"), "o comeco do id acha");
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------
T.prova(
  "DEPOIS: o numero acha (maiuscula, minuscula, com #, com espacos; dois pedidos com o mesmo fim aparecem juntos); pedaco, 7 caracteres e curinga NAO acham; o comeco do id, o protocolo e o nome seguem; o filtro de status, a paginacao e a contagem valem junto; so o admin atual chama",
  async () => {
    const falhas = await T.todasAsVerificacoes(CHECKS, T.instalarNova, semear);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

T.prova(
  "DIFERENCIAL: para as buscas que nao usam o ramo novo (comeco do id, protocolo, nome, vazia, nula, inexistente, status), o JSON de depois e' IDENTICO ao de antes (itens, total e contagem)",
  async () => {
    const buscas = [
      ["5555aa00", {}],
      ["c0395000", {}],
      ["DEV395-2", {}],
      ["dev395", {}],
      ["Cliente Delta", {}],
      ["delta", {}],
      [null, {}],
      ["", {}],
      ["inexistente", {}],
      [null, { status: "solicitada" }],
      ["dev395", { status: "recebida" }],
      ["dev395", { limite: 2, offset: 1 }],
      ["dev395", { limite: 500, offset: -5 }],
    ];
    const todas = async (estado) =>
      T.emTransacao(
        async () => {
          await semear();
          const m = [];
          for (const [termo, opc] of buscas)
            m.push((await listar(termo, opc)).r);
          return m;
        },
        { estado },
      );
    const antes = await todas("antes");
    const depois = await todas("depois");
    assert.deepEqual(
      depois,
      antes,
      "o JSON mudou para uma busca sem o ramo novo",
    );
    assert.equal(depois[3].total, 5);
  },
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------
const trocar = (de, para) => (corpo) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `a ancora do mutante nao e unica: ${de}`,
  );
  return corpo.replace(de, () => para);
};
const EXPR =
  "upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#')))";
T.mutantes(
  {
    "sem o ramo novo (o corpo antigo)": {
      aplica: (corpo) => inverso(corpo),
      vermelho: ["numero("],
    },
    "o COMECO do id em vez do fim (left)": {
      aplica: trocar(
        EXPR,
        "upper(left(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#')))",
      ),
      vermelho: ["numero("],
    },
    "7 caracteres do fim em vez de 6": {
      aplica: trocar(
        EXPR,
        "upper(right(d.order_id::text, 7)) = upper(btrim(ltrim(v_busca, '#')))",
      ),
      vermelho: ["numero("],
    },
    "com caixa (sem o upper dos dois lados)": {
      aplica: trocar(
        EXPR,
        "right(d.order_id::text, 6) = btrim(ltrim(v_busca, '#'))",
      ),
      vermelho: ['numero("3884BE")', 'numero("#3884BE")'],
    },
    "sem tirar o # da frente": {
      aplica: trocar(
        EXPR,
        "upper(right(d.order_id::text, 6)) = upper(btrim(v_busca))",
      ),
      vermelho: ['numero("#3884BE")', 'numero("##3884BE")'],
    },
    "busca por pedaco (ILIKE com % dos dois lados): fica ampla demais": {
      aplica: trocar(
        EXPR,
        "right(d.order_id::text, 6) ILIKE '%' || ltrim(v_busca, '#') || '%'",
      ),
      vermelho: ["estreita("],
    },
    "ILIKE do numero (o _ e o % viram curinga)": {
      aplica: trocar(
        EXPR,
        "right(d.order_id::text, 6) ILIKE ltrim(v_busca, '#')",
      ),
      vermelho: ['estreita("38_4BE")', 'estreita("3884B%")'],
    },
    "o ramo novo substitui o do comeco do id (perde quem colava o id)": {
      aplica: trocar(
        "            OR d.order_id::text ILIKE v_busca || '%'\n",
        "",
      ),
      vermelho: ['comoSempre("5555aa00")'],
    },
    "a busca ignora o filtro de status (OR solto fora do parenteses)": {
      aplica: trocar(
        "WHERE (p_status IS NULL OR d.status = p_status)\n       AND (v_busca IS NULL",
        "WHERE (p_status IS NULL OR d.status = p_status)\n       OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(coalesce(v_busca, '-'), '#')))\n       AND (v_busca IS NULL",
      ),
      vermelho: ["junto(status"],
    },
  },
  CHECKS,
  semear,
);

T.main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
