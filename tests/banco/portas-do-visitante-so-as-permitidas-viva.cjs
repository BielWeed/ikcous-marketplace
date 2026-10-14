"use strict";

/**
 * Prova VIVA do L8 da auditoria de seguranca de 12/10/2026: FUNCAO NOVA DE BANCO NAO NASCE ABERTA.
 *
 * O problema: no Postgres/Supabase toda funcao criada em `public` nasce com EXECUTE para PUBLIC e, pela
 * regra de fabrica do Supabase (pg_default_acl), tambem para anon, authenticated e service_role. Uma
 * migration que esquece o REVOKE abre a porta ao visitante sem login (ou a qualquer conta logada: o
 * cadastro e' aberto) e nada avisava. Ja houve 58 portas abertas assim (uma migration inteira teve de
 * fechar), e a auditoria de 12/10 achou portas de DINHEIRO.
 *
 * O que esta prova faz, no Postgres EFEMERO com TODAS as migrations aplicadas do zero (o estado FINAL do
 * banco, nao o texto das migrations — DROP+CREATE perde o ACL, CREATE OR REPLACE preserva):
 *
 *   1. lista toda funcao de `public` com EXECUTE efetivo para `anon`, `authenticated` ou PUBLIC (o grantee
 *      0 do ACL, que vale para todo papel, inclusive os futuros) — INCLUSIVE funcao criada por EXTENSAO
 *      (CREATE EXTENSION sem WITH SCHEMA joga as funcoes dela em public, abertas) — e REPROVA se alguma
 *      nao esta em tests/banco/portas-do-visitante-permitidas.json;
 *   2. REPROVA o contrario: funcao da lista que mudou QUEM executa (a vitrine ou o painel quebraria sem
 *      aviso, ou a porta abriu mais do que a lista diz) ou que nao existe mais;
 *   3. REPROVA mudanca de `tipo` (volatil/leitura/gatilho) e de SECURITY DEFINER da funcao listada (um
 *      CREATE OR REPLACE preserva o ACL e pode passar a rodar como o dono sem ninguem ver), linha
 *      duplicada e linha mal formada.
 *
 * A lista bate com as duas lojas reais (foto 18a de 14/10/2026: as duas sao iguais campo a campo). Quem
 * precisa abrir uma funcao acrescenta a linha, com o PORQUE, no MESMO PR da migration; quem fecha, tira a
 * linha ou acerta `executa`. Funcao so do service_role (ou so do dono) nao entra: e' a classe fechada.
 *
 * AUTOTESTE (CONTROLE, sem ele um "nenhuma porta nova" pode ser vacuo): numa transacao desfeita, cria
 * funcao sem REVOKE, com REVOKE so de PUBLIC, com REVOKE de PUBLIC e anon (o `authenticated` fica aberto:
 * o padrao esquecido 29 vezes nas migrations), uma funcao de extensao em public, e uma fechada de verdade
 * (so o que tem de aparecer aparece).
 *
 * Fora do escopo: outros schemas (auth, storage, cron do efemero sao imitacoes do provisionador e nao
 * batem com as lojas) e privilegio de tabela. So le o catalogo (o autoteste escreve numa transacao que
 * termina em ROLLBACK). Sem migration, sem mudar ACL de loja nenhuma.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/portas-do-visitante-so-as-permitidas-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O unico caminho de arquivo daqui e' a lista versionada ao lado deste script, nunca entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const LISTA = path.join(__dirname, "portas-do-visitante-permitidas.json");
const TIPOS = new Set(["volatil", "leitura", "gatilho"]);
const SITUACOES = new Set(["necessaria", "auxiliar", "tolerada", "logado"]);
const QUEM = ["PUBLIC", "anon", "authenticated"]; // a ordem em que a lista e a 18a escrevem

/**
 * Toda funcao de `public`, de qualquer dono e de extensao tambem (de proposito: sem filtro de pg_depend),
 * com quem executa DE FATO. PUBLIC = o grantee 0 do ACL; anon/authenticated = has_function_privilege
 * (efetivo: direto ou por heranca de papel).
 */
const SQL_FUNCOES = `
  SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS funcao,
         CASE WHEN p.prorettype = 'trigger'::regtype THEN 'gatilho'
              WHEN p.provolatile = 'v' THEN 'volatil'
              ELSE 'leitura' END AS tipo,
         p.prosecdef AS secdef,
         EXISTS (SELECT 1
                   FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
         (SELECT e.extname
            FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
             AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
           LIMIT 1) AS extensao
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace`;

const normalizar = (s) => String(s).replace(/\s+/g, " ").trim();
const ordenar = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

let C;
let EXT_INICIAL;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Mapa assinatura -> {tipo, secdef, executa: ["PUBLIC","anon","authenticated"] na ordem fixa}. */
async function funcoesDoBanco() {
  const r = await C.query(SQL_FUNCOES);
  return new Map(
    r.rows.map((l) => [
      normalizar(l.funcao),
      {
        tipo: l.tipo,
        secdef: l.secdef,
        extensao: l.extensao,
        executa: [
          l.publico ? "PUBLIC" : null,
          l.anon ? "anon" : null,
          l.authenticated ? "authenticated" : null,
        ].filter(Boolean),
      },
    ]),
  );
}

/** Le e valida a LISTA; devolve {linhas, problemas}. Nada aqui toca o banco. */
function lerLista() {
  const problemas = [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(LISTA, "utf8"));
  } catch (e) {
    return {
      linhas: [],
      problemas: [`LISTA ilegivel (${LISTA}): ${e.message}`],
    };
  }
  if (!doc || !Array.isArray(doc.funcoes)) {
    return {
      linhas: [],
      problemas: ["LISTA sem o vetor `funcoes` na raiz do JSON"],
    };
  }
  const vistos = new Map();
  const linhas = [];
  doc.funcoes.forEach((l, i) => {
    const onde = `linha ${i + 1} da lista`;
    if (!l || typeof l.funcao !== "string" || l.funcao.trim() === "") {
      problemas.push(`${onde}: falta o campo \`funcao\``);
      return;
    }
    const chave = normalizar(l.funcao);
    if (!/^public\.[a-z_][a-z0-9_]*\(.*\)$/.test(chave)) {
      problemas.push(
        `${onde} (${chave}): \`funcao\` tem de ser public.nome(argumentos), como pg_get_function_identity_arguments escreve`,
      );
    }
    if (
      !Array.isArray(l.executa) ||
      l.executa.length === 0 ||
      l.executa.some((q) => !QUEM.includes(q)) ||
      new Set(l.executa).size !== l.executa.length ||
      l.executa.join() !== QUEM.filter((q) => l.executa.includes(q)).join()
    ) {
      problemas.push(
        `${onde} (${chave}): \`executa\` tem de ser a lista nao vazia de ${QUEM.join(", ")}, nesta ordem, sem repetir`,
      );
    }
    if (!TIPOS.has(l.tipo)) {
      problemas.push(
        `${onde} (${chave}): \`tipo\` ${JSON.stringify(l.tipo)} nao e' ${[...TIPOS].join(" | ")}`,
      );
    }
    if (typeof l.secdef !== "boolean") {
      problemas.push(
        `${onde} (${chave}): \`secdef\` tem de ser true ou false (SECURITY DEFINER)`,
      );
    }
    if (!SITUACOES.has(l.situacao)) {
      problemas.push(
        `${onde} (${chave}): \`situacao\` ${JSON.stringify(l.situacao)} nao e' ${[...SITUACOES].join(" | ")}`,
      );
    }
    if (typeof l.porque !== "string" || normalizar(l.porque).length < 25) {
      problemas.push(
        `${onde} (${chave}): falta o \`porque\` (uma frase dizendo por que essa porta precisa existir)`,
      );
    }
    if (vistos.has(chave)) {
      problemas.push(
        `ENTRADA DUPLICADA: ${chave} aparece na ${vistos.get(chave)} e na ${onde}`,
      );
    } else {
      vistos.set(chave, onde);
    }
    linhas.push({ ...l, funcao: chave });
  });
  return { linhas, problemas };
}

/** Compara o banco com a lista como CONJUNTOS e devolve TODOS os problemas (o dev ve tudo de uma vez). */
function conferir(banco, linhas) {
  const problemas = [];
  const naLista = new Map(linhas.map((l) => [l.funcao, l]));
  for (const [chave, f] of banco) {
    if (f.executa.length > 0 && !naLista.has(chave)) {
      const como = f.extensao
        ? `Vem da extensao ${f.extensao}, instalada em public: instale-a com CREATE EXTENSION IF NOT EXISTS ${f.extensao} WITH SCHEMA extensions; (o schema extensions nao e' porta de ninguem).`
        : `Feche-a na migration: REVOKE EXECUTE ON FUNCTION ${chave} FROM PUBLIC, anon, authenticated;\n      (PUBLIC, anon e authenticated, os TRES: esquecer um deixa a porta aberta.)`;
      problemas.push(
        `FUNCAO ABERTA FORA DA LISTA: ${chave}\n      Executam: ${f.executa.join(", ")}.\n      ${como}\n      Se alguem de fora PRECISA dela, acrescente a linha com o porque em tests/banco/portas-do-visitante-permitidas.json no mesmo PR.`,
      );
    }
  }
  for (const [chave, l] of naLista) {
    const f = banco.get(chave);
    if (!f || f.executa.length === 0) {
      problemas.push(
        f
          ? `FUNCAO DA LISTA QUE NINGUEM DE FORA EXECUTA MAIS: ${chave}\n      A vitrine ou o painel que depende dela quebraria sem aviso. Se o fechamento e' de proposito, tire a linha da lista no mesmo PR.`
          : `ENTRADA DA LISTA QUE NAO EXISTE MAIS NO BANCO: ${chave}\n      Tire a linha da lista (a funcao foi removida ou mudou de assinatura).`,
      );
      continue;
    }
    if (Array.isArray(l.executa)) {
      const a = new Set(f.executa);
      const e = new Set(l.executa);
      const abriu = ordenar(f.executa.filter((q) => !e.has(q)));
      const fechou = ordenar(l.executa.filter((q) => !a.has(q)));
      if (abriu.length > 0) {
        problemas.push(
          `A PORTA ABRIU MAIS QUE A LISTA: ${chave}\n      Agora tambem executam: ${abriu.join(", ")} (a lista diz: ${l.executa.join(", ")}).`,
        );
      }
      if (fechou.length > 0) {
        const quem = fechou.includes("anon")
          ? "O VISITANTE DEIXOU DE EXECUTAR"
          : fechou.includes("authenticated")
            ? "O LOGADO DEIXOU DE EXECUTAR"
            : "PUBLIC SAIU DO ACL";
        problemas.push(
          `${quem}: ${chave}\n      Deixaram de executar: ${fechou.join(", ")} (a lista diz: ${l.executa.join(", ")}). A tela que depende dela quebraria sem aviso. Se o fechamento e' de proposito, acerte \`executa\` (ou tire a linha) no mesmo PR.`,
        );
      }
    }
    if (TIPOS.has(l.tipo) && f.tipo !== l.tipo) {
      problemas.push(
        `TIPO DA LISTA NAO CONFERE: ${chave} esta como "${l.tipo}" e no banco e' "${f.tipo}"\n      (volatil = pode escrever; leitura = STABLE/IMMUTABLE; gatilho = retorna trigger). Confira o que a funcao faz e acerte a linha.`,
      );
    }
    if (typeof l.secdef === "boolean" && f.secdef !== l.secdef) {
      problemas.push(
        `SECURITY DEFINER MUDOU: ${chave} esta na lista com secdef=${l.secdef} e no banco com secdef=${f.secdef}\n      Rodar como o dono (ou deixar de) muda o que a porta alcanca; confira o corpo e acerte a linha.`,
      );
    }
  }
  return ordenar(problemas);
}

/** Uma transacao por caso, sempre desfeita. */
async function emTransacao(fn) {
  await C.query("BEGIN");
  try {
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// AUTOTESTE: o detector enxerga porta aberta e nao acusa porta fechada
// ---------------------------------------------------------------------------

prova(
  "AUTOTESTE: o detector ve funcao sem REVOKE, com REVOKE so de PUBLIC, sem o authenticated e de extensao; nao acusa a fechada",
  () =>
    emTransacao(async () => {
      const criar = (nome) =>
        C.query(
          `CREATE FUNCTION public.${nome}() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`,
        );
      await criar("l8_aberta_de_fabrica");
      await criar("l8_revoke_so_de_public");
      await C.query(
        "REVOKE ALL ON FUNCTION public.l8_revoke_so_de_public() FROM PUBLIC",
      );
      await criar("l8_revoke_public_e_anon");
      await C.query(
        "REVOKE ALL ON FUNCTION public.l8_revoke_public_e_anon() FROM PUBLIC, anon",
      );
      await criar("l8_fechada");
      await C.query(
        "REVOKE ALL ON FUNCTION public.l8_fechada() FROM PUBLIC, anon, authenticated",
      );
      // funcao de EXTENSAO em public: o filtro da 18a (que ignora extensao) a esconderia. Nao se mexe em
      // extensao de verdade (DROP/CREATE EXTENSION quebraria se uma migration futura dependesse dela): a
      // funcao e' criada aqui e ANEXADA a uma extensao ja instalada, o que grava o pg_depend de tipo 'e'.
      await criar("l8_de_extensao");
      const ext = (
        await C.query(
          "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname LIMIT 1",
        )
      ).rows[0]?.extname;
      assert.ok(ext, "o provisionador instala alguma extensao de contrib");
      await C.query(
        `ALTER EXTENSION "${ext}" ADD FUNCTION public.l8_de_extensao()`,
      );
      const banco = await funcoesDoBanco();
      const quem = (n) => banco.get(`public.${n}()`)?.executa;
      assert.deepEqual(
        quem("l8_aberta_de_fabrica"),
        ["PUBLIC", "anon", "authenticated"],
        "sem REVOKE: aberta a todos",
      );
      assert.deepEqual(
        quem("l8_revoke_so_de_public"),
        ["anon", "authenticated"],
        "REVOKE so de PUBLIC nao fecha: o grant explicito do anon (regra de fabrica do Supabase) continua",
      );
      assert.deepEqual(
        quem("l8_revoke_public_e_anon"),
        ["authenticated"],
        "REVOKE de PUBLIC e anon sem o authenticated deixa o logado dentro; tem de aparecer",
      );
      assert.deepEqual(
        quem("l8_fechada"),
        [],
        "a funcao fechada de verdade nao pode aparecer",
      );
      const deExt = banco.get("public.l8_de_extensao()");
      assert.equal(
        deExt?.extensao,
        ext,
        "controle: o banco enxerga a funcao como de extensao (o que o filtro da 18a esconde)",
      );
      assert.ok(
        deExt.executa.length > 0,
        "a funcao da extensao em public tem de aparecer como aberta",
      );
      // e o conferidor acusa cada uma pelo NOME
      const { linhas } = lerLista();
      const msg = conferir(banco, linhas).join("\n");
      for (const n of [
        "l8_aberta_de_fabrica",
        "l8_revoke_so_de_public",
        "l8_revoke_public_e_anon",
      ])
        assert.ok(
          msg.includes(`FORA DA LISTA: public.${n}()`),
          `o conferidor tem de acusar ${n}`,
        );
      assert.ok(
        msg.includes("FORA DA LISTA: public.l8_de_extensao()"),
        "o conferidor tem de acusar a funcao de extensao",
      );
      assert.doesNotMatch(msg, /l8_fechada/);
    }),
);

const SQL_EXTENSOES = `
  SELECT (SELECT string_agg(extname || ':' || extversion || ':' || extnamespace::regnamespace::text, ',' ORDER BY extname)
            FROM pg_extension) AS extensoes,
         (SELECT count(*) FROM pg_depend
           WHERE classid = 'pg_proc'::regclass AND deptype = 'e') AS funcoes_de_extensao,
         (SELECT count(*) FROM pg_proc WHERE proname LIKE 'l8\\_%') AS restos`;

prova(
  "AUTOTESTE: nada de extensao foi criado ou removido, e nenhuma funcao do autoteste ficou para tras",
  async () => {
    const depois = (await C.query(SQL_EXTENSOES)).rows[0];
    assert.deepEqual(
      { ...depois, restos: Number(depois.restos) },
      { ...EXT_INICIAL, restos: 0 },
      "o autoteste desfez tudo (as extensoes e as funcoes de extensao sao as do inicio)",
    );
  },
);

// ---------------------------------------------------------------------------
// A LISTA e' bem formada e sem repeticao
// ---------------------------------------------------------------------------

prova(
  "LISTA: bem formada, sem entrada duplicada, com o porque de cada linha",
  () => {
    const { linhas, problemas } = lerLista();
    assert.deepEqual(problemas, [], problemas.join("\n"));
    assert.ok(linhas.length > 0, "a lista nao pode estar vazia");
  },
);

// ---------------------------------------------------------------------------
// O BANCO bate com a LISTA, nos dois sentidos
// ---------------------------------------------------------------------------

prova(
  "PORTAS: toda funcao que alguem de fora executa esta na lista, e a lista confere quem, tipo e SECURITY DEFINER",
  async () => {
    const { linhas, problemas: daLista } = lerLista();
    const banco = await funcoesDoBanco();
    const problemas = [...daLista, ...conferir(banco, linhas)];
    assert.deepEqual(problemas, [], `\n    ${problemas.join("\n    ")}`);
    const abertas = [...banco.values()].filter((f) => f.executa.length > 0);
    assert.equal(
      abertas.length,
      linhas.length,
      "contagem de portas = linhas da lista",
    );
    const visitante = abertas.filter((f) =>
      f.executa.some((q) => q !== "authenticated"),
    ).length;
    console.log(
      `        ${abertas.length} portas em public (${visitante} executaveis pelo visitante) = ${linhas.length} linhas da lista (de ${banco.size} funcoes em public)`,
    );
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const inicial = (await C.query(SQL_EXTENSOES)).rows[0];
  EXT_INICIAL = { ...inicial, restos: 0 };
  assert.equal(Number(inicial.restos), 0, "o banco ja tem funcao l8_ de resto");
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.message).split("\n").join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas das portas de funcao falharam.`,
    );
  }
  console.log(
    `\n[portas-de-funcao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
