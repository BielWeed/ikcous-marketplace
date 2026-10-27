"use strict";

/**
 * Prova VIVA da migration 20261394100000 (a lista de recomendacoes do produto tem teto: `get_product_recommendations`
 * limita `p_limit` a 50 e trata NULL como o padrao 4), num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261394100000 (em CI ela tem), TODO caso
 * comeca pelo estado ANTES (o corpo da 20261160, instalado por CREATE OR REPLACE direto, byte a byte, lido do arquivo) ou
 * pelo estado DEPOIS (a propria migration). Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  ANTES      controle: 1000000 e NULL devolvem os 60 produtos de uma vez (o defeito).
 *  DEPOIS     o teto (1, 4, 50 passam; 51, 100, 1000000 dao 50), NULL = 4, 0 e negativo = 1, omitido = 4; a categoria com
 *             poucos parentes devolve so os que existem; a lista ate o teto e' IDENTICA a de antes (mesmos ids, mesma
 *             ordem); custo e fornecedor continuam NULOS; so produto ativo com estoque e nunca o proprio; anon,
 *             authenticated e service_role chamam.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA (sem teto, teto 51, teto 49, sem o COALESCE do NULL,
 *             sem o piso, NULL com outro padrao, o corpo antigo).
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (md5 e sha256) e a mesma ACL e o
 *             segundo rollback recusa; o pre-voo recusa SEM escrever em cada estado ruim; o pos-voo recusa cada estrago; o
 *             pos-voo reprovando desfaz a troca (conexao sem BEGIN); consultas 107a/107b e a 9a.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const CONSULTAS = path.join(RAIZ, "scripts", "publicacao", "consultas");
const ARQ = "20261394100000_a_lista_de_recomendacoes_do_produto_tem_teto.sql";
const norm = (s) => s.replace(/\r\n/g, "\n");
const ler = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, nome), "utf8");
const MIGRATION = ler(ARQ);
const ROLLBACK = ler(`rollback-manual-${ARQ}`);
const SRC_160 = ler(
  "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
);
const A107 = lerConsulta(
  "107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado.sql",
);
const B107 = lerConsulta(
  "107b-antes-a-lista-de-recomendacoes-do-produto-tem-teto-base-vigente.sql",
);
const A9 = lerConsulta("9a-conferir-60-a-66-aplicado.sql");
const CONFERIR_BANCO = fs.readFileSync(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const NOME_FN = "get_product_recommendations";
const FN = `public.${NOME_FN}(uuid, integer)`;

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$function$;`: { cabeca (ate o `AS $function$`), corpo }. */
function funcaoDe(sql, fn) {
  const delim = "$function$";
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf(delim, ini);
  const corpoIni = ab + delim.length;
  const fim = sql.indexOf(delim, corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const decl = (f, corpo = f.corpo) => `${f.cabeca + corpo}$function$;`;

// O corpo ANTIGO e' o vivo (o da 20261160), LIDO DO ARQUIVO, nunca copiado para ca.
const ANTIGA = funcaoDe(SRC_160, NOME_FN);
const NOVA = funcaoDe(MIGRATION, NOME_FN);
const ROLL = funcaoDe(ROLLBACK, NOME_FN);
const H_ANTIGO = "3de5b27cc17c31301249861b7921a6fe";
const H_NOVO = "5e5bbe7bc7f12738a9082232ee6cfee6";
// MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar o corpo roda so a
// prova de COMPORTAMENTO, sem as travas de hash e de bytes que reprovariam a edicao antes de qualquer comportamento ser
// medido. Nunca roda em CI.
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";
assert.equal(md5(ANTIGA.corpo), H_ANTIGO, "o corpo vivo mudou");
if (!MUTADO)
  assert.equal(md5(NOVA.corpo), H_NOVO, "o corpo desta migration mudou");
assert.equal(
  ROLL.corpo,
  ANTIGA.corpo,
  "o rollback nao e o corpo vivo byte a byte",
);
assert.equal(ROLL.cabeca, ANTIGA.cabeca, "a declaracao do rollback mudou");
assert.equal(
  NOVA.cabeca,
  ANTIGA.cabeca,
  "a declaracao mudou (assinatura, atributos)",
);

// O corpo NOVO = o antigo com UMA troca (a linha do LIMIT, mais tres linhas de comentario antes dela) e mais nada.
const LIMITE_ANTIGO = "    LIMIT p_limit;\n";
const TETO = "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50)";
const LIMITE_NOVO = `    LIMIT ${TETO};\n`;
if (!MUTADO) {
  assert.equal(
    ANTIGA.corpo.split(LIMITE_ANTIGO).length - 1,
    1,
    "o LIMIT antigo nao e unico",
  );
  const iNovo = NOVA.corpo.indexOf(LIMITE_NOVO);
  assert.ok(iNovo > 0, "o LIMIT novo nao esta no corpo novo");
  const comentario = NOVA.corpo.slice(
    NOVA.corpo.lastIndexOf("\n    -- 20261394100000:", iNovo) + 1,
    iNovo,
  );
  assert.equal(
    comentario.split("\n").filter(Boolean).length,
    3,
    "o comentario da troca tem 3 linhas",
  );
  assert.equal(
    ANTIGA.corpo.replace(LIMITE_ANTIGO, () => comentario + LIMITE_NOVO),
    NOVA.corpo,
    "o corpo novo nao e o antigo com so a troca do LIMIT, byte a byte",
  );
}

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** O estado DEPOIS: a migration inteira (pre-voo, troca e pos-voo) ou, no modo mutante, so o corpo do arquivo. */
const instalarNova = () => C.query(MUTADO ? decl(NOVA) : MIGRATION);
/** O estado ANTES: o corpo vivo de antes (CREATE OR REPLACE direto; vale como o rollback, sem depender do pre-voo). */
const instalarAntiga = () => C.query(decl(ANTIGA));

const ACL_DE_SEMPRE = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h;
const prosrcVivo = async () =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.prosrc;
const oidVivo = async () =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN])).rows[0].o;
const aclBruto = async () =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.a;
const atributosVivos = async () =>
  (
    await C.query(
      "SELECT (to_jsonb(p) - 'prosrc')::text AS a FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.a;

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Uma transacao por caso, sempre desfeita, ja no estado pedido: "antes" (corpo vivo de antes) ou "depois" (migration). */
async function emTransacao(fn, { estado = "antes" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes" || estado === "depois") {
      await instalarAntiga();
      assert.equal(await hashVivo(), H_ANTIGO, "o estado ANTES nao montou");
    }
    if (estado === "depois") {
      await instalarNova();
      if (!MUTADO)
        assert.equal(await hashVivo(), H_NOVO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`; o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
    const linhas = (await C.query(sql, params)).rows;
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

// Ids deterministicos (os mesmos em toda transacao): a lista de antes e a de depois comparam-se id a id.
const idDe = (prefixo, n) =>
  `7e7e2394-1000-4000-${prefixo}-${String(n).padStart(12, "0")}`;
const BASE = idDe("8000", 0);
const BASE_PEQ = idDe("8001", 0);
const RELACIONADOS = 60;
const SO_3 = 3;

/** 1 produto-base e 60 parentes ativos com estoque na MESMA categoria (mais recente primeiro), e a categoria pequena. */
async function semear() {
  const cols =
    "id, nome, preco_venda, estoque, ativo, custo, categoria, data_cadastro, frete_gratis";
  await C.query(
    `INSERT INTO public.produtos (${cols}) VALUES ($1, 'Base 394b', 100, 5, true, 40, 'Cat394b', now(), false)`,
    [BASE],
  );
  await C.query(
    `INSERT INTO public.produtos (${cols})
     SELECT ('7e7e2394-1000-4000-8002-' || lpad(g::text, 12, '0'))::uuid, 'Parente ' || g, 100, 5, true, 40, 'Cat394b',
            now() - (g || ' minutes')::interval, false
       FROM generate_series(1, ${RELACIONADOS}) g`,
  );
  // O que NAO pode entrar na lista: inativo, sem estoque, de outra categoria (sem tag em comum).
  await C.query(
    `INSERT INTO public.produtos (${cols}) VALUES
       ('7e7e2394-1000-4000-8003-000000000001', 'Inativo', 100, 5, false, 40, 'Cat394b', now(), false),
       ('7e7e2394-1000-4000-8003-000000000002', 'Sem estoque', 100, 0, true, 40, 'Cat394b', now(), false),
       ('7e7e2394-1000-4000-8003-000000000003', 'Outra categoria', 100, 5, true, 40, 'Outra394b', now(), false)`,
  );
  // A categoria pequena: o produto-base e SO 3 parentes.
  await C.query(
    `INSERT INTO public.produtos (${cols}) VALUES ($1, 'Base pequena 394b', 100, 5, true, 40, 'Peq394b', now(), false)`,
    [BASE_PEQ],
  );
  await C.query(
    `INSERT INTO public.produtos (${cols})
     SELECT ('7e7e2394-1000-4000-8004-' || lpad(g::text, 12, '0'))::uuid, 'Parente pequeno ' || g, 100, 5, true, 40, 'Peq394b',
            now() - (g || ' minutes')::interval, false
       FROM generate_series(1, ${SO_3}) g`,
  );
}

const CHAMADA = {
  com: "SELECT id, custo, fornecedor_id FROM public.get_product_recommendations($1::uuid, $2::integer)",
  omitido:
    "SELECT id, custo, fornecedor_id FROM public.get_product_recommendations($1::uuid)",
};
const chamar = (papel, base, limite) =>
  tentar(papel, CHAMADA.com, [base, limite]);
const ids = (r) => r.linhas.map((l) => l.id);

/**
 * Cada verificacao devolve a lista de FALHAS (vazia = ok), com o nome da verificacao no inicio. As mesmas verificacoes
 * rodam no estado DEPOIS (tem de dar vazio) e em cada mutante (tem de dar a verificacao certa vermelha).
 */
const CHECKS = {
  /** O teto: 1, 4 e 50 passam; 51, 100 e 1000000 dao 50; NULL = 4; omitido = 4; 0 e negativo = 1. */
  async teto() {
    const f = [];
    const casos = [
      [1, 1],
      [4, 4],
      [7, 7],
      [50, 50],
      [51, 50],
      [100, 50],
      [1000000, 50],
      [2147483647, 50],
      [null, 4],
      [0, 1],
      [-3, 1],
    ];
    for (const [limite, esperado] of casos) {
      const r = await chamar("anon", BASE, limite);
      if (!r.linhas) {
        f.push(`teto(limite ${limite}): erro ${r.erro}`);
        continue;
      }
      if (r.linhas.length !== esperado)
        f.push(
          `teto(limite ${limite}): ${r.linhas.length} linhas (esperado ${esperado})`,
        );
    }
    const omitido = await tentar("anon", CHAMADA.omitido, [BASE]);
    if (!omitido.linhas || omitido.linhas.length !== 4)
      f.push(
        `teto(limite omitido): ${omitido.linhas?.length ?? omitido.erro} (esperado 4)`,
      );
    return f;
  },
  /** Categoria com so 3 parentes: o teto nunca inventa linha. */
  async poucosParentes() {
    const f = [];
    for (const limite of [1, 3, 4, 10, 50, 51, 1000000, null]) {
      const r = await chamar("anon", BASE_PEQ, limite);
      const esperado = limite === null ? SO_3 : Math.min(limite, SO_3);
      if (!r.linhas || r.linhas.length !== esperado)
        f.push(
          `poucosParentes(limite ${limite}): ${r.linhas?.length ?? r.erro} (esperado ${esperado})`,
        );
    }
    return f;
  },
  /** Ate o teto a lista e' a de sempre: os mais recentes primeiro, sem o proprio, sem inativo, sem estoque zero, sem outra categoria. */
  async conteudo() {
    const f = [];
    const r = await chamar("anon", BASE, 50);
    if (!r.linhas) return [`conteudo: erro ${r.erro}`];
    const esperado = Array.from({ length: 50 }, (_, i) => idDe("8002", i + 1));
    if (JSON.stringify(ids(r)) !== JSON.stringify(esperado))
      f.push(
        "conteudo: os 50 ids (ou a ordem) nao sao os 50 parentes mais recentes",
      );
    for (const l of r.linhas) {
      if (l.custo !== null) f.push(`conteudo: custo saiu (${l.custo})`);
      if (l.fornecedor_id !== null)
        f.push(`conteudo: fornecedor_id saiu (${l.fornecedor_id})`);
    }
    const todos = new Set(ids(await chamar("anon", BASE, 1000000)));
    for (const proibido of [
      BASE,
      "7e7e2394-1000-4000-8003-000000000001",
      "7e7e2394-1000-4000-8003-000000000002",
      "7e7e2394-1000-4000-8003-000000000003",
    ])
      if (todos.has(proibido))
        f.push(`conteudo: ${proibido} nao devia estar na lista`);
    return f;
  },
  /** Quem chama: anon (a vitrine), authenticated e service_role. */
  async papeis() {
    const f = [];
    for (const papel of ["anon", "authenticated", "service_role"]) {
      const r = await chamar(papel, BASE, 4);
      if (!r.linhas || r.linhas.length !== 4)
        f.push(`papeis(${papel}): ${r.linhas?.length ?? r.erro} (esperado 4)`);
    }
    return f;
  },
};

/** Roda todas as verificacoes, cada uma numa transacao propria que termina em ROLLBACK. */
async function todasAsVerificacoes(montarEstado) {
  const falhas = [];
  for (const [nome, check] of Object.entries(CHECKS)) {
    await C.query("BEGIN");
    try {
      await montarEstado();
      await semear();
      for (const f of await check()) falhas.push(f);
    } catch (e) {
      falhas.push(`${nome}: EXCECAO ${e.message}`);
    } finally {
      await C.query("ROLLBACK");
    }
  }
  return falhas;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261160, byte a byte) 1000000 e NULL devolvem os 60 produtos de uma vez, e 51 devolve 51 (o defeito); 0 devolve 0 e negativo da erro (o que a migration muda)",
  () =>
    emTransacao(async () => {
      assert.equal(await prosrcVivo(), ANTIGA.corpo);
      assert.deepEqual(
        (
          await C.query(
            "SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE p.oid = to_regprocedure($1)",
            [FN],
          )
        ).rows[0].a,
        ACL_DE_SEMPRE,
      );
      await semear();
      assert.equal(
        (await chamar("anon", BASE, 1000000)).linhas.length,
        RELACIONADOS,
        "1000000 devia levar tudo",
      );
      assert.equal(
        (await chamar("anon", BASE, null)).linhas.length,
        RELACIONADOS,
        "NULL devia levar tudo",
      );
      assert.equal((await chamar("anon", BASE, 51)).linhas.length, 51);
      assert.equal((await chamar("anon", BASE, 0)).linhas.length, 0);
      assert.ok(
        (await chamar("anon", BASE, -3)).erro,
        "negativo devia dar erro",
      );
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: o teto (1, 4, 50 passam; 51, 100, 1000000 e 2147483647 dao 50; NULL e omitido = 4; 0 e negativo = 1); poucos parentes devolvem so os que existem; a lista ate o teto e' a de sempre (50 mais recentes, sem o proprio, sem inativo, sem estoque zero, custo e fornecedor NULOS); anon, authenticated e service_role chamam",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

prova(
  "DIFERENCIAL: ate o teto, a lista de depois e' IDENTICA a de antes (mesmos ids, mesma ordem) para 1, 4, 7, 25 e 50",
  async () => {
    const lista = async (estado) =>
      emTransacao(
        async () => {
          await semear();
          const m = {};
          for (const limite of [1, 4, 7, 25, 50])
            m[limite] = ids(await chamar("anon", BASE, limite));
          m.pequena = ids(await chamar("anon", BASE_PEQ, 10));
          return m;
        },
        { estado },
      );
    const antes = await lista("antes");
    const depois = await lista("depois");
    assert.deepEqual(depois, antes, "a lista mudou");
    assert.equal(depois[50].length, 50);
  },
);

// ---------------------------------------------------------------------------
// MUTANTES: cada regra sabotada deixa a verificacao certa vermelha
// ---------------------------------------------------------------------------

const trocar = (de, para) => (corpo) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `a ancora do mutante nao e unica: ${de}`,
  );
  return corpo.replace(de, () => para);
};
const MUTANTES = {
  "sem teto (so o piso e o COALESCE)": {
    aplica: trocar(TETO, "GREATEST(COALESCE(p_limit, 4), 1)"),
    vermelho: ["teto(limite 51", "teto(limite 1000000"],
  },
  "teto em 51 (erra a borda)": {
    aplica: trocar(TETO, "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 51)"),
    vermelho: ["teto(limite 51", "teto(limite 100"],
  },
  "teto em 49 (erra a borda para baixo)": {
    aplica: trocar(TETO, "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 49)"),
    vermelho: ["teto(limite 50"],
  },
  "sem o COALESCE: NULL vira 1 em vez do padrao 4": {
    aplica: trocar(TETO, "LEAST(GREATEST(p_limit, 1), 50)"),
    vermelho: ["teto(limite null"],
  },
  "NULL com outro padrao (5)": {
    aplica: trocar(TETO, "LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50)"),
    vermelho: ["teto(limite null"],
  },
  "sem o piso: 0 devolve nada e negativo da erro": {
    aplica: trocar(TETO, "LEAST(COALESCE(p_limit, 4), 50)"),
    vermelho: ["teto(limite 0", "teto(limite -3"],
  },
  "o corpo antigo (LIMIT p_limit)": {
    aplica: (corpo) => trocar(TETO, "p_limit")(corpo),
    vermelho: ["teto(limite 51", "teto(limite null"],
  },
  "o teto vale so para quem passa de 100 (cap em duas faixas)": {
    aplica: trocar(
      TETO,
      "CASE WHEN p_limit > 100 THEN 50 ELSE COALESCE(p_limit, 4) END",
    ),
    vermelho: ["teto(limite 51"],
  },
  "a ordem muda (os mais antigos primeiro): a lista nao e' a de sempre": {
    aplica: trocar(
      "        p.data_cadastro DESC\n",
      "        p.data_cadastro ASC\n",
    ),
    vermelho: ["conteudo: os 50 ids"],
  },
  "o custo vaza (volta o valor real)": {
    aplica: trocar(
      "NULL::numeric(10,2),  -- custo: nunca sai desta funcao",
      "p.custo,",
    ),
    vermelho: ["conteudo: custo saiu"],
  },
};
for (const [nome, { aplica, vermelho }] of Object.entries(MUTANTES)) {
  prova(`MUTANTE vermelho — ${nome}`, async () => {
    const instalar = async () => {
      await instalarAntiga();
      const mutado = aplica(NOVA.corpo);
      assert.notEqual(mutado, NOVA.corpo, "a sabotagem nao mudou o corpo");
      await C.query(decl(NOVA, mutado));
    };
    const falhas = await todasAsVerificacoes(instalar);
    assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
    for (const alvo of vermelho)
      assert.ok(
        falhas.some((x) => x.includes(alvo)),
        `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.slice(0, 6).join(" | ")}`,
      );
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
  });
}

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, pos-voo, atomicidade
// ---------------------------------------------------------------------------

const retrato = async () => ({
  h: await hashVivo(),
  src: sha256(await prosrcVivo()),
  oid: await oidVivo(),
  acl: await aclBruto(),
  atributos: await atributosVivos(),
});

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); o rollback devolve o prosrc IDENTICO (md5 e sha256) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      const original = await retrato();
      assert.equal(original.src, sha256(ANTIGA.corpo));
      assert.equal(await aplicar(MIGRATION), null);
      const um = await retrato();
      assert.equal(um.h, H_NOVO);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      const crlf = await retrato();
      assert.equal(crlf.h, um.h, "CRLF: o hash (sem CR) tem de ser o mesmo");
      assert.equal(crlf.oid, um.oid);
      assert.equal(crlf.acl, um.acl);
      assert.equal(crlf.atributos, um.atributos);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(
        await retrato(),
        original,
        "o rollback nao devolveu o estado original byte a byte",
      );
      const segundo = await aplicar(ROLLBACK);
      assert.ok(segundo, "o segundo rollback devia recusar");
      assert.match(segundo.erro, /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await retrato(),
        original,
        "o segundo rollback escreveu",
      );
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      assert.equal((await retrato()).h, H_ANTIGO, "rollback em CRLF");
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "ida, volta e ida");
    }),
);

const ESTADOS_RUINS = {
  "corpo desconhecido (um comentario a mais)": () =>
    C.query(
      decl(ANTIGA, `${ANTIGA.corpo}\n-- redefinicao que ninguem revisou\n`),
    ),
  "atributo diferente (STABLE)": () => C.query(`ALTER FUNCTION ${FN} STABLE`),
  "atributo diferente (SECURITY INVOKER)": () =>
    C.query(`ALTER FUNCTION ${FN} SECURITY INVOKER`),
  "sobrecarga (outra get_product_recommendations)": () =>
    C.query(
      `CREATE FUNCTION public.${NOME_FN}(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    ),
  "funcao ausente (apagada)": () => C.query(`DROP FUNCTION ${FN}`),
  "ACL aberta (PUBLIC executa)": () =>
    C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
  "anon sem EXECUTE: a vitrine quebraria": () =>
    C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`),
  "authenticated sem EXECUTE": () =>
    C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
  "service_role sem EXECUTE": () =>
    C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
  "corpo mais velho que o vigente (o da baseline)": async () => {
    const velha = funcaoDe(
      ler("20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql"),
      NOME_FN,
    );
    await C.query(decl(velha));
  },
};

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; o corpo nao muda) e o rollback-manual tambem",
  () =>
    emTransacao(async () => {
      for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
        await C.query("SAVEPOINT ruim");
        await ruim();
        const fotoAntes = await prosrcVivo();
        const erro = await aplicar(MIGRATION);
        assert.ok(erro, `${nome}: a migration devia recusar`);
        assert.match(
          erro.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: ${erro.erro}`,
        );
        assert.equal(
          await prosrcVivo(),
          fotoAntes,
          `${nome}: o pre-voo escreveu`,
        );
        const rb = await aplicar(ROLLBACK);
        assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
        assert.match(
          rb.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: rollback: ${rb.erro}`,
        );
        assert.equal(
          await prosrcVivo(),
          fotoAntes,
          `${nome}: o pre-voo do rollback escreveu`,
        );
        await C.query("ROLLBACK TO SAVEPOINT ruim");
      }
    }),
);

const bloco = (sql, nome) => {
  const ini = sql.indexOf(`DO $${nome}$`);
  const fim = sql.indexOf(`END $${nome}$;`) + `END $${nome}$;`.length;
  assert.ok(ini >= 0 && fim > ini, `bloco ${nome} nao achado`);
  return sql.slice(ini, fim);
};

prova(
  "MIGRATION: o pos-voo PASSA no estado novo e RECUSA corpo antigo, o teto duplicado, atributo mudado, PUBLIC aberto e anon sem EXECUTE; mudar o dono entre o pre-voo e o pos-voo tambem reprova",
  () =>
    emTransacao(async () => {
      const PREVOO = bloco(MIGRATION, "preflight_20261394100000");
      const POSVOO = bloco(MIGRATION, "posvoo_20261394100000");
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(PREVOO), null);
      assert.equal(
        await aplicar(POSVOO),
        null,
        "o pos-voo reprovou o estado bom",
      );
      for (const [nome, estrago, padrao] of [
        ["corpo antigo", () => C.query(decl(ANTIGA)), /corpo vivo/],
        [
          "o teto duplicado (hash diferente)",
          () =>
            C.query(
              decl(
                NOVA,
                NOVA.corpo.replace(
                  LIMITE_NOVO,
                  () => `${LIMITE_NOVO}    -- LIMIT ${TETO};\n`,
                ),
              ),
            ),
          /corpo vivo/,
        ],
        [
          "atributo (STABLE)",
          () => C.query(`ALTER FUNCTION ${FN} STABLE`),
          /atributos de .* mudaram/,
        ],
        [
          "PUBLIC aberto",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
          /ACL de/,
        ],
        [
          "anon sem EXECUTE",
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`),
          /ACL de/,
        ],
      ]) {
        await C.query("SAVEPOINT estrago");
        await estrago();
        const erro = await aplicar(POSVOO);
        assert.ok(erro, `${nome}: o pos-voo devia recusar`);
        assert.match(erro.erro, /POSVOO_20261394100000/);
        assert.match(erro.erro, padrao, `${nome}: ${erro.erro}`);
        await C.query("ROLLBACK TO SAVEPOINT estrago");
      }
      await C.query("SAVEPOINT dono");
      await C.query("CREATE ROLE recs394_dono NOLOGIN");
      await C.query(`ALTER FUNCTION ${FN} OWNER TO recs394_dono`);
      const erroDono = await aplicar(POSVOO);
      assert.ok(erroDono, "mudar o dono devia reprovar o pos-voo");
      assert.match(erroDono.erro, /POSVOO_20261394100000/);
      await C.query("ROLLBACK TO SAVEPOINT dono");
    }),
);

prova(
  "MIGRATION: o pos-voo reprovando DESFAZ a troca — uma migration cujo corpo novo sai com 1 byte a mais aborta no pos-voo e a funcao fica como estava; o arquivo vai como UMA mensagem (uma transacao implicita, conexao SEM BEGIN)",
  async () => {
    const sabotada = MIGRATION.replace(decl(NOVA), () =>
      decl(NOVA, `${NOVA.corpo}\n-- um byte a mais\n`),
    );
    assert.notEqual(sabotada, MIGRATION);
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      await solto.query(decl(ANTIGA)); // estado ANTES, de verdade (clone descartavel)
      const lido = async () =>
        (
          await solto.query(
            "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN],
          )
        ).rows[0].h;
      assert.equal(await lido(), H_ANTIGO);
      await assert.rejects(
        () => solto.query(sabotada),
        /POSVOO_20261394100000/,
      );
      assert.equal(
        await lido(),
        H_ANTIGO,
        "o pos-voo reprovou mas a troca ficou gravada",
      );
      await solto.query(MIGRATION);
      assert.equal(await lido(), H_NOVO);
      await solto.query(ROLLBACK);
      assert.equal(await lido(), H_ANTIGO);
      await assert.rejects(
        () => solto.query(ROLLBACK),
        /B1_BASELINE_DIVERGENT/,
      );
      assert.equal(await lido(), H_ANTIGO);
      await solto.query(MIGRATION);
      assert.equal(await lido(), H_NOVO);
    } finally {
      await solto.end();
    }
  },
);

// ---------------------------------------------------------------------------
// CONSULTAS 107a / 107b e a 9a
// ---------------------------------------------------------------------------

const rodarConsulta = async (sql) => (await C.query(sql)).rows;
const mapa = (linhas) => Object.fromEntries(linhas.map((l) => [l.item, l.ok]));

prova(
  "CONSULTAS: 107a/107b tem rol fechado de 4 linhas (os rotulos do conferir-banco), positivas no estado certo; a 107a reprova no ANTES e a 107b no DEPOIS, nos itens certos; a 9a segue positiva nos DOIS estados no item desta funcao; cada desvio da 107a cai no item certo",
  async () => {
    const rodarTodas = async () => ({
      a: await rodarConsulta(A107),
      b: await rodarConsulta(B107),
      nove: (await rodarConsulta(A9)).filter(
        (l) => l.item === `corpo final ${NOME_FN}`,
      ),
    });
    const depois = await emTransacao(rodarTodas, { estado: "depois" });
    const antes = await emTransacao(rodarTodas, { estado: "antes" });
    for (const c of [depois.a, depois.b, antes.a, antes.b]) {
      assert.equal(c.length, 4, "rol fechado de 4 linhas");
      assert.equal(new Set(c.map((l) => l.item)).size, 4);
    }
    for (const l of [...depois.a, ...depois.b])
      assert.ok(
        CONFERIR_BANCO.includes(`"${l.item}"`),
        `rotulo fora do rol do conferir-banco: ${l.item}`,
      );
    const FIXOS = [
      "controle: funcoes de public visiveis a este papel",
      "get_product_recommendations: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, SETOF produtos; anon, authenticated e service_role, sem PUBLIC)",
    ];
    assert.ok(
      depois.a.every((l) => l.ok),
      JSON.stringify(depois.a.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(depois.b)))
      assert.equal(ok, FIXOS.includes(item), `107b DEPOIS: ${item}`);
    assert.ok(
      antes.b.every((l) => l.ok),
      JSON.stringify(antes.b.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(antes.a)))
      assert.equal(ok, FIXOS.includes(item), `107a ANTES: ${item}`);
    // A 9a: o corpo final desta funcao e' positivo nos dois estados (aceita o corpo desta migration como sucessor do da 160).
    for (const estado of [depois, antes]) {
      assert.equal(estado.nove.length, 1);
      assert.equal(estado.nove[0].ok, true, JSON.stringify(estado.nove));
    }
    // Cada desvio da 107a (no estado novo) cai no item certo.
    const casos = [
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, FIXOS[1]],
      [`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`, FIXOS[1]],
      [`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`, FIXOS[1]],
      [`ALTER FUNCTION ${FN} SECURITY INVOKER`, FIXOS[1]],
      [
        decl(NOVA, `${NOVA.corpo}\n-- sabotagem\n`),
        "get_product_recommendations: corpo exato (md5)",
      ],
      [
        decl(
          NOVA,
          NOVA.corpo.replace(
            LIMITE_NOVO,
            () => `${LIMITE_NOVO}    -- ${LIMITE_NOVO.trim()}\n`,
          ),
        ),
        "get_product_recommendations: o corpo traz o teto do limite (uma vez)",
      ],
    ];
    for (const [sabotar, itemQueCai] of casos)
      await emTransacao(
        async () => {
          await C.query(sabotar);
          const caiu = (await rodarConsulta(A107))
            .filter((l) => !l.ok)
            .map((l) => l.item);
          assert.ok(
            caiu.includes(itemQueCai),
            `${sabotar.slice(0, 60)}: caiu ${JSON.stringify(caiu)}`,
          );
        },
        { estado: "depois" },
      );
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  let ok = 0;
  const falhas = [];
  // No modo mutante de arquivo roda SO a prova de comportamento (ver MUTADO).
  const lista = MUTADO
    ? PROVAS.filter((p) => p.nome.startsWith("DEPOIS:"))
    : PROVAS;
  try {
    for (const { nome, corpo } of lista) {
      try {
        await corpo();
        ok++;
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push({ nome, erro: e });
        console.log(
          `  FALHOU  ${nome}\n      ${String(e.stack || e.message)
            .split("\n")
            .join("\n      ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(`\n${ok}/${lista.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
