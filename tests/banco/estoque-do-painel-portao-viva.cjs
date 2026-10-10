"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 17 (onda I-b do painel simples:
 * o estoque do painel segue UMA regra) -- as migrations 20261212000000 (`painel_inicio`, o Inicio
 * conta estoque baixo pela regra da loja), 20261213000000 (`get_admin_products_paged`, o filtro de
 * estoque baixo do admin segue a regra) e 20261214000000 (`get_admin_analytics_v2`, o lucro do
 * estoque so conta produto com custo), cada uma trocando SO o corpo de UMA funcao --, num Postgres
 * EFEMERO local, nada de rede, nada de loja:
 *   17a-conferir-estoque-do-painel-aplicado.sql        (DEPOIS do apply: 14 linhas)
 *   17b-antes-estoque-do-painel-corpos-vigentes.sql    (ANTES do apply: 11 linhas)
 * Elas sao a "prova de objetos" do lote 20261212000000 + 20261213000000 + 20261214000000 em
 * scripts/frota/canais-de-backend.json: sem elas o portao (scripts/frota/publicar-release.mjs)
 * bloqueia a release com essas migrations novas. Esta prova diz que cada consulta DECIDE certo --
 * nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da consulta contra
 * o ref de cada loja diz).
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada: as tres
 * aplicadas = o DEPOIS). Cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK; as consultas rodam nela como um papel de LEITURA nao superusuario (BYPASSRLS +
 * pg_read_all_data, imita o supabase_read_only_user), com `SET LOCAL ROLE` e a transacao ja somente
 * leitura. O ANTES e' o DEPOIS com os tres rollback-manual: a 20261214 e a 20261212 pelo
 * `desfazerSucessorasDa99` (tests/banco/sucessoras-da-99.cjs) e a 20261213 pelo rollback dela, com
 * guarda de hash. CRLF = o TEXTO do arquivo (migration ou rollback) com `\n` -> `\r\n`, executado na
 * transacao. Cada veredito e' levado ao PORTAO de verdade (`evidenciaDaProva` e `decidirLote`):
 * "positiva" aqui quer dizer POSITIVA para o portao, com `rol=ok`; "reprova" quer dizer NEGATIVA
 * (nunca POSITIVA). A ponta a ponta usa DOIS clones commitados (o de depois e o de antes), com o
 * conferir-banco.cjs de verdade num processo filho falando com um servidor HTTP local.
 *
 * CASOS (cada um com as LINHAS exatas que reprovam; o veredito real, com rol=ok e o ok_false
 * esperado, e' conferido em TODO caso):
 *  ESTADOS     antes (LF e CRLF): 17a NEGATIVA nas 3 linhas de corpo, 17b POSITIVA; depois (a arvore,
 *              o antes + as tres aplicadas em LF e em CRLF, aplicar 2x, ida-volta-ida, e as tres
 *              aplicadas na ordem 12->14 ou 14->12): 17a POSITIVA (linha a linha IGUAL a arvore), 17b
 *              NEGATIVA nas 3 linhas de corpo; depois dos tres rollbacks em qualquer ordem: como antes.
 *              17b e 17a POSITIVAS tambem com o papel minimo, `search_path` vazio e objetos-isca (as
 *              tres funcoes, com o corpo certo, no schema `isca` a frente do search_path).
 *  MISTOS      os 6 subconjuntos proprios das tres (LF e CRLF): a 17a reprova SO o corpo das que
 *              faltam e a 17b SO o das que entraram.
 *  8e          em TODOS os estados acima (antes, depois, mistos, CRLF, ida e volta) a 8e (rol 92-202)
 *              sai POSITIVA com rol=ok: o lote 17 nunca deixa a 8e vermelha.
 *  NEGATIVOS   (17a sobre o depois, 17b sobre o antes; cada um reprova SO a sua linha) corpo com 1
 *              byte a mais e com 1 caractere trocado -> corpo; funcao ausente -> sobrecargas 0, corpo,
 *              EXECUTE (e forma, na 17a) AUSENTE; sobrecarga extra com o mesmo corpo -> sobrecargas;
 *              (so 17a) SECURITY INVOKER, RESET search_path, search_path = public, pg_temp,
 *              painel_inicio VOLATILE e get_admin_analytics_v2 STABLE -> forma; GRANT EXECUTE a anon,
 *              a PUBLIC e REVOKE de authenticated -> o EXECUTE da funcao; RENAME COLUMN de
 *              produtos.estoque_minimo e de product_variants.stock_increment -> colunas. E os que
 *              reprovam VARIAS linhas, de proposito: o papel `anon` (ou `authenticated`) inexistente
 *              (renomeado numa transacao desfeita) -> as 3 linhas de EXECUTE, com `papel ausente` no
 *              vivo; o schema `public` renomeado (transacao desfeita) -> TODAS as linhas, o controle
 *              com '0'.
 *  MUTANTES    cada linha virando constante (a de controle tambem, e o controle sempre '>0'); o CRLF
 *              de cada corpo fora dos aceitos; o hash do ANTES nos aceitos da 17a (e o do DEPOIS nos da
 *              17b); o filtro `n.nspname = 'public'` das sobrecargas fora; a clausula de anon e de
 *              authenticated de cada linha de EXECUTE desligada, a de PUBLIC invertida, os papeis
 *              trocados no CTE `fn`, o `papel ausente` engolido pelo formato da 16a
 *              (`COALESCE(CASE WHEN f.exec_anon ...)`) e o `to_regrole` de um papel no lugar do outro
 *              -- cada um deixa um caso PASSAR e esta prova ficaria VERMELHA (a saida vermelha de cada
 *              um e' impressa). Dois mutantes sao EQUIVALENTES e a prova os MEDE como tais (ver LIMITES).
 *  FECHADO     resposta PARCIAL, linha duplicada, linha a mais e o rol de uma consulta julgando a
 *              outra (ou a 8e) tem rol=invalido: o portao fica SEM_EVIDENCIA, nunca POSITIVA.
 *  ERRO        SQL truncado (42601) e banco inexistente: nenhuma linha VEREDITO-CONSULTA, o portao
 *              fica SEM_EVIDENCIA.
 *  PONTA A PONTA  conferir-banco.cjs de verdade e o LOTE do canais-de-backend.json REAL (`lerCanais()`)
 *              no `decidirLote`: antes + ledger vazio (17a negativa, 17b positiva) -> APLICAR
 *              [20261212000000, 20261213000000, 20261214000000] (o `decidirLote` devolve o `faltam`
 *              que recebe; a ordem do lote vem de `migrationsDaRelease`, que ordena); depois + ledger completo
 *              (17a positiva) -> NADA; depois + ledger vazio -> PARAR (sem backfillLedger); so a 12 +
 *              ledger [12] (as duas negativas) -> PARAR; antes + ledger [12, 13] (17b positiva) ->
 *              PARAR (contradicao); antes + ledger completo (17a negativa) -> PARAR SO com a prova
 *              exigida (com `exigeProva: false` e' NADA: ver LIMITES); antes com GRANT a
 *              anon + ledger vazio (17b negativa) -> PARAR. A 8e pelo processo de verdade segue
 *              POSITIVA no antes e no depois.
 *
 * Toda mutacao (de corpo, forma, ACL, coluna ou estado) leva uma GUARDA que da RAISE se nao aplicou:
 * sem ela, um mutante que nao aplica nada vira falso verde. Papeis temporarios com nome unico,
 * removidos no fim, e os dois clones somem no fim.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user), o Postgres 15/17 da Supabase e a ACL real das lojas NAO foram medidos
 * aqui. (2) A linha "controle: funcoes de public visiveis" conta as funcoes do schema `public`: o
 * negativo local e' o schema renomeado numa transacao desfeita (o controle mostra '0' e o mutante
 * "controle sempre '>0'" e' pego). O caso "catalogo vazio por PERMISSAO" (um papel que nao enxerga
 * pg_proc) nao e' montavel aqui: pg_proc e' legivel por todo papel neste Postgres. (3) As consultas nao medem service_role nem o DONO
 * das funcoes (o lote nao muda nenhum dos dois); a 17b nao mede a forma (o CREATE OR REPLACE do lote
 * a reescreve igual; a 17a a mede depois). (4) Mutantes EQUIVALENTES, medidos aqui como tais (sem
 * caso que os distinga, por construcao do Postgres): a clausula de PUBLIC no EXECUTE desligada (o
 * EXECUTE de PUBLIC alcanca anon, entao a linha reprova pela clausula de anon) e o
 * `NOT a.attisdropped` do CTE `faltam` (o Postgres renomeia a coluna apagada para
 * `........pg.dropped.N........`, entao o nome nunca casa). (5) O texto de `proconfig` de
 * `get_admin_products_paged` (`search_path=public, extensions`) e' o que ESTE Postgres imprime. (6)
 * Estas consultas provam OBJETOS; o COMPORTAMENTO (a regra do estoque baixo, o lucro so com custo) e'
 * de tests/banco/estoque-baixo-uma-regra-viva.cjs e tests/banco/inventario-so-com-custo-viva.cjs.
 * (7) PONTO CEGO DO PORTAO (medido no L6b): com o ledger COMPLETO e o lote ja no SHA que a loja
 * serve (`exigeProva: false`), o portao nao pede a 17a e decide NADA mesmo com o banco no ANTES -- e'
 * o estado de um rollback-manual feito por `psql` direto (o ledger fica com as versoes). Por isso o
 * runbook (item 15) manda desfazer SO pelo aplicar-migrations.yml, que apaga a versao do ledger.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/estoque-do-painel-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas, as migrations e o
 * publicar-release.mjs), nunca de entrada de rede; as chaves de objeto vem de constantes e
 * mapas fechados deste arquivo (nomes das consultas, das funcoes e das linhas). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  SUCESSORAS_DA_99,
  conferirLista,
  desfazerSucessorasDa99,
} = require("./sucessoras-da-99.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "17a-conferir-estoque-do-painel-aplicado";
const B = "17b-antes-estoque-do-painel-corpos-vigentes";
const E8 = "8e-conferir-92-a-202-aplicado";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B), [E8]: lerConsulta(E8) };
const ROL = {
  [A]: CONF.ROL_DA_17A,
  [B]: CONF.ROL_DA_17B,
  [E8]: CONF.ROL_DA_8E,
};
const N_LINHAS = { [A]: 14, [B]: 11, [E8]: CONF.ROL_DA_8E.length };
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "f".repeat(40);
const ACL_ESPERADA = "PUBLIC=nao anon=nao authenticated=sim";

// ---------------------------------------------------------------------------
// As tres funcoes do lote, na ordem das linhas das consultas. Os corpos e os hashes sao
// recalculados dos ARQUIVOS (nenhum literal solto aqui) e conferidos contra o que as consultas
// aceitam, contra o pre-voo de cada migration e contra o rollback-manual dela.
// ---------------------------------------------------------------------------
const ARQ199 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const ARQ_BASELINE = "20260806000000_baseline_do_schema_vivo.sql";
const lerLF = (arq) =>
  fs.readFileSync(path.join(MIGRATIONS, arq), "utf8").replace(/\r\n/g, "\n");
const crlfDe = (s) => s.replace(/\n/g, "\r\n");
const textoDe = (arq, crlf) => (crlf ? crlfDe(lerLF(arq)) : lerLF(arq));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s) =>
  createHash("md5").update(s.replace(/\r/g, ""), "utf8").digest("hex");
/** O texto entre o `AS $$` e o `$$;` da funcao cujo cabecalho abre o CREATE (uma vez no arquivo). */
const corpoDe = (texto, cabecalho) => {
  const ini = texto.indexOf(cabecalho);
  assert.ok(ini >= 0, `nao achei ${cabecalho}`);
  assert.equal(
    texto.indexOf(cabecalho, ini + 1),
    -1,
    `${cabecalho} definida duas vezes no mesmo arquivo`,
  );
  const abre = texto.indexOf("AS $$", ini) + "AS $$".length;
  const fim = texto.indexOf("$$;", abre);
  assert.ok(fim > abre, `nao achei o fim do corpo de ${cabecalho}`);
  return texto.slice(abre, fim);
};
const RE_PAR_DE_HASHES =
  /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g;
const FUNCOES = [
  {
    chave: "analytics",
    nome: "get_admin_analytics_v2",
    sig: "public.get_admin_analytics_v2(integer)",
    versao: "20261214000000",
    arq: "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql",
    arqAntes: ARQ199,
    cabAntes:
      "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)",
    origem: "20261199000000",
  },
  {
    chave: "produtos",
    nome: "get_admin_products_paged",
    sig: "public.get_admin_products_paged(text,text,text,text,integer,integer)",
    versao: "20261213000000",
    arq: "20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql",
    arqAntes: ARQ_BASELINE,
    cabAntes: "CREATE FUNCTION public.get_admin_products_paged(",
    origem: "20260806000000",
  },
  {
    chave: "painel",
    nome: "painel_inicio",
    sig: "public.painel_inicio()",
    versao: "20261212000000",
    arq: "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql",
    arqAntes: ARQ199,
    cabAntes: "CREATE OR REPLACE FUNCTION public.painel_inicio()",
    origem: "20261199000000",
  },
].map((f) => {
  const rollback = `rollback-manual-${f.arq}`;
  const cab = `CREATE OR REPLACE FUNCTION public.${f.nome}(`;
  const antes = corpoDe(lerLF(f.arqAntes), f.cabAntes);
  const depois = corpoDe(lerLF(f.arq), cab);
  const pares = [...lerLF(f.arq).matchAll(RE_PAR_DE_HASHES)];
  assert.equal(
    pares.length,
    1,
    `${f.arq}: o pre-voo tem de citar UM par (vigente, desta)`,
  );
  return {
    ...f,
    rollback,
    corpo: { antes, depois, devolvido: corpoDe(lerLF(rollback), cab) },
    preVoo: {
      assinatura: pares[0][1],
      vigente: pares[0][2],
      desta: pares[0][3],
    },
    md5: { antes: md5(antes), depois: md5(depois) },
    hash: {
      antes: { lf: sha(antes), crlf: sha(crlfDe(antes)) },
      depois: { lf: sha(depois), crlf: sha(crlfDe(depois)) },
    },
    linha: {
      sobre: `${f.nome}: sobrecargas`,
      exec: `${f.nome}: EXECUTE`,
      forma: `${f.nome}: forma`,
      corpoA: `${f.nome}: corpo e o da ${f.versao} (sha256)`,
      corpoB: `${f.nome}: corpo e o da ${f.origem} (sha256)`,
    },
  };
});
const F = Object.fromEntries(FUNCOES.map((f) => [f.chave, f]));
const CHAVES = FUNCOES.map((f) => f.chave);
const CONTROLE = "controle: funcoes de public visiveis a este papel";
const COLUNAS = "produtos e product_variants: colunas que os corpos novos leem";
const corposA = (chaves) => chaves.map((k) => F[k].linha.corpoA);
const corposB = (chaves) => chaves.map((k) => F[k].linha.corpoB);
const fora = (chaves) => CHAVES.filter((k) => !chaves.includes(k));

const ordena = (l) => [...l].sort();
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `pe_ro_${SUF}`, // NOLOGIN BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  minimo: `pe_min_${SUF}`, // NOLOGIN, sem nada: so o catalogo que todo papel le
};

const urlBase = lerDatabaseUrlEfemera();
const MOLDE = new URL(urlBase).pathname.replace(/^\//, "") || "postgres";
const urlDe = (db) => {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
};
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
const clones = [];
async function clonar(rotulo, de = MOLDE) {
  const nome = `pe_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await usar("template1", (a) =>
        a.query(`CREATE DATABASE "${nome}" TEMPLATE "${de}"`),
      );
      break;
    } catch (e) {
      // 55006: o molde ainda esta sendo liberado pela conexao que acabou de fechar.
      if (e.code !== "55006" || tentativa >= 20) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  clones.push(nome);
  return nome;
}
let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}

// ---------------------------------------------------------------------------
// Guardas e montagens (cada uma recebe a conexao, dentro da transacao do estado)
// ---------------------------------------------------------------------------
const MD5_VIVO = (sig) =>
  `(SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;
const SHA_VIVO = (sig) =>
  `(SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;
/** A GUARDA: um DO que da RAISE se `guarda` (expressao booleana) nao for VERDADEIRA. */
const guardaSql = (rotulo, guarda) =>
  `DO $g$ BEGIN IF NOT COALESCE((${guarda}), false) THEN RAISE EXCEPTION 'a mutacao nao aplicou: ${rotulo.replace(/'/g, "''")}'; END IF; END $g$`;
const guardar = (c, rotulo, guarda) => c.query(guardaSql(rotulo, guarda));
/** Uma mutacao SEGUIDA da guarda que da RAISE se ela nao aplicou. */
async function mutar(c, rotulo, sql, guarda) {
  await c.query(sql);
  await guardar(c, rotulo, guarda);
}
const TODOS = (lado) => Object.fromEntries(CHAVES.map((k) => [k, lado]));
/** GUARDA do estado: o corpo vivo de cada funcao e' o do lado pedido, byte a byte (sha256 LF ou CRLF). */
async function exigirCorpos(c, rotulo, lados, crlf = false) {
  for (const f of FUNCOES) {
    const lado = lados[f.chave];
    await guardar(
      c,
      `${rotulo}: ${f.nome} com o corpo ${lado}${crlf ? " em CRLF" : ""}`,
      `${SHA_VIVO(f.sig)} = '${f.hash[lado][crlf ? "crlf" : "lf"]}'`,
    );
  }
}
const em =
  (...passos) =>
  async (c) => {
    let ultimo;
    for (const p of passos) ultimo = await p(c);
    return ultimo;
  };
/** Desfaz UMA funcao pelo rollback-manual dela (o pre-voo dele exige o corpo do DEPOIS). */
const desfazer =
  (f, crlf = false) =>
  async (c) => {
    await guardar(
      c,
      `${f.rollback}: o corpo do DEPOIS no ar`,
      `${MD5_VIVO(f.sig)} = '${f.md5.depois}'`,
    );
    await c.query(textoDe(f.rollback, crlf));
    await guardar(
      c,
      `${f.rollback} devolveu o corpo de antes${crlf ? " em CRLF" : ""}`,
      `${SHA_VIVO(f.sig)} = '${f.hash.antes[crlf ? "crlf" : "lf"]}'`,
    );
  };
/** Aplica UMA migration do lote pelo TEXTO do arquivo (o pre-voo dela roda junto). */
const aplicar =
  (f, crlf = false) =>
  async (c) => {
    await c.query(textoDe(f.arq, crlf));
    await guardar(
      c,
      `${f.arq} deixou o corpo dela${crlf ? " em CRLF" : ""}`,
      `${SHA_VIVO(f.sig)} = '${f.hash.depois[crlf ? "crlf" : "lf"]}'`,
    );
  };
const DEPOIS = (c) =>
  exigirCorpos(c, "depois (arvore inteira)", TODOS("depois"));
/** O ANTES: a 20261214 e a 20261212 desfeitas pelo modulo das sucessoras da 99, a 20261213 pelo rollback dela. */
const ANTES = async (c) => {
  await DEPOIS(c);
  const desfeitas = await desfazerSucessorasDa99(c);
  assert.deepEqual(
    desfeitas,
    SUCESSORAS_DA_99.map((s) => s.nome).reverse(),
    "as duas sucessoras da 99 tinham de estar no ar e sair",
  );
  await desfazer(F.produtos)(c);
  await exigirCorpos(c, "antes", TODOS("antes"));
};
/** O ANTES de um checkout Windows: os tres rollbacks executados em CRLF. */
const ANTES_CRLF = em(DEPOIS, ...FUNCOES.map((f) => desfazer(f, true)), (c) =>
  exigirCorpos(c, "antes em CRLF", TODOS("antes"), true),
);
/** O antes + SO as funcoes de `chaves` aplicadas (o MISTO, ou o DEPOIS com as tres). */
const comAplicadas = (chaves, crlf = false) =>
  em(
    crlf ? ANTES_CRLF : ANTES,
    ...chaves.map((k) => aplicar(F[k], crlf)),
    (c) =>
      exigirCorpos(
        c,
        `aplicadas: ${chaves.join(", ")}`,
        Object.fromEntries(
          CHAVES.map((k) => [k, chaves.includes(k) ? "depois" : "antes"]),
        ),
        crlf,
      ),
  );
/** As tres funcoes, com o MESMO corpo, num schema `isca` (a isca de mesmo nome nao pode contar). */
const ISCAS = async (c) => {
  await c.query("CREATE SCHEMA isca");
  for (const f of FUNCOES) {
    const def = (
      await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
        f.sig,
      ])
    ).rows[0].d;
    const cab = `FUNCTION public.${f.nome}(`;
    assert.ok(def.includes(cab), `${f.nome}: cabecalho nao achado`);
    await c.query(def.replace(cab, `FUNCTION isca.${f.nome}(`));
  }
  await c.query("GRANT USAGE ON SCHEMA isca TO PUBLIC");
  for (const f of FUNCOES)
    await guardar(
      c,
      `isca ${f.nome} com o corpo de public`,
      `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'isca' AND p.proname = '${f.nome}'
                  AND p.prosrc = (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('${f.sig}')))`,
    );
};

/** CREATE OR REPLACE com o texto de pg_get_functiondef e o corpo transformado (cabecalho, atributos e ACL intactos). */
async function reescreverCorpo(c, sig, transformar) {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
  assert.ok(def, `${sig}: sem definicao`);
  const i = def.indexOf("$function$");
  const j = def.lastIndexOf("$function$");
  assert.ok(i > 0 && j > i, "pg_get_functiondef sem $function$");
  const corpo = def.slice(i + "$function$".length, j);
  const novo = transformar(corpo);
  assert.notEqual(novo, corpo, `${sig}: a transformacao nao mudou nada`);
  await c.query(def.slice(0, i + "$function$".length) + novo + def.slice(j));
}
const maisUmByte = (c) => `${c} `;
// troca UM caractere sem mudar o que o corpo faz (dentro de um comentario ou, sem comentario, a
// caixa de uma letra do BEGIN: palavra-chave nao distingue maiuscula): so o hash muda
const trocaUmChar = (c) =>
  /--[^\n]*e/.test(c)
    ? c.replace(/(--[^\n]*?)e/, "$1E")
    : c.replace("BEGIN", "BEGiN");
const corpoMudado = (f, lado, transformar) => async (c) => {
  await reescreverCorpo(c, f.sig, transformar);
  await guardar(
    c,
    `corpo de ${f.nome} trocado`,
    `${SHA_VIVO(f.sig)} IS DISTINCT FROM '${f.hash[lado].lf}' AND ${MD5_VIVO(f.sig)} IS NOT NULL`,
  );
};
const QUANTAS = (nome) =>
  `(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${nome}')`;
const semFuncao = (f) => (c) =>
  mutar(
    c,
    `DROP ${f.nome}`,
    `DROP FUNCTION ${f.sig}`,
    `${QUANTAS(f.nome)} = 0`,
  );
/** SOBRECARGA extra com o MESMO corpo (a da assinatura do lote continua certa). */
const comSobrecarga = (f) => async (c) => {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
      f.sig,
    ])
  ).rows[0].d;
  const cab = `FUNCTION public.${f.nome}(`;
  const i = def.indexOf(cab);
  assert.ok(i > 0, `${f.nome}: cabecalho nao achado`);
  const k = i + cab.length;
  const isca = def[k] === ")" ? "p_isca_17 text" : "p_isca_17 text, ";
  await mutar(
    c,
    `sobrecarga de ${f.nome}`,
    def.slice(0, k) + isca + def.slice(k),
    `${QUANTAS(f.nome)} = 2 AND (SELECT count(DISTINCT p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${f.nome}') = 1`,
  );
};
const DO_PROC = (sig, expr) =>
  `(SELECT ${expr} FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;
/** Os desvios de forma (so a 17a mede forma): [rotulo, SQL, guarda, trecho que o `vivo` tem de mostrar]. */
const FORMAS = (f) => [
  [
    "invoker",
    `ALTER FUNCTION ${f.sig} SECURITY INVOKER`,
    DO_PROC(f.sig, "NOT prosecdef"),
    " SECURITY INVOKER ",
  ],
  [
    "sem-search-path",
    `ALTER FUNCTION ${f.sig} RESET search_path`,
    DO_PROC(f.sig, "proconfig IS NULL"),
    " sem search_path ",
  ],
  [
    "search-path-pg-temp",
    `ALTER FUNCTION ${f.sig} SET search_path = public, pg_temp`,
    DO_PROC(f.sig, "array_to_string(proconfig, ',') LIKE '%pg_temp%'"),
    "pg_temp",
  ],
  ...(f.chave === "painel"
    ? [
        [
          "volatile",
          `ALTER FUNCTION ${f.sig} VOLATILE`,
          DO_PROC(f.sig, "provolatile = 'v'"),
          "plpgsql VOLATILE ",
        ],
      ]
    : []),
  ...(f.chave === "analytics"
    ? [
        [
          "stable",
          `ALTER FUNCTION ${f.sig} STABLE`,
          DO_PROC(f.sig, "provolatile = 's'"),
          "plpgsql STABLE ",
        ],
      ]
    : []),
];
const EXEC_PUBLIC = (sig) =>
  `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${sig}') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')`;
/** Os desvios de ACL: [rotulo, SQL, guarda, o `vivo` da linha]. */
const ACLS = (f) => [
  [
    "exec-anon",
    `GRANT EXECUTE ON FUNCTION ${f.sig} TO anon`,
    `has_function_privilege('anon', to_regprocedure('${f.sig}'), 'EXECUTE')`,
    "PUBLIC=nao anon=sim authenticated=sim",
  ],
  [
    "exec-public",
    `GRANT EXECUTE ON FUNCTION ${f.sig} TO PUBLIC`,
    EXEC_PUBLIC(f.sig),
    "PUBLIC=sim anon=sim authenticated=sim",
  ],
  [
    "sem-exec-authenticated",
    `REVOKE EXECUTE ON FUNCTION ${f.sig} FROM authenticated`,
    `NOT has_function_privilege('authenticated', to_regprocedure('${f.sig}'), 'EXECUTE')`,
    "PUBLIC=nao anon=nao authenticated=nao",
  ],
];
/** O papel `papel` deixa de existir pelo NOME (renomeado; o ROLLBACK do estado o devolve). */
const semPapel = (papel) => (c) =>
  mutar(
    c,
    `${papel} renomeado`,
    `ALTER ROLE ${papel} RENAME TO pe_${papel}_${SUF}`,
    `to_regrole('${papel}') IS NULL AND to_regrole('pe_${papel}_${SUF}') IS NOT NULL`,
  );
/** O schema `public` deixa de existir pelo NOME (renomeado; o ROLLBACK do estado o devolve). */
const semSchemaPublic = (c) =>
  mutar(
    c,
    "schema public renomeado",
    `ALTER SCHEMA public RENAME TO pe_public_${SUF}`,
    `to_regnamespace('public') IS NULL AND to_regnamespace('pe_public_${SUF}') IS NOT NULL`,
  );
const COLUNAS_LIDAS = [
  "product_variants.active",
  "product_variants.product_id",
  "product_variants.stock_increment",
  "produtos.ativo",
  "produtos.custo",
  "produtos.deleted_at",
  "produtos.estoque",
  "produtos.estoque_minimo",
  "produtos.id",
  "produtos.preco_venda",
];
const COLUNAS_RENOMEADAS = [
  ["produtos", "estoque_minimo"],
  ["product_variants", "stock_increment"],
];
const renomear = (tabela, coluna) => (c) =>
  mutar(
    c,
    `RENAME ${tabela}.${coluna}`,
    `ALTER TABLE public.${tabela} RENAME COLUMN ${coluna} TO pe_${coluna}`,
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.${tabela}'::regclass AND attname = '${coluna}' AND NOT attisdropped)
     AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.${tabela}'::regclass AND attname = 'pe_${coluna}' AND NOT attisdropped)`,
  );

// ---------------------------------------------------------------------------
// Estado numa transacao desfeita; as consultas como papel so-leitura
// ---------------------------------------------------------------------------
let C; // a conexao unica com o clone do rodar-isolado
/**
 * BEGIN; `montar` (como o dono da conexao); `preparo` (SET LOCAL de sessao); SET LOCAL ROLE so-leitura e
 * a transacao somente leitura; cada consulta (nome, ou { consulta, sql } para um texto mutado); ROLLBACK.
 */
async function noEstado(montar, pedidos, { papel = P.ro, preparo = [] } = {}) {
  await C.query("BEGIN");
  try {
    const montado = montar ? await montar(C) : undefined;
    for (const p of preparo) await C.query(p);
    await C.query(`SET LOCAL ROLE ${papel}`);
    await C.query("SET LOCAL transaction_read_only = on");
    assert.equal(
      (await C.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only,
      "on",
    );
    const saidas = [];
    for (const pedido of pedidos) {
      const texto = typeof pedido === "string" ? SQL[pedido] : pedido.sql;
      assert.equal(CONF.contarStatements(texto), 1, "exatamente 1 statement");
      const r = await C.query(texto);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas.push(r.rows);
    }
    return { saidas, montado };
  } finally {
    await C.query("ROLLBACK");
  }
}
/** Como `noEstado`, para UM texto que tem de ERRAR: devolve o erro (nunca linhas). */
async function erroNoEstado(montar, texto) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    await C.query(`SET LOCAL ROLE ${P.ro}`);
    await C.query("SET LOCAL transaction_read_only = on");
    try {
      const r = await C.query(texto);
      return { rows: r.rows };
    } catch (erro) {
      return { erro };
    }
  } finally {
    await C.query("ROLLBACK");
  }
}
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
function linha(rows, item) {
  const l = rows.filter((r) => r.item === item);
  assert.equal(l.length, 1, `esperava 1 linha de "${item}", achei ${l.length}`);
  return l[0];
}

// ---------------------------------------------------------------------------
// O PORTAO
// ---------------------------------------------------------------------------
let PORTAO;
let relogio = Date.parse("2026-10-10T12:00:00Z");
async function portaoComLog(consulta, linhaDeVeredito, conclusao = "success") {
  relogio += 1000;
  return PORTAO.evidenciaDaProva({
    consulta,
    projeto: "savy",
    ref: REF_SAVY,
    sha: SHA40,
    topo: SHA40,
    validadeHoras: 6,
    agora: relogio + 60000,
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml"
          ? [
              {
                databaseId: 1,
                displayTitle: `conferir ${consulta} em savy`,
                headSha: SHA40,
                createdAt: new Date(relogio).toISOString(),
                conclusion: conclusao,
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () => `saida do job\n${linhaDeVeredito ?? ""}\n`,
      arvoreIgual: async () => true,
    },
  });
}
const veredito = (consulta, rows) =>
  CONF.veredictoDaConsulta({
    consulta,
    ref: REF_SAVY,
    sha: SHA40,
    linhas: rows,
  });
async function estadoNoPortao(consulta, rows) {
  return (await portaoComLog(consulta, veredito(consulta, rows))).estado;
}
function exigirFormato(consulta, rotulo, rows) {
  assert.equal(rows.length, N_LINHAS[consulta], `${rotulo}: n de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
    null,
    `${rotulo}: o rol fechado do codigo tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok nao booleano`);
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
      `${rotulo}: item/esperado/vivo tem de ser texto`,
    );
  }
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
}
async function exigirPositiva(consulta, rotulo, rows) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  const v = veredito(consulta, rows);
  assert.ok(
    v.endsWith(
      `linhas=${N_LINHAS[consulta]} ok_false=0 ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${v}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "POSITIVA", rotulo);
}
async function exigirReprovadas(consulta, rotulo, rows, esperadas) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    ordena(esperadas),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(ordena(esperadas))}`,
  );
  const v = veredito(consulta, rows);
  assert.ok(
    v.endsWith(
      `linhas=${N_LINHAS[consulta]} ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${v}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "NEGATIVA", rotulo);
}
const exigirResultado = (consulta, rotulo, rows, esperadas) =>
  esperadas.length
    ? exigirReprovadas(consulta, rotulo, rows, esperadas)
    : exigirPositiva(consulta, rotulo, rows);
/**
 * Um estado inteiro: a 17a e a 17b reprovam EXATAMENTE o pedido ([] = POSITIVA) e a 8e sai POSITIVA
 * (rol=ok) -- o lote 17 nunca deixa a 8e vermelha. Confere tambem o `vivo` das linhas de corpo.
 */
async function exigirEstado(rotulo, montar, aplicadas, crlf = false) {
  const {
    saidas: [ra, rb, r8],
  } = await noEstado(montar, [A, B, E8]);
  await exigirResultado(A, `17a ${rotulo}`, ra, corposA(fora(aplicadas)));
  await exigirResultado(B, `17b ${rotulo}`, rb, corposB(aplicadas));
  await exigirPositiva(E8, `8e ${rotulo}`, r8);
  const forma = crlf ? "crlf" : "lf";
  for (const f of FUNCOES) {
    const entrou = aplicadas.includes(f.chave);
    // aceito, o `vivo` mostra o esperado (o LF); reprovado, mostra o hash vivo de verdade
    assert.equal(
      linha(ra, f.linha.corpoA).vivo,
      entrou ? f.hash.depois.lf : f.hash.antes[forma],
      `${rotulo}: vivo da 17a em ${f.nome}`,
    );
    assert.equal(
      linha(rb, f.linha.corpoB).vivo,
      entrou ? f.hash.depois[forma] : f.hash.antes.lf,
      `${rotulo}: vivo da 17b em ${f.nome}`,
    );
    assert.equal(linha(ra, f.linha.exec).vivo, ACL_ESPERADA, rotulo);
    assert.equal(linha(rb, f.linha.exec).vivo, ACL_ESPERADA, rotulo);
    assert.equal(linha(ra, f.linha.sobre).vivo, "1", rotulo);
    assert.equal(
      linha(ra, f.linha.forma).vivo,
      linha(ra, f.linha.forma).esperado,
    );
  }
  assert.equal(linha(ra, COLUNAS).vivo, "EXISTEM");
  return { ra, rb, r8 };
}

// ---------------------------------------------------------------------------
// Mutantes do texto das consultas
// ---------------------------------------------------------------------------
function aplicarTrocas(rotulo, consulta, trocas) {
  let sql = SQL[consulta];
  for (const [de, para] of trocas) {
    assert.ok(
      sql.includes(de),
      `${rotulo}: o trecho a mutar nao existe: ${de}`,
    );
    const novoSql = sql.replace(de, () => para);
    assert.notEqual(novoSql, sql);
    sql = novoSql;
  }
  return sql;
}
function imprimeVermelho(rotulo, e) {
  assert.ok(e instanceof assert.AssertionError, String(e));
  console.log(
    `     mutante "${rotulo}" -> VERMELHO: ${String(e.message).split("\n")[0].slice(0, 200)}`,
  );
}
/** Com o mutante, o NEGATIVO `caso` deixa de reprovar o que devia (e fica MAIS verde). */
async function mutanteNegativo(rotulo, consulta, trocas, caso) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const {
    saidas: [real, mutante],
  } = await noEstado(caso.montar, [consulta, { sql }], caso.opcoes);
  await exigirReprovadas(
    consulta,
    `${rotulo} (consulta real)`,
    real,
    caso.esperadas,
  );
  let pego = false;
  try {
    await exigirReprovadas(
      consulta,
      `mutante ${rotulo}`,
      mutante,
      caso.esperadas,
    );
  } catch (e) {
    pego = true;
    imprimeVermelho(rotulo, e);
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido`);
  assert.ok(
    reprovadas(mutante).length < reprovadas(real).length,
    `${rotulo}: o mutante nao afrouxou nada`,
  );
}
/** Com o mutante, um POSITIVO deixa de ser positivo. */
async function mutantePositivo(rotulo, consulta, trocas, montar, opcoes) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const {
    saidas: [real, mutante],
  } = await noEstado(montar, [consulta, { sql }], opcoes);
  await exigirPositiva(consulta, `${rotulo} (consulta real)`, real);
  let pego = false;
  try {
    await exigirPositiva(consulta, `mutante ${rotulo}`, mutante);
  } catch (e) {
    pego = true;
    imprimeVermelho(rotulo, e);
  }
  assert.ok(pego, `${rotulo}: o MUTANTE do caso positivo passou despercebido`);
}
/** Mutante EQUIVALENTE (declarado nos LIMITES): no caso que mais o favoreceria, reprova o MESMO. */
async function mutanteEquivalente(rotulo, consulta, trocas, caso) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const {
    saidas: [real, mutante],
    montado,
  } = await noEstado(caso.montar, [consulta, { sql }], caso.opcoes);
  await exigirReprovadas(
    consulta,
    `${rotulo} (consulta real)`,
    real,
    caso.esperadas,
  );
  await exigirReprovadas(
    consulta,
    `mutante equivalente ${rotulo}`,
    mutante,
    caso.esperadas,
  );
  console.log(
    `     mutante "${rotulo}" -> EQUIVALENTE (medido: reprova as mesmas ${caso.esperadas.length} linha(s))`,
  );
  return { real, mutante, montado };
}
/**
 * Mutante pego pelo QUE a linha diz (o `checar` do caso) ou por ERRAR onde a consulta real responde:
 * a consulta real reprova `esperadas` e passa no `checar`; a mutada tem de falhar em algum dos dois
 * (ou dar erro do banco, que o portao trataria como SEM_EVIDENCIA, e esta prova como VERMELHA).
 */
async function mutanteComChecagem(rotulo, consulta, trocas, caso) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const [real] = (await noEstado(caso.montar, [consulta], caso.opcoes)).saidas;
  await exigirReprovadas(
    consulta,
    `${rotulo} (consulta real)`,
    real,
    caso.esperadas,
  );
  caso.checar(real);
  let pego = false;
  try {
    const [mutante] = (await noEstado(caso.montar, [{ sql }], caso.opcoes))
      .saidas;
    await exigirReprovadas(
      consulta,
      `mutante ${rotulo}`,
      mutante,
      caso.esperadas,
    );
    caso.checar(mutante);
  } catch (e) {
    pego = true;
    if (e instanceof assert.AssertionError) imprimeVermelho(rotulo, e);
    else {
      assert.ok(e.code, `${rotulo}: erro inesperado ${String(e)}`);
      console.log(
        `     mutante "${rotulo}" -> VERMELHO: a consulta mutada ERRA (${e.code}: ${String(e.message).slice(0, 120)}) onde a real responde`,
      );
    }
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido`);
}
function textoDaLinha(consulta, item) {
  const sql = SQL[consulta];
  const ini = sql.indexOf(`SELECT '${item}',`);
  assert.ok(ini >= 0, `a linha "${item}" nao existe na ${consulta}`);
  assert.equal(
    sql.indexOf(`SELECT '${item}',`, ini + 1),
    -1,
    `a linha "${item}" aparece mais de uma vez`,
  );
  const resto = sql.slice(ini);
  const fim = resto.search(/\n {2}(?:UNION ALL|-- )|\n\)\nSELECT item/);
  assert.ok(fim > 0, `nao achei o fim da linha "${item}"`);
  return resto.slice(0, fim);
}
/** A troca vale SO dentro do texto de UMA linha (o trecho se repete nas outras); `de` e' texto ou RegExp. */
function trocasNaLinha(rotulo, consulta, item, de, para) {
  const texto = textoDaLinha(consulta, item);
  // RegExp sem `g`: o primeiro achado e, depois dele, se ainda ha outro (2 = mais de um)
  const primeiro = typeof de === "string" ? null : texto.match(de);
  const achados =
    typeof de === "string"
      ? texto.split(de).length - 1
      : primeiro
        ? 1 +
          Number(
            texto.slice(primeiro.index + primeiro[0].length).search(de) >= 0,
          )
        : 0;
  assert.equal(
    achados,
    1,
    `${rotulo}: o trecho tem de estar UMA vez na linha ${item}`,
  );
  return [[texto, texto.replace(de, () => para)]];
}

// ---------------------------------------------------------------------------
// ponta a ponta: conferir-banco.cjs (processo filho de verdade) x servidor local
// ---------------------------------------------------------------------------
/** O servidor faz o papel da Management API: cada consulta numa transacao desfeita, depois de `montar`. */
function subirApi() {
  const estado = { db: null, papel: P.ro, montar: [] };
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", async () => {
      const query = JSON.parse(corpo).query;
      try {
        const c = new Client({ connectionString: urlDe(estado.db) });
        await c.connect();
        try {
          await c.query("BEGIN");
          for (const m of estado.montar) await c.query(m);
          await c.query(`SET LOCAL ROLE ${estado.papel}`);
          await c.query("SET LOCAL transaction_read_only = on");
          const r = await c.query(query);
          await c.query("ROLLBACK");
          res.writeHead(201, {
            "content-type": "application/json",
            connection: "close",
          });
          res.end(JSON.stringify(r.rows ?? []));
        } finally {
          await c.end().catch(() => {});
        }
      } catch (erro) {
        res.writeHead(400, {
          "content-type": "application/json",
          connection: "close",
        });
        res.end(JSON.stringify({ message: String(erro.message) }));
      }
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        estado,
        base: `http://127.0.0.1:${srv.address().port}`,
        parar: () => new Promise((r) => srv.close(r)),
      }),
    ),
  );
}
function rodarScript(env) {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      [path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs")],
      {
        env: {
          PATH: process.env.PATH,
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
          GITHUB_STEP_SUMMARY: "",
          ...env,
        },
      },
    );
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (saida += d));
    filho.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

// ---------------------------------------------------------------------------
async function main() {
  conferirLista();
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  for (const c of [A, B, E8]) {
    assert.ok(
      PORTAO.CONSULTAS_DE_ROL_FECHADO.has(c),
      `o portao tem de tratar ${c} como consulta de ROL FECHADO (so vale com rol=ok)`,
    );
    assert.equal(
      Object.entries(CONF.ROL_FECHADO_POR_CONSULTA).find(([n]) => n === c)?.[1],
      ROL[c],
    );
  }
  assert.deepEqual(
    Object.keys(CONF.ROL_FECHADO_POR_CONSULTA).sort(),
    [...PORTAO.CONSULTAS_DE_ROL_FECHADO].sort(),
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_17A),
    ordena([
      CONTROLE,
      COLUNAS,
      ...FUNCOES.flatMap((f) => [
        f.linha.sobre,
        f.linha.exec,
        f.linha.forma,
        f.linha.corpoA,
      ]),
    ]),
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_17B),
    ordena([
      CONTROLE,
      COLUNAS,
      ...FUNCOES.flatMap((f) => [f.linha.sobre, f.linha.exec, f.linha.corpoB]),
    ]),
  );
  // o que a 17a e a 17b aceitam e' o que os ARQUIVOS definem; o pre-voo e o rollback citam os mesmos corpos
  for (const f of FUNCOES) {
    assert.equal(f.preVoo.assinatura, f.sig, `${f.arq}: assinatura do pre-voo`);
    assert.equal(f.preVoo.vigente, f.md5.antes, `${f.arq}: hash_vigente`);
    assert.equal(f.preVoo.desta, f.md5.depois, `${f.arq}: hash_desta`);
    assert.equal(
      f.corpo.devolvido,
      f.corpo.antes,
      `${f.rollback} devolve o corpo de antes byte a byte`,
    );
    assert.ok(
      lerLF(f.rollback).includes(`'${f.md5.depois}'`),
      `${f.rollback}: o pre-voo exige o corpo do DEPOIS`,
    );
    for (const [consulta, lado, outro] of [
      [A, "depois", "antes"],
      [B, "antes", "depois"],
    ]) {
      assert.ok(
        SQL[consulta].includes(`'${f.hash[lado].lf}'`) &&
          SQL[consulta].includes(`'${f.hash[lado].crlf}'`),
        `${consulta} tem de aceitar o corpo ${lado} de ${f.nome} (LF e CRLF)`,
      );
      assert.ok(
        !SQL[consulta].includes(f.hash[outro].lf) &&
          !SQL[consulta].includes(f.hash[outro].crlf),
        `${consulta} nao pode aceitar o corpo ${outro} de ${f.nome}`,
      );
    }
  }
  assert.equal(
    new Set(
      FUNCOES.flatMap((f) => [
        f.hash.antes.lf,
        f.hash.antes.crlf,
        f.hash.depois.lf,
        f.hash.depois.crlf,
      ]),
    ).size,
    12,
    "os doze sha256 sao distintos",
  );
  // as sucessoras da 99 sao exatamente a 20261212 (painel_inicio) e a 20261214 (analytics)
  assert.deepEqual(
    SUCESSORAS_DA_99.map((s) => [s.nome, s.assinatura, s.hashDesta]).sort(),
    [F.painel, F.analytics].map((f) => [f.arq, f.sig, f.md5.depois]).sort(),
    "as sucessoras da 99 deixaram de ser a 20261212 e a 20261214: reveja esta prova",
  );
  ok(
    "precondicao: 17a, 17b e 8e sao de ROL FECHADO no portao e no contrato unico; os rols batem com as linhas por funcao; os seis sha256 da 17a (DEPOIS) e os seis da 17b (ANTES), LF e CRLF, sao os dos ARQUIVOS; o md5 de cada corpo e' o par (vigente, desta) do pre-voo; cada rollback-manual devolve o corpo de antes byte a byte",
  );

  // Os papeis sao do CLUSTER; a prova os cria (nomes unicos) e os remove no fim.
  await usar("template1", async (a) => {
    await a.query(`CREATE ROLE ${P.ro} NOLOGIN BYPASSRLS`);
    await a.query(`GRANT pg_read_all_data TO ${P.ro}`);
    await a.query(`CREATE ROLE ${P.minimo} NOLOGIN`);
  });
  {
    const sonda = await usar(MOLDE, async (c) => ({
      eu: (
        await c.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0].rolsuper,
      papeis: (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')",
        )
      ).rows[0].n,
      corpos: (
        await c.query(
          `SELECT ${FUNCOES.map((f) => `${SHA_VIVO(f.sig)} AS ${f.chave}`).join(", ")}`,
        )
      ).rows[0],
    }));
    assert.equal(
      sonda.eu,
      true,
      "precondicao: a conexao da prova e superusuario",
    );
    assert.equal(sonda.papeis, 3, "precondicao: os 3 papeis de fabrica");
    assert.deepEqual(
      sonda.corpos,
      Object.fromEntries(FUNCOES.map((f) => [f.chave, f.hash.depois.lf])),
      "precondicao: a arvore inteira esta no DEPOIS (as tres migrations do lote no ar, LF)",
    );
  }
  // Os DOIS clones commitados da ponta a ponta nascem ANTES da conexao das transacoes (o molde nao
  // pode ter sessao aberta enquanto serve de TEMPLATE).
  const cloneDepois = await clonar("depois");
  const cloneAntes = await clonar("antes");
  await usar(cloneAntes, (c) => ANTES(c));
  ok(
    "bases: o molde (clone do rodar-isolado) esta no DEPOIS, conexao superusuario, 3 papeis de fabrica; dois clones commitados para a ponta a ponta (o de depois e o de antes, este pelos tres rollback-manual com guarda)",
  );

  C = new Client({ connectionString: urlDe(MOLDE) });
  await C.connect();
  try {
    await provar(cloneDepois, cloneAntes);
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.end().catch(() => {});
  }
}

async function provar(cloneDepois, cloneAntes) {
  // ----------------------------------------------------------- ESTADOS (POSITIVOS)
  const antes = await exigirEstado("antes", ANTES, []);
  const depois = await exigirEstado("depois (arvore inteira)", DEPOIS, CHAVES);
  for (const f of FUNCOES) {
    assert.equal(linha(antes.rb, f.linha.corpoB).esperado, f.hash.antes.lf);
    assert.equal(linha(depois.ra, f.linha.corpoA).esperado, f.hash.depois.lf);
  }
  // a forma de cada funcao no ANTES e' a mesma do DEPOIS (o lote so troca o corpo): a 17a no antes
  // reprova so as linhas de corpo, e a linha de forma e' igual nos dois estados
  for (const f of FUNCOES)
    assert.deepEqual(
      linha(antes.ra, f.linha.forma),
      linha(depois.ra, f.linha.forma),
    );
  ok(
    "antes: 17a NEGATIVA SO nas 3 linhas de corpo (vivo = o hash de antes), 17b POSITIVA (11 linhas, rol=ok, portao POSITIVA); depois: 17a POSITIVA (14 linhas), 17b NEGATIVA SO nas 3 linhas de corpo; EXECUTE PUBLIC=nao anon=nao authenticated=sim, UMA sobrecarga e a mesma forma nos dois; a 8e POSITIVA nos dois",
  );
  const antesCrlf = await exigirEstado("antes em CRLF", ANTES_CRLF, [], true);
  assert.deepEqual(antesCrlf.rb, antes.rb, "17b em CRLF = 17b em LF");
  // a ordem do lote (12, 13, 14) e a inversa (14, 13, 12): as tres sao independentes
  const ORDEM_DO_LOTE = ["painel", "produtos", "analytics"];
  const depoisLf = await exigirEstado(
    "antes + as tres aplicadas na ordem 12, 13, 14 (LF)",
    comAplicadas(ORDEM_DO_LOTE),
    CHAVES,
  );
  const depoisCrlf = await exigirEstado(
    "antes em CRLF + as tres aplicadas em CRLF",
    comAplicadas(ORDEM_DO_LOTE, true),
    CHAVES,
    true,
  );
  const ordemInversa = await exigirEstado(
    "antes + as tres aplicadas na ordem 14, 13, 12",
    comAplicadas([...ORDEM_DO_LOTE].reverse()),
    CHAVES,
  );
  const duasVezes = await exigirEstado(
    "depois + as tres aplicadas de novo (2x)",
    em(DEPOIS, ...FUNCOES.map((f) => aplicar(f))),
    CHAVES,
  );
  const idaVoltaIda = await exigirEstado(
    "ida, volta e ida (depois, os tres rollbacks, as tres de novo)",
    em(
      DEPOIS,
      ...FUNCOES.map((f) => desfazer(f)),
      ...FUNCOES.map((f) => aplicar(f)),
    ),
    CHAVES,
  );
  for (const [rotulo, e] of [
    ["LF", depoisLf],
    ["CRLF", depoisCrlf],
    ["ordem inversa", ordemInversa],
    ["2x", duasVezes],
    ["ida-volta-ida", idaVoltaIda],
  ])
    assert.deepEqual(
      e.ra,
      depois.ra,
      `17a ${rotulo}: o apply dos ARQUIVOS e' indistinguivel da arvore inteira`,
    );
  ok(
    "17a POSITIVA e IGUAL linha a linha a arvore inteira depois do apply dos tres ARQUIVOS sobre o antes (LF; CRLF, com os corpos gravados em CRLF e o `esperado` no LF; na ordem 12->14 e 14->12), de aplicar 2x e de ida, volta e ida; 17b POSITIVA no antes em CRLF (igual ao LF); a 8e POSITIVA em todos",
  );
  // a ida e volta em QUALQUER ordem devolve o antes
  for (const ordem of [
    ["painel", "produtos", "analytics"],
    ["analytics", "produtos", "painel"],
    ["produtos", "painel", "analytics"],
  ]) {
    const e = await exigirEstado(
      `depois dos rollbacks na ordem ${ordem.join(", ")}`,
      em(DEPOIS, ...ordem.map((k) => desfazer(F[k]))),
      [],
    );
    assert.deepEqual(e.ra, antes.ra, `17a volta ${ordem.join(", ")}`);
    assert.deepEqual(e.rb, antes.rb, `17b volta ${ordem.join(", ")}`);
  }
  for (const e of [antesCrlf, depois, depoisLf, depoisCrlf, idaVoltaIda])
    assert.deepEqual(e.r8, antes.r8, "a 8e responde IGUAL em todos os estados");
  ok(
    "depois dos tres rollbacks em QUALQUER ordem (12-13-14, 14-13-12, 13-12-14) a 17b volta a ser POSITIVA e a 17a NEGATIVA, linha a linha iguais ao antes; a 8e da a MESMA resposta em todos os estados (antes, depois, CRLF, ida e volta)",
  );
  // papel minimo, search_path trocado e iscas de mesmo nome (com o corpo certo) em outro schema
  for (const [consulta, base, rotulo] of [
    [B, ANTES, "17b antes"],
    [A, DEPOIS, "17a depois"],
  ]) {
    const [minimo] = (await noEstado(base, [consulta], { papel: P.minimo }))
      .saidas;
    await exigirPositiva(consulta, `${rotulo} papel minimo`, minimo);
    const [vazio] = (
      await noEstado(base, [consulta], {
        preparo: ["SET LOCAL search_path = ''"],
      })
    ).saidas;
    await exigirPositiva(consulta, `${rotulo} search_path vazio`, vazio);
    const [isca] = (
      await noEstado(em(base, ISCAS), [consulta], {
        preparo: ["SET LOCAL search_path = isca, pg_catalog"],
      })
    ).saidas;
    await exigirPositiva(consulta, `${rotulo} com iscas a frente`, isca);
  }
  ok(
    "17b (antes) e 17a (depois) POSITIVAS tambem com o papel minimo (NOLOGIN sem nada: so o catalogo), com search_path vazio e com as tres funcoes-isca (mesmo nome, mesmo corpo) no schema `isca` a frente do search_path",
  );

  // ----------------------------------------------------------- MISTOS
  const SUBCONJUNTOS = [
    ["painel"],
    ["produtos"],
    ["analytics"],
    ["painel", "produtos"],
    ["painel", "analytics"],
    ["produtos", "analytics"],
  ];
  for (const crlf of [false, true])
    for (const s of SUBCONJUNTOS)
      await exigirEstado(
        `misto ${s.join("+")}${crlf ? " (CRLF)" : ""}`,
        comAplicadas(s, crlf),
        s,
        crlf,
      );
  ok(
    "MISTOS: nos 6 subconjuntos proprios das tres (LF e CRLF) a 17a reprova SO o corpo das que faltam e a 17b SO o corpo das que entraram (estado parcial = PARAR); a 8e segue POSITIVA com rol=ok em todos",
  );

  // ----------------------------------------------------------- NEGATIVOS
  const CASOS = { [A]: [], [B]: [] };
  const caso = (consulta, rotulo, mutacao, esperadas, checar) =>
    CASOS[consulta].push({
      rotulo,
      montar: em(consulta === A ? DEPOIS : ANTES, mutacao),
      esperadas,
      checar,
    });
  for (const [consulta, lado, corpo] of [
    [A, "depois", "corpoA"],
    [B, "antes", "corpoB"],
  ]) {
    const pre = consulta === A ? "a" : "b";
    for (const f of FUNCOES) {
      const L = f.linha;
      caso(
        consulta,
        `${pre}-${f.chave}-byte`,
        corpoMudado(f, lado, maisUmByte),
        [L[corpo]],
      );
      caso(
        consulta,
        `${pre}-${f.chave}-char`,
        corpoMudado(f, lado, trocaUmChar),
        [L[corpo]],
      );
      caso(
        consulta,
        `${pre}-${f.chave}-ausente`,
        semFuncao(f),
        [L.sobre, L[corpo], L.exec, ...(consulta === A ? [L.forma] : [])],
        (rows) => {
          assert.equal(linha(rows, L.sobre).vivo, "0");
          assert.equal(linha(rows, L[corpo]).vivo, "AUSENTE");
          assert.equal(linha(rows, L.exec).vivo, "AUSENTE");
          if (consulta === A)
            assert.equal(linha(rows, L.forma).vivo, "AUSENTE");
        },
      );
      caso(
        consulta,
        `${pre}-${f.chave}-sobrecarga`,
        comSobrecarga(f),
        [L.sobre],
        (rows) => assert.equal(linha(rows, L.sobre).vivo, "2"),
      );
      if (consulta === A)
        for (const [rotulo, sql, guarda, trecho] of FORMAS(f))
          caso(
            consulta,
            `a-${f.chave}-${rotulo}`,
            (c) => mutar(c, `${f.nome} ${rotulo}`, sql, guarda),
            [L.forma],
            (rows) =>
              assert.ok(
                linha(rows, L.forma).vivo.includes(trecho),
                `${f.nome} ${rotulo}: vivo ${linha(rows, L.forma).vivo}`,
              ),
          );
      for (const [rotulo, sql, guarda, vivo] of ACLS(f))
        caso(
          consulta,
          `${pre}-${f.chave}-${rotulo}`,
          (c) => mutar(c, `${f.nome} ${rotulo}`, sql, guarda),
          [L.exec],
          (rows) => assert.equal(linha(rows, L.exec).vivo, vivo),
        );
    }
    // o papel inexistente pelo nome: as 3 linhas de EXECUTE, com `papel ausente` (as consultas
    // guardam has_function_privilege com to_regrole: nunca o erro 42704)
    for (const [papel, vivo] of [
      ["anon", "PUBLIC=nao anon=papel ausente authenticated=sim"],
      ["authenticated", "PUBLIC=nao anon=nao authenticated=papel ausente"],
    ])
      caso(
        consulta,
        `${pre}-sem-${papel}`,
        semPapel(papel),
        FUNCOES.map((f) => f.linha.exec),
        (rows) => {
          for (const f of FUNCOES)
            assert.equal(linha(rows, f.linha.exec).vivo, vivo, f.nome);
        },
      );
    // o schema public inexistente pelo nome: TODAS as linhas, o controle com '0'
    caso(
      consulta,
      `${pre}-sem-schema-public`,
      semSchemaPublic,
      ROL[consulta],
      (rows) => {
        assert.equal(linha(rows, CONTROLE).vivo, "0");
        const vivoColunas = linha(rows, COLUNAS).vivo;
        assert.ok(vivoColunas.startsWith("AUSENTES: "), vivoColunas);
        assert.deepEqual(
          ordena(vivoColunas.slice("AUSENTES: ".length).split(", ")),
          ordena(COLUNAS_LIDAS),
        );
        for (const f of FUNCOES) {
          assert.equal(linha(rows, f.linha.sobre).vivo, "0");
          assert.equal(linha(rows, f.linha[corpo]).vivo, "AUSENTE");
          assert.equal(linha(rows, f.linha.exec).vivo, "AUSENTE");
          if (consulta === A)
            assert.equal(linha(rows, f.linha.forma).vivo, "AUSENTE");
        }
      },
    );
    for (const [tabela, coluna] of COLUNAS_RENOMEADAS)
      caso(
        consulta,
        `${pre}-coluna-${coluna}`,
        renomear(tabela, coluna),
        [COLUNAS],
        (rows) =>
          assert.equal(
            linha(rows, COLUNAS).vivo,
            `AUSENTES: ${tabela}.${coluna}`,
          ),
      );
  }
  for (const consulta of [A, B]) {
    for (const k of CASOS[consulta]) {
      const [rows] = (await noEstado(k.montar, [consulta])).saidas;
      await exigirReprovadas(
        consulta,
        `${consulta.slice(0, 3)} ${k.rotulo}`,
        rows,
        k.esperadas,
      );
      if (k.checar) k.checar(rows);
    }
  }
  ok(
    `NEGATIVOS, cada defeito reprovando SO a sua linha (${CASOS[A].length} na 17a sobre o depois, ${CASOS[B].length} na 17b sobre o antes): corpo com 1 byte a mais e com 1 caractere trocado; funcao ausente (sobrecargas 0 e corpo, EXECUTE e forma AUSENTE); sobrecarga extra com o mesmo corpo; SECURITY INVOKER, sem search_path, search_path com pg_temp, painel_inicio VOLATILE e analytics STABLE (forma, so 17a); EXECUTE a anon, a PUBLIC e sem authenticated; produtos.estoque_minimo e product_variants.stock_increment renomeadas (colunas); e os de varias linhas: anon ou authenticated inexistentes (as 3 linhas de EXECUTE com papel ausente) e o schema public renomeado (todas as linhas, o controle com 0)`,
  );

  // ----------------------------------------------------------- MUTANTES
  console.log(
    "\n  --- MUTANTES do texto das consultas (cada um tem de deixar um caso PASSAR) ---",
  );
  const casoDe = (consulta, rotulo) => {
    const k = CASOS[consulta].find((x) => x.rotulo === rotulo);
    assert.ok(k, `nao ha o caso ${rotulo}`);
    return k;
  };
  let nMutantes = 0;
  // cada linha vira constante: o primeiro negativo que reprova SO ela passa (o controle: o schema
  // public renomeado, que reprova todas)
  for (const consulta of [A, B])
    for (const item of ROL[consulta]) {
      const k =
        item === CONTROLE
          ? casoDe(consulta, `${consulta === A ? "a" : "b"}-sem-schema-public`)
          : CASOS[consulta].find(
              (x) => x.esperadas.length === 1 && x.esperadas[0] === item,
            );
      assert.ok(k, `nao ha negativo SO para a linha "${item}" (${consulta})`);
      await mutanteNegativo(
        `${consulta.slice(0, 3)} sem a linha '${item}'`,
        consulta,
        [[textoDaLinha(consulta, item), `SELECT '${item}', 'x', 'x'`]],
        k,
      );
      nMutantes += 1;
    }
  // o CRLF de cada corpo fora dos aceitos: o positivo em CRLF reprova
  for (const f of FUNCOES) {
    await mutantePositivo(
      `17a sem aceitar o CRLF de ${f.nome}`,
      A,
      [[`'${f.hash.depois.crlf}'`, "'x'"]],
      comAplicadas(CHAVES, true),
    );
    await mutantePositivo(
      `17b sem aceitar o CRLF de ${f.nome}`,
      B,
      [[`'${f.hash.antes.crlf}'`, "'x'"]],
      ANTES_CRLF,
    );
    nMutantes += 2;
  }
  // o hash do ANTES nos aceitos da 17a (e o do DEPOIS nos da 17b): o estado errado passaria
  for (const f of FUNCOES) {
    await mutanteNegativo(
      `17a aceitando o corpo de ANTES de ${f.nome}`,
      A,
      [
        [
          `f.h IN ('${f.hash.depois.lf}',`,
          `f.h IN ('${f.hash.antes.lf}', '${f.hash.depois.lf}',`,
        ],
      ],
      { montar: ANTES, esperadas: corposA(CHAVES) },
    );
    await mutanteNegativo(
      `17b aceitando o corpo do DEPOIS de ${f.nome}`,
      B,
      [
        [
          `f.h IN ('${f.hash.antes.lf}',`,
          `f.h IN ('${f.hash.depois.lf}', '${f.hash.antes.lf}',`,
        ],
      ],
      { montar: DEPOIS, esperadas: corposB(CHAVES) },
    );
    nMutantes += 2;
  }
  // o filtro do schema nas sobrecargas: as iscas de mesmo nome contariam
  for (const [consulta, base] of [
    [A, DEPOIS],
    [B, ANTES],
  ]) {
    await mutantePositivo(
      `${consulta.slice(0, 3)} sobrecargas sem o filtro n.nspname = 'public'`,
      consulta,
      [
        [
          "WHERE n.nspname = 'public' AND q.proname = t.nome",
          "WHERE q.proname = t.nome",
        ],
      ],
      em(base, ISCAS),
      { preparo: ["SET LOCAL search_path = isca, pg_catalog"] },
    );
    nMutantes += 1;
  }
  // o EXECUTE: a clausula de cada papel em cada linha, e os papeis trocados no CTE `fn`
  const RE_ANON =
    /CASE WHEN f\.exec_anon IS NULL THEN 'papel ausente'\s+WHEN f\.exec_anon THEN 'sim' ELSE 'nao' END/;
  const RE_AUTH =
    /CASE WHEN f\.exec_auth IS NULL THEN 'papel ausente'\s+WHEN f\.exec_auth THEN 'sim' ELSE 'nao' END/;
  const CLAUSULA_PUBLIC = "CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END";
  for (const [consulta, base, pre] of [
    [A, DEPOIS, "a"],
    [B, ANTES, "b"],
  ]) {
    const r = consulta.slice(0, 3);
    for (const f of FUNCOES) {
      const item = f.linha.exec;
      await mutanteNegativo(
        `${r} ${f.nome}: EXECUTE de anon ignorado`,
        consulta,
        trocasNaLinha("anon", consulta, item, RE_ANON, "'nao'"),
        casoDe(consulta, `${pre}-${f.chave}-exec-anon`),
      );
      await mutanteNegativo(
        `${r} ${f.nome}: authenticated sem EXECUTE ignorado`,
        consulta,
        trocasNaLinha("authenticated", consulta, item, RE_AUTH, "'sim'"),
        casoDe(consulta, `${pre}-${f.chave}-sem-exec-authenticated`),
      );
      await mutantePositivo(
        `${r} ${f.nome}: EXECUTE de PUBLIC invertido`,
        consulta,
        trocasNaLinha(
          "PUBLIC",
          consulta,
          item,
          CLAUSULA_PUBLIC,
          "CASE WHEN f.exec_public THEN 'nao' ELSE 'sim' END",
        ),
        base,
      );
      nMutantes += 3;
    }
    await mutantePositivo(
      `${r} CTE fn: anon medido como authenticated`,
      consulta,
      [
        [
          "has_function_privilege('anon', p.oid, 'EXECUTE')",
          "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
        ],
      ],
      base,
    );
    await mutantePositivo(
      `${r} CTE fn: authenticated medido como anon`,
      consulta,
      [
        [
          "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
          "has_function_privilege('anon', p.oid, 'EXECUTE')",
        ],
      ],
      base,
    );
    nMutantes += 2;
  }
  // o papel AUSENTE e o controle: o que so um estado de varias linhas distingue
  const FORMATO_16A_ANON =
    "COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')";
  const FORMATO_16A_AUTH =
    "COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente')";
  const RE_CONTROLE =
    /CASE WHEN \(SELECT count\(\*\) FROM pg_proc p JOIN pg_namespace n ON n\.oid = p\.pronamespace\s+WHERE n\.nspname = 'public'\) > 0 THEN '>0' ELSE '0' END/;
  for (const [consulta, pre] of [
    [A, "a"],
    [B, "b"],
  ]) {
    const r = consulta.slice(0, 3);
    for (const f of FUNCOES) {
      // anon inexistente vira 'nao' (o NULL cai no ELSE): a linha deixa de reprovar
      await mutanteNegativo(
        `${r} ${f.nome}: anon inexistente engolido (formato da 16a)`,
        consulta,
        trocasNaLinha(
          "anon",
          consulta,
          f.linha.exec,
          RE_ANON,
          FORMATO_16A_ANON,
        ),
        casoDe(consulta, `${pre}-sem-anon`),
      );
      // authenticated inexistente vira 'nao': ainda reprova, mas o vivo deixa de dizer `papel ausente`
      await mutanteComChecagem(
        `${r} ${f.nome}: authenticated inexistente dito 'nao' (formato da 16a)`,
        consulta,
        trocasNaLinha(
          "authenticated",
          consulta,
          f.linha.exec,
          RE_AUTH,
          FORMATO_16A_AUTH,
        ),
        casoDe(consulta, `${pre}-sem-authenticated`),
      );
      nMutantes += 2;
    }
    // o to_regrole de um papel no lugar do outro: has_function_privilege com o papel inexistente
    await mutanteComChecagem(
      `${r} CTE fn: to_regrole('anon') guardando authenticated`,
      consulta,
      [
        [
          "CASE WHEN to_regrole('authenticated') IS NULL THEN NULL",
          "CASE WHEN to_regrole('anon') IS NULL THEN NULL",
        ],
      ],
      casoDe(consulta, `${pre}-sem-authenticated`),
    );
    await mutanteComChecagem(
      `${r} CTE fn: to_regrole('authenticated') guardando anon`,
      consulta,
      [
        [
          "CASE WHEN to_regrole('anon') IS NULL THEN NULL",
          "CASE WHEN to_regrole('authenticated') IS NULL THEN NULL",
        ],
      ],
      casoDe(consulta, `${pre}-sem-anon`),
    );
    // o controle sempre '>0': com o schema public renomeado a linha deixa de reprovar
    await mutanteNegativo(
      `${r} controle sempre '>0'`,
      consulta,
      trocasNaLinha("controle", consulta, CONTROLE, RE_CONTROLE, "'>0'"),
      casoDe(consulta, `${pre}-sem-schema-public`),
    );
    nMutantes += 3;
  }
  // os EQUIVALENTES (LIMITES): medidos no caso que mais os favoreceria
  let nEquivalentes = 0;
  for (const [consulta, base, pre] of [
    [A, DEPOIS, "a"],
    [B, ANTES, "b"],
  ]) {
    const r = consulta.slice(0, 3);
    const k = casoDe(consulta, `${pre}-painel-exec-public`);
    const { real, mutante } = await mutanteEquivalente(
      `${r} painel_inicio: EXECUTE de PUBLIC ignorado`,
      consulta,
      trocasNaLinha(
        "PUBLIC",
        consulta,
        F.painel.linha.exec,
        CLAUSULA_PUBLIC,
        "'nao'",
      ),
      k,
    );
    // o EXECUTE de PUBLIC alcanca anon: a linha reprova pela clausula de anon
    assert.equal(
      linha(real, F.painel.linha.exec).vivo,
      "PUBLIC=sim anon=sim authenticated=sim",
    );
    assert.equal(
      linha(mutante, F.painel.linha.exec).vivo,
      "PUBLIC=nao anon=sim authenticated=sim",
    );
    // a coluna APAGADA: o Postgres a renomeia, e o nome nunca casa com ou sem `NOT a.attisdropped`
    const apagada = {
      montar: em(base, async (c) => {
        await mutar(
          c,
          "DROP product_variants.stock_increment",
          "ALTER TABLE public.product_variants DROP COLUMN stock_increment CASCADE",
          `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.product_variants'::regclass AND attname = 'stock_increment')
           AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.product_variants'::regclass AND attisdropped)`,
        );
        return (
          await c.query(
            "SELECT attname FROM pg_attribute WHERE attrelid = 'public.product_variants'::regclass AND attisdropped",
          )
        ).rows.map((x) => x.attname);
      }),
      esperadas: [COLUNAS],
    };
    const eq = await mutanteEquivalente(
      `${r} faltam sem NOT a.attisdropped`,
      consulta,
      [["AND a.attnum > 0 AND NOT a.attisdropped", "AND a.attnum > 0"]],
      apagada,
    );
    assert.ok(eq.montado.length > 0);
    for (const nome of eq.montado)
      assert.match(
        nome,
        /^\.+pg\.dropped\.\d+\.+$/,
        "a coluna apagada foi renomeada",
      );
    assert.deepEqual(
      eq.mutante,
      eq.real,
      "o mutante responde IGUAL linha a linha",
    );
    nEquivalentes += 2;
  }
  ok(
    `MUTANTES do texto das consultas: ${nMutantes} pegos (cada linha virando constante, menos a de controle; o CRLF de cada corpo fora dos aceitos; o hash do ANTES nos aceitos da 17a e o do DEPOIS nos da 17b; o filtro do schema nas sobrecargas; a clausula de anon e de authenticated de cada EXECUTE, a de PUBLIC invertida, os papeis trocados no CTE fn, o papel ausente no formato da 16a, o to_regrole de um papel no lugar do outro e o controle sempre '>0') -- a prova ficaria VERMELHA; ${nEquivalentes} EQUIVALENTES medidos como tais (PUBLIC desligado no EXECUTE e o NOT a.attisdropped de faltam), declarados nos LIMITES`,
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const soOk = antes.ra.filter((r) => r.ok === true);
    assert.ok(soOk.length > 0 && soOk.length < antes.ra.length);
    const v = veredito(A, soOk);
    assert.ok(v.endsWith("rol=invalido"), v);
    assert.equal(
      (await portaoComLog(A, v)).estado,
      "SEM_EVIDENCIA",
      "resposta PARCIAL com tudo ok=true nunca e positiva",
    );
    for (const [consulta, rows] of [
      [A, depois.ra],
      [B, antes.rb],
    ]) {
      for (const errada of [
        [...rows, rows[0]],
        [...rows, { item: "linha a mais", esperado: "x", vivo: "x", ok: true }],
      ]) {
        const ve = veredito(consulta, errada);
        assert.ok(ve.endsWith("rol=invalido"), ve);
        assert.equal(
          (await portaoComLog(consulta, ve)).estado,
          "SEM_EVIDENCIA",
        );
      }
    }
    for (const [consulta, rows] of [
      [A, antes.rb],
      [B, depois.ra],
      [E8, depois.ra],
      [A, antes.r8],
    ]) {
      const ve = veredito(consulta, rows);
      assert.ok(ve.endsWith("rol=invalido"), ve);
      assert.equal((await portaoComLog(consulta, ve)).estado, "SEM_EVIDENCIA");
    }
    ok(
      "rol FECHADO: a resposta PARCIAL (so as linhas ok=true), com linha duplicada, com linha a mais ou julgada pelo rol da OUTRA consulta (17a x 17b x 8e) tem rol=invalido e o portao a trata como SEM_EVIDENCIA, nunca POSITIVA",
    );
  }
  for (const consulta of [A, B]) {
    const corte = SQL[consulta].indexOf("\n)\nSELECT item");
    assert.ok(corte > 0);
    const r = await erroNoEstado(DEPOIS, SQL[consulta].slice(0, corte));
    assert.ok(r.erro && r.erro.code === "42601", String(r.erro));
    assert.equal(r.rows, undefined);
    for (const conclusao of ["success", "failure"])
      assert.equal(
        (await portaoComLog(consulta, null, conclusao)).estado,
        "SEM_EVIDENCIA",
      );
  }
  ok(
    "SQL truncado na 17a e na 17b: erro 42601, nenhuma linha, e o portao fica SEM_EVIDENCIA mesmo com o run verde -- erro nunca vira positivo",
  );

  // ----------------------------------------------------------- PONTA A PONTA
  const api = await subirApi();
  try {
    await pontaAPonta(api, cloneDepois, cloneAntes);
  } finally {
    await api.parar();
  }
  console.log(`\n[estoque-do-painel-portao-viva] ${resultados} provas ok`);
}

async function pontaAPonta(api, cloneDepois, cloneAntes) {
  const env = (consulta) => ({
    CONFERIR_BANCO_API_BASE: api.base,
    PROJETO: "savy",
    CONSULTA: consulta,
    SUPABASE_ACCESS_TOKEN_SAVY: "tk-teste",
    GITHUB_SHA: SHA40,
  });
  const executar = async (db, consulta, montar = []) => {
    api.estado.db = db;
    api.estado.montar = montar;
    return rodarScript(env(consulta));
  };
  // o run "de verdade": o log do processo filho vira a evidencia do portao
  let reloginho = Date.parse("2026-10-10T13:00:00Z");
  const evidencia = async (consulta, saida, conclusao = "success") => {
    reloginho += 60000;
    return PORTAO.evidenciaDaProva({
      consulta,
      projeto: "savy",
      ref: REF_SAVY,
      sha: SHA40,
      topo: SHA40,
      validadeHoras: 6,
      agora: reloginho + 1000,
      deps: {
        listarRuns: async (wf) =>
          wf === "conferir-banco-da-loja.yml"
            ? [
                {
                  databaseId: 1,
                  displayTitle: `conferir ${consulta} em savy`,
                  headSha: SHA40,
                  createdAt: new Date(reloginho).toISOString(),
                  conclusion: conclusao,
                  status: "completed",
                },
              ]
            : [],
        logDoRun: async () => saida,
        arvoreIgual: async () => true,
      },
    });
  };
  const canais = PORTAO.lerCanais();
  const lote = canais.provasDeObjetos.find((p) => p.consulta === A);
  assert.ok(lote, "o canais-de-backend.json real nao declara o lote da 17a");
  const [V12, V13, V14] = [
    F.painel.versao,
    F.produtos.versao,
    F.analytics.versao,
  ];
  assert.deepEqual(lote.versoes, [V12, V13, V14]);
  assert.equal(lote.ausenciaConfirmadaPor, B);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(lote[campo], undefined, `o lote nao devia declarar ${campo}`);
  /** Le as duas consultas pelo processo de verdade e decide o lote REAL. `faltam` = as versoes fora do ledger. */
  const decidir = async (db, faltam, montar = [], exigeProva = true) => {
    const sa = await executar(db, A, montar);
    assert.equal(sa.codigo, 0, sa.saida);
    const sb = await executar(db, B, montar);
    assert.equal(sb.codigo, 0, sb.saida);
    const prova = await evidencia(A, sa.saida);
    const diag = new Map([[B, await evidencia(B, sb.saida)]]);
    const diagB = diag.get(B);
    return {
      prova,
      diag: diagB,
      decisao: PORTAO.decidirLote({
        lote,
        faltam,
        exigeProva,
        prova,
        diagnostico: diag,
      }),
    };
  };
  // E1: os vereditos reais do processo filho (e a 8e no antes e no depois)
  for (const [db, consulta, linhas, okFalse] of [
    [cloneDepois, A, 14, 0],
    [cloneAntes, B, 11, 0],
    [cloneAntes, A, 14, 3],
    [cloneDepois, B, 11, 3],
    [cloneDepois, E8, N_LINHAS[E8], 0],
    [cloneAntes, E8, N_LINHAS[E8], 0],
  ]) {
    const e = await executar(db, consulta);
    assert.equal(e.codigo, 0, e.saida);
    assert.deepEqual(PORTAO.lerVeredicto(e.saida, consulta), {
      ref: REF_SAVY,
      sha: SHA40,
      linhas,
      okFalse,
      naoBooleano: 0,
      rol: "ok",
    });
    assert.equal(
      (await evidencia(consulta, e.saida)).estado,
      okFalse ? "NEGATIVA" : "POSITIVA",
      `${consulta}`,
    );
  }
  // E2: banco inexistente -> HTTP 400, saida 1, NENHUM veredito, SEM_EVIDENCIA
  for (const consulta of [A, B]) {
    const e2 = await executar("pe_banco_que_nao_existe", consulta);
    assert.equal(e2.codigo, 1, e2.saida);
    assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
    assert.equal((await evidencia(consulta, e2.saida)).estado, "SEM_EVIDENCIA");
  }
  // L1: antes + ledger sem as tres: 17a NEGATIVA + 17b POSITIVA -> APLICAR as tres
  const l1 = await decidir(cloneAntes, [V12, V13, V14]);
  assert.equal(l1.prova.estado, "NEGATIVA");
  assert.equal(l1.diag.estado, "POSITIVA");
  assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
  assert.deepEqual(l1.decisao.versoes, [V12, V13, V14]);
  // L1b: a ordem NAO e' do decidirLote (ele devolve o `faltam` que recebe); e' do
  // migrationsDaRelease, que ordena as versoes dos arquivos (12, 13, 14) antes de tudo
  const l1b = await decidir(cloneAntes, [V14, V12, V13]);
  assert.equal(l1b.decisao.acao, "APLICAR", JSON.stringify(l1b.decisao));
  assert.deepEqual(l1b.decisao.versoes, [V14, V12, V13]);
  assert.deepEqual(
    PORTAO.migrationsDaRelease(
      [F.analytics.arq, F.painel.arq, F.produtos.arq],
      {
        migrationsForaDaRelease: [],
      },
    ),
    [V12, V13, V14],
  );
  // L2: depois + ledger completo: 17a POSITIVA -> NADA
  const l2 = await decidir(cloneDepois, []);
  assert.equal(l2.prova.estado, "POSITIVA");
  assert.equal(l2.decisao.acao, "NADA", JSON.stringify(l2.decisao));
  // L3: depois + ledger sem as versoes (sem backfillLedger) -> PARAR, nenhum apply
  const l3 = await decidir(cloneDepois, [V12, V13, V14]);
  assert.equal(l3.prova.estado, "POSITIVA");
  assert.equal(l3.decisao.acao, "PARAR", JSON.stringify(l3.decisao));
  assert.match(l3.decisao.motivo, /não declara backfillLedger/);
  // L4: so a 20261212 no banco e no ledger: as duas consultas NEGATIVAS -> PARAR
  const SO_12 = [
    lerLF(F.painel.arq),
    guardaSql(
      "so a 20261212 no ar",
      `${SHA_VIVO(F.painel.sig)} = '${F.painel.hash.depois.lf}'`,
    ),
  ];
  const l4 = await decidir(cloneAntes, [V13, V14], SO_12);
  assert.equal(l4.prova.estado, "NEGATIVA");
  assert.equal(l4.diag.estado, "NEGATIVA");
  assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
  assert.ok(!l4.decisao.versoes, "PARAR nao carrega versoes a aplicar");
  // L5: antes + ledger com 12 e 13: 17b POSITIVA mas o ledger registra parte -> PARAR (contradicao)
  const l5 = await decidir(cloneAntes, [V14]);
  assert.equal(l5.prova.estado, "NEGATIVA");
  assert.equal(l5.diag.estado, "POSITIVA");
  assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
  assert.match(l5.decisao.motivo, /contradição/);
  // L6: antes + ledger completo (rollback feito sem apagar o ledger) com a prova EXIGIDA (o lote e'
  // novo para o SHA que a loja serve): 17a NEGATIVA -> PARAR
  const l6 = await decidir(cloneAntes, []);
  assert.equal(l6.prova.estado, "NEGATIVA");
  assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
  // L6b (LIMITE 7, o ponto cego): o mesmo banco com o lote ja no SHA servido (`exigeProva: false`):
  // NADA, sem olhar a 17a negativa -- por isso o rollback nunca por psql direto (runbook, item 15)
  const l6b = await decidir(cloneAntes, [], [], false);
  assert.equal(l6b.prova.estado, "NEGATIVA");
  assert.equal(l6b.decisao.acao, "NADA", JSON.stringify(l6b.decisao));
  // L7: antes com EXECUTE a anon + ledger vazio: 17b NEGATIVA -> PARAR (antes de escrever)
  const ANON = [
    `GRANT EXECUTE ON FUNCTION ${F.painel.sig} TO anon`,
    guardaSql(
      "EXECUTE a anon",
      `has_function_privilege('anon', to_regprocedure('${F.painel.sig}'), 'EXECUTE')`,
    ),
  ];
  const l7 = await decidir(cloneAntes, [V12, V13, V14], ANON);
  assert.equal(l7.prova.estado, "NEGATIVA");
  assert.equal(l7.diag.estado, "NEGATIVA");
  assert.equal(l7.decisao.acao, "PARAR", JSON.stringify(l7.decisao));
  ok(
    "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): os vereditos do processo filho (17a 14 linhas, 17b 11, rol=ok; a 8e POSITIVA no antes e no depois); antes + ledger vazio -> APLICAR [20261212000000, 20261213000000, 20261214000000] (o decidirLote devolve o faltam que recebe; a ordem e' a do migrationsDaRelease); depois + ledger completo -> NADA; depois + ledger vazio -> PARAR (sem backfillLedger); so a 12 + ledger [12] -> PARAR; antes + ledger [12, 13] -> PARAR (contradicao); antes + ledger completo -> PARAR com a prova exigida e NADA sem ela (o ponto cego do LIMITE 7); antes com EXECUTE a anon -> PARAR; banco inexistente -> saida 1, sem veredito, SEM_EVIDENCIA",
  );
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`),
      ).catch(() => {});
    }
    for (const papel of Object.values(P)) {
      await usar("template1", (a) =>
        a.query(`DROP ROLE IF EXISTS ${papel}`),
      ).catch(() => {});
    }
  });
