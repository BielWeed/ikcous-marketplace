"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste ou do catálogo do
 * Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA das migrations 20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql
 * (public.get_admin_customers_paged) e 20261231000000_a_busca_do_crm_ignora_acento.sql
 * (public.crm_clientes) contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 * A busca de clientes que a lojista usa todo dia:
 *
 *   (1) tela Clientes / balcão / cupom exclusivo (get_admin_customers_paged): o cadastro grava
 *       "(34) 99999-1234" e a busca comparava texto com texto. Agora, com 4 ou mais dígitos no termo,
 *       compara SÓ DÍGITOS nos dois lados (WhatsApp do perfil e telefone da conta); com 12 ou 13
 *       dígitos começando por 55, o 55 sai. Provas: as 7 formas de digitar o mesmo número, o termo
 *       curto (3 dígitos) que NÃO vira busca por dígitos, o +55, o DDD 55 (11 dígitos, NÃO se corta),
 *       o termo de 12 dígitos que não começa por 55 (NÃO se corta), a cliente sem WhatsApp, a busca
 *       vazia/só espaços/só símbolos, e que NADA mais mudou (o JSON, a ordenação, a paginação e as
 *       estatísticas são iguais aos do corpo antigo).
 *   (2) aba Clientes do CRM (crm_clientes): "joao" acha "João" e "JOSÉ" acha "Jose", no nome e no
 *       e-mail, nos três grupos (compradora, pediu e não pagou, nunca comprou), junto com o filtro de
 *       segmento; o número (só dígitos) segue achando; o resto é igual ao do corpo antigo.
 *   (3) CONTROLE e MUTANTES: o corpo antigo (o rollback-manual aplicado numa transação desfeita) REPROVA
 *       a prova; cada guarda tirada do corpo novo deixa a prova correspondente vermelha.
 *   (4) a porta: usuário comum, admin rebaixado e visitante recusados; anon/PUBLIC sem EXECUTE; o
 *       formato do JSON é o mesmo; a ACL, os atributos e o dono ficam iguais; reaplicar 2x é o mesmo que
 *       1x; pré-voo com corpo divergente recusa sem escrever; o rollback devolve o md5 antigo e o
 *       segundo rollback recusa; uma troca interrompida no meio (erro depois do CREATE) não deixa
 *       nada; uma leitura concorrente nunca enxerga estado misto; nenhuma linha de cliente muda.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 * BUSCA_SO=comportamento roda só os itens (0), (1x) e (2x) — usado para ver o VERMELHO do corpo vivo
 * antes das migrations existirem no banco; BUSCA_TODAS=1 não para na primeira que falhar.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/busca-de-clientes-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const NOME_A =
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql";
const NOME_B = "20261231000000_a_busca_do_crm_ignora_acento.sql";
const SO_COMPORTAMENTO = process.env.BUSCA_SO === "comportamento";

const CLIENTES =
  "public.get_admin_customers_paged(text,text,text,integer,integer)";
const CRM = "public.crm_clientes(text,text,integer,integer)";

const U_ADMIN = "d1d10000-0000-4000-8000-000000000001";
const U_COMUM = "d1d10000-0000-4000-8000-000000000002";
const U_JOAO = "d1d10000-0000-4000-8000-000000000011";
const U_JOSE = "d1d10000-0000-4000-8000-000000000012";
const U_MARIA = "d1d10000-0000-4000-8000-000000000013";
const U_ANA = "d1d10000-0000-4000-8000-000000000014";
const U_PEDRO = "d1d10000-0000-4000-8000-000000000015";
const U_PAULA = "d1d10000-0000-4000-8000-000000000016";
const U_SEM_ZAP = "d1d10000-0000-4000-8000-000000000017";
const U_ANDRE = "d1d10000-0000-4000-8000-000000000018";

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

/** Tela Clientes / balcão / cupom: devolve os nomes achados, ordenados (e o JSON bruto em `.bruto`). */
async function clientes(c, termo, extra = {}) {
  await logar(c, U_ADMIN);
  const r = await c.query(
    "SELECT public.get_admin_customers_paged($1, $2, $3, $4, $5) AS r",
    [
      termo,
      extra.campo || "full_name",
      extra.direcao || "asc",
      extra.pagina || 0,
      extra.tamanho || 50,
    ],
  );
  const bruto = r.rows[0].r;
  const nomes = bruto.data.map((l) => l.full_name).sort();
  nomes.bruto = bruto;
  return nomes;
}

/** Aba Clientes do CRM: os nomes achados, ordenados (e o JSON bruto em `.bruto`). */
async function crm(c, busca, segmento = null, limite = 200, offset = 0) {
  await logar(c, U_ADMIN);
  const r = await c.query("SELECT public.crm_clientes($1, $2, $3, $4) AS r", [
    segmento,
    busca,
    limite,
    offset,
  ]);
  const bruto = r.rows[0].r;
  const nomes = bruto.clientes.map((l) => l.nome).sort();
  nomes.bruto = bruto;
  return nomes;
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, prosecdef,
            coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

/** Os caminhos de chave de um JSON (formato), sem os valores. */
function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

const PROVAS = [];
const fx = {};

// ---- as provas do comportamento, reexecutáveis sobre os dados já montados (corpo novo, antigo e mutantes)
const FORMAS_DO_NUMERO_DO_JOAO = [
  "34999991234",
  "34 99999-1234",
  "(34) 99999-1234",
  "999991234",
  "99999-1234",
  "+55 34 99999-1234",
  "5534999991234",
];
const prova1a = async (c) => {
  for (const termo of FORMAS_DO_NUMERO_DO_JOAO)
    assert.deepEqual(
      [...(await clientes(c, termo))],
      ["João Silva"],
      `a busca "${termo}" tem de achar so a Joao`,
    );
};
const prova1b = async (c) => {
  // 3 digitos: NAO vira busca por digitos ("991" so existe nos DIGITOS de "(34) 99999-1234" e de
  // "(34) 9999-1234" -- a mascara parte o "99|1" --, nunca no texto)...
  assert.deepEqual([...(await clientes(c, "991"))], []);
  // ... mas segue sendo busca de TEXTO ("123" esta no texto de "1234" de duas clientes; "(34)" com a
  // mascara, nas tres que moram no DDD 34).
  assert.deepEqual(
    [...(await clientes(c, "123"))],
    ["João Silva", "Paula Fixa"],
  );
  assert.deepEqual(
    [...(await clientes(c, "(34)"))],
    ["João Silva", "Paula Fixa", "Pedro Fixo"],
  );
  // 4 digitos ja e' busca por digitos: "9912" so existe nos DIGITOS (a mascara parte o "99|12"), e e'
  // achado; "1234" (que o texto tambem tem) continua achado.
  assert.deepEqual(
    [...(await clientes(c, "9912"))],
    ["João Silva", "Paula Fixa"],
  );
  assert.deepEqual(
    [...(await clientes(c, "1234"))],
    ["João Silva", "Paula Fixa"],
  );
};
const prova1c = async (c) => {
  // O +55 colado do WhatsApp acha a conta cujo telefone foi gravado COM o 55 (auth.users.phone).
  assert.deepEqual(
    [...(await clientes(c, "+55 34 97777-6666"))],
    ["Maria Conceição"],
  );
  assert.deepEqual(
    [...(await clientes(c, "5534977776666"))],
    ["Maria Conceição"],
  );
  // 12 digitos com 55 (fixo de 8 digitos): o 55 sai.
  assert.deepEqual([...(await clientes(c, "55 34 9999-1234"))], ["Paula Fixa"]);
  // DDD 55 (Santa Maria): 11 digitos comecando por 55 NAO se corta -- ninguem tem 55999991234.
  assert.deepEqual([...(await clientes(c, "55999991234"))], []);
  // ... e a Ana (DDD 55, 11 digitos) e' achada pelos 11 digitos e pelo +55 dela (13 digitos).
  assert.deepEqual([...(await clientes(c, "55987654321"))], ["Ana Santa"]);
  assert.deepEqual(
    [...(await clientes(c, "+55 55 98765-4321"))],
    ["Ana Santa"],
  );
  // 12 digitos que NAO comecam por 55 NAO se cortam: "123456789012" nao e' o fixo "(34) 5678-9012".
  assert.deepEqual([...(await clientes(c, "123456789012"))], []);
  // o fixo dela, digitado certo, e' achado
  assert.deepEqual([...(await clientes(c, "3456789012"))], ["Pedro Fixo"]);
};
const prova1d = async (c) => {
  // ACEITO (a mesma regra da busca de pedidos): letras E 4 digitos tambem comparam os digitos -- o
  // conjunto e' MAIOR, nunca menor: a Joao (nome + 1234) e a Paula (so o 1234 do telefone).
  assert.deepEqual(
    [...(await clientes(c, "joao 1234"))],
    ["João Silva", "Paula Fixa"],
  );
};
const prova1f = async (c) => {
  // vazio, so espacos: todo mundo (as 8 clientes + admin + comum = 10 perfis)
  assert.equal((await clientes(c, "")).bruto.total_count, 10);
  assert.equal((await clientes(c, "   ")).bruto.total_count, 10);
  // so simbolos: digitos = '' (< 4) -> so texto; ninguem tem "()-" colado; nenhum erro
  assert.deepEqual([...(await clientes(c, "()-"))], []);
  // a cliente SEM WhatsApp nao quebra a busca por digitos e nao e' achada por ela
  assert.deepEqual([...(await clientes(c, "34999991234"))], ["João Silva"]);
  assert.ok((await clientes(c, "")).includes("Sem Zap"));
};
const prova2a = async (c) => {
  assert.deepEqual(
    [...(await crm(c, "joao"))],
    ["João Silva"],
    "joao acha João",
  );
  assert.deepEqual([...(await crm(c, "JOAO"))], ["João Silva"]);
  assert.deepEqual([...(await crm(c, "João"))], ["João Silva"]);
  assert.deepEqual(
    [...(await crm(c, "JOSÉ"))],
    ["Jose Almeida"],
    "JOSÉ acha Jose",
  );
  assert.deepEqual([...(await crm(c, "conceicao"))], ["Maria Conceição"]);
  // o e-mail: o nome nao tem "andre.coelho"; so o e-mail acentuado tem
  assert.deepEqual([...(await crm(c, "andre.coelho"))], ["Sem Nome Aqui"]);
  // quem comprou (nome vem do pedido, nao do perfil)
  assert.deepEqual([...(await crm(c, "claudia"))], ["Cláudia Compradora"]);
};
const prova2b = async (c) => {
  // o filtro de segmento continua mandando: a Cláudia e' compradora (nao e' "nunca_comprou")
  assert.deepEqual([...(await crm(c, "claudia", "nunca_comprou"))], []);
  assert.deepEqual(
    [...(await crm(c, "joao", "nunca_comprou"))],
    ["João Silva"],
  );
  assert.deepEqual([...(await crm(c, "joao", "campeoes"))], []);
  // busca so de espacos = sem filtro; NULL = sem filtro; termo que ninguem tem = 0
  assert.equal(
    (await crm(c, "   ")).bruto.total,
    (await crm(c, null)).bruto.total,
  );
  assert.equal((await crm(c, "zzzqq")).bruto.total, 0);
};
const prova2c = async (c) => {
  // o numero (so digitos) segue achando, e o termo curto segue sendo so texto
  assert.deepEqual([...(await crm(c, "34999991234"))], ["João Silva"]);
  assert.deepEqual([...(await crm(c, "999991234"))], ["João Silva"]);
  assert.deepEqual([...(await crm(c, "349"))], []);
};

PROVAS.push({
  nome: "(0) fixtures: admin atual, cliente comum e 8 clientes (WhatsApp mascarado, com 55, fixo, DDD 55, sem WhatsApp, e-mail acentuado, uma compradora)",
  corpo: async (c) => {
    const usuarios = [
      [U_ADMIN, "admin@busca.teste", null, '{"role":"admin"}'],
      [U_COMUM, "comum@busca.teste", null, "{}"],
      [U_JOAO, "silva.j@busca.teste", null, "{}"],
      [U_JOSE, "jose@busca.teste", null, "{}"],
      [U_MARIA, "maria@busca.teste", "5534977776666", "{}"],
      [U_ANA, "ana@busca.teste", null, "{}"],
      [U_PEDRO, "pedro@busca.teste", null, "{}"],
      [U_PAULA, "paula@busca.teste", null, "{}"],
      [U_SEM_ZAP, "semzap@busca.teste", null, "{}"],
      [U_ANDRE, "andré.coelho@busca.teste", null, "{}"],
    ];
    for (const [id, email, phone, meta] of usuarios)
      await c.query(
        "INSERT INTO auth.users (id, email, phone, raw_app_meta_data) VALUES ($1, $2, $3, $4::jsonb)",
        [id, email, phone, meta],
      );
    // 20261199000000 (admin ATUAL): o painel exige o papel admin AGORA em auth.users E em profiles.
    const perfis = [
      [U_ADMIN, "Admin Busca", "admin", null],
      [U_COMUM, "Cliente Comum", "customer", null],
      [U_JOAO, "João Silva", "customer", "(34) 99999-1234"],
      [U_JOSE, "Jose Almeida", "customer", "(11) 98888-7777"],
      [U_MARIA, "Maria Conceição", "customer", null],
      [U_ANA, "Ana Santa", "customer", "(55) 98765-4321"],
      [U_PEDRO, "Pedro Fixo", "customer", "(34) 5678-9012"],
      [U_PAULA, "Paula Fixa", "customer", "(34) 9999-1234"],
      [U_SEM_ZAP, "Sem Zap", "customer", null],
      [U_ANDRE, "Sem Nome Aqui", "customer", null],
    ];
    for (const [id, nome, papel, zap] of perfis)
      await c.query(
        "INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES ($1, $2, $3, $4)",
        [id, nome, papel, zap],
      );
    await c.query(
      `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
       VALUES ($1, 'Casa', 'Joao', '38400000', 'Rua A', '1', 'Centro', 'Uberlândia', 'MG', true)`,
      [U_JOAO],
    );
    // uma COMPRADORA do CRM (venda paga, sem conta): o nome vem do pedido
    await c.query(
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
          payment_status, paid_at, created_at)
       VALUES (NULL, 'Cláudia Compradora',
               '{"whatsapp":"(34) 98888-0000","email":"claudia@busca.teste"}'::jsonb,
               100, 100, 'delivered', 'online', 'online', 'pago', now(), now())`,
    );
  },
});

PROVAS.push({
  nome: "(1a) Clientes: a cliente gravada como '(34) 99999-1234' e achada pelas 7 formas de digitar o mesmo numero",
  corpo: prova1a,
});
PROVAS.push({
  nome: "(1b) Clientes: BORDA — 3 digitos NAO viram busca por digitos (so texto); 4 digitos viram",
  corpo: prova1b,
});
PROVAS.push({
  nome: "(1c) Clientes: o +55 sai com 12 ou 13 digitos que comecam por 55; DDD 55 (11 digitos) e 12 digitos fora do 55 NAO se cortam",
  corpo: prova1c,
});
PROVAS.push({
  nome: "(1d) Clientes: ACEITO — letras mais 4 digitos tambem comparam os digitos (a regra da busca de pedidos): o conjunto so cresce",
  corpo: prova1d,
});
PROVAS.push({
  nome: "(1f) Clientes: BORDA — vazio/so espacos devolve todos, so simbolos nao quebra, cliente sem WhatsApp nao e achada nem quebra a busca",
  corpo: prova1f,
});
PROVAS.push({
  nome: "(2a) CRM: 'joao' acha 'João', 'JOSÉ' acha 'Jose', no nome, no e-mail e na compradora",
  corpo: prova2a,
});
PROVAS.push({
  nome: "(2b) CRM: o filtro de segmento continua mandando; so espacos e NULL = sem filtro; termo sem ninguem = 0",
  corpo: prova2b,
});
PROVAS.push({
  nome: "(2c) CRM: o numero (so digitos) segue achando e o termo curto segue so texto",
  corpo: prova2c,
});

// ---- o resto nao mudou: o JSON de antes e o de depois sao IGUAIS nas buscas que o conserto nao toca
const CASOS_CLIENTES_IGUAIS = [
  ["", "full_name", "asc", 0, 50],
  ["", "created_at", "desc", 0, 3],
  ["", "full_name", "asc", 1, 3],
  ["maria", "full_name", "asc", 0, 50],
  ["uberl", "full_name", "asc", 0, 50],
  ["ÁLVARO", "full_name", "asc", 0, 50],
  ["zzzqq", "full_name", "asc", 0, 50],
  ["()-", "full_name", "asc", 0, 50],
  ["349", "email", "desc", 0, 50],
  [null, "full_name", "asc", 0, 50],
];
const CASOS_CRM_IGUAIS = [
  [null, "", 200, 0],
  [null, null, 3, 0],
  [null, null, 3, 3],
  ["nunca_comprou", "silva", 200, 0],
  [null, "maria", 200, 0],
  [null, "34999991234", 200, 0],
  [null, "999991234", 200, 0],
  [null, "zzzqq", 200, 0],
  ["campeoes", "claudia", 200, 0],
];
async function fotoDosCasos(c) {
  await logar(c, U_ADMIN);
  const fotos = [];
  for (const caso of CASOS_CLIENTES_IGUAIS)
    fotos.push(
      (
        await c.query(
          "SELECT public.get_admin_customers_paged($1,$2,$3,$4,$5) AS r",
          caso,
        )
      ).rows[0].r,
    );
  for (const caso of CASOS_CRM_IGUAIS)
    fotos.push(
      (await c.query("SELECT public.crm_clientes($1,$2,$3,$4) AS r", caso))
        .rows[0].r,
    );
  return fotos;
}

PROVAS.push({
  nome: "(1e/2d) O RESTO NAO MUDOU: o JSON (dados, total, estatisticas, ordenacao, paginacao) e IGUAL ao do corpo antigo nas buscas que o conserto nao toca",
  corpo: async (c) => {
    await montarCorpos();
    const novo = await fotoDosCasos(c);
    const antigo = await numaTransacao(c, [fx.rbA, fx.rbB], () =>
      fotoDosCasos(c),
    );
    assert.equal(
      novo.length,
      CASOS_CLIENTES_IGUAIS.length + CASOS_CRM_IGUAIS.length,
    );
    for (let i = 0; i < novo.length; i += 1)
      assert.deepStrictEqual(
        novo[i],
        antigo[i],
        `o caso ${i} mudou entre o corpo antigo e o novo`,
      );
  },
});

async function montarCorpos() {
  if (fx.pronto) return;
  const ma = ler(NOME_A);
  const mb = ler(NOME_B);
  const pares = (sql, assinatura) => {
    const m = [
      ...sql.matchAll(
        /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
      ),
    ];
    assert.equal(
      m.length,
      1,
      `o preflight tem de citar UM par de hashes de ${assinatura}`,
    );
    assert.equal(m[0][1], assinatura, "o par de hashes e de outra funcao");
    return { vigente: m[0][2], desta: m[0][3] };
  };
  fx.migA = ma;
  fx.migB = mb;
  fx.rbA = ler(`rollback-manual-${NOME_A}`);
  fx.rbB = ler(`rollback-manual-${NOME_B}`);
  fx.hA = pares(ma, CLIENTES);
  fx.hB = pares(mb, CRM);
  // o statement CREATE OR REPLACE (para os mutantes)
  const stmt = (sql) => {
    const ini = sql.indexOf("CREATE OR REPLACE FUNCTION");
    const fim = sql.indexOf("\n$$;", ini) + "\n$$;".length;
    return sql.slice(ini, fim);
  };
  fx.stmtA = stmt(ma);
  fx.stmtB = stmt(mb);
  fx.pronto = true;
}

/** Roda `fn` com o `sql` aplicado numa transação que SEMPRE é desfeita. */
async function numaTransacao(c, sqls, fn) {
  await c.query("BEGIN");
  try {
    for (const sql of sqls) await c.query(sql);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

/** A prova `prova` PRECISA falhar com o corpo mutado: senão, o mutante sobreviveu. */
async function mataMutante(c, nome, sqls, prova) {
  let passou = false;
  try {
    await numaTransacao(c, sqls, prova);
    passou = true;
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log(`    mutante morto: ${nome}`);
      return;
    }
    throw e;
  }
  assert.ok(!passou, `MUTANTE SOBREVIVEU: ${nome}`);
}

function mutar(stmt, de, para) {
  const n = stmt.split(de).length - 1;
  assert.equal(
    n,
    1,
    `o trecho do mutante tem de aparecer 1x (achei ${n}): ${de.slice(0, 50)}`,
  );
  return stmt.replace(de, () => para);
}

const PROVAS_DE_CLIENTES = [prova1a, prova1b, prova1c, prova1f];
const PROVAS_DE_CRM = [prova2a, prova2b];

PROVAS.push({
  nome: "(3) CONTROLE: o corpo ANTIGO (rollback-manual numa transacao desfeita) REPROVA as provas do defeito; e o corpo vivo volta a ser o novo depois",
  corpo: async (c) => {
    await montarCorpos();
    // cada prova do defeito falha no corpo antigo (e pela razao certa: assercao, nao erro de SQL)
    await numaTransacao(c, [fx.rbA, fx.rbB], async () => {
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.vigente);
      assert.equal((await catalogo(c, CRM)).hash, fx.hB.vigente);
      for (const [nome, prova] of [
        ["1a (digitos)", prova1a],
        ["1c (+55)", prova1c],
        ["2a (acento)", prova2a],
      ])
        await assert.rejects(
          () => prova(c),
          (e) => e instanceof assert.AssertionError,
          `o corpo ANTIGO tinha de reprovar a prova ${nome}`,
        );
      // e o que o corpo antigo ja fazia continua verdadeiro nos dois (o conserto so soma)
      assert.deepEqual(
        [...(await clientes(c, "(34) 99999-1234"))],
        ["João Silva"],
      );
      assert.deepEqual([...(await clientes(c, "99999-1234"))], ["João Silva"]);
      assert.deepEqual([...(await crm(c, "34999991234"))], ["João Silva"]);
    });
    // fora da transacao o corpo e o novo, e as provas passam
    assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.desta);
    assert.equal((await catalogo(c, CRM)).hash, fx.hB.desta);
    for (const p of [...PROVAS_DE_CLIENTES, ...PROVAS_DE_CRM, prova1d, prova2c])
      await p(c);
  },
});

PROVAS.push({
  nome: "(3b) MUTANTES de Clientes: cada guarda tirada do corpo novo deixa a prova correspondente vermelha",
  corpo: async (c) => {
    await montarCorpos();
    const s = fx.stmtA;
    const m = (nome, de, para, prova) =>
      mataMutante(c, nome, [mutar(s, de, para)], () => prova(c));
    await m(
      "sem a clausula por digitos (volta o defeito)",
      "(length(v_search_digitos) >= 4 AND (",
      "(false AND (",
      prova1a,
    );
    await m(
      "limiar 3 em vez de 4 (um termo de 3 digitos vira busca por digitos)",
      "length(v_search_digitos) >= 4",
      "length(v_search_digitos) >= 3",
      prova1b,
    );
    await m(
      "limiar 5 em vez de 4 (os 4 digitos finais deixam de achar)",
      "length(v_search_digitos) >= 4",
      "length(v_search_digitos) >= 5",
      prova1b,
    );
    await m(
      "sem o corte do 55 (o +55 colado nao acha mais)",
      "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
      "IF false THEN",
      prova1a,
    );
    await m(
      "corte do 55 so com 13 digitos (o fixo de 12 digitos nao acha)",
      "length(v_search_digitos) IN (12, 13)",
      "length(v_search_digitos) IN (13)",
      prova1c,
    );
    await m(
      "corta os 2 primeiros digitos de QUALQUER termo longo (nao confere o 55)",
      "AND left(v_search_digitos, 2) = '55' THEN",
      "AND true THEN",
      prova1c,
    );
    await m(
      "corta tambem o DDD 55 de 11 digitos",
      "length(v_search_digitos) IN (12, 13)",
      "length(v_search_digitos) IN (11, 12, 13)",
      prova1c,
    );
    await m(
      "compara so o WhatsApp do perfil (sem o telefone da conta)",
      "regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'",
      "false",
      prova1c,
    );
    await m(
      "compara so o telefone da conta (sem o WhatsApp do perfil)",
      "regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%' OR",
      "false OR",
      prova1a,
    );
    await m(
      "troca em vez de somar: tira a busca de texto do WhatsApp",
      "unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR",
      "false OR",
      prova1b,
    );
  },
});

PROVAS.push({
  nome: "(3c) MUTANTES do CRM: acento so de um lado, so no nome, so no e-mail, sem o ramo do numero ou sem o filtro de segmento",
  corpo: async (c) => {
    await montarCorpos();
    const s = fx.stmtB;
    const m = (nome, de, para, prova) =>
      mataMutante(c, nome, [mutar(s, de, para)], () => prova(c));
    await m(
      "sem acento so no lado da coluna (o termo acentuado nao acha)",
      "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
      "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE '%' || v_busca || '%'",
      prova2a,
    );
    await m(
      "sem acento so no lado do termo (a coluna acentuada nao acha)",
      "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
      "OR COALESCE(nome_exibido, '') ILIKE public.f_unaccent('%' || v_busca || '%')",
      prova2a,
    );
    await m(
      "sem acento no nome (volta o defeito)",
      "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
      "OR COALESCE(nome_exibido, '') ILIKE '%' || v_busca || '%'",
      prova2a,
    );
    await m(
      "sem acento no e-mail",
      "OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
      "OR COALESCE(email, '') ILIKE '%' || v_busca || '%'",
      prova2a,
    );
    await m(
      "sem o ramo do numero (4+ digitos)",
      "OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND",
      "OR (false AND length(v_digitos) >= 4 AND",
      prova2c,
    );
    await m(
      "sem o filtro de segmento",
      "WHERE (p_segmento IS NULL OR segmento = p_segmento)",
      "WHERE (true)",
      prova2b,
    );
  },
});

PROVAS.push({
  nome: "(4a) a porta: comum, admin REBAIXADO e visitante recusados; anon/PUBLIC sem EXECUTE; authenticated e service_role com; o corpo vivo e o declarado",
  corpo: async (c) => {
    await montarCorpos();
    for (const [rotulo, sql, args] of [
      [
        "clientes",
        "SELECT public.get_admin_customers_paged($1,'full_name','asc',0,10)",
        ["joao"],
      ],
      ["crm", "SELECT public.crm_clientes(NULL,$1,10,0)", ["joao"]],
    ]) {
      // comum
      await logar(c, U_COMUM);
      await assert.rejects(
        c.query(sql, args),
        (e) => /Acesso negado/.test(e.message),
        `${rotulo}: comum`,
      );
      // visitante (sem sessao)
      await logar(c, "");
      await assert.rejects(
        c.query(sql, args),
        (e) => /Acesso negado/.test(e.message),
        `${rotulo}: visitante`,
      );
      // admin REBAIXADO: auth.users ainda diz admin, profiles ja diz customer (20261199000000)
      await c.query("BEGIN");
      try {
        await c.query(
          `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
          [U_COMUM],
        );
        await logar(c, U_COMUM);
        await assert.rejects(
          c.query(sql, args),
          (e) => /Acesso negado/.test(e.message),
          `${rotulo}: rebaixado`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    for (const assinatura of [CLIENTES, CRM]) {
      const a = await c.query(
        `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS srv,
                EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = $1::regprocedure AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS publico`,
        [assinatura],
      );
      assert.deepEqual(
        a.rows[0],
        { anon: false, auth: true, srv: true, publico: false },
        assinatura,
      );
    }
    assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.desta);
    assert.equal((await catalogo(c, CRM)).hash, fx.hB.desta);
  },
});

PROVAS.push({
  nome: "(4b) o FORMATO do JSON e o mesmo do corpo antigo; ACL, atributos e dono iguais; nenhuma linha de cliente muda",
  corpo: async (c) => {
    await montarCorpos();
    // o formato do corpo ANTIGO (medido numa transacao desfeita) e o do NOVO
    const antigo = await numaTransacao(c, [fx.rbA, fx.rbB], async () => ({
      clientes: formato((await clientes(c, "")).bruto),
      crm: formato((await crm(c, "")).bruto),
    }));
    assert.ok(antigo.clientes.length > 10 && antigo.crm.length > 10);
    assert.deepEqual(formato((await clientes(c, "")).bruto), antigo.clientes);
    assert.deepEqual(formato((await crm(c, "")).bruto), antigo.crm);
    const contar = async () =>
      (
        await c.query(
          `SELECT (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM public.profiles p) AS perfis,
                  (SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) FROM public.marketplace_orders o) AS pedidos,
                  (SELECT md5(string_agg(u.id::text || coalesce(u.phone, ''), '|' ORDER BY u.id)) FROM auth.users u) AS contas`,
        )
      ).rows[0];
    const antes = await contar();
    const novoA = await catalogo(c, CLIENTES);
    const novoB = await catalogo(c, CRM);
    // roda as buscas (so leitura) e aplica/desfaz: as linhas continuam as mesmas
    await clientes(c, "34999991234");
    await crm(c, "joao");
    assert.deepEqual(
      await contar(),
      antes,
      "uma busca escreveu dado de cliente",
    );
    await numaTransacao(c, [fx.rbA, fx.rbB], async () => {
      const a = await catalogo(c, CLIENTES);
      const b = await catalogo(c, CRM);
      for (const [antigo, novo] of [
        [a, novoA],
        [b, novoB],
      ]) {
        assert.equal(antigo.prosecdef, novo.prosecdef);
        assert.equal(antigo.proconfig, novo.proconfig);
        assert.equal(antigo.proacl, novo.proacl);
        assert.equal(antigo.volatil, novo.volatil);
        assert.equal(antigo.dono, novo.dono);
      }
    });
    assert.deepEqual(
      await contar(),
      antes,
      "aplicar/desfazer tocou dado de cliente",
    );
  },
});

PROVAS.push({
  nome: "(4c) reaplicar as migrations 2x deixa a impressao digital igual; aplicar, desfazer e aplicar de novo volta identico",
  corpo: async (c) => {
    await montarCorpos();
    const foto = async () => ({
      a: await catalogo(c, CLIENTES),
      b: await catalogo(c, CRM),
    });
    const base = await foto();
    await numaTransacao(c, [fx.migA, fx.migB, fx.migA, fx.migB], async () => {
      assert.deepEqual(await foto(), base, "reaplicar mudou o estado");
    });
    await numaTransacao(c, [fx.rbA, fx.rbB], async () => {
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.vigente);
      assert.equal((await catalogo(c, CRM)).hash, fx.hB.vigente);
      // rollback 2x: o segundo e o mesmo estado (o preflight aceita o vigente)
      await c.query(fx.rbA);
      await c.query(fx.rbB);
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.vigente);
      await c.query(fx.migA);
      await c.query(fx.migB);
      assert.deepEqual(
        await foto(),
        base,
        "aplicar-desfazer-aplicar mudou o estado",
      );
    });
    assert.deepEqual(await foto(), base);
  },
});

PROVAS.push({
  nome: "(4d) preflight: corpo divergente / ACL aberta / atributo trocado recusam (B1_BASELINE_DIVERGENT) SEM escrever; erro no meio da troca nao deixa nada; coluna ou funcao ausente recusa",
  corpo: async (c) => {
    await montarCorpos();
    // 1. corpo vivo divergente (um comentario a mais): a migration recusa e nada muda; o rollback tambem
    for (const [assinatura, mig, rb, hashDesta, rx] of [
      [
        CLIENTES,
        fx.migA,
        fx.rbA,
        fx.hA.desta,
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_customers_paged/,
      ],
      [
        CRM,
        fx.migB,
        fx.rbB,
        fx.hB.desta,
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.crm_clientes/,
      ],
    ]) {
      await c.query("BEGIN");
      try {
        const def = (
          await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
            assinatura,
          ])
        ).rows[0].d;
        const divergente = def.replace("DECLARE", "DECLARE\n  -- divergente");
        assert.notEqual(divergente, def);
        await c.query(divergente);
        const hashDivergente = (await catalogo(c, assinatura)).hash;
        assert.notEqual(hashDivergente, hashDesta);
        await c.query("SAVEPOINT a");
        await assert.rejects(c.query(mig), rx);
        await c.query("ROLLBACK TO SAVEPOINT a");
        assert.equal(
          (await catalogo(c, assinatura)).hash,
          hashDivergente,
          "a recusa escreveu",
        );
        await assert.rejects(c.query(rb), rx);
        await c.query("ROLLBACK TO SAVEPOINT a");
        assert.equal(
          (await catalogo(c, assinatura)).hash,
          hashDivergente,
          "o rollback recusado escreveu",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // 2. ACL aberta para PUBLIC / authenticated sem EXECUTE / anon com EXECUTE: recusa antes de escrever
    for (const [assinatura, mig, rb, rotulo, ajuste] of [
      [
        CLIENTES,
        fx.migA,
        fx.rbA,
        "clientes+PUBLIC",
        `GRANT EXECUTE ON FUNCTION ${CLIENTES} TO PUBLIC`,
      ],
      [
        CRM,
        fx.migB,
        fx.rbB,
        "crm+PUBLIC",
        `GRANT EXECUTE ON FUNCTION ${CRM} TO PUBLIC`,
      ],
      [
        CLIENTES,
        fx.migA,
        fx.rbA,
        "clientes+anon",
        `GRANT EXECUTE ON FUNCTION ${CLIENTES} TO anon`,
      ],
      [
        CRM,
        fx.migB,
        fx.rbB,
        "crm-authenticated",
        `REVOKE EXECUTE ON FUNCTION ${CRM} FROM authenticated`,
      ],
    ]) {
      await c.query("BEGIN");
      try {
        await c.query(ajuste);
        const antes = (await catalogo(c, assinatura)).hash;
        await c.query("SAVEPOINT b");
        await assert.rejects(
          c.query(mig),
          /B1_BASELINE_DIVERGENT: ACL de/,
          `${rotulo}: migration`,
        );
        await c.query("ROLLBACK TO SAVEPOINT b");
        await assert.rejects(
          c.query(rb),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: rollback`,
        );
        await c.query("ROLLBACK TO SAVEPOINT b");
        assert.equal(
          (await catalogo(c, assinatura)).hash,
          antes,
          `${rotulo}: escreveu`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // 3. atributo trocado (SECURITY INVOKER): recusa
    await c.query("BEGIN");
    try {
      await c.query(`ALTER FUNCTION ${CRM} SECURITY INVOKER`);
      await assert.rejects(
        c.query(fx.migB),
        /B1_BASELINE_DIVERGENT: atributos de public\.crm_clientes/,
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // 4. coluna que o corpo novo le AUSENTE (profiles.whatsapp) e funcao ausente (f_unaccent): recusam
    await c.query("BEGIN");
    try {
      await c.query(
        "ALTER TABLE public.profiles RENAME COLUMN whatsapp TO whatsapp_x",
      );
      await assert.rejects(
        c.query(fx.migA),
        /B1_BASELINE_DIVERGENT: colunas que o corpo novo lê não existem: public\.profiles\.whatsapp/,
      );
    } finally {
      await c.query("ROLLBACK");
    }
    await c.query("BEGIN");
    try {
      await c.query(
        "ALTER FUNCTION public.f_unaccent(text) RENAME TO f_unaccent_x",
      );
      await assert.rejects(
        c.query(fx.migB),
        /B1_BASELINE_DIVERGENT: funções que o corpo novo chama não existem: public\.f_unaccent/,
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // 5. erro NO MEIO da troca (depois do CREATE OR REPLACE, antes do fim): a transacao inteira cai e o corpo volta
    for (const [assinatura, mig, rb, hashDesta, hashVigente] of [
      [CLIENTES, fx.migA, fx.rbA, fx.hA.desta, fx.hA.vigente],
      [CRM, fx.migB, fx.rbB, fx.hB.desta, fx.hB.vigente],
    ]) {
      await c.query("BEGIN");
      try {
        await c.query(rb); // estado de antes
        assert.equal((await catalogo(c, assinatura)).hash, hashVigente);
        await c.query("SAVEPOINT meio");
        await assert.rejects(
          c.query(
            `${mig}\nDO $$ BEGIN RAISE EXCEPTION 'falha no meio da troca'; END $$;`,
          ),
          /falha no meio da troca/,
        );
        await c.query("ROLLBACK TO SAVEPOINT meio");
        assert.equal(
          (await catalogo(c, assinatura)).hash,
          hashVigente,
          "a troca interrompida deixou o corpo novo",
        );
      } finally {
        await c.query("ROLLBACK");
      }
      assert.equal((await catalogo(c, assinatura)).hash, hashDesta);
    }
  },
});

PROVAS.push({
  nome: "(4e) CONCORRENCIA: enquanto outra sessao desfaz a troca numa transacao ABERTA, a leitura enxerga o corpo NOVO inteiro (nunca estado misto); depois do COMMIT ela enxerga o antigo inteiro",
  corpo: async (c) => {
    await montarCorpos();
    const url = lerDatabaseUrlEfemera();
    const outra = new Client({ connectionString: url });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(fx.rbA);
      await outra.query(fx.rbB);
      // sessao `outra` ainda NAO commitou: aqui o corpo e o NOVO inteiro
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.desta);
      assert.equal((await catalogo(c, CRM)).hash, fx.hB.desta);
      assert.deepEqual([...(await clientes(c, "34999991234"))], ["João Silva"]);
      assert.deepEqual([...(await crm(c, "joao"))], ["João Silva"]);
      await outra.query("ROLLBACK");
      await outra.query("BEGIN");
      await outra.query(fx.rbA);
      await outra.query(fx.rbB);
      await outra.query("COMMIT");
      // depois do commit: o ANTIGO inteiro nas duas
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.vigente);
      assert.equal((await catalogo(c, CRM)).hash, fx.hB.vigente);
      assert.deepEqual([...(await clientes(c, "34999991234"))], []);
      assert.deepEqual([...(await crm(c, "joao"))], []);
      // e a migration volta (a ordem do deploy: aplicar de novo)
      await outra.query("BEGIN");
      await outra.query(fx.migA);
      await outra.query(fx.migB);
      await outra.query("COMMIT");
      assert.equal((await catalogo(c, CLIENTES)).hash, fx.hA.desta);
      assert.equal((await catalogo(c, CRM)).hash, fx.hB.desta);
    } finally {
      await outra.query("ROLLBACK").catch(() => {});
      await outra.end().catch(() => {});
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  let falhas = 0;
  const provas = SO_COMPORTAMENTO
    ? PROVAS.filter((p) => /^\((0|1[a-f]|2[abc])\)/.test(p.nome))
    : PROVAS;
  try {
    for (const { nome, corpo } of provas) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        if (process.env.BUSCA_TODAS === "1") {
          falhas += 1;
          continue;
        }
        anexarAoSummary(
          "Prova viva da busca de clientes (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "A busca de clientes deixou de achar pelo número ou sem acento — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  if (falhas > 0)
    falhar("FALHOU", `${falhas} prova(s) falharam (BUSCA_TODAS=1).`);
  console.log(
    `\n[busca-de-clientes] ${provas.length}/${provas.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva da busca de clientes (rpc-ci)",
    `${linhas.join("\n")}\n\n**${provas.length}/${provas.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
