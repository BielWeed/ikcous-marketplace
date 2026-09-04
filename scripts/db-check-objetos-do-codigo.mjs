#!/usr/bin/env node
/**
 * DETECTOR de "objeto que o código usa e o banco não tem" (BANCO-080, issue
 * #139 — frente blindagem-banco-0409).
 *
 * POR QUE ESTE SCRIPT EXISTE: em 05/08/2026, `vw_produtos_admin` não existia
 * em nenhum schema do banco enquanto o front a chamava em sete lugares —
 * cadastrar produto estava quebrado EM PRODUÇÃO e o fallback de
 * StoreContext.tsx escondeu o problema por tempo indeterminado. Nada no
 * projeto avisava. O ledger de migrations não pegaria o caso: nunca houve
 * migration criando a view (ela SUMIU do banco vivo).
 *
 * O QUE ELE FAZ:
 *   1. Extrai de src/ e supabase/functions/ todo nome passado para
 *      `.from("...")` e `.rpc("..."` — varrendo o arquivo INTEIRO, não linha
 *      a linha: a casa escreve `.from(\n  "nome",` e um varredor por linha
 *      perde a chamada (mesma lição do inventário da #114).
 *   2. Confere contra o catálogo REAL do banco (pg_class para tabelas/views,
 *      pg_proc para funções) via DATABASE_URL.
 *   3. DISTINGUE os dois defeitos diferentes que a issue separa:
 *        AUSENTE      — o objeto não existe no banco (o caso da view sumida);
 *       INALCANÇAVEL — existe, mas nenhum papel do app o alcança (SELECT para
 *                      .from, EXECUTE para .rpc; para src/: anon OU
 *                      authenticated; para edges: service_role). Defeito de
 *                      GRANT, correção diferente.
 *   4. Sai com exit 1 se houver qualquer AUSENTE ou INALCANÇAVEL — no CI,
 *      reprova o PR ANTES de virar defeito em produção.
 *
 * SEM DATABASE_URL (ex.: CI antes de o secret existir): imprime aviso
 * destacado e sai 0 — detector inerte é dívida VISÍVEL, não vermelho que o
 * time aprende a ignorar. O teste em tests/db_check_objetos_do_codigo_test.ts
 * prova a lógica com casos semeados (inclusive o da view sumida) sem banco.
 *
 * USO:
 *   node scripts/db-check-objetos-do-codigo.mjs            (lê .env.local/.env)
 *   DATABASE_URL=... node scripts/db-check-objetos-do-codigo.mjs
 *
 * LIMITAÇÕES (documentadas, não escondidas):
 *   * só audita nomes LITERAIS — chamadas com nome em VARIÁVEL (hoje: o
 *     ternário de useOrders.ts que elege create_marketplace_order_v23/v24)
 *     são REPORTADAS como "fora da auditoria" no relatório, não conferidas;
 *     o detector não faz análise de fluxo — a lacuna fica visível.
 *   * `.from()`/`.rpc()` em teste/mocks não é contado: só src/ e
 *     supabase/functions/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são chaves internas do próprio varredor (família do
 * achado, nome de objeto, papéis de listas fixas deste arquivo). Nunca há
 * payload de terceiro. */

const PAPEIS_SRC = ["anon", "authenticated"];
const PAPEIS_EDGE = ["service_role"];

/** Extrai referências de um único conteúdo de arquivo. Exportada para teste.
 *
 * Três famílias, porque são três catálogos diferentes no banco:
 *   from     — `.from("nome")` em client de DATABASE (tabela/view);
 *   rpc      — `.rpc("nome"` (função);
 *   bucket   — `.storage.from("nome")` (bucket do Supabase Storage — NÃO é
 *              tabela; confundir os dois fabrica o falso positivo medido em
 *              04/09: os 6 "products ausentes" eram o bucket de imagens).
 *
 * E uma QUARTA família, declarada em vez de escondida:
 *   dinamicas — `.rpc(variavel)` / `.from(variavel)` com nome em identificador
 *              (o caso REAL de hoje: o ternário de useOrders.ts elege
 *              create_marketplace_order_v23/v24 para uma variável — o caminho
 *              do DINHEIRO está fora da auditoria literal por construção).
 *              O detector não faz análise de fluxo; o que ele faz é REPORTAR
 *              cada linha dinâmica no relatório, para a lacuna ficar visível
 *              em vez de parecer cobertura.
 */
export function extrairDeConteudo(conteudo, ondePrefixo = "") {
  const achados = { from: [], rpc: [], bucket: [], dinamicas: [] };
  const padroes = [
    [/\.from\(\s*["']([^"']+)["']/g, "from"],
    [/\.rpc\(\s*["']([^"']+)["']/g, "rpc"],
    [/\.from\(\s*([a-zA-Z_$][\w$]*)\s*[,)]/g, "from-ident"],
    [/\.rpc\(\s*([a-zA-Z_$][\w$]*)\s*[,)]/g, "rpc-ident"],
  ];
  for (const [padrao, tipo] of padroes) {
    let m;
    while ((m = padrao.exec(conteudo)) !== null) {
      const linha = conteudo.slice(0, m.index).split(/\r?\n/).length;
      const onde = `${ondePrefixo}:${linha}`;
      if (tipo === "from" || tipo === "rpc") {
        // .storage.from("x") é BUCKET, não tabela: olha o que vem imediatamente
        // antes do match para decidir a família (inclusive o .from quebrado em
        // linha própria — \s cobre a quebra).
        const antes = conteudo.slice(Math.max(0, m.index - 30), m.index);
        const ehBucket = /storage\s*$/.test(antes);
        const familia = tipo === "from" && ehBucket ? "bucket" : tipo;
        achados[familia].push({ nome: m[1], onde });
      } else {
        const antes = conteudo.slice(Math.max(0, m.index - 30), m.index);
        if (/storage\s*$/.test(antes)) continue; // storage.from(ident) idem
        achados.dinamicas.push({ nome: m[1], onde, chamada: tipo.replace("-ident", "") });
      }
    }
  }
  return achados;
}

/** Varre src/ (papéis do app) e supabase/functions/ (service_role). Exportada. */
export function extrairDoRepo(raiz = PROJECT_ROOT) {
  const referencias = []; // { tipo: 'from'|'rpc'|'bucket', nome, onde, papeis }
  const dinamicas = []; // { nome (variável), onde, chamada }
  const exts = /\.(ts|tsx|js|jsx|deno)$/;
  function varrer(dir, origem, papeis) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- árvore do próprio repo
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name === ".git") continue;
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        varrer(caminho, origem, papeis);
      } else if (exts.test(entrada.name) && !/_test\.|\.test\./.test(entrada.name)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
        const conteudo = fs.readFileSync(caminho, "utf8");
        const achados = extrairDeConteudo(conteudo, path.relative(raiz, caminho));
        for (const tipo of ["from", "rpc", "bucket"]) {
          for (const ref of achados[tipo])
            referencias.push({ tipo, ...ref, papeis });
        }
        for (const d of achados.dinamicas) dinamicas.push(d);
      }
    }
  }
  const alvos = [
    { dir: "src", papeis: PAPEIS_SRC },
    { dir: "supabase/functions", papeis: PAPEIS_EDGE },
  ];
  for (const alvo of alvos) {
    const caminho = path.join(raiz, alvo.dir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- raiz fixa declarada acima
    if (fs.existsSync(caminho)) varrer(caminho, alvo.dir, alvo.papeis);
  }
  return { referencias, dinamicas };
}

/**
 * Avalia referências contra o catálogo. Exportada para teste.
 * catalogo = {
 *   relacoes: Map nome -> Set(papeis com SELECT),
 *   funcoes:  Map nome -> Set(papeis com EXECUTE em QUALQUER sobrecarga),
 *   buckets:  Set(nomes de buckets do storage)
 * }
 * Bucket só tem checagem de AUSÊNCIA: o acesso a objeto de storage é decidido
 * por policies de storage.objects (semântica própria, fora do escopo #139).
 * Devolve { ausentes, inalcançaveis, ok } — cada item com tipo/nome/onde/papeis.
 */
export function avaliar(referencias, catalogo) {
  const ausentes = [];
  const inalcançaveis = [];
  const ok = [];
  for (const ref of referencias) {
    if (ref.tipo === "bucket") {
      if (catalogo.buckets.has(ref.nome)) ok.push(ref);
      else ausentes.push({ ...ref, objeto: "bucket de storage" });
      continue;
    }
    const mapa = ref.tipo === "from" ? catalogo.relacoes : catalogo.funcoes;
    if (!mapa.has(ref.nome)) {
      ausentes.push({
        ...ref,
        objeto: ref.tipo === "from" ? "tabela/view" : "função",
      });
      continue;
    }
    const papeisComAcesso = mapa.get(ref.nome);
    const alcança = ref.papeis.some((p) => papeisComAcesso.has(p));
    if (alcança) {
      ok.push(ref);
    } else {
      inalcançaveis.push({
        ...ref,
        objeto: ref.tipo === "from" ? "tabela/view" : "função",
        detalhe: `existe, mas nenhum papel desta origem (${ref.papeis.join("/")}) tem ${ref.tipo === "from" ? "SELECT" : "EXECUTE"}`,
      });
    }
  }
  return { ausentes, inalcançaveis, ok };
}

/** Consulta o catálogo real + privilégios por papel. */
export async function lerCatalogo(connectionString) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const todosPapeis = [...PAPEIS_SRC, ...PAPEIS_EDGE];

  const rel = await client.query(`
    SELECT c.relname AS nome,
           (has_table_privilege('anon',     quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('anon',     quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS anon,
           (has_table_privilege('authenticated', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('authenticated', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS authenticated,
           (has_table_privilege('service_role', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('service_role', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS service_role
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','f')
  `);
  const relacoes = new Map();
  for (const r of rel.rows) {
    // SELECT conta se vem da TABELA ou de QUALQUER coluna (a 20261070 deu
    // SELECT por coluna a authenticated de propósito; has_table_privilege
    // sozinho é cego para grant de coluna — falso positivo medido).
    const papeis = new Set(todosPapeis.filter((p) => r[p]));
    relacoes.set(r.nome, papeis);
  }

  // Funções: agrega sobrecargas por nome — o .rpc("nome") não elege
  // assinatura; alcançável = QUALQUER sobrecarga alcançável.
  const fn = await client.query(`
    SELECT p.proname AS nome,
           has_function_privilege('anon', p.oid::regprocedure::text, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid::regprocedure::text, 'EXECUTE') AS authenticated,
           has_function_privilege('service_role', p.oid::regprocedure::text, 'EXECUTE') AS service_role
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  `);
  const funcoes = new Map();
  for (const r of fn.rows) {
    if (!funcoes.has(r.nome)) funcoes.set(r.nome, new Set());
    for (const p of todosPapeis) {
      if (r[p]) funcoes.get(r.nome).add(p);
    }
  }

  // Buckets do storage (só existência; acesso a objeto é policy de
  // storage.objects, fora do escopo).
  const buckets = new Set();
  const bucketsAcessivel = true;
  try {
    const bk = await client.query("SELECT id FROM storage.buckets");
    for (const r of bk.rows) buckets.add(r.id);
  } catch {
    // Sem acesso ao schema storage: a checagem de bucket fica CEGA — e o
    // main AVISA (silêncio aqui escondia a cegueira).
    return { relacoes, funcoes, buckets, bucketsAcessivel: false };
  }

  await client.end();
  return { relacoes, funcoes, buckets, bucketsAcessivel };
}

function lerDatabaseUrlDeArquivo() {
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  return null;
}

export function formatar(resultado) {
  const linhas = [];
  if (resultado.ausentes.length > 0) {
    linhas.push("AUSENTE — o código usa e o banco NÃO TEM (o caso da view sumida #139):");
    for (const a of resultado.ausentes)
      linhas.push(`  - ${a.objeto} "${a.nome}" usada em ${a.onde}`);
  }
  if (resultado.inalcançaveis.length > 0) {
    linhas.push("INALCANÇÁVEL — existe, mas nenhum papel do app alcança (defeito de GRANT, correção diferente):");
    for (const i of resultado.inalcançaveis)
      linhas.push(`  - ${i.objeto} "${i.nome}" usada em ${i.onde} — ${i.detalhe}`);
  }
  return linhas.join("\n");
}

/** Bloco informativo das referências DINÂMICAS (não reprova; declara a lacuna). */
export function formatarDinamicas(dinamicas) {
  if (!dinamicas || dinamicas.length === 0) return "";
  const linhas = [
    `FORA DA AUDITORIA — .rpc/.from com nome em VARIÁVEL (${dinamicas.length}; o detector não faz análise de fluxo, então estas linhas ficam sem conferência):`,
  ];
  for (const d of dinamicas)
    linhas.push(`  - .${d.chamada}(${d.nome}, …) em ${d.onde}`);
  return linhas.join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL ?? lerDatabaseUrlDeArquivo();
  if (!url) {
    console.warn(
      "::warning::Detector de objetos INERTE: sem DATABASE_URL (local: .env.local/.env; CI: secret DATABASE_URL do repo). Enquanto não configurar, este passo não vigia nada — a lógica segue provada por tests/db_check_objetos_do_codigo_test.ts.",
    );
    process.exit(0);
  }
  console.log(`Conectado em ${new URL(url).hostname} — só leitura de catálogo.`);
  const { referencias, dinamicas } = extrairDoRepo();
  const catalogo = await lerCatalogo(url);
  if (!catalogo.bucketsAcessivel) {
    console.warn(
      "::warning::Sem acesso a storage.buckets — a checagem de BUCKET está cega nesta rodada (tabelas e funções seguem conferidas).",
    );
  }
  const resultado = avaliar(referencias, catalogo);

  const unicos = new Set(referencias.map((r) => `${r.tipo}:${r.nome}`));
  console.log(
    `Referências literais no código: ${referencias.length} (${unicos.size} objetos únicos) — ${catalogo.relacoes.size} relações e ${catalogo.funcoes.size} funções no catálogo public.`,
  );
  const blocoDinamicas = formatarDinamicas(dinamicas);
  if (blocoDinamicas) console.log(blocoDinamicas);

  if (resultado.ausentes.length === 0 && resultado.inalcançaveis.length === 0) {
    console.log("TODAS as referências do código existem e são alcançáveis.");
    process.exit(0);
  }
  console.log(formatar(resultado));
  process.exit(1);
}

// Roda como script apenas quando invocado diretamente (import.meta.url === argv[1])
const scriptInvocado =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (scriptInvocado) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
