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
 *   PROJETO                "loja" (default) ou "sandbox" — NUNCA um ref cru.
 *                          Resolvido para o ref de 20 letras por
 *                          `resolverRef` (ver abaixo, achado da rodada 2).
 *   CONSULTA                nome (sem `.sql`) de um arquivo em
 *                          scripts/publicacao/consultas/, ou "backups".
 *   LEDGER                 "72-74" ou "75-78" — pré-confere o schema, grava
 *                          o ledger fixo daquela faixa e confere 72-78
 *                          depois. Mutuamente exclusivo com CONSULTA (o
 *                          workflow só passa um).
 *
 *   node scripts/publicacao/conferir-banco.cjs
 *
 * REVISÃO DE RISCO DA RODADA 2 (26/09/2026) — o que mudou e por quê:
 *
 * 1. `projeto_ref` como TEXTO LIVRE ia direto para o path da URL, com um
 *    token válido para TODOS os projetos da conta. Provado contra um stub:
 *    "cafkrminfnokvgjqtkle/restart#" batia em POST /restart; e
 *    "x/../outroprojeto.../database/query#" fazia o INSERT do ledger ir
 *    para OUTRO projeto. Agora `PROJETO` só aceita "loja"/"sandbox"
 *    (`resolverRef`, lookup fechado + `Object.hasOwn` + regex
 *    `/^[a-z]{20}$/` antes de qualquer URL ser montada — o mesmo formato
 *    que o `openapi.json` da Management API declara para `ref`).
 *
 * 2. O ledger não conferia o que prometia gravar: `needs: conferir` no
 *    workflow só exigia que a consulta ESCOLHIDA não desse erro — o
 *    default `consulta = backups` nem olha o schema. Agora
 *    `conferirAntesDeGravar` roda as consultas de VERDADE da faixa (2a+2b
 *    para 72-74; 1a+1b para 75-78) pelo caminho só-leitura ANTES do
 *    INSERT, e aborta se vier 0 linha ou qualquer linha com `ok !== true`
 *    (a linha "loja existente com as 3 formas ligadas", de 2b, é dado ao
 *    vivo que muda legitimamente — ignorada). O `needs: conferir` saiu do
 *    workflow: ele nunca provava nada sobre a faixa escolhida.
 *
 * 3. "Só-leitura por construção" não era bem verdade: `contarStatements`
 *    divergia do lexer do Postgres em 4 casos adversariais (string E'' com
 *    escape de barra, identificador com `$` colado, comentário `--`
 *    terminado só por `\r`, tag de dollar-quote não-ASCII) — todos faziam
 *    o contador ver 1 statement enquanto o Postgres via 4 (com um COMMIT e
 *    um INSERT de verdade no meio). Os 4 casos foram corrigidos no lexer
 *    (ele continua útil para pegar erro de autoria — ver abaixo), MAS a
 *    barreira real agora é OUTRA: toda leitura vai para o endpoint
 *    dedicado `POST /v1/projects/{ref}/database/query/read-only`, que roda
 *    como `supabase_read_only_user` — um papel do BANCO sem grant de
 *    escrita, não uma promessa da aplicação. Mesmo que um arquivo futuro
 *    engane o contador, o papel não tem INSERT/UPDATE/DDL para conceder.
 *    Por isso o guard `BEGIN READ ONLY` (ver `comGuardaSomenteLeitura`) NÃO
 *    é mais usado nas chamadas de leitura: o endpoint é Beta e não
 *    documenta se aceita múltiplos statements, e arriscar um comportamento
 *    desconhecido não vale a pena quando o papel já é a barreira. Ele
 *    continua exportado e testado (prova básica em
 *    `scripts/publicacao/prova-readonly.cjs`: SELECT funciona,
 *    CREATE/INSERT isolados são barrados), mas NÃO é uma barreira
 *    hermética por si só — a suíte adversarial da rodada 2 mediu que
 *    `BEGIN READ ONLY;\nSELECT 1; COMMIT; INSERT ...;` GRAVA (o COMMIT
 *    fecha a transação read-only, e o INSERT seguinte roda numa nova
 *    transação implícita, read-write por padrão). É exatamente esse buraco
 *    — um COMMIT embutido no meio de um corpo que o contador leu errado
 *    como 1 statement — que o papel `supabase_read_only_user` fecha de
 *    verdade: falta de privilégio de escrita não se desfaz com COMMIT.
 *

 *    Texto corrigido (a versão anterior deste comentário errava nos dois
 *    pontos): a Management API (postgres-meta) reduz um corpo com vários
 *    statements ao resultado do ÚLTIMO NÃO-VAZIO, não ao último statement
 *    por posição (`res.reverse().find(x => x.rows.length !== 0)` no
 *    `db.ts` do postgres-meta) — irrelevante para este script, porque cada
 *    chamada manda exatamente 1 statement, mas a alegação antiga era
 *    imprecisa. E "só leitura" vem do PAPEL do banco (`supabase_read_only_user`
 *    no endpoint dedicado), não de o parser deste arquivo estar certo.
 *
 * 4. O job do ledger e o `aplicar-migrations.yml` agora compartilham
 *    `concurrency: group: banco-da-loja` — o ledger não roda enquanto uma
 *    migration está sendo aplicada (e vice-versa).
 *
 * 5. `backups`: se `backups[]` vier vazio mas
 *    `physical_backup_data.latest_physical_backup_date_unix` existir (PITR
 *    ligado, sem backup discreto ainda listado), imprime essa data em vez
 *    de "(nenhum)".
 *
 * Sobre o GitHub Environment sugerido pela revisão ("banco-da-loja" com
 * revisor obrigatório): NÃO foi adicionado — ver a nota grande antes de
 * `module.exports` no fim deste arquivo.
 */
/* eslint-disable security/detect-object-injection --
 * As "chaves" indexadas neste arquivo nunca vêm de entrada externa sem
 * portão: são posições inteiras (`i`, `j`, `idx`) andando sobre uma string
 * SQL local (dividirEmStatements), nomes de coluna que a PRÓPRIA resposta
 * da API declarou (extrairLinhas/formatarTabela), ou `REFS_POR_PROJETO[projeto]`
 * — que passa por `Object.hasOwn` ANTES do acesso (recusa `__proto__`,
 * `constructor` etc.) e cujo resultado ainda é validado por regex antes de
 * qualquer URL ser montada (resolverRef). Nunca uma chave escolhida por
 * quem chama o script que chegue a um efeito observável sem checagem. */
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

/** Os únicos dois projetos que este token alcança (mesmos refs de
 * `publicar-functions.yml`). Nunca aceitar um terceiro valor aqui: é isso
 * que fecha a injeção de `projeto_ref` da rodada 2 da revisão. */
const REFS_POR_PROJETO = {
  loja: "cafkrminfnokvgjqtkle",
  sandbox: "lofznuxcvezrhxsgjqyg",
};

/**
 * Resolve "loja"/"sandbox" para o ref de 20 letras minúsculas — nunca
 * aceita texto livre. `Object.hasOwn` recusa `__proto__`/`constructor`/
 * `toString` antes mesmo de indexar o objeto; a regex depois é defesa em
 * profundidade (o formato que o próprio `openapi.json` da Management API
 * declara para `ref`: minLength/maxLength 20, pattern `^[a-z]+$`) — mesmo
 * que `REFS_POR_PROJETO` seja corrompido no futuro, nenhuma URL chega a
 * ser montada com algo fora desse formato.
 */
function resolverRef(projeto) {
  if (!Object.hasOwn(REFS_POR_PROJETO, projeto)) {
    throw new Error(`projeto desconhecido: "${projeto}" (use loja ou sandbox)`);
  }
  const ref = REFS_POR_PROJETO[projeto];
  if (!/^[a-z]{20}$/.test(ref)) {
    throw new Error(`ref resolvido para "${projeto}" é inválido: "${ref}"`);
  }
  return ref;
}

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
 * de comentário de linha (`--`, terminado por `\n` OU `\r`), comentário de
 * bloco (`/* *​/`, aninhável), string simples (`'...'`, escapada por
 * duplicação, ou `E'...'`/`e'...'` com escape de barra), identificador
 * entre aspas (`"..."`) ou string delimitada (`$tag$...$tag$`, tag Unicode
 * — `$é$` é uma tag válida — e nunca disparada no MEIO de um identificador,
 * como em `x$y$`) NÃO fecha statement nenhum.
 *
 * Esta contagem NÃO é mais a barreira de "só leitura" (ver o cabeçalho do
 * arquivo — isso é o papel `supabase_read_only_user` do endpoint
 * dedicado). Ela continua útil como checagem de autoria: um arquivo de
 * consulta com mais de 1 statement por engano é recusado antes de
 * qualquer chamada de rede.
 */
function dividirEmStatements(sql) {
  const statements = [];
  let atual = "";
  let i = 0;
  const n = sql.length;
  // Caractere que, colado ANTES de um `$`, faz parte do MESMO identificador
  // — nesse caso o `$` não pode abrir dollar-quote (é o caso `x$y$`: um
  // identificador comum com `$` no meio, não uma string delimitada).
  const CONTINUA_IDENTIFICADOR = /[\p{L}\p{N}_$]/u;
  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      let fim = i + 2;
      while (fim < n && sql[fim] !== "\n" && sql[fim] !== "\r") fim++;
      // Consome até o fim da linha, incluindo UM terminador (\n ou \r) —
      // Postgres aceita qualquer um dos dois como fim de comentário `--`.
      const ateAqui = fim < n ? fim + 1 : fim;
      atual += sql.slice(i, ateAqui);
      i = ateAqui;
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
      // `E'...'`/`e'...'`: dentro da string, `\<qualquer coisa>` é um
      // escape (consome os DOIS caracteres) — sem isto, `E'\''` (uma
      // string de um caractere, a áspa, escapada por barra) engana o
      // lexer, que via a áspa escapada como o ÚLTIMO caractere de uma
      // string e a áspa seguinte (a de fechamento de verdade) como o
      // INÍCIO de um par `''` — string nunca fechava e engolia o resto do
      // arquivo, inclusive um `COMMIT; INSERT` de verdade.
      const ehEString = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e");
      let j = i + 1;
      while (j < n) {
        if (ehEString && sql[j] === "\\") {
          j += 2;
          continue;
        }
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
      // Um `$` colado depois de letra/dígito/`_`/`$` é parte do MESMO
      // identificador (Postgres aceita `$` em identificador comum, só não
      // como primeiro caractere) — `x$y$` é UM identificador, não uma
      // string delimitada. Sem esta guarda, o `$y$` no meio era lido como
      // abertura de dollar-quote, o fechamento nunca era achado, e a
      // "string" engolia o resto do arquivo inteiro.
      const anterior = i > 0 ? sql[i - 1] : "";
      const dentroDeIdentificador = CONTINUA_IDENTIFICADOR.test(anterior);
      if (!dentroDeIdentificador) {
        // eslint-disable-next-line security/detect-unsafe-regex -- grupo com um quantificador só, sem aninhamento; entrada é um .sql local desta pasta, nunca rede.
        const m = /^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(sql.slice(i));
        if (m) {
          const delimitador = m[0];
          const fim = sql.indexOf(delimitador, i + delimitador.length);
          const j = fim === -1 ? n : fim + delimitador.length;
          atual += sql.slice(i, j);
          i = j;
          continue;
        }
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
    .replace(/--[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

function contarStatements(sql) {
  return dividirEmStatements(sql).filter((s) => semComentarios(s) !== "")
    .length;
}

/** O guard: `BEGIN READ ONLY;` na frente, sem COMMIT. Provado
 * (scripts/publicacao/prova-readonly.cjs) contra os casos SIMPLES: SELECT
 * funciona, um CREATE/INSERT isolado é barrado. NÃO é uma barreira
 * hermética contra um corpo que embuta um COMMIT/ROLLBACK/END/`SET
 * TRANSACTION READ WRITE` no meio (medido na rodada 2: nesse caso o
 * guard é desfeito e a escrita seguinte roda de verdade) — por isso não é
 * mais chamado pelo caminho quente deste script (ver o cabeçalho: o
 * endpoint dedicado com `supabase_read_only_user` é a barreira real
 * agora). Continua exportado e testado como o que ele É: uma trava de
 * transação que ajuda contra escrita acidental simples, não contra SQL
 * adversarial. */
function comGuardaSomenteLeitura(selectUnico) {
  return `BEGIN READ ONLY;\n${selectUnico}`;
}

/**
 * A Management API (postgres-meta) devolve sempre um array achatado de
 * linhas (`data || []`, onde `data` já é o `.rows` do resultado reduzido
 * no servidor — `res.reverse().find(x => x.rows.length !== 0)`: o ÚLTIMO
 * resultado NÃO-VAZIO entre os statements do corpo, nunca simplesmente "o
 * último statement por posição"). Como este script manda sempre exatamente
 * 1 statement (para o endpoint de leitura E para o de escrita), essa
 * nuance não tem efeito prático aqui — mas o formato "um resultado
 * `{columns, rows}` por statement" que uma versão antiga deste comentário
 * alegava nunca foi observado contra o servidor real. Mantido como
 * fallback defensivo (não around dano), documentado corretamente agora.
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

/** Só o que o design pede — hora do último backup (ou, na falta de um
 * backup discreto, a data mais recente de PITR físico), status, PITR e
 * total. Nada que pareça segredo. */
function resumoDeBackups(json) {
  const backups = Array.isArray(json.backups) ? [...json.backups] : [];
  backups.sort((a, b) => new Date(b.inserted_at) - new Date(a.inserted_at));
  const ultimo = backups[0];
  if (ultimo) {
    return {
      ultimoEm: ultimo.inserted_at,
      fonte: "backup",
      status: ultimo.status,
      pitrHabilitado: Boolean(json.pitr_enabled),
      total: backups.length,
    };
  }
  const pitrUnix = json.physical_backup_data?.latest_physical_backup_date_unix;
  if (typeof pitrUnix === "number") {
    return {
      ultimoEm: new Date(pitrUnix * 1000).toISOString(),
      fonte: "pitr",
      status: null,
      pitrHabilitado: Boolean(json.pitr_enabled),
      total: 0,
    };
  }
  return {
    ultimoEm: null,
    fonte: "nenhum",
    status: null,
    pitrHabilitado: Boolean(json.pitr_enabled),
    total: 0,
  };
}

function escreverResumo(markdown) {
  console.log(markdown);
  const destino = process.env.GITHUB_STEP_SUMMARY;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions (GITHUB_STEP_SUMMARY), não de entrada de usuário.
  if (destino) fs.appendFileSync(destino, `${markdown}\n`);
}

/** POST genérico para a Management API. Falha (lança) em HTTP ≠ 2xx ou
 * erro no corpo — mesmo critério de `aplicar-migrations.yml`. Nunca loga
 * o token: ele só entra no header Authorization. */
async function chamarManagementApi(caminho, { token, corpo }) {
  const r = await fetch(`${API_BASE}${caminho}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 500)}`);
  if (texto.includes('"error"') || texto.includes('"message":"')) {
    throw new Error(texto.slice(0, 500));
  }
  return texto;
}

/**
 * `POST /v1/projects/{ref}/database/query/read-only` — roda como
 * `supabase_read_only_user` (referência: openapi.json, operationId
 * `v1-read-only-query`, "[Beta] Run a sql query as supabase_read_only_user",
 * `x-fga-permissions: [["database_read"]]`). O corpo do endpoint dedicado é
 * só `{ query }` (schema `V1ReadOnlyQueryBody`: `query` + `parameters`
 * opcional — SEM `read_only`, que é exclusivo do endpoint de escrita).
 * Manda a consulta CRUA (sem `BEGIN READ ONLY`): o endpoint é Beta e não
 * documenta se aceita mais de um statement por corpo, e o papel do banco
 * já é a barreira — não vale arriscar um comportamento desconhecido.
 */
async function chamarLeitura({ ref, token, query }) {
  return chamarManagementApi(`/v1/projects/${ref}/database/query/read-only`, {
    token,
    corpo: { query },
  });
}

/** `POST /v1/projects/{ref}/database/query` — o ÚNICO caminho de escrita
 * deste script (o INSERT fixo do ledger, dentro de `rodarLedger`). Sem
 * guard, sem `read_only`. */
async function chamarEscrita({ ref, token, query }) {
  return chamarManagementApi(`/v1/projects/${ref}/database/query`, {
    token,
    corpo: { query },
  });
}

/** `GET /v1/projects/{ref}/database/backups` — referência: openapi.json,
 * operationId `v1-list-all-backups` (schema `V1BackupsResponse_Output`:
 * `region`, `walg_enabled`, `pitr_enabled`, `backups[]`,
 * `physical_backup_data`). */
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
      `${consulta}.sql tem ${total} statements — precisa ser exatamente 1 SELECT`,
    );
  }
  const corpo = await chamarLeitura({ ref, token, query: selectUnico });
  const linhas = extrairLinhas(corpo);
  const tabela = formatarTabela(linhas);
  escreverResumo(
    `## Consulta \`${consulta}\` — projeto \`${ref}\`\n\n\`\`\`\n${tabela}\n\`\`\``,
  );
}

async function rodarBackups({ ref, token }) {
  const json = await buscarBackups({ ref, token });
  const resumo = resumoDeBackups(json);
  const linhaUltimo =
    resumo.fonte === "pitr"
      ? `Último ponto de restauração (PITR, sem backup discreto ainda listado): ${resumo.ultimoEm}`
      : `Último backup: ${resumo.ultimoEm ?? "(nenhum)"}`;
  const texto = [
    linhaUltimo,
    `Status: ${resumo.status ?? "(nenhum)"}`,
    `PITR: ${resumo.pitrHabilitado ? "ligado" : "desligado"}`,
    `Total de backups: ${resumo.total}`,
  ].join("\n");
  escreverResumo(`## Backups — projeto \`${ref}\`\n\n\`\`\`\n${texto}\n\`\`\``);
}

/** As consultas que REALMENTE conferem o schema de cada faixa do ledger —
 * fixas, não o que o coordenador escolheu em `consulta` (achado da rodada
 * 2: `needs: conferir` só provava que ALGUMA consulta rodou sem erro, e o
 * default `backups` nem olha o schema). */
const CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER = {
  "72-74": ["2a-marcadores-72-74", "2b-objetos-72-74"],
  "75-78": ["1a-conferir-o-que-nasceu", "1b-conferir-marcadores"],
};

/** "loja existente com as 3 formas ligadas" (2b) é dado AO VIVO da loja —
 * muda legitimamente conforme o admin liga/desliga forma de pagamento — e
 * não uma checagem estrutural. Ignorada na pré-checagem do ledger. */
const IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER = new Set([
  "loja existente com as 3 formas ligadas",
]);

/** Roda as consultas fixas da faixa pelo caminho só-leitura e aborta
 * (lança) se vier 0 linha ou qualquer linha com `ok !== true` (fora as
 * ignoradas). Chamado ANTES do INSERT em `rodarLedger`. */
async function conferirAntesDeGravar({ ref, token, faixa }) {
  const consultasObrigatorias = CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER[faixa];
  for (const nomeConsulta of consultasObrigatorias) {
    const arquivo = path.join(CONSULTAS_DIR, `${nomeConsulta}.sql`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `nomeConsulta` vem só de CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER, uma lista fixa deste arquivo.
    const selectUnico = fs.readFileSync(arquivo, "utf8");
    const corpo = await chamarLeitura({ ref, token, query: selectUnico });
    const linhas = extrairLinhas(corpo);
    if (linhas.length === 0) {
      throw new Error(
        `pré-checagem do ledger ${faixa} falhou: ${nomeConsulta} devolveu 0 linhas`,
      );
    }
    for (const linha of linhas) {
      const rotulo = linha.item ?? linha.checagem ?? JSON.stringify(linha);
      if (IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER.has(rotulo)) continue;
      if (linha.ok !== true) {
        throw new Error(
          `pré-checagem do ledger ${faixa} falhou: ${nomeConsulta} tem "${rotulo}" com ok=${linha.ok}`,
        );
      }
    }
  }
}

async function rodarLedger({ ref, token, faixa }) {
  if (!FAIXAS_DE_LEDGER.includes(faixa)) {
    throw new Error(
      `LEDGER inválido: "${faixa}" (esperava uma de: ${FAIXAS_DE_LEDGER.join(", ")})`,
    );
  }

  console.log(`=== PRÉ-CHECAGEM antes de gravar o ledger ${faixa} ===`);
  await conferirAntesDeGravar({ ref, token, faixa });
  console.log("Pré-checagem OK: todas as linhas relevantes vieram ok=true.");

  const arquivo = path.join(CONSULTAS_DIR, `ledger-${faixa}.sql`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `faixa` já foi conferida contra FAIXAS_DE_LEDGER (lista fixa) acima.
  const insertUnico = fs.readFileSync(arquivo, "utf8");
  const total = contarStatements(insertUnico);
  if (total !== 1) {
    throw new Error(
      `ledger-${faixa}.sql tem ${total} statements — precisa ser exatamente 1 INSERT`,
    );
  }
  console.log(`=== GRAVANDO ledger ${faixa} (endpoint de escrita) ===`);
  // A ÚNICA escrita deste script: o INSERT fixo do arquivo, idempotente
  // por ON CONFLICT DO NOTHING.
  await chamarEscrita({ ref, token, query: insertUnico });
  console.log(
    `Ledger ${faixa} gravado (ou já estava — ON CONFLICT DO NOTHING).`,
  );

  const verificacao = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20261172000000' AND '20261178999999' ORDER BY version;`;
  const corpo = await chamarLeitura({ ref, token, query: verificacao });
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

  let ref;
  try {
    ref = resolverRef(process.env.PROJETO || "loja");
  } catch (erro) {
    console.error("FALHOU:", erro.message);
    process.exit(1);
    return;
  }

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

// Sobre o GitHub Environment "banco-da-loja" com revisor obrigatório
// (sugestão da revisão da rodada 2): NÃO foi adicionado. Motivo medido, não
// preferência: quando um workflow referencia um `environment:` que ainda
// não existe no repositório, o GitHub Actions CRIA um automaticamente, SEM
// nenhuma regra de proteção, e o job SEGUE RODANDO na hora — não falha
// fechado. (Vários relatos de bypass exatamente por isso: nome digitado
// errado ou ambiente nunca criado vira "sem revisor nenhum", em silêncio,
// e quem olha o YAML acha que há uma trava.) Colocar `environment:
// banco-da-loja` aqui SEM o dono já ter criado o ambiente manualmente em
// Settings → Environments (com ele mesmo como revisor obrigatório) daria
// uma falsa sensação de trava: o primeiro `GRAVAR` rodaria direto, sem
// aprovação nenhuma, e o YAML pareceria dizer o contrário. Preferi não
// escrever uma proteção que só funciona depois de um passo manual que este
// PR não força — a pré-checagem de schema (`conferirAntesDeGravar`) é a
// trava que já vale a partir deste commit, sem pré-requisito. Se o dono
// quiser o Environment depois de criar/configurar em Settings →
// Environments, é um `environment: banco-da-loja` de uma linha no job
// `ledger`.

// Exportado para tests/ci_conferir_banco_test.ts. O guarda acima existe pelo
// mesmo motivo do scripts/db-apply.cjs: sem ele, importar o módulo chamaria
// a Management API de verdade.
module.exports = {
  REFS_POR_PROJETO,
  resolverRef,
  listarConsultas,
  dividirEmStatements,
  contarStatements,
  comGuardaSomenteLeitura,
  extrairLinhas,
  formatarTabela,
  resumoDeBackups,
  chamarManagementApi,
  chamarLeitura,
  chamarEscrita,
  buscarBackups,
  conferirAntesDeGravar,
  main,
  CONSULTAS_DIR,
};
