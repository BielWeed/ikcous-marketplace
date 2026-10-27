import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$function$";
const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const definicao = (sql: string, fn: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string, fn: string) => {
  const d = definicao(sql, fn);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// Os corpos vigentes ANTES desta migration: a v23 e' a da 350; a v24 e' a da 384 (que ja sucede a 350).
const H_V23_ANTES = "6b71cb823967518955407b532904ae91";
const H_V24_ANTES = "f8d6ed0c3622ab41123bacb98911a98f";
const H_V23_DEPOIS = "89c99662346d47a4d6b3d13612ca4acb";
const H_V24_DEPOIS = "36c80a107f3ed16853c1c5b2b0cbc911";
const ANCORA_PASSO_1 =
  "    -- 1. Address Ownership Check (Only if user is logged in)\n";
const INICIO_DO_TRECHO = "    -- 0-quater.";
const CONDICAO =
  "IF v_user_id IS NULL AND p_payment_method IS DISTINCT FROM 'online' THEN";
const LOCK =
  "PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pedido_visitante_na_entrega', 0));";
const FRASE_UNIDADES =
  "Sem entrar na conta, o pedido aceita até 10 unidades. Entre na conta para comprar mais.";
const FRASE_LOJA =
  "Estamos com muitos pedidos aguardando agora. Entre na conta para finalizar o seu.";

const anterior350 = ler(
  "supabase/migrations/20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql",
);
const anterior384 = ler(
  "supabase/migrations/20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

const FUNCOES: Array<[string, string, string, string]> = [
  [V23, anterior350, H_V23_ANTES, H_V23_DEPOIS],
  [V24, anterior384, H_V24_ANTES, H_V24_DEPOIS],
];

const trecho = (fn: string) => {
  const c = corpo(sql, fn);
  const i = c.indexOf(INICIO_DO_TRECHO);
  const f = c.indexOf(ANCORA_PASSO_1);
  assert.ok(i > 0 && f > i, `${fn}: o trecho 0-quater nao foi achado`);
  return c.slice(i, f);
};

Deno.test("394: o corpo anterior e' o vigente (v23 da 350, v24 da 384); a migration muda UM trecho (0-quater), igual nas duas, antes do passo 1; o rollback devolve cada corpo byte a byte", () => {
  for (const [fn, fonte, hAntes, hDepois] of FUNCOES) {
    assert.equal(md5(corpo(fonte, fn)), hAntes, `${fn}: o corpo vigente mudou`);
    assert.equal(md5(corpo(sql, fn)), hDepois, `${fn}: o corpo novo mudou`);
    const t = trecho(fn);
    // Tira o trecho e sobra o corpo vigente, byte a byte; o cabecalho da funcao e' o mesmo.
    assert.equal(
      corpo(sql, fn).replace(t, ""),
      corpo(fonte, fn),
      `${fn}: mais que o trecho mudou`,
    );
    assert.equal(
      definicao(sql, fn).split(DELIM)[0],
      definicao(fonte, fn).split(DELIM)[0],
      `${fn}: o cabecalho mudou`,
    );
    assert.equal(
      corpo(rb, fn),
      corpo(fonte, fn),
      `${fn}: o rollback nao e o corpo vigente`,
    );
    assert.equal(definicao(rb, fn), definicao(fonte, fn));
    assert.equal(md5(corpo(rb, fn)), hAntes);
    // O trecho aparece uma vez no corpo novo e nenhuma no vigente.
    assert.equal(corpo(sql, fn).split(INICIO_DO_TRECHO).length - 1, 1);
    assert.equal(corpo(fonte, fn).includes(INICIO_DO_TRECHO), false);
  }
  // O MESMO trecho nas duas funcoes (uma regra so, dois caminhos de pagamento).
  assert.equal(trecho(V23), trecho(V24));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 2);
});

Deno.test("394: a regra — so sem sessao e fora do online; 10 unidades somadas pelo MESMO cast do laco; lock da loja; 10 pendentes em 72 h; frases e DETAIL; p_address_id de visitante recusado", () => {
  const t = trecho(V23);
  // Condicao: so quem nao tem sessao e so fora do pagamento online (NULL conta como "fora", por isso IS DISTINCT FROM).
  assert.equal(t.split(CONDICAO).length - 1, 1);
  // Unidades: a soma das quantidades pelo cast ::integer (o do laco do passo 3), com o teto de 10.
  assert.ok(t.includes("sum(GREATEST((e->>'quantity')::integer, 0))"));
  assert.ok(t.includes("> 10 THEN"));
  assert.ok(t.includes(`RAISE EXCEPTION '${FRASE_UNIDADES}'`));
  assert.ok(t.includes("USING DETAIL = 'visitante_teto_unidades:"));
  // Loja: o lock vem ANTES da contagem; a contagem so olha visitante, pendente, fora do online, ultimas 72 h; teto de 10.
  assert.equal(t.split(LOCK).length - 1, 1);
  const contagem = t.slice(t.indexOf("SELECT count(*)"), t.indexOf(FRASE_LOJA));
  assert.ok(t.indexOf(LOCK) < t.indexOf("SELECT count(*)"));
  for (const pedaco of [
    "FROM public.marketplace_orders",
    "user_id IS NULL",
    "status = 'pending'",
    "payment_method IS DISTINCT FROM 'online'",
    "created_at > now() - interval '72 hours'",
    ">= 10 THEN",
  ])
    assert.ok(t.includes(pedaco), `falta: ${pedaco}`);
  assert.ok(contagem.length > 0);
  assert.ok(t.includes(`RAISE EXCEPTION '${FRASE_LOJA}'`));
  assert.ok(t.includes("USING DETAIL = 'visitante_teto_da_loja:"));
  // Sem ERRCODE: P0001 como as demais recusas (o front classifica pela frase).
  assert.doesNotMatch(t.replace(/--[^\n]*/g, ""), /ERRCODE/);
  // O p_address_id sem sessao: recusa com a frase que o front ja traduz, ANTES do lock (nao segura nada).
  assert.ok(
    t.includes("IF p_address_id IS NOT NULL AND v_user_id IS NULL THEN"),
  );
  assert.ok(t.includes("'Endereço inválido ou não pertence ao usuário.'"));
  assert.ok(t.indexOf("p_address_id IS NOT NULL") < t.indexOf(LOCK));
  // As duas tetos so valem dentro da condicao (o logado e o online nem chegam ao lock).
  assert.ok(t.indexOf(CONDICAO) < t.indexOf(LOCK));
  // Os limites do dono estao escritos uma vez cada (uma mudanca de K precisa mexer aqui, na prova viva e na frase).
  assert.equal(t.split("> 10 THEN").length - 1, 1);
  assert.equal(t.split(">= 10 THEN").length - 1, 1);
});

Deno.test("394: a posicao — DEPOIS da idempotencia (a retentativa nunca e recusada), da forma de pagamento e (v24) do 0-ter; ANTES de ler o carrinho, trancar, gravar, baixar estoque ou usar cupom", () => {
  for (const fn of [V23, V24]) {
    const c = corpo(sql, fn);
    const pos = (x: string) => {
      const i = c.indexOf(x);
      assert.ok(i >= 0, `${fn}: trecho ausente: ${x.slice(0, 50)}`);
      return i;
    };
    const t = pos(INICIO_DO_TRECHO);
    assert.ok(
      t > pos("    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO"),
      `${fn}: antes da idempotencia`,
    );
    assert.ok(
      t > pos("RETURN v_order_id;"),
      `${fn}: antes do retorno da retentativa`,
    );
    assert.ok(
      t > pos("IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN"),
      `${fn}: antes da forma de pagamento aceita`,
    );
    if (fn === V24)
      assert.ok(
        t > pos("IF p_payment_method = 'online' AND v_user_id IS NULL THEN"),
        "v24: o online sem conta ja foi recusado pelo 0-ter",
      );
    for (const depois of [
      ANCORA_PASSO_1,
      "SELECT * INTO v_store_config",
      "FOR NO KEY UPDATE",
      "INSERT INTO public.marketplace_orders",
      "UPDATE public.produtos",
      "UPDATE public.product_variants",
      "UPDATE public.coupons",
      "INSERT INTO public.marketplace_order_items",
    ])
      assert.ok(
        t < pos(depois),
        `${fn}: a recusa tem de vir antes de: ${depois}`,
      );
  }
});

Deno.test("394: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
  for (const texto of [sql, rb]) {
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    const externo = texto
      .replace(definicao(texto, V23), "")
      .replace(definicao(texto, V24), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    // Uma assinatura so por funcao, atributos de sempre, sem PUBLIC e com os tres papeis.
    assert.ok(texto.includes("p.proname = r.nome) <> 1"));
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(
      texto.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('service_role', v_oid, 'EXECUTE')",
      ),
    );
  }
  for (const h of [H_V23_ANTES, H_V24_ANTES, H_V23_DEPOIS, H_V24_DEPOIS])
    assert.ok(sql.includes(h), `a migration nao cita o hash ${h}`);
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(
    sql.includes(
      "v_hash IS DISTINCT FROM r.hash_vigente AND v_hash IS DISTINCT FROM r.hash_desta",
    ),
  );
  assert.ok(rb.includes("IF v_hash IS DISTINCT FROM r.hash_desta THEN"));
  assert.ok(rb.includes("IF v_hash IS DISTINCT FROM r.hash_vigente THEN"));
  assert.ok(
    sql.includes("current_setting('ikcous.freio394_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.freio394_rb_atributos')::jsonb"),
  );
  // O pos-voo exige o trecho exatamente uma vez em cada corpo.
  assert.ok(sql.includes("nao tem o trecho 0-quater exatamente uma vez"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("394: a vigente e' a ultima redefinicao de v23 e v24 da arvore; db-apply exige as guardas nas DUAS funcoes; a lista das sucessoras da 99 fecha com os dois pares", () => {
  for (const fn of [V23, V24]) {
    const fontes = [...Deno.readDirSync(dir)]
      .map((e) => e.name)
      .filter((n) => /^\d{14}_.*\.sql$/.test(n))
      .sort()
      .filter((n) => definicao(ler(`supabase/migrations/${n}`), fn));
    assert.equal(
      fontes.at(-1),
      nome,
      `outra migration redefine ${fn} depois da 394`,
    );
  }
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 2);
  for (const [fn, fonte] of [
    [V23, anterior350],
    [V24, anterior384],
  ] as Array<[string, string]>) {
    const checagem = checagens.find((c: { funcao: string }) => c.funcao === fn);
    assert.ok(checagem, `${fn}: sem checagem em db-apply`);
    assert.equal(
      avaliarChecagem(corpo(sql, fn), checagem).situacao,
      "verificada",
    );
    // Sem o freio (o corpo vigente) a verificacao falha: o marcador pega a regressao.
    assert.equal(
      avaliarChecagem(corpo(fonte, fn), checagem).situacao,
      "falhou",
    );
    // Cada marcador do freio tira a verificacao do ar quando some do corpo novo.
    for (const m of checagem.esperado as Array<{ texto: string }>)
      assert.equal(
        avaliarChecagem(corpo(sql, fn).replace(m.texto, "XX"), checagem)
          .situacao,
        "falhou",
        `${fn}: o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registros = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(registros.length, 2);
  const porFn = (fn: string) =>
    registros.find((s: { assinatura: string }) =>
      s.assinatura.includes(`.${fn}(`),
    );
  assert.equal(porFn(V23).hashVigente, H_V23_ANTES);
  assert.equal(porFn(V23).hashDesta, H_V23_DEPOIS);
  assert.equal(porFn(V24).hashVigente, H_V24_ANTES);
  assert.equal(porFn(V24).hashDesta, H_V24_DEPOIS);
  // A cadeia de posteriores: a 384 chama a 394 primeiro, e a 394 sabe o nome do arquivo e os quatro hashes.
  const post394 = ler(
    "tests/banco/o-pedido-de-visitante-na-entrega-posterior.cjs",
  );
  for (const h of [H_V23_ANTES, H_V24_ANTES, H_V23_DEPOIS, H_V24_DEPOIS])
    assert.ok(post394.includes(h));
  assert.ok(post394.includes(nome));
  assert.ok(
    ler("tests/banco/pedido-pelo-app-exige-conta-posterior.cjs").includes(
      "o-pedido-de-visitante-na-entrega-posterior.cjs",
    ),
  );
});

Deno.test("394: 31a, 37a, 47a, 81a e 89a aceitam os corpos novos como sucessores; as consultas 106a/106b sao so de catalogo, nove linhas fechadas, e estao registradas", async () => {
  for (const arquivo of [
    "31a-conferir-endereco-da-compra-fica-no-pedido.sql",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
    "81a-conferir-compra-online-trava-preco-e-chave-aplicado.sql",
    "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado.sql",
  ])
    assert.ok(
      ler(`scripts/publicacao/consultas/${arquivo}`).includes(
        `'${H_V23_DEPOIS}'`,
      ),
      `${arquivo} nao aceita o corpo novo da v23`,
    );
  for (const arquivo of [
    "31a-conferir-endereco-da-compra-fica-no-pedido.sql",
    "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
    "81a-conferir-compra-online-trava-preco-e-chave-aplicado.sql",
    "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado.sql",
  ])
    assert.ok(
      ler(`scripts/publicacao/consultas/${arquivo}`).includes(
        `'${H_V24_DEPOIS}'`,
      ),
      `${arquivo} nao aceita o corpo novo da v24`,
    );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A = "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado";
  const B =
    "106b-antes-o-pedido-de-visitante-na-entrega-tem-freio-base-vigente";
  const consultas: Array<[string, string, string]> = [
    [A, H_V23_DEPOIS, H_V24_DEPOIS],
    [B, H_V23_ANTES, H_V24_ANTES],
  ];
  for (const [nomeConsulta, h23, h24] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${h23}'`));
    assert.ok(consulta.includes(`'${h24}'`));
    // So catalogo: nenhuma tabela de pedido, produto ou cliente e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config)|public\.create_marketplace_order_v2[34]\(\s*[^j]/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 9);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const entrada = canais.provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261394000000"),
  );
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, ["20261394000000"]);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  const rpcCi = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpcCi.includes(
      "rodar-isolado.cjs tests/banco/o-pedido-de-visitante-na-entrega-tem-freio-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "o-pedido-de-visitante-na-entrega-tem-freio-viva.cjs",
    ),
  );
});
