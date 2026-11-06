"use strict";

/**
 * Prova VIVA da migration 20261399800000 (as recomendacoes do produto contam o estoque das variacoes: `get_product_recommendations`
 * troca o filtro `p.estoque > 0`, sobre a coluna crua, pela regra da vitrine - com ao menos uma variacao ATIVA, a soma de
 * `stock_increment` das ativas; senao, a coluna), num Postgres EFEMERO local, sem rede, com os papeis de verdade (anon,
 * authenticated, service_role).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261399800000 (em CI ela tem), TODO caso
 * comeca pelo estado ANTES (o corpo da 20261394100000, instalado por CREATE OR REPLACE direto, byte a byte, lido do arquivo) ou
 * pelo estado DEPOIS (a propria migration). Cada caso roda numa transacao que termina em ROLLBACK.
 *
 * O ORACULO da regra (`efetivo`, abaixo) e' escrito AQUI, em JS, copiando src/lib/mappers.ts, e nunca consulta o SQL que prova.
 *
 *  ANTES      controle: na MESMA fixture o corpo antigo faz o esgotado com grade ocupar vaga e o que tem saldo so na grade sumir.
 *  DEPOIS     (a) coluna 2 + grade ativa somando 0 SAI; (b) coluna 0 + variacao ativa com saldo ENTRA; (c) sem variacao usa a
 *             coluna; (d) variacao inativa, active NULL e estoque NULL nao contam; bordas (1 na grade, 1 na coluna); o filtro de
 *             ativo e de categoria/tags e a ORDEM seguem; as 4 vagas (LIMIT 4 e o padrao omitido) sao as do oraculo; o teto de 50, NULL = 4 e
 *             0/negativo = 1 seguem valendo; a coluna `estoque` devolvida continua a crua; custo e fornecedor NULOS; anon,
 *             authenticated e service_role chamam; produto sem variacao responde IGUAL ao corpo antigo.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA (filtro antigo, soma de inativas, EXISTS sem ativa, sem o ramo
 *             da coluna, GREATEST, soma sem o produto, borda > 1, active NULL ativa, produto inativo, sem teto, ordem, custo).
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO ao da 20261394100000 (md5 e sha256) e a mesma
 *             ACL e o segundo rollback recusa; o pre-voo recusa SEM escrever em cada estado ruim (corpo desconhecido, corpo da
 *             20261160, atributo, sobrecarga, ausente, ACL, dono, coluna de product_variants ausente); o pos-voo recusa cada estrago e
 *             a fumaca pega corpo que nao compila; o pos-voo reprovando desfaz a troca (conexao sem BEGIN); consultas 124a/124b, 107a e 9a.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-viva.cjs
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
const ARQ =
  "20261399800000_as_recomendacoes_do_produto_contam_o_estoque_das_variacoes.sql";
const norm = (s) => s.replace(/\r\n/g, "\n");
const ler = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, nome), "utf8");
const MIGRATION = ler(ARQ);
const ROLLBACK = ler(`rollback-manual-${ARQ}`);
const SRC_394 = ler(
  "20261394100000_a_lista_de_recomendacoes_do_produto_tem_teto.sql",
);
const SRC_160 = ler(
  "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
);
const A124 = lerConsulta(
  "124a-conferir-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-aplicado.sql",
);
const B124 = lerConsulta(
  "124b-antes-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-base-vigente.sql",
);
const A107 = lerConsulta(
  "107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado.sql",
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

// O corpo ANTIGO e' o vivo (o da 20261394100000), LIDO DO ARQUIVO, nunca copiado para ca.
const ANTIGA = funcaoDe(SRC_394, NOME_FN);
const NOVA = funcaoDe(MIGRATION, NOME_FN);
const ROLL = funcaoDe(ROLLBACK, NOME_FN);
const H_ANTIGO = "5e5bbe7bc7f12738a9082232ee6cfee6";
const H_NOVO = "9b9fa184eb3984e8afd3ec0f80a086e7";
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

// O corpo NOVO = o antigo com UMA troca (a linha do filtro, mais tres linhas de comentario antes dela) e mais nada.
const FILTRO_VELHO = "AND p.estoque > 0";
const LINHA_VELHA = `      ${FILTRO_VELHO}\n`;
const EXISTE_ATIVA =
  "EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active)";
const SOMA_ATIVAS =
  "(SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.product_id = p.id AND v.active)";
const FILTRO_NOVO = `AND CASE WHEN ${EXISTE_ATIVA} THEN ${SOMA_ATIVAS} ELSE p.estoque END > 0`;
const LINHA_NOVA = `      ${FILTRO_NOVO}\n`;
const TETO = "LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50)";
if (!MUTADO) {
  assert.equal(
    ANTIGA.corpo.split(LINHA_VELHA).length - 1,
    1,
    "o filtro antigo nao e unico no corpo vivo",
  );
  assert.equal(
    NOVA.corpo.includes(FILTRO_VELHO),
    false,
    "o filtro antigo ficou no corpo novo",
  );
  const iNovo = NOVA.corpo.indexOf(LINHA_NOVA);
  assert.ok(iNovo > 0, "o filtro novo nao esta no corpo novo");
  const comentario = NOVA.corpo.slice(
    NOVA.corpo.lastIndexOf("\n      -- 20261399800000:", iNovo) + 1,
    iNovo,
  );
  assert.equal(
    comentario.split("\n").filter(Boolean).length,
    3,
    "o comentario da troca tem 3 linhas",
  );
  assert.equal(
    ANTIGA.corpo.replace(LINHA_VELHA, () => comentario + LINHA_NOVA),
    NOVA.corpo,
    "o corpo novo nao e o antigo com so a troca do filtro, byte a byte",
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

// ---------------------------------------------------------------------------
// A FIXTURE e o ORACULO (a regra da vitrine, escrita fora do SQL)
// ---------------------------------------------------------------------------

// Ids deterministicos (os mesmos em toda transacao): a lista de antes e a de depois comparam-se id a id.
const idDe = (prefixo, n) =>
  `7e7e2399-1000-4000-${prefixo}-${String(n).padStart(12, "0")}`;
const CAT = "Cat399w";
const TAG = "tag399w";
const BASE_A = idDe("8000", 0);

/** A regra de src/lib/mappers.ts: com ao menos uma variacao ATIVA, a soma (Number(null) || 0) das ativas; senao, a coluna. */
const efetivo = (c) => {
  const ativas = c.variacoes.filter((v) => v.active === true);
  return ativas.length > 0
    ? ativas.reduce((acc, v) => acc + (v.stock ?? 0), 0)
    : c.estoque;
};

/**
 * Os candidatos do produto-base A, do mais NOVO (n = 1) ao mais antigo: `caso` e' a letra do que cada um prova.
 * `entra` e' escrito a mao ao lado da conta so para o leitor; o oraculo usa `efetivo`, e a prova confere os dois.
 */
const CASOS_A = [
  {
    n: 1,
    nome: "Esgotado com grade",
    caso: "a",
    estoque: 2,
    variacoes: [
      { active: true, stock: 0 },
      { active: true, stock: 0 },
    ],
    entra: false,
  },
  {
    n: 2,
    nome: "Saldo so na grade",
    caso: "b",
    estoque: 0,
    variacoes: [
      { active: true, stock: 3 },
      { active: true, stock: 0 },
    ],
    entra: true,
  },
  {
    n: 3,
    nome: "Simples com estoque",
    caso: "c",
    estoque: 5,
    variacoes: [],
    entra: true,
  },
  {
    n: 4,
    nome: "Simples zerado",
    caso: "c",
    estoque: 0,
    variacoes: [],
    entra: false,
  },
  {
    n: 5,
    nome: "Grade ativa zerada e inativa com saldo",
    caso: "d",
    estoque: 5,
    variacoes: [
      { active: true, stock: 0 },
      { active: false, stock: 9 },
    ],
    entra: false,
  },
  {
    n: 6,
    nome: "So variacao inativa usa a coluna (com estoque)",
    caso: "d",
    estoque: 4,
    variacoes: [{ active: false, stock: 0 }],
    entra: true,
  },
  {
    n: 7,
    nome: "So variacao inativa com saldo e coluna zero",
    caso: "d",
    estoque: 0,
    variacoes: [{ active: false, stock: 9 }],
    entra: false,
  },
  {
    n: 8,
    nome: "Active NULL e' inativa (coluna 6)",
    caso: "d",
    estoque: 6,
    variacoes: [{ active: null, stock: 8 }],
    entra: true,
  },
  {
    n: 9,
    nome: "Active NULL e' inativa (coluna 0)",
    caso: "d",
    estoque: 0,
    variacoes: [{ active: null, stock: 8 }],
    entra: false,
  },
  {
    n: 10,
    nome: "Estoque NULL da variacao ativa vale 0",
    caso: "d",
    estoque: 5,
    variacoes: [{ active: true, stock: null }],
    entra: false,
  },
  {
    n: 11,
    nome: "Borda: 1 na grade",
    caso: "borda",
    estoque: 0,
    variacoes: [{ active: true, stock: 1 }],
    entra: true,
  },
  {
    n: 12,
    nome: "Borda: 1 na coluna",
    caso: "borda",
    estoque: 1,
    variacoes: [],
    entra: true,
  },
  {
    n: 13,
    nome: "Grade de varios tamanhos",
    caso: "b",
    estoque: 0,
    variacoes: [
      { active: true, stock: 2 },
      { active: true, stock: 2 },
      { active: false, stock: 50 },
    ],
    entra: true,
  },
  {
    n: 14,
    nome: "Produto inativo com saldo na grade",
    caso: "ativo",
    estoque: 5,
    ativo: false,
    variacoes: [{ active: true, stock: 9 }],
    entra: false,
  },
  {
    n: 15,
    nome: "Outra categoria, sem tag, com saldo na grade",
    caso: "categoria",
    estoque: 5,
    categoria: "Outra399w",
    variacoes: [{ active: true, stock: 9 }],
    entra: false,
  },
  {
    n: 16,
    nome: "Outra categoria, tag em comum, saldo na grade",
    caso: "tag",
    estoque: 0,
    categoria: "Outra399w",
    tags: [TAG],
    variacoes: [{ active: true, stock: 5 }],
    entra: true,
  },
  {
    n: 17,
    nome: "Outra categoria, tag em comum, esgotado na grade",
    caso: "tag",
    estoque: 3,
    categoria: "Outra399w",
    tags: [TAG],
    variacoes: [{ active: true, stock: 0 }],
    entra: false,
  },
  {
    n: 18,
    nome: "Simples extra 18",
    caso: "c",
    estoque: 5,
    variacoes: [],
    entra: true,
  },
  {
    n: 19,
    nome: "Simples extra 19",
    caso: "c",
    estoque: 5,
    variacoes: [],
    entra: true,
  },
  {
    n: 20,
    nome: "Simples extra 20",
    caso: "c",
    estoque: 5,
    variacoes: [],
    entra: true,
  },
].map((c) => ({
  ativo: true,
  categoria: CAT,
  tags: null,
  ...c,
  id: idDe("8200", c.n),
}));
const entra = (c) =>
  c.ativo &&
  efetivo(c) > 0 &&
  (c.categoria === CAT || (c.tags ?? []).includes(TAG));
for (const c of CASOS_A)
  assert.equal(
    entra(c),
    c.entra,
    `a fixture e o oraculo discordam em "${c.nome}"`,
  );
/** A lista do oraculo: quem entra, categoria igual primeiro, depois do mais novo para o mais antigo (data_cadastro DESC). */
const ORACULO_A = CASOS_A.filter(entra).sort(
  (x, y) =>
    Number(y.categoria === CAT) - Number(x.categoria === CAT) || x.n - y.n,
);
const NOME_DE = Object.fromEntries(CASOS_A.map((c) => [c.id, c]));

// Grupo B (o teto e as 70 parentes): a cada 7 uma esgotada com grade (coluna 3, grade zerada) que o filtro antigo deixaria entrar.
const BASE_B = idDe("8100", 0);
const PARENTES_B = 70;
const validaB = (g) => g % 7 !== 0;
const ORACULO_B = Array.from({ length: PARENTES_B }, (_, i) => i + 1)
  .filter(validaB)
  .map((g) => idDe("8101", g));

// Grupo C (so produtos SEM variacao): o corpo novo tem de responder IGUAL ao antigo.
const BASE_C = idDe("8300", 0);
const COLUNAS_C = [5, 0, 3, 0, 1, 7, 0, 2, 9, 4];

async function semear() {
  const cols =
    "id, nome, preco_venda, estoque, ativo, custo, categoria, tags, data_cadastro, frete_gratis";
  const ins = (id, nome, estoque, ativo, categoria, tags, minutos) =>
    C.query(
      `INSERT INTO public.produtos (${cols})
       VALUES ($1, $2, 100, $3, $4, 40, $5, $6::text[], now() - ($7 || ' minutes')::interval, false)`,
      [id, nome, estoque, ativo, categoria, tags, String(minutos)],
    );
  const grade = (produto, i, v) =>
    C.query(
      `INSERT INTO public.product_variants (product_id, name, value, stock_increment, active)
       VALUES ($1, 'Tamanho', $2, $3, $4)`,
      [produto, `V${i}`, v.stock, v.active],
    );
  // Grupo A: o produto-base (com grade propria, so para provar que a dele nao importa) e os 20 candidatos.
  await ins(BASE_A, "Base 399w", 5, true, CAT, [TAG], 0);
  await grade(BASE_A, 1, { active: true, stock: 4 });
  for (const c of CASOS_A) {
    await ins(c.id, c.nome, c.estoque, c.ativo, c.categoria, c.tags, c.n);
    for (const [i, v] of c.variacoes.entries()) await grade(c.id, i + 1, v);
  }
  // Grupo B: base + 70 parentes na categoria grande; a cada 7, esgotada com grade.
  await ins(BASE_B, "Base grande 399w", 5, true, "CatGrande399w", null, 0);
  await C.query(
    `INSERT INTO public.produtos (${cols})
     SELECT ('7e7e2399-1000-4000-8101-' || lpad(g::text, 12, '0'))::uuid, 'Parente ' || g, 100,
            CASE WHEN g % 7 = 0 THEN 3 ELSE 5 END, true, 40, 'CatGrande399w', NULL,
            now() - (g || ' minutes')::interval, false
       FROM generate_series(1, ${PARENTES_B}) g`,
  );
  await C.query(
    `INSERT INTO public.product_variants (product_id, name, value, stock_increment, active)
     SELECT ('7e7e2399-1000-4000-8101-' || lpad(g::text, 12, '0'))::uuid, 'Tamanho', 'V1', 0, true
       FROM generate_series(1, ${PARENTES_B}) g WHERE g % 7 = 0`,
  );
  // Grupo C: so produto simples, colunas variadas.
  await ins(BASE_C, "Base simples 399w", 5, true, "CatSimples399w", null, 0);
  for (const [i, estoque] of COLUNAS_C.entries())
    await ins(
      idDe("8301", i + 1),
      `Simples C ${i + 1}`,
      estoque,
      true,
      "CatSimples399w",
      null,
      i + 1,
    );
}

const CHAMADA = {
  com: "SELECT id, nome, estoque, custo, fornecedor_id FROM public.get_product_recommendations($1::uuid, $2::integer)",
  omitido:
    "SELECT id, nome, estoque, custo, fornecedor_id FROM public.get_product_recommendations($1::uuid)",
};
const chamar = (papel, base, limite) =>
  tentar(papel, CHAMADA.com, [base, limite]);
const ids = (r) => r.linhas.map((l) => l.id);
const mesmos = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rotulo = (id) => (NOME_DE[id] ? `"${NOME_DE[id].nome}"` : id);

/**
 * Cada verificacao devolve a lista de FALHAS (vazia = ok), com o nome da verificacao e a letra do caso no inicio. As mesmas
 * verificacoes rodam no estado DEPOIS (tem de dar vazio) e em cada mutante (tem de dar a verificacao certa vermelha).
 */
const CHECKS = {
  /** (a)-(d), bordas, filtros e ordem: a lista inteira (limite 50) e' a do oraculo, id a id. */
  async faixaCompleta() {
    const f = [];
    const r = await chamar("anon", BASE_A, 50);
    if (!r.linhas) return [`faixaCompleta: erro ${r.erro}`];
    const vivos = new Set(ids(r));
    const esperados = new Set(ORACULO_A.map((c) => c.id));
    for (const c of CASOS_A) {
      if (vivos.has(c.id) && !esperados.has(c.id))
        f.push(
          `faixaCompleta[${c.caso}]: ${rotulo(c.id)} ficou na lista e nao devia (estoque efetivo ${efetivo(c)})`,
        );
      if (!vivos.has(c.id) && esperados.has(c.id))
        f.push(
          `faixaCompleta[${c.caso}]: ${rotulo(c.id)} ficou de fora e devia entrar (estoque efetivo ${efetivo(c)})`,
        );
    }
    for (const id of vivos)
      if (!NOME_DE[id] && id !== BASE_A)
        f.push(`faixaCompleta[fixture]: ${id} nao e' de nenhum caso`);
    if (vivos.has(BASE_A))
      f.push("faixaCompleta[base]: o proprio produto entrou na lista");
    if (
      !f.length &&
      !mesmos(
        ids(r),
        ORACULO_A.map((c) => c.id),
      )
    )
      f.push(
        `faixaCompleta[ordem]: ${ids(r)
          .map((x) => NOME_DE[x]?.n)
          .join(",")} (esperado ${ORACULO_A.map((c) => c.n).join(",")})`,
      );
    return f;
  },
  /** As 4 vagas: LIMIT 4, o padrao omitido e NULL sao os 4 primeiros do oraculo; o esgotado com grade nao ocupa nenhuma. */
  async faixaDe4() {
    const f = [];
    const quatro = ORACULO_A.slice(0, 4).map((c) => c.id);
    const comLimite = await chamar("anon", BASE_A, 4);
    const omitido = await tentar("anon", CHAMADA.omitido, [BASE_A]);
    const nulo = await chamar("anon", BASE_A, null);
    for (const [nome, r] of [
      ["limite 4", comLimite],
      ["limite omitido", omitido],
      ["limite NULL", nulo],
    ]) {
      if (!r.linhas) {
        f.push(`faixaDe4(${nome}): erro ${r.erro}`);
        continue;
      }
      if (!mesmos(ids(r), quatro))
        f.push(
          `faixaDe4(${nome}): vagas ${ids(r)
            .map((x) => NOME_DE[x]?.n ?? x)
            .join(",")} (esperado ${ORACULO_A.slice(0, 4)
            .map((c) => c.n)
            .join(",")})`,
        );
    }
    return f;
  },
  /** O contrato SETOF produtos nao muda: a coluna `estoque` devolvida e' a CRUA, e custo e fornecedor saem NULOS. */
  async colunas() {
    const f = [];
    const r = await chamar("anon", BASE_A, 50);
    if (!r.linhas) return [`colunas: erro ${r.erro}`];
    for (const l of r.linhas) {
      const c = NOME_DE[l.id];
      if (c && l.estoque !== c.estoque)
        f.push(
          `colunas: ${rotulo(l.id)} devolveu estoque ${l.estoque} (a coluna crua e' ${c.estoque})`,
        );
      if (l.custo !== null) f.push(`colunas: custo saiu (${l.custo})`);
      if (l.fornecedor_id !== null)
        f.push(`colunas: fornecedor_id saiu (${l.fornecedor_id})`);
    }
    return f;
  },
  /** O teto de 50, NULL = 4, 0 e negativo = 1 e a lista de 70 parentes (10 esgotadas com grade) seguem iguais ao oraculo. */
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
      const r = await chamar("anon", BASE_B, limite);
      if (!r.linhas) {
        f.push(`teto(limite ${limite}): erro ${r.erro}`);
        continue;
      }
      if (r.linhas.length !== esperado)
        f.push(
          `teto(limite ${limite}): ${r.linhas.length} linhas (esperado ${esperado})`,
        );
      else if (!mesmos(ids(r), ORACULO_B.slice(0, esperado)))
        f.push(
          `teto(limite ${limite}): as linhas nao sao as ${esperado} primeiras do oraculo (esgotada com grade na lista?)`,
        );
    }
    const omitido = await tentar("anon", CHAMADA.omitido, [BASE_B]);
    if (!omitido.linhas || omitido.linhas.length !== 4)
      f.push(
        `teto(limite omitido): ${omitido.linhas?.length ?? omitido.erro} (esperado 4)`,
      );
    return f;
  },
  /** Produto sem variacao: o corpo novo responde IGUAL ao oraculo da coluna (o diferencial contra o corpo antigo e' outra prova). */
  async semVariacao() {
    const f = [];
    const esperado = COLUNAS_C.map((estoque, i) => ({
      estoque,
      id: idDe("8301", i + 1),
    }))
      .filter((x) => x.estoque > 0)
      .map((x) => x.id);
    for (const limite of [1, 4, 7, 25, 50]) {
      const r = await chamar("anon", BASE_C, limite);
      if (!r.linhas || !mesmos(ids(r), esperado.slice(0, limite)))
        f.push(
          `semVariacao(limite ${limite}): ${r.linhas ? ids(r).length : r.erro} linhas fora do oraculo da coluna`,
        );
    }
    return f;
  },
  /** Quem chama: anon (a vitrine), authenticated e service_role. */
  async papeis() {
    const f = [];
    for (const papel of ["anon", "authenticated", "service_role"]) {
      const r = await chamar(papel, BASE_A, 4);
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
// ANTES: o controle (o defeito existe, nos dois sentidos)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261394100000, byte a byte) na MESMA fixture, o esgotado com grade ocupa a vaga (a), quem tem saldo so na grade some (b) e as 4 vagas erram (o defeito); produto sem variacao responde certo",
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
      const r = await chamar("anon", BASE_A, 50);
      const vivos = new Set(ids(r));
      assert.ok(
        vivos.has(idDe("8200", 1)),
        "o esgotado com grade (coluna 2) devia estar na lista antiga",
      );
      assert.ok(
        !vivos.has(idDe("8200", 2)),
        "quem tem saldo so na grade (coluna 0) devia faltar na lista antiga",
      );
      assert.ok(
        vivos.has(idDe("8200", 5)),
        "a grade ativa zerada com coluna 5 devia estar na lista antiga",
      );
      assert.ok(
        !vivos.has(idDe("8200", 13)),
        "a grade de varios tamanhos com coluna 0 devia faltar na lista antiga",
      );
      assert.deepEqual(
        ids(await chamar("anon", BASE_A, 4)).map((x) => NOME_DE[x].n),
        [1, 3, 5, 6],
        "as 4 vagas da lista antiga",
      );
      assert.notDeepEqual(
        ids(await chamar("anon", BASE_A, 4)),
        ORACULO_A.slice(0, 4).map((c) => c.id),
      );
      assert.deepEqual(
        await CHECKS.semVariacao(),
        [],
        "o grupo sem variacao ja respondia certo",
      );
    }),
);

prova(
  "ANTES: o conjunto das verificacoes reprova o corpo antigo em (a), (b) e nas 4 vagas",
  async () => {
    const falhas = await todasAsVerificacoes(instalarAntiga);
    for (const alvo of [
      "faixaCompleta[a]",
      "faixaCompleta[b]",
      "faixaCompleta[d]",
      "faixaDe4(limite 4)",
      "teto(limite 50)",
    ])
      assert.ok(
        falhas.some((x) => x.includes(alvo)),
        `o corpo antigo devia reprovar "${alvo}"; reprovou: ${falhas.slice(0, 6).join(" | ")}`,
      );
  },
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: (a) coluna 2 + grade ativa 0 sai; (b) coluna 0 + variacao ativa com saldo entra; (c) sem variacao usa a coluna; (d) inativa, active NULL e estoque NULL nao contam; bordas; as 4 vagas, o teto, a ordem, a coluna crua devolvida, custo/fornecedor NULOS e os tres papeis seguem",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

prova(
  "DIFERENCIAL: produto SEM variacao responde IGUAL antes e depois (mesmos ids, mesma ordem) para 1, 4, 7, 25 e 50; e para o grupo com grade a lista MUDA so no que o defeito errava",
  async () => {
    const lista = async (estado) =>
      emTransacao(
        async () => {
          await semear();
          const m = {};
          for (const limite of [1, 4, 7, 25, 50])
            m[limite] = ids(await chamar("anon", BASE_C, limite));
          m.grade = ids(await chamar("anon", BASE_A, 50));
          return m;
        },
        { estado },
      );
    const antes = await lista("antes");
    const depois = await lista("depois");
    for (const limite of [1, 4, 7, 25, 50])
      assert.deepEqual(
        depois[limite],
        antes[limite],
        `sem variacao: a lista de ${limite} mudou`,
      );
    const so = (a, b) => a.filter((x) => !b.includes(x));
    const sairam = so(antes.grade, depois.grade).map((x) => NOME_DE[x].n);
    const entraram = so(depois.grade, antes.grade).map((x) => NOME_DE[x].n);
    // Saiu SO o que tem coluna > 0 e grade ativa zerada; entrou SO o que tem coluna 0 e saldo na grade.
    assert.deepEqual(sairam, [1, 5, 10, 17]);
    assert.deepEqual(entraram, [2, 11, 13, 16]);
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
  "o filtro antigo (coluna crua)": {
    aplica: trocar(FILTRO_NOVO, FILTRO_VELHO),
    vermelho: ["faixaCompleta[a]", "faixaCompleta[b]", "faixaDe4(limite 4)"],
  },
  "a soma conta as variacoes INATIVAS tambem": {
    aplica: trocar(
      SOMA_ATIVAS,
      "(SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.product_id = p.id)",
    ),
    vermelho: ["faixaCompleta[d]"],
  },
  "variacao inativa faz o produto 'ter grade' (EXISTS sem o ativa)": {
    aplica: trocar(
      EXISTE_ATIVA,
      "EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id)",
    ),
    vermelho: ["faixaCompleta[d]"],
  },
  "sem o ramo da coluna (produto sem variacao vira zero)": {
    aplica: trocar("ELSE p.estoque END > 0", "ELSE 0 END > 0"),
    vermelho: ["faixaCompleta[c]", "semVariacao"],
  },
  "o MAIOR entre a coluna e a soma (GREATEST)": {
    aplica: trocar(FILTRO_NOVO, `AND GREATEST(p.estoque, ${SOMA_ATIVAS}) > 0`),
    vermelho: ["faixaCompleta[a]", "faixaDe4(limite 4)"],
  },
  "a coluna vale quando a soma e zero (OR)": {
    aplica: trocar(FILTRO_NOVO, `AND (${SOMA_ATIVAS} > 0 OR p.estoque > 0)`),
    vermelho: ["faixaCompleta[a]"],
  },
  "borda errada: estoque maior que 1": {
    aplica: trocar("ELSE p.estoque END > 0", "ELSE p.estoque END > 1"),
    vermelho: ["faixaCompleta[borda]"],
  },
  "a soma ignora de quem e' a variacao (soma a loja toda)": {
    aplica: trocar(
      SOMA_ATIVAS,
      "(SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.active)",
    ),
    vermelho: ["faixaCompleta[a]"],
  },
  "o EXISTS ignora de quem e' a variacao (qualquer grade da loja conta)": {
    aplica: trocar(
      EXISTE_ATIVA,
      "EXISTS (SELECT 1 FROM public.product_variants v WHERE v.active)",
    ),
    vermelho: ["faixaCompleta[c]"],
  },
  "active NULL conta como ativa": {
    aplica: (corpo) =>
      trocar(
        SOMA_ATIVAS,
        "(SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.product_id = p.id AND v.active IS NOT FALSE)",
      )(
        trocar(
          EXISTE_ATIVA,
          "EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active IS NOT FALSE)",
        )(corpo),
      ),
    vermelho: ["faixaCompleta[d]"],
  },
  "produto inativo entra": {
    aplica: trocar("      AND p.ativo = true\n", ""),
    vermelho: ["faixaCompleta[ativo]"],
  },
  "sem teto (LIMIT p_limit)": {
    aplica: trocar(TETO, "p_limit"),
    vermelho: ["teto(limite 51", "teto(limite null"],
  },
  "a ordem muda (os mais antigos primeiro)": {
    aplica: trocar(
      "        p.data_cadastro DESC\n",
      "        p.data_cadastro ASC\n",
    ),
    vermelho: ["faixaCompleta[ordem]", "faixaDe4"],
  },
  "o custo vaza (volta o valor real)": {
    aplica: trocar(
      "NULL::numeric(10,2),  -- custo: nunca sai desta funcao",
      "p.custo,",
    ),
    vermelho: ["colunas: custo saiu"],
  },
  "a coluna devolvida passa a ser a soma (muda o contrato)": {
    aplica: trocar("        p.estoque,\n", "        0,\n"),
    vermelho: ["colunas: "],
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
        `o mutante "${nome}" devia reprovar "${alvo}"; reprovou: ${falhas.slice(0, 6).join(" | ")}`,
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
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); o rollback devolve o prosrc IDENTICO ao da 20261394100000 (md5 e sha256) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual",
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
  "corpo mais velho que o vigente (o da 20261160, antes do teto)": async () => {
    await C.query(decl(funcaoDe(SRC_160, NOME_FN)));
  },
  "corpo ainda mais velho (o da baseline)": async () => {
    const velha = funcaoDe(
      ler("20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql"),
      NOME_FN,
    );
    await C.query(decl(velha));
  },
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
  "dono da funcao diferente do dono das tabelas": async () => {
    await C.query("CREATE ROLE recs3998_outro_dono NOLOGIN");
    await C.query(`ALTER FUNCTION ${FN} OWNER TO recs3998_outro_dono`);
  },
  "product_variants sem a coluna active": () =>
    C.query(
      "ALTER TABLE public.product_variants RENAME COLUMN active TO ativa",
    ),
  "product_variants sem a coluna stock_increment": () =>
    C.query(
      "ALTER TABLE public.product_variants RENAME COLUMN stock_increment TO saldo",
    ),
  "product_variants sem a coluna product_id": () =>
    C.query(
      "ALTER TABLE public.product_variants RENAME COLUMN product_id TO produto_id",
    ),
};
// O rollback tambem recusa quando a funcao no ar e' a NOVA mas os atributos ou a ACL fugiram (e o corpo conhecido nao basta).
const RUINS_DO_ROLLBACK = [
  "atributo diferente (STABLE)",
  "atributo diferente (SECURITY INVOKER)",
  "sobrecarga (outra get_product_recommendations)",
  "funcao ausente (apagada)",
  "ACL aberta (PUBLIC executa)",
  "anon sem EXECUTE: a vitrine quebraria",
  "authenticated sem EXECUTE",
  "service_role sem EXECUTE",
];

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

prova(
  "MIGRATION: com o corpo NOVO no ar, o rollback recusa SEM escrever quando os atributos, a ACL ou a assinatura fugiram, e a migration recusa tambem",
  () =>
    emTransacao(
      async () => {
        for (const nome of RUINS_DO_ROLLBACK) {
          await C.query("SAVEPOINT ruim");
          await ESTADOS_RUINS[nome]();
          const fotoAntes = await prosrcVivo();
          const rb = await aplicar(ROLLBACK);
          assert.ok(rb, `${nome}: o rollback devia recusar`);
          assert.match(rb.erro, /B1_BASELINE_DIVERGENT/, `${nome}: ${rb.erro}`);
          assert.equal(
            await prosrcVivo(),
            fotoAntes,
            `${nome}: o pre-voo do rollback escreveu`,
          );
          const mig = await aplicar(MIGRATION);
          assert.ok(mig, `${nome}: a migration devia recusar`);
          assert.match(
            mig.erro,
            /B1_BASELINE_DIVERGENT/,
            `${nome}: ${mig.erro}`,
          );
          await C.query("ROLLBACK TO SAVEPOINT ruim");
        }
      },
      { estado: "depois" },
    ),
);

const bloco = (sql, nome) => {
  const ini = sql.indexOf(`DO $${nome}$`);
  const fim = sql.indexOf(`END $${nome}$;`) + `END $${nome}$;`.length;
  assert.ok(ini >= 0 && fim > ini, `bloco ${nome} nao achado`);
  return sql.slice(ini, fim);
};

prova(
  "MIGRATION: o pos-voo PASSA no estado novo e RECUSA corpo antigo, o filtro duplicado, o filtro antigo de volta, atributo mudado, PUBLIC aberto e anon sem EXECUTE; mudar o dono entre o pre-voo e o pos-voo reprova; coluna de product_variants que some depois do pre-voo e' pega pela fumaca (o corpo nao compilaria)",
  () =>
    emTransacao(async () => {
      const PREVOO = bloco(MIGRATION, "preflight_20261399800000");
      const POSVOO = bloco(MIGRATION, "posvoo_20261399800000");
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
          "o filtro duplicado (hash diferente)",
          () =>
            C.query(
              decl(
                NOVA,
                NOVA.corpo.replace(
                  LINHA_NOVA,
                  () => `${LINHA_NOVA}      -- ${FILTRO_NOVO}\n`,
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
        assert.match(erro.erro, /POSVOO_20261399800000/);
        assert.match(erro.erro, padrao, `${nome}: ${erro.erro}`);
        await C.query("ROLLBACK TO SAVEPOINT estrago");
      }
      await C.query("SAVEPOINT dono");
      await C.query("CREATE ROLE recs3998_dono NOLOGIN");
      await C.query(`ALTER FUNCTION ${FN} OWNER TO recs3998_dono`);
      const erroDono = await aplicar(POSVOO);
      assert.ok(erroDono, "mudar o dono devia reprovar o pos-voo");
      assert.match(erroDono.erro, /POSVOO_20261399800000/);
      await C.query("ROLLBACK TO SAVEPOINT dono");
      // A fumaca: com a coluna sem o nome certo, so a primeira CHAMADA acusaria; o pos-voo chama uma vez.
      await C.query("SAVEPOINT fumaca");
      await C.query(
        "ALTER TABLE public.product_variants RENAME COLUMN active TO ativa",
      );
      const erroFumaca = await aplicar(POSVOO);
      assert.ok(erroFumaca, "a fumaca devia reprovar o corpo que nao compila");
      assert.equal(erroFumaca.codigo, "42703", erroFumaca.erro);
      await C.query("ROLLBACK TO SAVEPOINT fumaca");
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
        /POSVOO_20261399800000/,
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
// CONSULTAS 124a / 124b, a 107a e a 9a (que aceitam o corpo novo como sucessor)
// ---------------------------------------------------------------------------

const rodarConsulta = async (sql) => (await C.query(sql)).rows;
const mapa = (linhas) => Object.fromEntries(linhas.map((l) => [l.item, l.ok]));
const ITEM_ASSINATURA =
  "get_product_recommendations: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, SETOF produtos; anon, authenticated e service_role, sem PUBLIC)";
const FIXOS = [
  "controle: funcoes de public visiveis a este papel",
  ITEM_ASSINATURA,
];

prova(
  "CONSULTAS: 124a/124b tem rol fechado de 4 linhas (os rotulos do conferir-banco), positivas no estado certo; a 124a reprova no ANTES e a 124b no DEPOIS, nos itens certos; a 107a e a 9a seguem positivas nos DOIS estados (aceitam o corpo novo como sucessor); cada desvio da 124a cai no item certo",
  async () => {
    const rodarTodas = async () => ({
      a: await rodarConsulta(A124),
      b: await rodarConsulta(B124),
      a107: await rodarConsulta(A107),
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
    assert.ok(
      depois.a.every((l) => l.ok),
      JSON.stringify(depois.a.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(depois.b)))
      assert.equal(ok, FIXOS.includes(item), `124b DEPOIS: ${item}`);
    assert.ok(
      antes.b.every((l) => l.ok),
      JSON.stringify(antes.b.filter((l) => !l.ok)),
    );
    for (const [item, ok] of Object.entries(mapa(antes.a)))
      assert.equal(ok, FIXOS.includes(item), `124a ANTES: ${item}`);
    // A 107a e a 9a: positivas nos dois estados (o corpo da 124 e' sucessor do da 107, que e' o que elas esperam).
    for (const estado of [depois, antes]) {
      assert.ok(
        estado.a107.every((l) => l.ok),
        JSON.stringify(estado.a107.filter((l) => !l.ok)),
      );
      assert.equal(estado.nove.length, 1);
      assert.equal(estado.nove[0].ok, true, JSON.stringify(estado.nove));
    }
    // Cada desvio da 124a (no estado novo) cai no item certo.
    const casos = [
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, ITEM_ASSINATURA],
      [`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`, ITEM_ASSINATURA],
      [`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`, ITEM_ASSINATURA],
      [`ALTER FUNCTION ${FN} SECURITY INVOKER`, ITEM_ASSINATURA],
      [
        decl(NOVA, `${NOVA.corpo}\n-- sabotagem\n`),
        "get_product_recommendations: corpo exato (md5)",
      ],
      [
        decl(
          NOVA,
          NOVA.corpo.replace(
            LINHA_NOVA,
            () => `${LINHA_NOVA}      -- ELSE p.estoque END > 0\n`,
          ),
        ),
        "get_product_recommendations: o corpo conta o estoque das variacoes ativas (uma vez)",
      ],
    ];
    for (const [sabotar, itemQueCai] of casos)
      await emTransacao(
        async () => {
          await C.query(sabotar);
          const caiu = (await rodarConsulta(A124))
            .filter((l) => !l.ok)
            .map((l) => l.item);
          assert.ok(
            caiu.includes(itemQueCai),
            `${sabotar.slice(0, 60)}: caiu ${JSON.stringify(caiu)}`,
          );
        },
        { estado: "depois" },
      );
    // E um corpo desconhecido derruba tambem a 107a e a 9a: a tolerancia aceita SO o corpo novo, nao qualquer um.
    await emTransacao(
      async () => {
        await C.query(decl(NOVA, `${NOVA.corpo}\n-- sabotagem\n`));
        assert.ok(
          (await rodarConsulta(A107)).some((l) => !l.ok),
          "a 107a devia reprovar corpo desconhecido",
        );
        assert.equal(
          (await rodarConsulta(A9)).find(
            (l) => l.item === `corpo final ${NOME_FN}`,
          ).ok,
          false,
          "a 9a devia reprovar corpo desconhecido",
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
