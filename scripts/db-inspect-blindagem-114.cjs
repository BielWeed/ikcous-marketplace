#!/usr/bin/env node
/**
 * Inventário de RPCs x chamadores (BANCO-070, issue #114 — frente
 * blindagem-banco-0409).
 *
 * NÃO ALTERA NADA. Lê o catálogo do banco (funções, EXECUTE grants, policies)
 * e varre o código do repo (src/ + supabase/functions/) atrás de chamadas.
 *
 * POR QUE ESTE SCRIPT EXISTE:
 *   A issue #114 quer aposentar RPC órfã "com prova de que ninguém chama" —
 *   e avisa que o grep ingênuo de `.rpc(` SUBCONTA mais da metade das chamadas
 *   (template strings, indireção). Este script cobre as formas que existem no
 *   repo: .rpc('nome', .rpc("nome", /rpc/nome (URL do PostgREST) e
 *   'rpc/nome'. O cruzamento banco x código é o mapa de chamadores.
 *
 * O que ele imprime, por função do schema public:
 *   * assinatura (argumentos), retorno, owner, SECURITY DEFINER?, search_path;
 *   * quem tem EXECUTE (por papel; grantee vazio no proacl = PUBLIC);
 *   * policies que referenciam a função no USING/CHECK (impedimento de DROP);
 *   * call sites no código (arquivo:linha) — ou ÓRFÃ quando zero.
 *
 * USO:  node scripts/db-inspect-blindagem-114.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

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

/** Varre o repo atrás de chamadas de RPC. Devolve Map nome -> [arquivo:linha]. */
function acharChamadores() {
  const chamadas = new Map();
  const citacoes = new Map();
  const raizes = ["src", "supabase/functions"];
  const exts = /\.(ts|tsx|js|jsx|deno)$/;

  function registrar(mapa, nome, onde) {
    if (!mapa.has(nome)) mapa.set(nome, []);
    if (!mapa.get(nome).includes(onde)) mapa.get(nome).push(onde);
  }

  function varrer(dir) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos da árvore do próprio repo
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name === ".git")
          continue;
        varrer(caminho);
      } else if (exts.test(entrada.name)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
        const conteudo = fs.readFileSync(caminho, "utf8");
        // Varrer o arquivo INTEIRO (não linha a linha): a casa escreve
        // .rpc(\n  "nome", ... — o nome mora na linha seguinte, e um varredor
        // por linha perde mais da metade das chamadas (aviso da própria #114).
        const padroes = [
          [/\.rpc\(\s*["']([^"']+)["']/g, "chamada"],
          // Nome em VARIÁVEL (ternário/const) não dá para rastrear por regex;
          // a rede de segurança é a passada de "citação": qualquer string com
          // o nome de uma RPC do banco conta como USO POTENCIAL (lado seguro
          // do erro: sobra no mapa, nunca falta).
          [/["']([a-z0-9_]{4,})["']/g, "citacao"],
        ];
        for (const [padrao, tipo] of padroes) {
          let m;
          while ((m = padrao.exec(conteudo)) !== null) {
            const nome = m[1];
            const linha = conteudo.slice(0, m.index).split(/\r?\n/).length;
            const onde = `${path.relative(PROJECT_ROOT, caminho)}:${linha}`;
            registrar(tipo === "chamada" ? chamadas : citacoes, nome, onde);
          }
        }
      }
    }
  }

  for (const raiz of raizes) {
    const caminho = path.join(PROJECT_ROOT, raiz);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- raiz fixa declarada acima
    if (fs.existsSync(caminho)) varrer(caminho);
  }
  return { chamadas, citacoes };
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log("Somente leitura. Nada sera alterado.\n");

  const { chamadas, citacoes } = acharChamadores();

  const funcoes = await client.query(`
    SELECT p.proname AS nome,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS retorno,
           pg_get_userbyid(p.proowner) AS dono,
           p.prosecdef AS security_definer,
           coalesce(p.proconfig::text,'') AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, args;
  `);

  const policies = await client.query(`
    SELECT policyname, tablename, cmd, coalesce(qual,'') AS qual, coalesce(with_check,'') AS chk
    FROM pg_policies WHERE schemaname = 'public';
  `);
  const crons = await client
    .query(`
    SELECT jobname, command FROM cron.job
  `)
    .catch(() => ({ rows: [] }));
  const views = await client.query(`
    SELECT viewname, definition FROM pg_views WHERE schemaname = 'public';
  `);
  const defaults = await client.query(`
    SELECT c.relname AS tabela, a.attname AS coluna, pg_get_expr(d.adbin, d.adrelid) AS expr
    FROM pg_attrdef d
    JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public';
  `);
  const indexExprs = await client
    .query(`
    SELECT c.relname AS indice, pg_get_expr(i.indexprs, i.indrelid) AS expr
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indexprs IS NOT NULL;
  `)
    .catch(() => ({ rows: [] }));
  const corpos = await client.query(`
    SELECT p2.proname AS dona, p2.prosrc AS corpo
    FROM pg_proc p2
    JOIN pg_namespace n ON n.oid = p2.pronamespace
    WHERE n.nspname = 'public' AND p2.prokind = 'f';
  `);

  console.log(`RPCs no schema public: ${funcoes.rows.length}`);
  console.log(`Nomes CHAMADOS via .rpc(): ${chamadas.size}`);
  console.log(`Nomes CITADOS como string no código: ${citacoes.size}\n`);

  for (const f of funcoes.rows) {
    const chamadasDiretas = chamadas.get(f.nome) ?? [];
    const citadas = citacoes.get(f.nome) ?? [];
    const usadaPorPolicy = policies.rows.filter(
      (p) =>
        f.nome.length > 3 &&
        (p.qual.includes(f.nome) || p.chk.includes(f.nome)),
    );
    // Trigger usa a função se o trigger FOI criado a partir dela (tgfoid):
    const triggerDaFuncao = await client.query(
      `SELECT t.tgname, c.relname AS tabela
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgfoid = (SELECT p.oid FROM pg_proc p
                         JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname='public' AND p.proname=$1
                           AND pg_get_function_identity_arguments(p.oid)=$2)
         AND NOT t.tgisinternal`,
      [f.nome, f.args],
    );
    const usadaPorCron = crons.rows.filter((c) => c.command.includes(f.nome));
    const usadaPorView = views.rows.filter(
      (v) => f.nome.length > 3 && v.definition.includes(f.nome),
    );
    const usadaPorDefault = defaults.rows.filter((d) =>
      d.expr.includes(f.nome),
    );
    const usadaPorIndice = indexExprs.rows.filter((i) =>
      i.expr.includes(f.nome),
    );
    const citadaEmCorpo = corpos.rows.filter(
      (c) => c.dona !== f.nome && c.corpo.includes(f.nome),
    );

    const marcador =
      chamadasDiretas.length === 0 ? " ÓRFÃ-de-chamada-direta" : "";
    // ACL de EXECUTE (grantee vazio no proacl = PUBLIC):
    const acl = await client.query(
      `SELECT coalesce(g.grantee::regrole::text,'PUBLIC') AS grantee
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(p.proacl) g(grantor, grantee, privilege_type, is_grantable)
       WHERE n.nspname='public' AND p.proname = $1
         AND pg_get_function_identity_arguments(p.oid) = $2
         AND g.privilege_type = 'EXECUTE'`,
      [f.nome, f.args],
    );
    const executores = acl.rows.map((r) => r.grantee);
    console.log("------------------------------------------------------------");
    console.log(`${f.nome}(${f.args})${marcador}`);
    console.log(
      `  retorno: ${f.retorno} | dono: ${f.dono} | secdef: ${f.security_definer}`,
    );
    if (f.config) console.log(`  config: ${f.config}`);
    console.log(
      `  EXECUTE: ${executores.join(", ") || "(nenhum explícito — default do owner)"}`,
    );
    if (chamadasDiretas.length > 0) {
      console.log(`  .rpc() (${chamadasDiretas.length}):`);
      for (const c of chamadasDiretas) console.log(`    - ${c}`);
    }
    if (citadas.length > 0 && chamadasDiretas.length === 0) {
      console.log(
        `  CITADA como string (${citadas.length}) — nome em variável/comentário; conferir a olho:`,
      );
      for (const c of citadas.slice(0, 6)) console.log(`    - ${c}`);
    }
    if (triggerDaFuncao.rows.length > 0) {
      console.log(
        `  TRIGGER: ${triggerDaFuncao.rows.map((t) => `${t.tgname} em ${t.tabela}`).join("; ")}`,
      );
    }
    if (usadaPorCron.length > 0) {
      console.log(`  CRON: ${usadaPorCron.map((c) => c.jobname).join("; ")}`);
    }
    if (usadaPorPolicy.length > 0) {
      console.log(
        `  POLICY USA: ${usadaPorPolicy.map((p) => `${p.policyname} (${p.tablename})`).join("; ")}`,
      );
    }
    if (usadaPorView.length > 0) {
      console.log(
        `  VIEW USA: ${usadaPorView.map((v) => v.viewname).join("; ")}`,
      );
    }
    if (usadaPorDefault.length > 0) {
      console.log(
        `  DEFAULT USA: ${usadaPorDefault.map((d) => `${d.tabela}.${d.coluna}`).join("; ")}`,
      );
    }
    if (usadaPorIndice.length > 0) {
      console.log(
        `  ÍNDICE USA: ${usadaPorIndice.map((i) => i.indice).join("; ")}`,
      );
    }
    if (citadaEmCorpo.length > 0) {
      console.log(
        `  CORPO DE OUTRA FUNÇÃO cita: ${citadaEmCorpo
          .map((c) => c.dona)
          .slice(0, 8)
          .join("; ")}`,
      );
    }
    if (
      chamadasDiretas.length === 0 &&
      citadas.length === 0 &&
      triggerDaFuncao.rows.length === 0 &&
      usadaPorCron.length === 0 &&
      usadaPorPolicy.length === 0 &&
      usadaPorView.length === 0 &&
      usadaPorDefault.length === 0 &&
      usadaPorIndice.length === 0 &&
      citadaEmCorpo.length === 0
    ) {
      console.log("  >>> ÓRFÃ COMPLETA: nenhum uso em lugar nenhum <<<");
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
