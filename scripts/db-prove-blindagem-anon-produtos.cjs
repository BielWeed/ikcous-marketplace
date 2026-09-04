#!/usr/bin/env node
/**
 * PROVA da blindagem de escrita em `produtos` e nas views de produto
 * (BANCO-090, issue #141 — frente blindagem-banco-0409).
 *
 * NADA É GRAVADO: o conteúdo da migration 20261090000000 é LIDO DO DISCO e
 * executado DENTRO de uma transação desfeita com ROLLBACK no final. A prova
 * não redigitita nada do .sql — o arquivo é a única fonte (lição da revisão
 * 2ª rodada: cópia em JS fica verde quando o .sql muda).
 *
 * MODOS:
 *   padrão    — ANTES de a central aplicar: exige o estado pré-migration e
 *               simula o DEPOIS na transação;
 *   --depois  — DEPOIS de aplicada: exige o estado JÁ blindado (senão exit 2
 *               INCONCLUSIVO — verde sem estado é vácuo) e prova o vivo.
 *
 * O QUE ELE PROVA:
 *   PRÉ-CONDIÇÕES: o estado vivo é o esperado do momento (exit 2 aborta sem
 *   simular nada). Inclui PG>=17 (MAINTAIN precisa existir).
 *   AFIRMATIVAS DE CATÁLOGO (na tx, após os REVOKEs do arquivo):
 *     A1 tabela: anon sem INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/MAINTAIN;
 *     A2 tabela: authenticated sem TRUNCATE/TRIGGER/MAINTAIN, COM
 *         INSERT/UPDATE/DELETE (escrita legítima do painel via policy);
 *     A2b vw_produtos_admin: anon sem escrita nenhuma; authenticated sem
 *         TRUNCATE/TRIGGER/MAINTAIN e COM INSERT/UPDATE/DELETE (cadastro);
 *     A2c vw_produtos_public: anon e authenticated sem TRUNCATE/TRIGGER/
 *         MAINTAIN (resíduo da leva de 20/08);
 *     A3 controles: PUBLIC sem INSERT/MAINTAIN na tabela; vizinho intocado
 *         (anon mantém REFERENCES); sobreviventes (service_role mantém tudo;
 *         postgres dono intocado); anon sem SELECT na tabela (como hoje).
 *   TRAVA DE ESTADO (o DO $$ do próprio arquivo, extraído do disco):
 *     A4 passa no estado blindado E EXPLODE na inversão de cada um dos 3
 *     disjuntos-chave (INSERT→anon; INSERT→PUBLIC; MAINTAIN→anon), cada
 *     reconcessão num savepoint separado.
 *   SONDAS DE COMPORTAMENTO (SET LOCAL ROLE, na tx):
 *     S1 vitrine: anon continua LENDO vw_produtos_public;
 *     S2 blindagem: anon INSERT na tabela morre em "permission denied"
 *         (camada do privilégio) — antes morria em RLS (troca de camada);
 *     S3 painel: authenticated INSERT na tabela morre na POLICY (RLS),
 *         nunca em permission denied;
 *     S4 cadastro real SEM admin: authenticated INSERT na vw_produtos_admin
 *         morre no CHECK OPTION da view — mensagem PRENDIDA a
 *         'check option for view "vw_produtos_admin"', nunca permission
 *         denied (se a view sumir do banco, "relation does not exist" NÃO
 *         conta como passou);
 *     S5 CADASTRO REAL COM ADMIN (controle positivo): um admin de verdade
 *         (profiles.role='admin', claims JWT com o sub dele) CONSEGUE
 *         cadastrar produto pela view — e a linha é desfeita no savepoint.
 *         Sem esta, a suíte ficaria verde num banco onde nenhum admin
 *         cadastra (lição da revisão 2ª rodada).
 *   ENCERRAMENTO: ROLLBACK devolve o ACL ao estado de entrada, objeto a
 *   objeto (tabela + 2 views), papel a papel.
 *
 * USO:
 *   node scripts/db-prove-blindagem-anon-produtos.cjs            # ANTES
 *   node scripts/db-prove-blindagem-anon-produtos.cjs --depois   # DEPOIS
 *
 * Exit 0 = tudo OK. Exit 1 = afirmativa caiu. Exit 2 = INCONCLUSIVO (estado
 * inesperado — nada foi simulado).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são as chaves internas do próprio varredor (papel x
 * privilégio, listas fixas declaradas neste arquivo). Nunca há payload de
 * terceiro. */

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODO_DEPOIS = process.argv.includes("--depois");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase/migrations/20261090000000_anon_nao_nasce_com_poder_de_escrever_em_produtos.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

/** Lê a migration do disco e devolve { corpo, trava } — o arquivo é a fonte.
 * A cauda DEPOIS do último DO $$ tem que ser EXATAMENTE o bloco da trava
 * (laudo 3ª rodada, P3): se alguém apendar SQL extra no fim do arquivo, ele
 * executaria sem ser medido pela fotografia — então a forma da cauda é
 * afirmada antes de qualquer execução. */
function lerMigration() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo versionado no repo
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const i = sql.lastIndexOf("DO $$");
  if (i < 0) throw new Error("trava DO $$ não encontrada na migration — arquivo mudou?");
  const trava = sql.slice(i);
  if (!/^DO \$\$[\s\S]*END\s*\$\$;\s*$/.test(trava)) {
    throw new Error(
      "a cauda da migration (do último DO $$ ao fim) não é só o bloco da trava — há SQL extra que a prova não sabe medir. Corrija o arquivo ou a prova.",
    );
  }
  return { corpo: sql.slice(0, i), trava };
}

const PRIVILEGIOS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "TRIGGER",
  "REFERENCES",
  "MAINTAIN",
];

const ESCRITA_ANON = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "MAINTAIN"];
const RESIDUO_AUTH = ["TRUNCATE", "TRIGGER", "MAINTAIN"];
const OBJETOS = ["produtos", "vw_produtos_admin", "vw_produtos_public"];

const titulo = (t) => console.log(`\n=== ${t} ===`);

let falhas = 0;
function afirmar(rotulo, cond, detalhe) {
  const marca = cond ? "OK  " : "FALHOU";
  if (!cond) falhas += 1;
  console.log(`  [${marca}] ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function fotografar(client) {
  const foto = {}; // foto[objeto][papel][priv] = bool
  for (const objeto of OBJETOS) {
    foto[objeto] = {};
    for (const papel of ["anon", "authenticated", "service_role"]) {
      foto[objeto][papel] = {};
      for (const priv of PRIVILEGIOS) {
        const r = await client.query(
          "SELECT has_table_privilege($1,'public.'||$2,$3) AS tem",
          [papel, objeto, priv],
        );
        foto[objeto][papel][priv] = r.rows[0].tem;
      }
    }
  }
  return foto;
}

function imprimirFoto(rotulo, foto) {
  for (const objeto of OBJETOS) {
    for (const papel of ["anon", "authenticated"]) {
      const vivos = Object.entries(foto[objeto][papel])
        .filter(([, tem]) => tem)
        .map(([p]) => p);
      console.log(
        `  ${rotulo} ${objeto.padEnd(20)} ${papel.padEnd(15)} ${vivos.join(", ") || "(nenhum)"}`,
      );
    }
  }
}

function fotosIguais(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Sonda de comportamento: roda `sql` como `papel` (claims opcionais) num
 * envelope desfeito em seguida. Fora de transação: BEGIN/ROLLBACK próprio;
 * dentro da tx da simulação: SAVEPOINT/ROLLBACK TO.
 */
async function sondar(client, papel, sql, claims = "", emTx = false) {
  try {
    if (!emTx) await client.query("BEGIN");
    else await client.query("SAVEPOINT sonda");
    try {
      await client.query(`SET LOCAL ROLE ${papel}`);
      await client.query(
        "SELECT set_config('request.jwt.claims', $1, true)",
        [claims],
      );
      const r = await client.query(sql);
      // rows[0].linhas = valor do count(*) (SELECT devolve 1 linha com o
      // total — rowCount seria sempre 1); rowCount vale para INSERT/UPDATE.
      const linhas =
        r.rows?.[0] && "linhas" in r.rows[0] ? r.rows[0].linhas : (r.rowCount ?? null);
      return { ok: true, linhas };
    } finally {
      if (!emTx) await client.query("ROLLBACK");
      else await client.query("ROLLBACK TO SAVEPOINT sonda");
      await client.query("RESET ROLE").catch(() => {});
    }
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  // Avisos do Postgres (WARNING) são defeito de instrumento seando em silêncio:
  // foi um WARNING de "BEGIN inside transaction" que denunciou o ROLLBACK
  // seco de uma sonda (laudo 3ª rodada, P1). Nada mais morre mudo.
  client.on("notice", (m) => console.log(`  [AVISO PG] ${m.message}`));
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    MODO_DEPOIS
      ? "Modo --depois: exigindo o estado VIVO pós-migration (senão INCONCLUSIVO); os REVOKEs do arquivo viram no-op na tx."
      : "Modo padrão: exigindo estado pré-migration; o ARQUIVO da migration roda na tx e é desfeito com ROLLBACK.",
  );

  // ---------- AMBIENTE -------------------------------------------------------
  const versao = await client.query(
    "SELECT current_setting('server_version_num')::int AS v",
  );
  const ehPG17 = versao.rows[0].v >= 170000;
  console.log(`\nPostgres: ${versao.rows[0].v}`);
  if (!ehPG17) {
    console.log(
      "\nINCONCLUSIVO: Postgres < 17 — a sintaxe MAINTAIN desta migration não existe aqui; banco errado ou ambiente divergente.",
    );
    client
      .end()
      .finally(() => process.exit(2));
    return;
  }
  console.log("  [OK  ] ambiente: PG>=17 (MAINTAIN existe nesta sintaxe)");

  // ---------- PRÉ-CONDIÇÕES --------------------------------------------------
  titulo("0. Pré-condições e fotografia ANTES");
  const antes = await fotografar(client);
  imprimirFoto("ANTES", antes);

  const publicInsert = await client.query(
    "SELECT has_table_privilege('public','public.produtos','INSERT') AS tem",
  );
  const publicMaintain = await client.query(
    "SELECT has_table_privilege('public','public.produtos','MAINTAIN') AS tem",
  );
  const colunasAnon = await client.query(`
    SELECT count(*)::int AS n
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n2 ON n2.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) g(grantor, grantee, privilege_type, is_grantable)
    WHERE n2.nspname='public' AND c.relname='produtos'
      AND g.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname='anon'));
  `);

  function abortar(motivo) {
    console.log(`\nINCONCLUSIVO: ${motivo}`);
    client
      .end()
      .finally(() => process.exit(2));
  }

  if (!MODO_DEPOIS) {
    const faltandoTabela = ESCRITA_ANON.filter((p) => !antes.produtos.anon[p]);
    const faltandoAdmin = ESCRITA_ANON.filter((p) => !antes.vw_produtos_admin.anon[p]);
    const faltandoAuth = RESIDUO_AUTH.filter((p) => !antes.produtos.authenticated[p]);
    if (faltandoTabela.length > 0 || faltandoAdmin.length > 0 || faltandoAuth.length > 0) {
      return abortar(
        `o estado não é o pré-migration esperado (tabela sem: ${faltandoTabela.join("/") || "—"}; view admin sem: ${faltandoAdmin.join("/") || "—"}; authenticated sem: ${faltandoAuth.join("/") || "—"}). Ou a migration já foi aplicada (rode com --depois), ou este banco divergiu do molde.`,
      );
    }
    if (publicInsert.rows[0].tem || publicMaintain.rows[0].tem) {
      return abortar("PUBLIC tem INSERT/MAINTAIN em produtos — REVOKE só de anon seria cosmético.");
    }
    if (colunasAnon.rows[0].n > 0) {
      return abortar("anon (ou PUBLIC) tem grant de COLUNA em produtos — o desenho presume que não há.");
    }
    console.log("  Pré-condições de pré-migration: OK");
  } else {
    // Modo --depois: exigir o estado JÁ blindado — o else que faltava na
    // versão anterior (laudo 2ª rodada, B2): sem isto o modo criava na tx o
    // estado que ia asseverar e ficava verde num banco intacto.
    const restouTabela = ESCRITA_ANON.filter((p) => antes.produtos.anon[p]);
    const restouAdmin = ESCRITA_ANON.filter((p) => antes.vw_produtos_admin.anon[p]);
    const restouPublica = ["TRUNCATE", "TRIGGER", "MAINTAIN"].filter(
      (p) => antes.vw_produtos_public.anon[p] || antes.vw_produtos_public.authenticated[p],
    );
    const restouAuth = RESIDUO_AUTH.filter((p) => antes.produtos.authenticated[p] || antes.vw_produtos_admin.authenticated[p]);
    if (
      restouTabela.length > 0 ||
      restouAdmin.length > 0 ||
      restouPublica.length > 0 ||
      restouAuth.length > 0
    ) {
      return abortar(
        `a migration parece NÃO aplicada (anon ainda tem: tabela=${restouTabela.join("/") || "—"} admin=${restouAdmin.join("/") || "—"}; pública=${restouPublica.join("/") || "—"}; authenticated=${restouAuth.join("/") || "—"}). Rode no modo padrão.`,
      );
    }
    console.log("  Pré-condições de pós-migration: OK (estado já blindado no vivo)");
  }

  // ---------- SONDAS DO ESTADO VIVO (antes da tx) -----------------------------
  const INSERT_TABELA =
    "INSERT INTO produtos (nome, preco_venda, estoque) VALUES ('__prova_blindagem__',1,0)";
  const INSERT_VIEW =
    "INSERT INTO vw_produtos_admin (nome, preco_venda, estoque) VALUES ('__prova_blindagem__',1,0)";

  const sondaAnonViva = await sondar(client, "anon", INSERT_TABELA);
  console.log(
    `  sonda do VIVO — anon INSERT na tabela: ${sondaAnonViva.ok ? "PASSOU (não deveria!)" : `recusado (${sondaAnonViva.erro})`}`,
  );
  if (!MODO_DEPOIS) {
    afirmar(
      "VIVO pré: anon INSERT segurado pelo RLS (row-level security) — a 2ª camada é a única fechadura hoje",
      !sondaAnonViva.ok && /row-level security/i.test(sondaAnonViva.erro),
    );
  } else {
    // Espelho do modo --depois: no estado vivo já aplicado, a recusa tem que
    // ser do PRIVILÉGIO — senão a migration não fez efeito no vivo.
    afirmar(
      "VIVO pós: anon INSERT já morre no PRIVILÉGIO (permission denied) — a migration está de fato aplicada",
      !sondaAnonViva.ok && /permission denied/i.test(sondaAnonViva.erro),
    );
  }

  // ---------- SIMULAÇÃO: a migration do disco roda na tx ----------------------
  titulo("1. A migration roda INTEIRA do disco (corpo + trava), dentro de transação");
  const { corpo, trava } = lerMigration();
  await client.query("BEGIN");
  // O arquivo inteiro: os REVOKEs E a trava DO $$ — se a trava explodir aqui,
  // o script morre no catch com exit 1 (é o comportamento dela no banco real).
  // A fotografia vem DEPOIS, senão o que a trava executa não é medido
  // (laudo 3ª rodada, P3).
  await client.query(corpo);
  await client.query(trava);

  const depois = await fotografar(client);
  afirmar(
    "A4: a trava DO \$\$ do arquivo PASSOU ao rodar o arquivo inteiro na tx (explodir = exit 1 no catch)",
    !fotosIguais(depois, antes), // e o estado MUDOU mesmo (não é vermelho-vácuo)
    "estado mudou em relação à entrada",
  );
  imprimirFoto("DEPOIS (na tx)", depois);

  titulo("2. Afirmativas de catálogo (critério #141 + views)");
  for (const priv of ESCRITA_ANON) {
    afirmar(
      `A1 tabela: anon perde ${priv}`,
      depois.produtos.anon[priv] === false,
    );
    afirmar(
      `A2b view admin: anon perde ${priv}`,
      depois.vw_produtos_admin.anon[priv] === false,
    );
  }
  for (const priv of RESIDUO_AUTH) {
    afirmar(
      `A2 tabela: authenticated perde ${priv}`,
      depois.produtos.authenticated[priv] === false,
    );
    afirmar(
      `A2b view admin: authenticated perde ${priv}`,
      depois.vw_produtos_admin.authenticated[priv] === false,
    );
  }
  for (const priv of ["TRUNCATE", "TRIGGER", "MAINTAIN"]) {
    afirmar(
      `A2c view pública: anon perde ${priv}`,
      depois.vw_produtos_public.anon[priv] === false,
    );
    afirmar(
      `A2c view pública: authenticated perde ${priv}`,
      depois.vw_produtos_public.authenticated[priv] === false,
    );
  }
  for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
    afirmar(
      `A2 tabela: authenticated MANTÉM ${priv} (escrita do painel via policy)`,
      depois.produtos.authenticated[priv] === true,
    );
    afirmar(
      `A2b view admin: authenticated MANTÉM ${priv} (cadastro real do app)`,
      depois.vw_produtos_admin.authenticated[priv] === true,
    );
  }
  console.log("  — controles —");
  afirmar(
    "A3: PUBLIC sem INSERT na tabela (REVOKE de anon não é cosmético)",
    publicInsert.rows[0].tem === false,
  );
  afirmar("A3: PUBLIC sem MAINTAIN na tabela", publicMaintain.rows[0].tem === false);
  afirmar(
    "A3: vizinho intocado — anon MANTÉM REFERENCES na tabela (fora do critério)",
    depois.produtos.anon.REFERENCES === antes.produtos.anon.REFERENCES &&
      depois.produtos.anon.REFERENCES === true,
  );
  afirmar(
    "A3: sobrevivente — service_role MANTÉM INSERT na tabela (backend não tranca)",
    depois.produtos.service_role.INSERT === true &&
      depois.produtos.service_role.INSERT === antes.produtos.service_role.INSERT,
  );
  afirmar(
    "A3: anon NÃO ganha SELECT na tabela (não tinha, não tem)",
    depois.produtos.anon.SELECT === false && antes.produtos.anon.SELECT === false,
  );
  afirmar(
    "A3: anon tem ZERO grants de coluna (nem anon nem PUBLIC) em produtos — não há volta por coluna",
    colunasAnon.rows[0].n === 0,
    `${colunasAnon.rows[0].n} grant(s)`,
  );

  // ---------- INVERSÕES da trava (mutação de verdade sobre a guarda) ----------
  titulo("3. Inversões da trava DO \$\$ — cada reconcessão TEM que explodi-la");
  async function inversaoDaTrava(rotulo, reconcessao) {
    await client.query("SAVEPOINT inversao");
    await client.query(reconcessao);
    let explodiu = false;
    let msg = "";
    try {
      await client.query(trava);
    } catch (e) {
      explodiu = true;
      msg = e.message;
    }
    await client.query("ROLLBACK TO SAVEPOINT inversao");
    afirmar(`A4 inversão: trava EXPLODE com ${rotulo}`, explodiu, msg);
  }
  // Grupo tabela × anon:
  await inversaoDaTrava(
    "INSERT de volta a anon (tabela)",
    "GRANT INSERT ON public.produtos TO anon",
  );
  await inversaoDaTrava(
    "UPDATE de volta a anon (tabela)",
    "GRANT UPDATE ON public.produtos TO anon",
  );
  await inversaoDaTrava(
    "MAINTAIN de volta a anon (tabela)",
    "GRANT MAINTAIN ON public.produtos TO anon",
  );
  // Grupo PUBLIC (o fato de a trava acender aqui NÃO discrimina o disjunto
  // 'public' — qualquer papel soma o que PUBLIC recebe (sql-revoke); quem
  // fecha a pseudo-role é a doc (functions-info: "if the name is given as
  // public then the privileges of the PUBLIC pseudo-role are checked") mais
  // o fato de a trava ter rodado sem "role does not exist"):
  await inversaoDaTrava(
    "INSERT a PUBLIC (tabela)",
    "GRANT INSERT ON public.produtos TO PUBLIC",
  );
  // Grupo view admin × anon:
  await inversaoDaTrava(
    "INSERT de volta a anon (view admin — a porta esquecida)",
    "GRANT INSERT ON public.vw_produtos_admin TO anon",
  );
  // Grupo view pública × anon:
  await inversaoDaTrava(
    "TRUNCATE de volta a anon (view pública)",
    "GRANT TRUNCATE ON public.vw_produtos_public TO anon",
  );
  // Grupo authenticated (os três que perde):
  await inversaoDaTrava(
    "TRIGGER de volta a authenticated (tabela)",
    "GRANT TRIGGER ON public.produtos TO authenticated",
  );
  await inversaoDaTrava(
    "MAINTAIN de volta a authenticated (view admin)",
    "GRANT MAINTAIN ON public.vw_produtos_admin TO authenticated",
  );

  // ---------- SONDAS DE COMPORTAMENTO ----------------------------------------
  titulo("4. Sondas de comportamento (SET LOCAL ROLE, dentro da tx)");
  const vitrineAnon = await sondar(
    client,
    "anon",
    "SELECT count(*)::int AS linhas FROM vw_produtos_public",
    "",
    true,
  );
  afirmar(
    "S1 VITRINE: anon continua lendo vw_produtos_public",
    vitrineAnon.ok,
    vitrineAnon.ok ? `${vitrineAnon.linhas} linha(s)` : vitrineAnon.erro,
  );

  const selectTabelaAnon = await sondar(
    client,
    "anon",
    "SELECT count(*)::int AS linhas FROM produtos",
    "",
    true,
  );
  afirmar(
    "S2: anon continua SEM SELECT na tabela (permissão negada, como hoje)",
    !selectTabelaAnon.ok && /permission denied/i.test(selectTabelaAnon.erro),
    selectTabelaAnon.erro,
  );

  const insertAnon = await sondar(client, "anon", INSERT_TABELA, "", true);
  afirmar(
    "S2 BLINDAGEM: anon INSERT morre no PRIVILÉGIO (permission denied), não mais no RLS",
    !insertAnon.ok && /permission denied/i.test(insertAnon.erro),
    insertAnon.erro,
  );

  const insertAnonView = await sondar(client, "anon", INSERT_VIEW, "", true);
  afirmar(
    "S2 BLINDAGEM: anon INSERT na VIEW admin também morre no privilégio",
    !insertAnonView.ok && /permission denied/i.test(insertAnonView.erro),
    insertAnonView.erro,
  );

  const insertAuth = await sondar(client, "authenticated", INSERT_TABELA, "", true);
  afirmar(
    "S3 PAINEL: authenticated INSERT na tabela mantém o privilégio — recusa é da POLICY (row-level security), nunca permission denied",
    !insertAuth.ok &&
      /row-level security/i.test(insertAuth.erro) &&
      !/permission denied/i.test(insertAuth.erro),
    insertAuth.erro,
  );

  // S4: mensagem PRENDIDA — comparar antes==depois sem valor esperado deixa
  // "relation does not exist" passar por verde (laudo 2ª rodada).
  const cadastroSemAdmin = await sondar(client, "authenticated", INSERT_VIEW, "", true);
  afirmar(
    'S4 CADASTRO sem admin: authenticated INSERT na view morre no CHECK OPTION (mensagem presa: check option for view "vw_produtos_admin"), nunca permission denied',
    !cadastroSemAdmin.ok &&
      /check option for view "vw_produtos_admin"/i.test(cadastroSemAdmin.erro) &&
      !/permission denied/i.test(cadastroSemAdmin.erro),
    cadastroSemAdmin.erro,
  );

  // S5: CONTROLE POSITIVO — admin de verdade cadastra pela view e a linha é
  // desfeita no savepoint. Sem admin, ABORTA como INCONCLUSIVO: verde sem o
  // único controle positivo é vácuo — e "clone recém-provisionado sem
  // lojista" é exatamente a população-alvo desta frente (laudo 3ª rodada, P2).
  const admin = await client.query(
    `SELECT p.id::text FROM profiles p WHERE p.role='admin' ORDER BY p.created_at LIMIT 1`,
  );
  if (admin.rows.length === 0) {
    await client.query("ROLLBACK");
    await client.end();
    console.log(
      "\nINCONCLUSIVO: nenhum profiles.role='admin' neste banco — o controle positivo (S5) não pode rodar, e verde sem ele é vácuo.",
    );
    process.exit(2);
  }
  const sub = admin.rows[0].id;
  const claims = JSON.stringify({ sub, role: "authenticated" });
  const cadastroAdmin = await sondar(client, "authenticated", INSERT_VIEW, claims, true);
  afirmar(
    `S5 CADASTRO COM ADMIN (sub=${sub.slice(0, 8)}…): INSERT na view FUNCIONA — produto cadastrado e desfeito no savepoint`,
    cadastroAdmin.ok === true,
    cadastroAdmin.ok
      ? `${cadastroAdmin.linhas} linha(s) inserida(s) e desfeita(s)`
      : cadastroAdmin.erro,
  );

  // S7: o que anon LÊ na view admin (T1 do laudo 3ª rodada — medição que
  // faltava: a view não é invoker e a única fechadura do SELECT de anon é o
  // WHERE is_admin() da própria definição). Exigido: 0 linhas ou barrado.
  const leituraAnonViewAdmin = await sondar(
    client,
    "anon",
    "SELECT count(*)::int AS linhas FROM vw_produtos_admin",
    "",
    true,
  );
  afirmar(
    "S7 LEITURA da view admin por anon: 0 linha(s) (o WHERE is_admin() filtra) ou barrado",
    !leituraAnonViewAdmin.ok ||
      (leituraAnonViewAdmin.ok && leituraAnonViewAdmin.linhas === 0),
    leituraAnonViewAdmin.ok
      ? `${leituraAnonViewAdmin.linhas} linha(s)`
      : leituraAnonViewAdmin.erro,
  );

  const vitrineAuth = await sondar(
    client,
    "authenticated",
    "SELECT count(*)::int AS linhas FROM vw_produtos_public",
    "",
    true,
  );
  afirmar(
    "S6: authenticated continua lendo vw_produtos_public",
    vitrineAuth.ok,
    vitrineAuth.ok ? `${vitrineAuth.linhas} linha(s)` : vitrineAuth.erro,
  );

  // ---------- EXERCÍCIO DO ROLLBACK (laudo 3ª rodada, P5) ----------------------
  // O arquivo de rollback também é texto que ninguém exercitava: dentro da
  // MESMA tx, executa-se o rollback do disco em cima do estado blindado e o
  // resultado tem que ser FOTOGRAFICAMENTE a entrada de novo.
  titulo("5. O ROLLBACK do disco roda na tx e restaura a entrada");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo versionado no repo
  const rollbackSql = fs.readFileSync(
    path.join(
      PROJECT_ROOT,
      "supabase/migrations/rollback-manual-20261090000000_anon_nao_nasce_com_poder_de_escrever_em_produtos.sql",
    ),
    "utf8",
  );
  await client.query(rollbackSql);
  const aposRollbackArquivo = await fotografar(client);
  afirmar(
    "P5: o ARQUIVO de rollback executado devolve o ACL à fotografia de entrada",
    fotosIguais(aposRollbackArquivo, antes),
  );
  // Re-aplica a migration (para o ROLLBACK final da tx desfazer um estado
  // consistente e a afirmativa final medir o que espera).
  await client.query(corpo);
  await client.query(trava);

  // ---------- ROLLBACK ---------------------------------------------------------
  titulo("6. ROLLBACK — nada saiu gravado");
  await client.query("ROLLBACK");
  const apos = await fotografar(client);
  afirmar(
    "ACL pós-ROLLBACK idêntico ao de entrada — tabela e 2 views, papel a papel (a prova não gravou nada)",
    fotosIguais(apos, antes),
  );

  await client.end();
  console.log(
    `\n${falhas === 0 ? "TODAS AS AFIRMATIVAS PASSARAM" : `${falhas} AFIRMATIVA(S) CAÍRAM`}`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  // Se a explosão aconteceu com a tx de simulação aberta, o Postgres descarta
  // a transação órfã com ROLLBACK quando a conexão cai — nada é gravado.
  console.error(e.message);
  process.exit(1);
});
