"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// Onda 150, lote E / 20261399930000: fin_caixa_abrir e fin_conta_salvar recusam NaN, infinito e acima do teto (22023) ANTES de escrever.
// Somente Postgres descartavel do rpc-ci (rodar-isolado.cjs: CI_BANCO_EFEMERO=1 + localhost), nunca banco de loja. Tudo roda numa transacao
// que termina em ROLLBACK; os dados sao fixtures inventadas.
//
// Sem a guarda, 'NaN' nao e menor que zero (o Postgres o ordena acima de todo numero) e cabe em numeric(12,2): a abertura gravaria uma sessao e
// um ajuste de caixa de valor NaN, e a conta nasceria com saldo inicial NaN, que envenena o saldo total da loja.
//
// MUTANTE_R150E=<nome> sabota SOMENTE a funcao viva (depois do apply, antes das recusas) e a prova tem de ficar vermelha no cenario prometido:
//   abrir-sem-guarda | abrir-sem-teto | abrir-guarda-antes-da-permissao | conta-sem-guarda | conta-sem-teto | conta-so-na-criacao
// A igualdade explicita com 'NaN'::numeric e' REDUNDANTE de proposito: NaN ordena acima de todo numero e ja cai em `abs(x) > teto`; tirar SO ela
// e' mutante EQUIVALENTE (nao tem prova possivel). O que protege e' a guarda inteira, e e' ela que os mutantes tiram.
// Nome desconhecido e ERRO (nunca verde por engano).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const consultaAntes = ler(
  "scripts/publicacao/consultas/128b-antes-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-base-vigente.sql",
);
const consultaDepois = ler(
  "scripts/publicacao/consultas/128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado.sql",
);
const bloco = (sql, fn) =>
  sql.match(
    // eslint-disable-next-line security/detect-non-literal-regexp -- fn e' um dos dois nomes literais de funcao deste arquivo, nunca entrada externa
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`,
    ),
  )[0];
const corpoDe = (b) => b.split("AS $$")[1].slice(0, -3);
// Os corpos de ANTES, lidos das migrations que os deixaram vivos (nao copiados a mao).
const ABRIR_ANTES = corpoDe(
  bloco(
    ler(
      "supabase/migrations/20261370000000_o_caixa_abre_so_na_conta_da_loja.sql",
    ),
    "fin_caixa_abrir",
  ),
);
const CONTA_ANTES = corpoDe(
  bloco(
    ler(
      "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
    ),
    "fin_conta_salvar",
  ),
);
const HASH_ABRIR_ANTES = "28ab512e291378a01d110e298af7a402";
const HASH_CONTA_ANTES = "2f9b720cb3804edba4879595b0d6fe1d";

const ADMIN = "5e150000-0000-4000-8000-000000000001";
const CLIENTE = "5e150000-0000-4000-8000-000000000002";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const FRASE_ABRIR = /Informe quanto dinheiro há no caixa/;
const FRASE_CONTA = /Informe o saldo inicial como um número válido/;
const SIG_ABRIR = "public.fin_caixa_abrir(numeric,uuid)";
const SIG_CONTA = "public.fin_conta_salvar(jsonb)";

const MUTANTES = new Map(
  Object.entries({
    "abrir-sem-teto": [
      SIG_ABRIR,
      " OR abs(p_valor_abertura) > 9999999999.99",
      "",
    ],
    "conta-sem-teto": [
      SIG_CONTA,
      "\n          OR abs((p ->> 'saldo_inicial')::numeric) > 9999999999.99",
      "",
    ],
    "conta-so-na-criacao": [
      SIG_CONTA,
      "  IF p ? 'saldo_inicial'\n     AND (",
      "  IF v_id IS NULL AND p ? 'saldo_inicial'\n     AND (",
    ],
  }),
);
const GUARDA_CONTA = / {2}IF p \? 'saldo_inicial'[\s\S]*?\n {2}END IF;\n/;
const GUARDA_ABRIR = `  IF p_valor_abertura = 'NaN'::numeric OR abs(p_valor_abertura) > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
`;

async function definicao(c, sig) {
  return (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [sig])
  ).rows[0].d.replace(/\r/g, "");
}
async function funcoes(c) {
  const linhas = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = ANY (ARRAY['${SIG_ABRIR}'::regprocedure, '${SIG_CONTA}'::regprocedure]) ORDER BY p.proname`,
    )
  ).rows.map((l) => ({ ...l.a, prosrc: l.a.prosrc.replace(/\r/g, "") }));
  assert.equal(linhas.length, 2);
  return linhas;
}
async function hashes(c) {
  const r = await c.query(
    `SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h FROM pg_proc p
      WHERE p.oid = ANY (ARRAY['${SIG_ABRIR}'::regprocedure, '${SIG_CONTA}'::regprocedure])`,
  );
  return Object.fromEntries(r.rows.map((l) => [l.proname, l.h]));
}
// Tudo o que as duas funcoes escrevem: se mudar, a recusa nao foi limpa.
async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.fin_caixa_sessoes s) AS sessoes,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM public.fin_lancamentos l) AS lancamentos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(k) ORDER BY id), '[]') FROM public.fin_contas k) AS contas`)
  ).rows[0];
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso150");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso150");
    await c.query("RELEASE SAVEPOINT caso150");
  }
}
// Executa e devolve {erro: {code, message}} ou {linhas}; a transacao segue de pe (savepoint).
async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa150");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa150");
    return { linhas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa150");
    await c.query("RELEASE SAVEPOINT tentativa150");
    return { erro: { code: e.code, message: e.message } };
  }
}
const abrir = (c, valor, conta = null) =>
  tentar(c, "SELECT public.fin_caixa_abrir($1::numeric, $2::uuid) AS r", [
    valor,
    conta,
  ]);
const salvar = (c, obj) =>
  tentar(c, "SELECT public.fin_conta_salvar($1::jsonb) AS r", [
    typeof obj === "string" ? obj : JSON.stringify(obj),
  ]);
function esperarRecusa(r, frase, rotulo) {
  assert.ok(r.erro, `${rotulo}: foi ACEITO (devia recusar com 22023)`);
  assert.equal(
    r.erro.code,
    "22023",
    `${rotulo}: codigo ${r.erro.code} (${r.erro.message})`,
  );
  assert.match(r.erro.message, frase, `${rotulo}: frase errada`);
}
async function conferir(c, sql, positivo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(
    linhas.length,
    7,
    "o rol fechado das consultas 128 tem 7 linhas",
  );
  assert.equal(
    linhas.every((l) => l.ok === true),
    positivo,
    JSON.stringify(linhas.filter((l) => !l.ok)),
  );
}
async function como(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
}

async function mutar(c) {
  const nome = process.env.MUTANTE_R150E;
  if (!nome) return;
  if (nome === "abrir-guarda-antes-da-permissao") {
    const d = await definicao(c, SIG_ABRIR);
    assert.equal(
      d.split(GUARDA_ABRIR).length - 1,
      1,
      "guarda do abrir nao encontrada para o mutante",
    );
    const semGuarda = d.replace(GUARDA_ABRIR, "");
    const alvo = "BEGIN\n  IF NOT public.is_admin() THEN";
    assert.equal(semGuarda.split(alvo).length - 1, 1);
    const alterado = semGuarda.replace(
      alvo,
      `BEGIN\n${GUARDA_ABRIR}  IF NOT public.is_admin() THEN`,
    );
    assert.notEqual(alterado, d);
    await c.query(alterado);
    assert.equal(
      await definicao(c, SIG_ABRIR),
      alterado,
      "o banco nao instalou exatamente o mutante",
    );
    console.log(`MUTANTE aplicado: ${nome}`);
    return;
  }
  if (nome === "abrir-sem-guarda" || nome === "conta-sem-guarda") {
    const sig = nome === "abrir-sem-guarda" ? SIG_ABRIR : SIG_CONTA;
    const d = await definicao(c, sig);
    const alterado = d.replace(
      nome === "abrir-sem-guarda" ? GUARDA_ABRIR : GUARDA_CONTA,
      "",
    );
    assert.notEqual(alterado, d, "sabotagem nao aplicada");
    await c.query(alterado);
    assert.equal(
      await definicao(c, sig),
      alterado,
      "o banco nao instalou exatamente o mutante",
    );
    console.log(`MUTANTE aplicado: ${nome}`);
    return;
  }
  const m = MUTANTES.get(nome);
  if (!m) throw new Error(`MUTANTE_R150E desconhecido: ${nome}`);
  const [sig, de, para] = m;
  const d = await definicao(c, sig);
  assert.equal(
    d.split(de).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = d.replace(de, para);
  assert.notEqual(alterado, d, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(
    await definicao(c, sig),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // Base ainda no corpo anterior (arvore local sem a migration)? Aplica; no CI ela ja esta no ar. Reaplicar e' no-op.
    const vivo = await hashes(c);
    if (
      vivo.fin_caixa_abrir === HASH_ABRIR_ANTES &&
      vivo.fin_conta_salvar === HASH_CONTA_ANTES
    ) {
      await c.query(migration);
    }
    const topo = await funcoes(c);
    await conferir(c, consultaDepois, true);
    await conferir(c, consultaAntes, false);

    // ROLLBACK para o corpo anterior: byte a byte o das migrations que o deixaram vivo.
    await c.query(rollback);
    const anterior = await funcoes(c);
    assert.equal(
      anterior.find((f) => f.proname === "fin_caixa_abrir").prosrc,
      ABRIR_ANTES,
    );
    assert.equal(
      anterior.find((f) => f.proname === "fin_conta_salvar").prosrc,
      CONTA_ANTES,
    );
    await conferir(c, consultaAntes, true);
    await conferir(c, consultaDepois, false);

    // Fixtures: admin de verdade (papel nas DUAS fontes) e uma cliente comum.
    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, jsonb_build_object('role', $3::text))`,
        [id, `${papel}-150e@fixture.invalid`, papel],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa Ficticia', $2)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
        [id, papel],
      );
    }
    await como(c, ADMIN);

    // CONTROLE (a funcao ANTERIOR tem o defeito): 'NaN' passa e grava. E' o que a guarda nova tem de impedir.
    await isolado(c, async () => {
      const r = await abrir(c, "NaN");
      assert.ok(
        !r.erro,
        `controle: o corpo anterior devia aceitar NaN (${r.erro?.message})`,
      );
      const s = (
        await c.query(
          "SELECT valor_abertura::text AS v FROM public.fin_caixa_sessoes WHERE id = $1",
          [r.linhas[0].r.id],
        )
      ).rows[0];
      assert.equal(s.v, "NaN", "o controle nao gravou a sessao de caixa NaN");
    });
    await isolado(c, async () => {
      const r = await salvar(c, {
        nome: "Conta NaN controle",
        tipo: "banco",
        saldo_inicial: "NaN",
      });
      assert.ok(
        !r.erro,
        `controle: o corpo anterior devia aceitar saldo NaN (${r.erro?.message})`,
      );
      const k = (
        await c.query(
          "SELECT saldo_inicial::text AS v FROM public.fin_contas WHERE id = $1",
          [r.linhas[0].r.id],
        )
      ).rows[0];
      assert.equal(k.v, "NaN", "o controle nao gravou a conta NaN");
    });
    // Infinito, no corpo anterior, ja nao gravava (o cast do DECLARE estoura 22003): o ganho e' a frase certa (22023), nao a gravacao.
    await isolado(c, async () => {
      const r = await abrir(c, "Infinity");
      assert.equal(
        r.erro?.code,
        "22003",
        `controle: infinito no corpo anterior (${JSON.stringify(r)})`,
      );
    });

    // DADO QUE JA EXISTIA: uma conta NaN gravada pelo corpo anterior (a migration nao a corrige nem apaga) + uma conta valida.
    const velhaNaN = (
      await salvar(c, {
        nome: "Conta NaN antiga",
        tipo: "banco",
        saldo_inicial: "NaN",
      })
    ).linhas[0].r.id;
    const valida = (
      await salvar(c, {
        nome: "Conta valida",
        tipo: "banco",
        saldo_inicial: 100.5,
      })
    ).linhas[0].r.id;
    const dados = await fotografar(c);

    // APPLY sobre esse estado.
    await c.query(migration);
    assert.deepEqual(
      await fotografar(c),
      dados,
      "o apply alterou sessao, lancamento ou conta ja gravados",
    );
    assert.deepEqual(
      await funcoes(c),
      topo,
      "o apply nao reproduziu o topo instalado pelo CI (corpo, OID, dono, ACL ou atributos)",
    );
    await conferir(c, consultaDepois, true);
    await conferir(c, consultaAntes, false);

    await mutar(c);

    // ===== fin_caixa_abrir: recusa NaN, infinito, acima do teto; sem escrever nada =====
    for (const [valor, rotulo] of [
      ["NaN", "NaN"],
      ["Infinity", "infinito"],
      ["-Infinity", "menos infinito"],
      [
        "9999999999.995",
        "9999999999.995 (arredonda para fora do numeric(12,2))",
      ],
      ["10000000000", "acima do teto"],
      ["-0.01", "negativo (guarda que ja existia)"],
      [null, "nulo (guarda que ja existia)"],
    ]) {
      const r = await abrir(c, valor);
      esperarRecusa(r, FRASE_ABRIR, `abrir ${rotulo}`);
      assert.deepEqual(
        await fotografar(c),
        dados,
        `abrir ${rotulo}: a recusa gravou sessao, ajuste ou conta`,
      );
    }
    // Borda de conta: a guarda vem ANTES das demais, mas a recusa de conta personalizada segue valendo para valor valido.
    {
      const r = await abrir(c, 10, "5e150000-0000-4000-8000-000000000099");
      assert.equal(r.erro?.code, "22023");
      assert.match(r.erro.message, /Abra o caixa na conta Caixa da loja/);
    }
    // CONTROLES: o que ja era valido segue valido, com o mesmo resultado gravado.
    for (const [valor, esperado] of [
      ["0", "0.00"],
      ["-0.004", "0.00"], // arredonda para zero: aceito antes, aceito agora (a guarda nao muda isso)
      ["12.345", "12.35"],
      ["9999999999.99", "9999999999.99"], // exatamente o teto
    ]) {
      await isolado(c, async () => {
        const r = await abrir(c, valor);
        assert.ok(
          !r.erro,
          `abrir ${valor}: valido foi recusado (${r.erro?.code} ${r.erro?.message})`,
        );
        const s = (
          await c.query(
            "SELECT valor_abertura::text AS v, conta_id FROM public.fin_caixa_sessoes WHERE id = $1",
            [r.linhas[0].r.id],
          )
        ).rows[0];
        assert.equal(s.v, esperado, `abrir ${valor}: gravou ${s.v}`);
        assert.equal(s.conta_id, CAIXA);
      });
    }
    // Permissao ANTES da guarda: quem nao e admin recebe 42501 mesmo com NaN (a recusa nao vaza como validacao para o visitante).
    await como(c, CLIENTE);
    {
      const r = await abrir(c, "NaN");
      assert.equal(
        r.erro?.code,
        "42501",
        `abrir NaN como cliente: ${JSON.stringify(r)}`,
      );
      assert.match(r.erro.message, /Acesso negado/);
      const r2 = await salvar(c, {
        nome: "x",
        tipo: "banco",
        saldo_inicial: "NaN",
      });
      assert.equal(
        r2.erro?.code,
        "42501",
        `conta NaN como cliente: ${JSON.stringify(r2)}`,
      );
    }
    await como(c, ADMIN);
    assert.deepEqual(
      await fotografar(c),
      dados,
      "recusas por permissao escreveram",
    );

    // ===== fin_conta_salvar: criar e editar =====
    for (const [saldo, rotulo] of [
      ["NaN", "NaN"],
      ["Infinity", "infinito"],
      ["-Infinity", "menos infinito"],
      [" nan ", "NaN com espacos e minusculas"],
      ["1e400", "numero gigante"],
      ["10000000000", "acima do teto"],
      ["-10000000000", "negativo acima do teto"],
    ]) {
      const criar = await salvar(c, {
        nome: "Conta nova",
        tipo: "banco",
        saldo_inicial: saldo,
      });
      esperarRecusa(criar, FRASE_CONTA, `criar conta com saldo ${rotulo}`);
      assert.deepEqual(
        await fotografar(c),
        dados,
        `criar ${rotulo}: a recusa criou a conta`,
      );
      const editar = await salvar(c, {
        id: valida,
        nome: "Renomeada",
        saldo_inicial: saldo,
      });
      esperarRecusa(editar, FRASE_CONTA, `editar conta com saldo ${rotulo}`);
      assert.deepEqual(
        await fotografar(c),
        dados,
        `editar ${rotulo}: a recusa mudou nome ou saldo da conta`,
      );
    }
    // CONTROLES: valido segue valido (inclusive NEGATIVO: conta no vermelho), e chave ausente ou JSON null seguem como antes.
    for (const [obj, esperado] of [
      [{ nome: "Negativa", tipo: "banco", saldo_inicial: -50.25 }, "-50.25"],
      [{ nome: "Zero", tipo: "banco", saldo_inicial: 0 }, "0.00"],
      [
        { nome: "Arredonda", tipo: "banco", saldo_inicial: "123.456" },
        "123.46",
      ],
      [
        { nome: "Teto", tipo: "banco", saldo_inicial: "9999999999.99" },
        "9999999999.99",
      ],
      [{ nome: "Sem a chave", tipo: "banco" }, "0.00"],
      [{ nome: "Nulo", tipo: "banco", saldo_inicial: null }, "0.00"],
    ]) {
      await isolado(c, async () => {
        const r = await salvar(c, obj);
        assert.ok(
          !r.erro,
          `conta ${JSON.stringify(obj)}: valida foi recusada (${r.erro?.code} ${r.erro?.message})`,
        );
        const k = (
          await c.query(
            "SELECT saldo_inicial::text AS v FROM public.fin_contas WHERE id = $1",
            [r.linhas[0].r.id],
          )
        ).rows[0];
        assert.equal(
          k.v,
          esperado,
          `conta ${JSON.stringify(obj)}: gravou ${k.v}`,
        );
      });
    }
    // Editar sem a chave do saldo segue funcionando, inclusive na conta NaN que ja existia (renomear/desativar nao e recusado).
    await isolado(c, async () => {
      const r = await salvar(c, {
        id: velhaNaN,
        nome: "Antiga renomeada",
        ativa: false,
      });
      assert.ok(
        !r.erro,
        `conta NaN antiga sem a chave do saldo foi recusada (${r.erro?.message})`,
      );
      const k = (
        await c.query(
          "SELECT nome, ativa, saldo_inicial::text AS v FROM public.fin_contas WHERE id = $1",
          [velhaNaN],
        )
      ).rows[0];
      assert.deepEqual(
        k,
        { nome: "Antiga renomeada", ativa: false, v: "NaN" },
        "o saldo NaN antigo foi tocado sem pedido",
      );
    });
    // E o caminho de cura: gravar um saldo valido na conta NaN antiga funciona; gravar NaN de novo, nao.
    await isolado(c, async () => {
      const r = await salvar(c, { id: velhaNaN, saldo_inicial: 80 });
      assert.ok(
        !r.erro,
        `curar a conta NaN antiga com saldo valido foi recusado (${r.erro?.message})`,
      );
      assert.equal(
        (
          await c.query(
            "SELECT saldo_inicial::text AS v FROM public.fin_contas WHERE id = $1",
            [velhaNaN],
          )
        ).rows[0].v,
        "80.00",
      );
    });
    esperarRecusa(
      await salvar(c, { id: velhaNaN, saldo_inicial: "NaN" }),
      FRASE_CONTA,
      "regravar NaN na conta NaN antiga",
    );
    assert.deepEqual(await fotografar(c), dados);
    // Texto que nem e numero: o erro de sempre do cast (22P02), nao o da guarda (comportamento preservado).
    {
      const r = await salvar(c, {
        nome: "Lixo",
        tipo: "banco",
        saldo_inicial: "abc",
      });
      assert.equal(r.erro?.code, "22P02", `saldo 'abc': ${JSON.stringify(r)}`);
    }

    // ===== reaplicar (inclusive CRLF) nao muda nada =====
    await c.query(migration);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.deepEqual(await fotografar(c), dados, "reaplicar tocou dados");
    assert.deepEqual(
      await funcoes(c),
      topo,
      "reaplicar mudou corpo, OID, dono, ACL ou atributos",
    );

    // ===== pre-voo: corpo ou atributo desconhecido recusa SEM escrever =====
    for (const [rotulo, sabotagem] of [
      [
        "corpo desconhecido do abrir",
        (await definicao(c, SIG_ABRIR)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
      ],
      [
        "corpo desconhecido da conta",
        (await definicao(c, SIG_CONTA)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
      ],
      [
        "abrir SECURITY INVOKER",
        `ALTER FUNCTION ${SIG_ABRIR} SECURITY INVOKER`,
      ],
      [
        "conta com outro search_path",
        `ALTER FUNCTION ${SIG_CONTA} SET search_path TO pg_catalog`,
      ],
      [
        "abrir aberta ao anon",
        `GRANT EXECUTE ON FUNCTION ${SIG_ABRIR} TO anon`,
      ],
      [
        "conta aberta ao anon",
        `GRANT EXECUTE ON FUNCTION ${SIG_CONTA} TO anon`,
      ],
    ]) {
      await isolado(c, async () => {
        await c.query(sabotagem);
        const sabotada = await funcoes(c);
        const r = await tentar(c, migration);
        assert.equal(
          r.erro?.code,
          "P0001",
          `${rotulo}: o pre-voo nao recusou (${JSON.stringify(r.erro)})`,
        );
        assert.match(r.erro.message, /B1_BASELINE_DIVERGENT/, rotulo);
        assert.deepEqual(
          await funcoes(c),
          sabotada,
          `${rotulo}: o pre-voo escreveu antes de recusar`,
        );
        assert.deepEqual(await fotografar(c), dados);
      });
    }

    // ===== rollback devolve os DOIS corpos byte a byte e nao toca dado; segundo rollback recusa =====
    await c.query(rollback);
    assert.deepEqual(
      await funcoes(c),
      anterior,
      "o rollback nao devolveu corpo/atributos byte a byte",
    );
    assert.deepEqual(await fotografar(c), dados, "o rollback tocou dados");
    const segundo = await tentar(c, rollback);
    assert.equal(segundo.erro?.code, "P0001");
    assert.match(segundo.erro.message, /B1_BASELINE_DIVERGENT/);
    // (e o rollback reabre o defeito: o corpo anterior volta a aceitar NaN)
    await isolado(c, async () => {
      const r = await abrir(c, "NaN");
      assert.ok(
        !r.erro,
        "depois do rollback o corpo anterior devia voltar a aceitar NaN",
      );
    });
    await c.query(migration);
    assert.deepEqual(await funcoes(c), topo);

    // ===== CONTROLE NEGATIVO causal: sem a guarda, as MESMAS chamadas passam (a recusa vem da guarda e de mais nada) =====
    await isolado(c, async () => {
      const d = await definicao(c, SIG_ABRIR);
      assert.equal(d.split(GUARDA_ABRIR).length - 1, 1);
      await c.query(d.replace(GUARDA_ABRIR, ""));
      const r = await abrir(c, "NaN");
      assert.ok(
        !r.erro,
        "sem a guarda o abrir ainda recusou NaN: a recusa vinha de outra coisa",
      );
    });
    await isolado(c, async () => {
      const d = await definicao(c, SIG_CONTA);
      const alterado = d.replace(GUARDA_CONTA, "");
      assert.notEqual(alterado, d, "mutante nao tirou a guarda da conta");
      await c.query(alterado);
      const r = await salvar(c, {
        nome: "Sem guarda",
        tipo: "banco",
        saldo_inicial: "NaN",
      });
      assert.ok(
        !r.erro,
        "sem a guarda a conta ainda recusou NaN: a recusa vinha de outra coisa",
      );
    });

    console.log(
      "PASSOU 20261399930000: NaN/infinito/acima do teto recusam 22023 sem escrever (abrir e conta, criar e editar); valido, negativo da conta, nulo e chave ausente seguem; conta NaN antiga preservada e curavel; permissao antes da guarda; reaplicacao/CRLF; pre-voo; rollback exato e segundo rollback recusa; consultas 128a/128b; controle sem a guarda.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
