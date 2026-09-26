#!/usr/bin/env node
/**
 * Roda, sob demanda e SÓ LEITURA, as conferências de pré/pós-publicação que
 * o `docs/runbooks/publicar-painel-cartao-devolucoes.md` (§0/§1) descrevia
 * como "cole no SQL Editor" — e o registro do ledger
 * (`supabase_migrations.schema_migrations`) para as faixas 72-74 e 75-78.
 * Chamado por `.github/workflows/conferir-banco-da-loja.yml`.
 *
 * USO (variáveis de ambiente, o mesmo estilo de aplicar-migrations.yml):
 *   SUPABASE_ACCESS_TOKEN  o segredo do repositório (o mesmo que publica
 *                          as functions e aplica migrations).
 *   PROJETO_REF            ref do projeto (default: cafkrminfnokvgjqtkle).
 *   CONSULTA                nome (sem `.sql`) de um arquivo em
 *                          scripts/publicacao/consultas/, ou "backups".
 *   LEDGER                 "72-74" ou "75-78" — grava o ledger fixo daquela
 *                          faixa e confere 72-78 depois. Mutuamente
 *                          exclusivo com CONSULTA (o workflow só passa um).
 *
 *   node scripts/publicacao/conferir-banco.cjs
 *
 * SOMENTE LEITURA, POR CONSTRUÇÃO — o que a Management API oferece e o que
 * este script usa:
 *
 * A Management API do Supabase documenta DUAS formas de restringir escrita
 * em `POST /v1/projects/{ref}/database/query`:
 *   1. um parâmetro opcional `read_only: boolean` no corpo do request
 *      (referência: supabase.com/docs/reference/api/v1-run-a-query);
 *   2. um endpoint dedicado, `POST /v1/projects/{ref}/database/query/read-only`,
 *      que roda como `supabase_read_only_user`, sem privilégio de escrita no
 *      papel do banco (referência:
 *      supabase.com/docs/reference/api/v1-read-only-query).
 *
 * Este script manda `read_only: true` no request (usa a opção 1 documentada,
 * no MESMO endpoint que o `aplicar-migrations.yml` já usa, sem introduzir
 * host novo) E, além disso, todo statement de conferência entra dentro de
 * `BEGIN READ ONLY;` (SEM `COMMIT` — a transação nunca é fechada de propósito;
 * o request termina e a conexão da API descarta o que não foi comitado).
 * Este segundo mecanismo é o "por construção": ele foi PROVADO contra um
 * Postgres local (mesmo protocolo SIMPLES que a API usa — uma string com
 * vários statements, mandada de uma vez, sem `values`) que uma escrita
 * depois do guard FALHA na mesma requisição, nunca grava, mesmo sem
 * `ROLLBACK` explícito — script de prova em
 * `scripts/publicacao/prova-readonly.cjs` (rodado localmente, não faz parte
 * do CI: exige um Postgres à mão). O guard não depende de o `read_only`
 * documentado se comportar como esperado; ele é auditável e independente do
 * que a API faz por dentro.
 *
 * Por isso cada arquivo de consulta tem de ser UM SELECT só: o corpo vira
 * `BEGIN READ ONLY;\n<select>`, dois statements por protocolo simples, e a
 * API só devolve o resultado do ÚLTIMO — o SELECT. Um segundo SELECT no
 * mesmo arquivo silenciosamente devolveria o resultado ERRADO (o penúltimo
 * de fato não aparece), então o script recusa (contarStatements) antes de
 * mandar qualquer coisa.
 *
 * O job do ledger é o único que ESCREVE: ele manda o INSERT fixo do arquivo
 * `ledger-<faixa>.sql` SEM o guard e SEM `read_only` (bullet 6 do design —
 * "WITHOUT the read-only guard"), e só depois disso roda uma conferência
 * comum (guardada) dos números de migration 72–78.
 */
/* eslint-disable security/detect-object-injection --
 * As "chaves" indexadas neste arquivo nunca vêm de entrada externa: são
 * posições inteiras (`i`, `j`, `idx`) andando sobre uma string SQL local
 * (dividirEmStatements) ou nomes de coluna que a PRÓPRIA resposta da API
 * declarou em `columns` (extrairLinhas/formatarTabela) — nunca uma chave
 * escolhida por quem chama o script. */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONSULTAS_DIR = path.join(
  PROJECT_ROOT,
  "scripts",
  "publicacao",
  "consultas",
);
// A variável só existe para o teste de ponta a ponta contra um stub HTTP
// local (verificação desta tarefa); o workflow nunca a define, e o valor
// real de produção é sempre o host oficial da Management API.
const API_BASE =
  process.env.CONFERIR_BANCO_API_BASE || "https://api.supabase.com";
const FAIXAS_DE_LEDGER = ["72-74", "75-78"];

/** Nomes (sem `.sql`) dos arquivos de consulta que aparecem no menu —
 * os do ledger não entram aqui, eles só são alcançáveis por `LEDGER`. */
function listarConsultas(dir = CONSULTAS_DIR) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir por padrão é a constante CONSULTAS_DIR; só um teste passa outro valor, também um caminho local fixo.
  const nomes = fs.readdirSync(dir);
  return nomes
    .filter((f) => f.endsWith(".sql") && !f.startsWith("ledger-"))
    .map((f) => f.slice(0, -4))
    .sort();
}

/**
 * Divide um texto SQL nos seus statements de NÍVEL SUPERIOR — um `;` dentro
 * de comentário de linha (`--`), comentário de bloco (`/* *​/`, aninhável),
 * string simples (`'...'`, escapada por duplicação), identificador entre
 * aspas (`"..."`) ou string delimitada (`$tag$...$tag$`, como os
 * `$marcador$...$marcador$` de 1b/2a) NÃO fecha statement nenhum.
 *
 * É essa contagem que garante "cada arquivo de consulta é UM SELECT": a API
 * só devolve o resultado do ÚLTIMO statement (protocolo simples, provado em
 * scripts/publicacao/prova-readonly.cjs), então um segundo statement no
 * arquivo faria o script mandar duas coisas e devolver, calado, o resultado
 * errado.
 */
function dividirEmStatements(sql) {
  const statements = [];
  let atual = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      const fimDaLinha = sql.indexOf("\n", i);
      const trecho =
        fimDaLinha === -1 ? sql.slice(i) : sql.slice(i, fimDaLinha + 1);
      atual += trecho;
      i += trecho.length;
      continue;
    }

    if (c === "/" && sql[i + 1] === "*") {
      let profundidade = 1;
      let j = i + 2;
      while (j < n && profundidade > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          profundidade++;
          j += 2;
          continue;
        }
        if (sql[j] === "*" && sql[j + 1] === "/") {
          profundidade--;
          j += 2;
          continue;
        }
        j++;
      }
      atual += sql.slice(i, j);
      i = j;
      continue;
    }

    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      atual += sql.slice(i, j);
      i = j;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      atual += sql.slice(i, j);
      i = j;
      continue;
    }

    if (c === "$") {
      // eslint-disable-next-line security/detect-unsafe-regex -- grupo com um quantificador só, sem aninhamento; entrada é um .sql local desta pasta, nunca rede.
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const delimitador = m[0];
        const fim = sql.indexOf(delimitador, i + delimitador.length);
        const j = fim === -1 ? n : fim + delimitador.length;
        atual += sql.slice(i, j);
        i = j;
        continue;
      }
    }

    if (c === ";") {
      statements.push(atual);
      atual = "";
      i++;
      continue;
    }

    atual += c;
    i++;
  }
  if (atual.trim() !== "") statements.push(atual);
  return statements;
}

/** Um statement "vazio" (só comentário/espaço) não conta. */
function semComentarios(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

function contarStatements(sql) {
  return dividirEmStatements(sql).filter((s) => semComentarios(s) !== "")
    .length;
}

/** O guard read-only: BEGIN READ ONLY na frente, sem COMMIT. Ver o
 * cabeçalho do arquivo para a prova e a justificativa. */
function comGuardaSomenteLeitura(selectUnico) {
  return `BEGIN READ ONLY;\n${selectUnico}`;
}

/**
 * A API devolve, hoje, o array de linhas (objetos) do ÚLTIMO statement. Mas
 * a documentação já mudou de formato antes (um resultado `{columns, rows}`
 * POR statement) — então, se um dia a resposta vier nesse formato, este
 * parser pega o ÚLTIMO elemento (que é sempre o nosso SELECT, guard +
 * consulta = 2 statements) e monta os objetos a partir de columns/rows, em
 * vez de quebrar calado.
 */
function extrairLinhas(corpoTexto) {
  let parsed;
  try {
    parsed = JSON.parse(corpoTexto);
  } catch {
    throw new Error(`resposta não é JSON: ${corpoTexto.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `formato de resposta inesperado (esperava array): ${corpoTexto.slice(0, 300)}`,
    );
  }
  const ehFormatoPorStatement =
    parsed.length > 0 &&
    parsed.every(
      (x) =>
        x &&
        typeof x === "object" &&
        Array.isArray(x.rows) &&
        Array.isArray(x.columns),
    );
  if (ehFormatoPorStatement) {
    const ultimo = parsed[parsed.length - 1];
    return ultimo.rows.map((linha) =>
      Object.fromEntries(
        ultimo.columns.map((coluna, idx) => [coluna, linha[idx]]),
      ),
    );
  }
  return parsed;
}

/** Tabela legível de largura fixa — para o log e o $GITHUB_STEP_SUMMARY. */
function formatarTabela(linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) return "(nenhuma linha)";
  const colunas = Object.keys(linhas[0]);
  const larguras = colunas.map((c) =>
    Math.max(c.length, ...linhas.map((l) => String(l[c]).length)),
  );
  const formatarLinha = (valores) =>
    valores.map((v, i) => String(v).padEnd(larguras[i])).join(" | ");
  const separador = larguras.map((w) => "-".repeat(w)).join("-|-");
  return [
    formatarLinha(colunas),
    separador,
    ...linhas.map((l) => formatarLinha(colunas.map((c) => l[c]))),
  ].join("\n");
}

/** Só o que o design pede — hora do último backup, status, PITR e total.
 * Nada que pareça segredo. */
function resumoDeBackups(json) {
  const backups = Array.isArray(json.backups) ? [...json.backups] : [];
  backups.sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at));
  const ultimo = backups[0];
  return {
    ultimoEm: ultimo ? ultimo.inserted_at : null,
    status: ultimo ? ultimo.status : null,
    pitrHabilitado: Boolean(json.pitr_enabled),
    total: backups.length,
  };
}

function escreverResumo(markdown) {
  console.log(markdown);
  const destino = process.env.GITHUB_STEP_SUMMARY;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions (GITHUB_STEP_SUMMARY), não de entrada de usuário.
  if (destino) fs.appendFileSync(destino, `${markdown}\n`);
}

/**
 * Chama `POST /v1/projects/{ref}/database/query`. Falha (lança) em HTTP
 * ≠ 2xx ou erro no corpo — mesmo critério de `aplicar-migrations.yml`.
 * Nunca loga o token: ele só entra no header Authorization.
 */
async function chamarQuery({ ref, token, query, somenteLeitura }) {
  const corpoRequest = somenteLeitura ? { query, read_only: true } : { query };
  const r = await fetch(`${API_BASE}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpoRequest),
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${corpo.slice(0, 500)}`);
  if (corpo.includes('"error"') || corpo.includes('"message":"')) {
    throw new Error(corpo.slice(0, 500));
  }
  return corpo;
}

/** `GET /v1/projects/{ref}/database/backups` — referência:
 * supabase.com/docs/reference/api/v1-list-all-backups. */
async function buscarBackups({ ref, token }) {
  const r = await fetch(`${API_BASE}/v1/projects/${ref}/database/backups`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${corpo.slice(0, 500)}`);
  return JSON.parse(corpo);
}

async function rodarConsulta({ ref, token, consulta }) {
  const validas = listarConsultas();
  if (!validas.includes(consulta)) {
    throw new Error(
      `consulta desconhecida: "${consulta}" (esperava uma de: ${validas.join(", ")}, backups)`,
    );
  }
  const arquivo = path.join(CONSULTAS_DIR, `${consulta}.sql`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `consulta` já foi conferido contra `validas` (lista fixa do disco) duas linhas acima.
  const selectUnico = fs.readFileSync(arquivo, "utf8");
  const total = contarStatements(selectUnico);
  if (total !== 1) {
    throw new Error(
      `${consulta}.sql tem ${total} statements — a API só devolve o resultado do ÚLTIMO; precisa ser exatamente 1 SELECT`,
    );
  }
  const query = comGuardaSomenteLeitura(selectUnico);
  const corpo = await chamarQuery({ ref, token, query, somenteLeitura: true });
  const linhas = extrairLinhas(corpo);
  const tabela = formatarTabela(linhas);
  escreverResumo(
    `## Consulta \`${consulta}\` — projeto \`${ref}\`\n\n\`\`\`\n${tabela}\n\`\`\``,
  );
}

async function rodarBackups({ ref, token }) {
  const json = await buscarBackups({ ref, token });
  const resumo = resumoDeBackups(json);
  const texto = [
    `Último backup: ${resumo.ultimoEm ?? "(nenhum)"}`,
    `Status: ${resumo.status ?? "(nenhum)"}`,
    `PITR: ${resumo.pitrHabilitado ? "ligado" : "desligado"}`,
    `Total de backups: ${resumo.total}`,
  ].join("\n");
  escreverResumo(`## Backups — projeto \`${ref}\`\n\n\`\`\`\n${texto}\n\`\`\``);
}

async function rodarLedger({ ref, token, faixa }) {
  if (!FAIXAS_DE_LEDGER.includes(faixa)) {
    throw new Error(
      `LEDGER inválido: "${faixa}" (esperava uma de: ${FAIXAS_DE_LEDGER.join(", ")})`,
    );
  }
  const arquivo = path.join(CONSULTAS_DIR, `ledger-${faixa}.sql`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `faixa` já foi conferida contra FAIXAS_DE_LEDGER (lista fixa) duas linhas acima.
  const insertUnico = fs.readFileSync(arquivo, "utf8");
  const total = contarStatements(insertUnico);
  if (total !== 1) {
    throw new Error(
      `ledger-${faixa}.sql tem ${total} statements — precisa ser exatamente 1 INSERT`,
    );
  }
  console.log(`=== GRAVANDO ledger ${faixa} (SEM o guard read-only) ===`);
  // A ÚNICA escrita deste script: sem BEGIN READ ONLY, sem read_only:true —
  // exatamente o INSERT fixo do arquivo, idempotente por ON CONFLICT DO NOTHING.
  await chamarQuery({ ref, token, query: insertUnico, somenteLeitura: false });
  console.log(
    `Ledger ${faixa} gravado (ou já estava — ON CONFLICT DO NOTHING).`,
  );

  const verificacao = comGuardaSomenteLeitura(
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20261172000000' AND '20261178999999' ORDER BY version;`,
  );
  const corpo = await chamarQuery({
    ref,
    token,
    query: verificacao,
    somenteLeitura: true,
  });
  const linhas = extrairLinhas(corpo);
  const tabela = formatarTabela(linhas);
  escreverResumo(
    `## Ledger 72–78 depois da gravação de \`${faixa}\`\n\n\`\`\`\n${tabela}\n\`\`\``,
  );
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("SEM SUPABASE_ACCESS_TOKEN");
    process.exit(1);
    return;
  }
  const ref = process.env.PROJETO_REF || "cafkrminfnokvgjqtkle";
  const faixaDeLedger = process.env.LEDGER;
  const consulta = process.env.CONSULTA;

  try {
    if (faixaDeLedger) {
      await rodarLedger({ ref, token, faixa: faixaDeLedger });
      return;
    }
    if (!consulta) {
      throw new Error("nem CONSULTA nem LEDGER foram informados");
    }
    if (consulta === "backups") {
      await rodarBackups({ ref, token });
      return;
    }
    await rodarConsulta({ ref, token, consulta });
  } catch (erro) {
    console.error("FALHOU:", erro.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// Exportado para tests/ci_conferir_banco_test.ts. O guarda acima existe pelo
// mesmo motivo do scripts/db-apply.cjs: sem ele, importar o módulo chamaria
// a Management API de verdade.
module.exports = {
  listarConsultas,
  dividirEmStatements,
  contarStatements,
  comGuardaSomenteLeitura,
  extrairLinhas,
  formatarTabela,
  resumoDeBackups,
  chamarQuery,
  buscarBackups,
  main,
  CONSULTAS_DIR,
};
