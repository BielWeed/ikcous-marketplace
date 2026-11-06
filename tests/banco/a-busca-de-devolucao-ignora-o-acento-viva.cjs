"use strict";

/**
 * Prova VIVA da migration 20261399910000 (a busca de devolucao ignora o acento: `admin_devolucoes_listar` compara o protocolo e o nome do
 * cliente com `public.f_unaccent` nos DOIS lados), num Postgres EFEMERO local, sem rede, com os papeis de verdade. Esqueleto de migration em
 * `prova-de-troca-de-corpo.cjs`.
 *
 *  ANTES      controle: "jose", "antonio" e "conceicao" (sem acento) nao achavam "José Antônio" e "Conceição Silva" (com acento); "José" com
 *             acento achava; o protocolo com acento so era achado digitado com acento (e o sem acento, so digitado sem).
 *  DEPOIS     sem acento acha com acento e com acento acha sem acento (nome e protocolo); o numero do pedido, o comeco do id e o nome sem acento
 *             seguem achando; total e contagem por status; filtro de status e paginacao valem junto; so o admin ATUAL chama (cliente comum 42501,
 *             anon sem EXECUTE).
 *  DIFEREN.   para as buscas que nao dependem de acento, o JSON de depois e' IDENTICO ao de antes.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA.
 *  MIGRATION  ver o esqueleto (pre-voo inclui public.f_unaccent).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-busca-de-devolucao-ignora-o-acento-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de casos e de cenarios), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ = "20261399910000_a_busca_de_devolucao_ignora_o_acento.sql";
const FN = "admin_devolucoes_listar";
const SIG = "public.admin_devolucoes_listar(text,text,integer,integer)";
const RAMO_PROTOCOLO =
  "            OR public.f_unaccent(d.protocolo) ILIKE public.f_unaccent('%' || v_busca || '%')\n";
const RAMO_NOME =
  "            OR public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_busca || '%')\n";
const PROTOCOLO_VELHO =
  "            OR d.protocolo ILIKE '%' || v_busca || '%'\n";
const NOME_VELHO =
  "            OR o.customer_name ILIKE '%' || v_busca || '%'\n";

/** Desfaz a troca (escrita a parte, do zero): tira o comentario e devolve os dois ramos antigos. */
function inverso(corpo) {
  const ini = corpo.indexOf(
    "            -- 20261399910000: protocolo e nome do cliente ignoram o acento",
  );
  assert.ok(ini >= 0, "a troca nao foi achada no corpo novo");
  const fimNome = corpo.indexOf(RAMO_NOME, ini) + RAMO_NOME.length;
  assert.ok(fimNome > ini, "o ramo do nome nao foi achado");
  assert.ok(
    corpo.slice(ini, fimNome).includes(RAMO_PROTOCOLO),
    "o ramo do protocolo nao foi achado antes do do nome",
  );
  return (
    corpo.slice(0, ini) + PROTOCOLO_VELHO + NOME_VELHO + corpo.slice(fimNome)
  );
}

const ROTULO_ATRIBUTOS =
  "admin_devolucoes_listar: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, STABLE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)";
const ROTULO_MARCA =
  "admin_devolucoes_listar: o corpo traz a busca sem acento do protocolo e do nome (uma vez)";
const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: {
    arquivo: "20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql",
  },
  fn: FN,
  delim: "$$",
  sig: SIG,
  hAntes: "989a6c6151eb35efc7c834c6cce20f01",
  hDepois: "82d381944fb7b3337e7272a258b65260",
  volatil: "s",
  aclDeSempre: [
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "126a-conferir-a-busca-de-devolucao-ignora-o-acento-aplicado",
    b: "126b-antes-a-busca-de-devolucao-ignora-o-acento-base-vigente",
    rotulos: [
      "controle: funcoes de public visiveis a este papel",
      "admin_devolucoes_listar: corpo exato (md5)",
      ROTULO_MARCA,
      ROTULO_ATRIBUTOS,
    ],
    fixos: [
      "controle: funcoes de public visiveis a este papel",
      ROTULO_ATRIBUTOS,
    ],
    attr: ROTULO_ATRIBUTOS,
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
});
// Sabotagem da marca: o comentario da troca repetido (o corpo muda e a marca aparece 2x).
{
  const dup = T.NOVA.corpo.replace(
    "            -- 20261399910000: protocolo e nome do cliente ignoram o acento",
    () =>
      "            -- 20261399910000: protocolo e nome do cliente ignoram o acento (copia)\n            -- 20261399910000: protocolo e nome do cliente ignoram o acento",
  );
  assert.notEqual(dup, T.NOVA.corpo);
  ESTRAGOS.push([T.decl(T.NOVA, dup), ROTULO_MARCA]);
}

// ---------------------------------------------------------------------------
// Semente: 1 admin, 1 cliente, 6 pedidos entregues e pagos, 6 devolucoes (nomes COM acento e SEM acento)
// ---------------------------------------------------------------------------
const ADMIN = "de399910-0000-4000-8000-0000000000a1";
const CLIENTE = "de399910-0000-4000-8000-0000000000c1";
const PED = {
  jose: "c0399910-0000-4000-8000-000000000001",
  conceicao: "c0399910-0000-4000-8000-000000000002",
  maria: "5555aa00-0000-4000-8000-000000000003", // o COMECO do id e' 5555aa00
  protAcento: "c0399910-0000-4000-8000-000000000004",
  protSem: "c0399910-0000-4000-8000-000000000005",
  numero: "c0399910-0000-4000-8000-0000003884be", // numero 3884BE
};
const DEV = {
  jose: "d0399910-0000-4000-8000-000000000001",
  conceicao: "d0399910-0000-4000-8000-000000000002",
  maria: "d0399910-0000-4000-8000-000000000003",
  protAcento: "d0399910-0000-4000-8000-000000000004",
  protSem: "d0399910-0000-4000-8000-000000000005",
  numero: "d0399910-0000-4000-8000-000000000006",
};
const STATUS = {
  jose: "solicitada",
  conceicao: "recebida",
  maria: "solicitada",
  protAcento: "concluida",
  protSem: "solicitada",
  numero: "recebida",
};
const NOME = {
  jose: "José Antônio",
  conceicao: "Conceição Silva",
  maria: "Maria da Penha",
  protAcento: "Cliente Neutro",
  protSem: "Outro Neutro",
  numero: "Cliente Do Numero",
};
const PROTOCOLO = {
  jose: "DV3999-1",
  conceicao: "DV3999-2",
  maria: "DV3999-3",
  protAcento: "DVÃO3999-4",
  protSem: "DVAO3999-5",
  numero: "DV3999-6",
};
const TODOS = Object.keys(PED);

async function semear() {
  const C = T.C;
  await C.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'admin399910@fixture.test','{"role":"admin"}'),($2,'cliente399910@fixture.test','{}')`,
    [ADMIN, CLIENTE],
  );
  await C.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')`,
    [ADMIN, CLIENTE],
  );
  let n = 0;
  for (const k of TODOS) {
    n++;
    await C.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,
          payment_method,payment_status,paid_at,pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,$3,'{}',100,100,0,'delivered','online','online','pago',now(),now(),$4,0)`,
      [PED[k], CLIENTE, NOME[k], `ORD399910-${n}`],
    );
    await C.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,metodo_retorno,
          status,valor_itens,valor_frete_ida,prazo_ate,politica,created_at)
       VALUES ($1,$2,$3,$4,'arrependimento','outro','reembolso','nacional','envio_proprio',
          $5,100,0,current_date+7,'{}', timestamptz '2026-10-01 12:00:00+00' - $6 * interval '1 minute')`,
      [DEV[k], PROTOCOLO[k], PED[k], CLIENTE, STATUS[k], n],
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

/** Roda uma lista [termo, [quem tem de ser achado]] e devolve as falhas com o prefixo da verificacao. */
async function casos(prefixo, lista) {
  const f = [];
  for (const [termo, esperado] of lista) {
    const x = await listar(termo);
    if (!so(x, ...esperado))
      f.push(
        `${prefixo}(${JSON.stringify(termo)}): ${JSON.stringify(x.ids ?? x.erro)} (esperado ${JSON.stringify(esperado)})`,
      );
  }
  return f;
}

const CHECKS = {
  /** Digitar SEM acento acha o cliente que tem acento no nome. */
  semAcento: () =>
    casos("semAcento", [
      ["jose", ["jose"]],
      ["JOSE", ["jose"]],
      ["antonio", ["jose"]],
      ["jose antonio", ["jose"]],
      ["conceicao", ["conceicao"]],
      ["CONCEICAO", ["conceicao"]],
      ["conceicao silva", ["conceicao"]],
      ["penha", ["maria"]],
    ]),
  /** Digitar COM acento continua achando (e acha o mesmo): o acento e' tirado dos DOIS lados. */
  comAcento: () =>
    casos("comAcento", [
      ["José", ["jose"]],
      ["josé", ["jose"]],
      ["Antônio", ["jose"]],
      ["ANTÔNIO", ["jose"]],
      ["Conceição", ["conceicao"]],
      ["conceição", ["conceicao"]],
      ["Penhà", ["maria"]],
    ]),
  /** O protocolo tambem ignora o acento, de qualquer lado. */
  protocolo: () =>
    casos("protocolo", [
      ["dvao3999", ["protAcento", "protSem"]],
      ["DVÃO3999", ["protAcento", "protSem"]],
      ["dvão3999", ["protAcento", "protSem"]],
      ["DV3999-1", ["jose"]],
      ["dv3999", ["jose", "conceicao", "maria", "numero"]],
    ]),
  /** O que ja achava continua: numero do pedido, comeco do id, vazio, nulo, nome sem acento. */
  async comoSempre() {
    const f = await casos("comoSempre", [
      ["3884BE", ["numero"]],
      ["#3884be", ["numero"]],
      [" #3884BE ", ["numero"]],
      ["5555aa00", ["maria"]],
      ["Maria", ["maria"]],
      ["Cliente Neutro", ["protAcento"]],
      [null, TODOS],
      ["", TODOS],
      ["   ", TODOS],
      ["inexistente", []],
      // pedaco do numero nao acha (a regra da 20261395000000 continua igual)
      ["884BE", []],
    ]);
    return f;
  },
  /** O termo vale junto com o filtro de status, a paginacao e a contagem por status. */
  async junto() {
    const f = [];
    const a = await listar("jose", { status: "solicitada" });
    if (!so(a, "jose"))
      f.push(`junto(status solicitada): ${JSON.stringify(a.ids ?? a.erro)}`);
    const b = await listar("jose", { status: "concluida" });
    if (!so(b))
      f.push(`junto(status concluida): ${JSON.stringify(b.ids ?? b.erro)}`);
    const c = await listar("conceicao", { status: "solicitada" });
    if (!so(c))
      f.push(`junto(status errado): ${JSON.stringify(c.ids ?? c.erro)}`);
    // Paginacao: "dv3999" acha 4, 2 por pagina, mais recente primeiro (o created_at diminui com a ordem da semente).
    const p0 = await listar("dv3999", { limite: 2, offset: 0 });
    const p1 = await listar("dv3999", { limite: 2, offset: 2 });
    if (!p0.ids || !p1.ids || p0.r.total !== 4 || p1.r.total !== 4)
      f.push(
        `junto(paginas): total ${p0.r?.total}/${p1.r?.total} (esperado 4/4)`,
      );
    else if (
      JSON.stringify([...p0.ids, ...p1.ids]) !==
      JSON.stringify([DEV.jose, DEV.conceicao, DEV.maria, DEV.numero])
    )
      f.push(`junto(paginas): ordem ${JSON.stringify([...p0.ids, ...p1.ids])}`);
    // A contagem por status e' a da tabela inteira (nao do filtro), como sempre.
    const t = await listar("jose");
    const esperadoContagem = { solicitada: 3, recebida: 2, concluida: 1 };
    for (const [s, n] of Object.entries(esperadoContagem))
      if (t.r.contagem[s] !== n)
        f.push(`junto(contagem ${s}): ${t.r.contagem[s]} (esperado ${n})`);
    return f;
  },
  /** A porta: so o admin atual. */
  async porta() {
    const f = [];
    const x = await listar("jose", { papel: "cliente" });
    if (x.codigo !== "42501")
      f.push(`porta(cliente comum): ${x.codigo ?? "passou"} (esperado 42501)`);
    await T.C.query("SAVEPOINT anon");
    let anon;
    try {
      await T.C.query("SET LOCAL ROLE anon");
      await T.C.query(
        "SELECT public.admin_devolucoes_listar(NULL,'jose',50,0)",
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
  "ANTES: com o corpo antigo (o da 20261395000000, byte a byte) 'jose', 'antonio' e 'conceicao' sem acento NAO acham o cliente com acento (o defeito); com acento acha",
  () =>
    T.emTransacao(async () => {
      assert.equal(await T.prosrcVivo(), T.ANTIGA.corpo);
      await semear();
      for (const termo of ["jose", "antonio", "conceicao"]) {
        const x = await listar(termo);
        assert.deepEqual(x.ids, [], `${termo}: o corpo antigo ja achava?`);
      }
      assert.ok(
        so(await listar("José"), "jose"),
        "com acento o corpo antigo achava",
      );
      assert.ok(so(await listar("Conceição"), "conceicao"));
      // O protocolo: cada jeito de digitar achava SO o protocolo escrito do mesmo jeito (o defeito: nao achava o outro).
      assert.ok(
        so(await listar("DVÃO3999"), "protAcento"),
        "com acento achava so o protocolo com acento",
      );
      assert.ok(
        so(await listar("dvao3999"), "protSem"),
        "sem acento achava so o protocolo sem acento",
      );
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------
T.prova(
  "DEPOIS: sem acento acha com acento e com acento acha sem acento (nome e protocolo); o numero do pedido, o comeco do id e o nome sem acento seguem; o filtro de status, a paginacao e a contagem valem junto; so o admin atual chama",
  async () => {
    const falhas = await T.todasAsVerificacoes(CHECKS, T.instalarNova, semear);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

T.prova(
  "DIFERENCIAL: para as buscas que nao dependem de acento (numero do pedido, comeco do id, protocolo igual, nome sem acento nos dois lados, vazia, nula, inexistente, status), o JSON de depois e' IDENTICO ao de antes (itens, total e contagem)",
  async () => {
    const buscas = [
      ["3884BE", {}],
      ["#3884be", {}],
      ["5555aa00", {}],
      ["DV3999-1", {}],
      ["dv3999", {}],
      ["Maria", {}],
      ["Cliente Neutro", {}],
      [null, {}],
      ["", {}],
      ["inexistente", {}],
      [null, { status: "solicitada" }],
      ["dv3999", { status: "recebida" }],
      ["dv3999", { limite: 2, offset: 1 }],
      ["dv3999", { limite: 500, offset: -5 }],
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
      "o JSON mudou para uma busca que nao depende de acento",
    );
    assert.equal(depois[4].total, 4);
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
T.mutantes(
  {
    "sem a troca (o corpo antigo)": {
      aplica: (corpo) => inverso(corpo),
      vermelho: ["semAcento(", "protocolo("],
    },
    "o nome volta a comparar com acento (so o protocolo ignora)": {
      aplica: trocar(RAMO_NOME, NOME_VELHO),
      vermelho: ["semAcento(", "comAcento("],
    },
    "o protocolo volta a comparar com acento (so o nome ignora)": {
      aplica: trocar(RAMO_PROTOCOLO, PROTOCOLO_VELHO),
      vermelho: ["protocolo("],
    },
    "acento tirado so do lado da coluna (o termo digitado com acento nao acha)":
      {
        aplica: trocar(
          RAMO_NOME,
          "            OR public.f_unaccent(o.customer_name) ILIKE '%' || v_busca || '%'\n",
        ),
        vermelho: ["comAcento("],
      },
    "acento tirado so do lado do termo (a coluna com acento nao acha)": {
      aplica: trocar(
        RAMO_NOME,
        "            OR o.customer_name ILIKE public.f_unaccent('%' || v_busca || '%')\n",
      ),
      vermelho: ["semAcento("],
    },
    "o ramo novo substitui o do comeco do id (perde quem colava o id)": {
      aplica: trocar(
        "            OR d.order_id::text ILIKE v_busca || '%'\n",
        "",
      ),
      vermelho: ["comoSempre("],
    },
    "o ramo do numero do pedido some": {
      aplica: trocar(
        "            OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))))\n",
        "            OR false)\n",
      ),
      vermelho: ["comoSempre("],
    },
    "a busca ignora o filtro de status (OR solto fora do parenteses)": {
      aplica: trocar(
        "WHERE (p_status IS NULL OR d.status = p_status)\n       AND (v_busca IS NULL",
        "WHERE (p_status IS NULL OR d.status = p_status)\n       OR public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || coalesce(v_busca, '-') || '%')\n       AND (v_busca IS NULL",
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
