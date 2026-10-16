#!/usr/bin/env node
/**
 * Roda, sob demanda e SÓ LEITURA, as conferências de pré/pós-publicação que
 * o `docs/runbooks/publicar-painel-cartao-devolucoes.md` (§0/§1) descrevia
 * como "cole no SQL Editor" — e o registro do ledger
 * (`supabase_migrations.schema_migrations`) para as faixas 72-74, 75-78 e
 * 79-82.
 * Chamado por `.github/workflows/conferir-banco-da-loja.yml`.
 *
 * USO (variáveis de ambiente, o mesmo estilo de aplicar-migrations.yml):
 *   SUPABASE_ACCESS_TOKEN  o segredo do repositório (o mesmo que publica
 *                          as functions e aplica migrations).
 *   PROJETO                "loja" (default), "sandbox", "ikcous-publicada" (a
 *                          CAF explícita) ou "savy" (a loja cliente explícita)
 *                          — NUNCA um ref cru. Resolvido para o ref de 20
 *                          letras por `resolverRef` (ver abaixo, achado da
 *                          rodada 2). A CAF usa SÓ SUPABASE_ACCESS_TOKEN_IKCOUS
 *                          e a Savy SÓ SUPABASE_ACCESS_TOKEN_SAVY (sem
 *                          fallback); nenhuma das duas roda o LEDGER, salvo a
 *                          faixa 92-202 (pré-checagem 8e obrigatória) e, SÓ na
 *                          CAF, a faixa 60-66 (pré-checagem 9a obrigatória).
 *   CONSULTA                nome (sem `.sql`) de um arquivo em
 *                          scripts/publicacao/consultas/, ou "backups".
 *   LEDGER                 "72-74", "75-78", "79-82", "83", "92-202" ou
 *                          "60-66" — pré-confere o schema, grava o ledger fixo
 *                          daquela faixa e confere 72-78 (ou 72-82/72-83/
 *                          72-202, para as faixas novas) depois. Mutuamente
 *                          exclusivo com CONSULTA (o workflow só passa um). Em
 *                          `ikcous-publicada` e `savy` SÓ a faixa 92-202 (o
 *                          backfill das migrations 92..202 sem a 201), com a
 *                          pré-checagem da 8e obrigatória; a faixa 60-66 (o
 *                          backfill do REGISTRO das 20261160..20261166, cujo
 *                          efeito já está vivo na CAF) é SÓ de
 *                          `ikcous-publicada`, com a 9a por ROL FECHADO.
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
 *    engane o contador, o papel não tem GRANT direto de INSERT/UPDATE/DDL
 *    em tabela nenhuma. (Frase corrigida na rodada 3 — ver o item 3 de
 *    baixo: isto NÃO cobre função `SECURITY DEFINER` executável por
 *    PUBLIC, que escreve com o privilégio de QUEM CRIOU a função, não do
 *    papel que a chamou.)
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
 * revisor obrigatório): NÃO foi adicionado na rodada 2 — ver a nota grande
 * antes de `module.exports` no fim deste arquivo. A re-revisão da rodada 3
 * confirmou que a premissa ("ambiente inexistente falha fechado") estava
 * ERRADA — GitHub Actions cria o ambiente na hora, sem proteção nenhuma —
 * então a decisão de NÃO adicionar continua de pé.
 *
 * REVISÃO DE RISCO DA RODADA 3 (26/09/2026) — o que mudou e por quê:
 *
 * 1. `concurrency` com a fila padrão (`queue: single`) CANCELA o run
 *    pendente, não enfileira: A aplica 72, B (73) e C (74) são disparados
 *    → B é cancelado e C aplica 74 sem 73 no meio. `queue: max` (até 100
 *    pendentes, processados em ordem) é compatível com
 *    `cancel-in-progress: false` — adicionado nos dois workflows
 *    (`conferir-banco-da-loja.yml` e `aplicar-migrations.yml`).
 *
 * 2. A pré-checagem de 75-78 tratava dado ao vivo como estrutura: "75
 *    política padrão" (1a) — o dono pode mudar os prazos de devolução em
 *    Ajustes — e "76 cartão nasce desligado" (1a) — vira `false` DE
 *    PROPÓSITO depois do passo 6 do runbook (ligar o cartão). As duas
 *    entraram em `IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER`, mesmo motivo da linha
 *    das "3 formas" (2b).
 *
 * 3. O papel `supabase_read_only_user` sozinho NÃO barra uma função
 *    `SECURITY DEFINER` executável por PUBLIC que escreve — medido: uma
 *    `SELECT public.<funcao_definer_que_grava>()` roda com o privilégio de
 *    QUEM CRIOU a função (o dono do schema), não do papel que chamou o
 *    SELECT. O texto do item 3 acima foi corrigido para não prometer mais
 *    do que o papel entrega. Nova consulta,
 *    `4a-definer-alcancavel-pelo-leitor.sql`: lista (só o nome) toda
 *    função `SECURITY DEFINER` em `public` que `supabase_read_only_user`
 *    consegue executar — esperado 0 linhas; roda por conta do operador
 *    (não faz parte de nenhum fluxo automático, porque a defesa de
 *    verdade é revisar `GRANT`/`SECURITY DEFINER` na hora de escrever a
 *    função, não uma varredura periódica).
 *
 * 4. O lexer ainda divergia em 4 casos além dos P1-P4 (rodada 2):
 *    identificador terminado em `e`/`E` colado numa string (o `E` do meio
 *    de "name" não abre string estendida — só abre se o caractere ANTES do
 *    E/e não for de identificador), `$` depois de um símbolo não-ASCII ou
 *    de uma letra fora do BMP, e tag de dollar-quote sem ser letra Unicode
 *    "de verdade" (a regra do Postgres é bem mais simples: todo code point
 *    ≥ U+0080 conta como caractere de identificador/tag — não só os que a
 *    categoria Unicode chama de "letra"). Corrigido em
 *    `ehCaractereDeIdentificador` e na regex de tag. Além disso, o INSERT
 *    do ledger agora tem o SHA-256 pinado (`SHA256_DO_LEDGER`,
 *    `conferirHashDoLedger`) — o caminho de escrita não tem o papel
 *    restrito como rede de segurança, então não pode depender só da
 *    contagem de statements, que a experiência destas 3 rodadas mostrou
 *    que nunca fica garantidamente completa contra SQL adversarial.
 *
 * 5. `docs/runbooks/publicar-painel-cartao-devolucoes.md`: `projeto_ref`
 *    trocado por `projeto: loja` (o texto antigo sobrevivia como instrução
 *    obsoleta) + nota de que disparar pela API com `projeto_ref` depois
 *    do merge da rodada 2 dá 422 (o input não existe mais).
 *
 * REVISÃO DE RISCO DA RODADA 4 (26/09/2026) — "passa" para produção, com um
 * achado de código: `4a-definer-alcancavel-pelo-leitor.sql` (item 3 acima)
 * só olhava o schema `public` — o revisor provou que uma função `SECURITY
 * DEFINER` concedida a `PUBLIC` em QUALQUER OUTRO schema (ex.: um schema de
 * extensão) TAMBÉM escreve quando o papel de leitura a chama. A consulta
 * passou a varrer todo schema (menos `pg_catalog`/`information_schema`,
 * sistema do próprio Postgres) e a projetar `schema.função`, em vez de só
 * o nome. Ganhou também uma linha sentinela para "o papel não existe neste
 * projeto" (`to_regrole(...) IS NULL`) — sem ela, "0 linhas" seria ambíguo
 * entre "nada alcançável" (bom) e "não dava pra saber" (o resultado não
 * provava nada). Os dois outros achados da rodada foram fora de código:
 * `queue: max` nos dois workflows (validado contra o schema oficial do
 * GitHub Actions) e a fusão com o branch que trouxe a migration 80/81 e o
 * fix irmão de `projeto_ref` em `aplicar-migrations.yml`.
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
const crypto = require("node:crypto");

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
const FAIXAS_DE_LEDGER = ["72-74", "75-78", "79-82", "83", "92-202", "60-66"];
/** A ÚNICA faixa do ledger permitida nas lojas explícitas (`ikcous-publicada` e
 * `savy`) — 06/10/2026. A regra de antes ("a CAF não grava o ledger") continua
 * valendo para as faixas 72..83; esta é o BACKFILL das 9 migrations
 * 20261192..20261202 (sem a 201) que o apply central já deixa registradas daqui
 * para a frente, mas que na CAF subiram antes disso. Só vale com a pré-checagem
 * da 8e (todas as linhas ok=true, feita ANTES do INSERT em `rodarLedger`) e com
 * o INSERT fixo e pinado por SHA-256. */
const FAIXA_LEDGER_DAS_LOJAS_EXPLICITAS = "92-202";
/** A faixa 60-66 do ledger (06/10/2026): o backfill do REGISTRO das 7 migrations
 * 20261160..20261166, cujo efeito já está VIVO na CAF (o ledger salta de
 * 20261150 para 20261167). É SÓ de `ikcous-publicada`: nem `savy` (o ledger dela
 * não tem esse buraco) nem `loja`/`sandbox`/lojas de teste. Nunca aplica nada —
 * só grava as 7 linhas, depois da 9a toda ok=true, por ROL FECHADO. */
const FAIXA_LEDGER_SO_DA_CAF = "60-66";
/** O MAPA das faixas de ledger que cada loja explícita aceita (D4). Fora dele
 * (`loja`, `sandbox`, lojas de teste e qualquer outro alvo) nenhuma das duas. */
const FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA = {
  "ikcous-publicada": [
    FAIXA_LEDGER_DAS_LOJAS_EXPLICITAS,
    FAIXA_LEDGER_SO_DA_CAF,
  ],
  savy: [FAIXA_LEDGER_DAS_LOJAS_EXPLICITAS],
};

/** Os únicos dois projetos que este token alcança (mesmos refs de
 * `publicar-functions.yml`). Nunca aceitar um terceiro valor aqui: é isso
 * que fecha a injeção de `projeto_ref` da rodada 2 da revisão. */
const REFS_POR_PROJETO = {
  loja: "cafkrminfnokvgjqtkle",
  sandbox: "lofznuxcvezrhxsgjqyg",
  // O alvo CAF EXPLÍCITO (04/10/2026): o mesmo ref de `loja`, mas pelo segredo
  // de NOME `SUPABASE_ACCESS_TOKEN_IKCOUS` (o que publicar-functions.yml já usa
  // para a CAF) e só com `expected_sha` igual ao do run (conferido no workflow
  // ANTES de qualquer requisição). `loja` e `sandbox` NÃO mudam de significado.
  "ikcous-publicada": "cafkrminfnokvgjqtkle",
  // O alvo SAVY EXPLÍCITO (06/10/2026): a loja cliente real, ref FIXO (nunca
  // texto livre), pelo segredo de NOME `SUPABASE_ACCESS_TOKEN_SAVY` (o que
  // publicar-functions.yml já usa para a Savy) e só com `expected_sha` igual ao
  // do run (conferido no workflow ANTES de qualquer requisição). Mesmas travas
  // da CAF explícita: só grava ledger na faixa 92-202 (com a 8e toda ok), 401/403 PARA.
  savy: "gnjsrucsmjkajijrakzr",
};

/** O alvo que exige o segredo próprio da CAF (e nunca cai em outro). */
const PROJETO_CAF = "ikcous-publicada";
const SEM_ACESSO_CAF =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
/** O alvo que exige o segredo próprio da Savy (e nunca cai em outro). */
const PROJETO_SAVY = "savy";
const SEM_ACESSO_SAVY =
  "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto";

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
    throw new Error(
      `projeto desconhecido: "${projeto}" (use loja, sandbox, ikcous-publicada ou savy)`,
    );
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
/**
 * A regra real do Postgres para identificador/tag de dollar-quote: letra
 * ASCII, dígito, `_`, `$`, OU **qualquer code point ≥ U+0080** — não só
 * "letra Unicode" (`\p{L}`). É por isso que `€` (símbolo, categoria "Sc",
 * não "L") e `𝑥` (letra fora do BMP) contam como caractere de identificador
 * para o Postgres, mas não contavam para `\p{L}` (achados P6/P8 da rodada
 * 3). `codePointAt(0)` funciona certo mesmo se `ch` for só METADE de um par
 * substituto (surrogate) de um astral — ainda assim o valor numérico é
 * ≥ 0x80, então a checagem não precisa iterar por code point de verdade
 * para decidir "é caractere de identificador?", só para RECONHECER a tag
 * inteira (isso já é feito pela regex com a flag `u`, que trata pares
 * substitutos como um único code point).
 */
function ehCaractereDeIdentificador(ch) {
  if (!ch) return false;
  if (/[A-Za-z0-9_$]/.test(ch)) return true;
  return ch.codePointAt(0) >= 0x80;
}

/** Tag de dollar-quote: letra/`_` ASCII para abrir, dígito também para
 * continuar, OU `\P{ASCII}` (qualquer code point ≥ U+0080) nos dois casos —
 * `$€$` (achado P7, tag símbolo) e `$𝑥$` (tag fora do BMP) são tags
 * válidas para o Postgres, não só tag com letra Unicode "de verdade"
 * (`\p{L}` não bastava). Nomeada e declarada uma vez para o
 * `eslint-disable-next-line` de baixo mirar a linha certa mesmo depois de
 * o formatador reindentar o `.exec(...)` embutido. */
const PADRAO_TAG_DOLLAR_QUOTE =
  // eslint-disable-next-line security/detect-unsafe-regex -- grupo com um quantificador só, sem aninhamento; entrada é um .sql local desta pasta, nunca rede.
  /^\$((?:[A-Za-z_]|\P{ASCII})(?:[A-Za-z0-9_]|\P{ASCII})*)?\$/u;

function dividirEmStatements(sql) {
  const statements = [];
  let atual = "";
  let i = 0;
  const n = sql.length;
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
      //
      // O `E`/`e` só abre string estendida se ELE MESMO não for o rabo de
      // um identificador mais longo — sem checar o caractere ANTES do E/e,
      // `name'...'` (um identificador que por acaso termina em "e", colado
      // numa string) era lido como `nam` + E-string, e o escape de barra
      // passava a valer onde não devia (achado P5 da rodada 3).
      const anteriorDaQuote = i > 0 ? sql[i - 1] : "";
      const doisAntesDaQuote = i > 1 ? sql[i - 2] : "";
      const ehEString =
        /[Ee]/.test(anteriorDaQuote) &&
        !ehCaractereDeIdentificador(doisAntesDaQuote);
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
      // Um `$` colado depois de letra/dígito/`_`/`$`/qualquer code point
      // não-ASCII é parte do MESMO identificador (Postgres aceita isso em
      // identificador comum, só não como primeiro caractere) — `x$y$` é UM
      // identificador, não uma string delimitada; o mesmo vale para
      // `x€$a$` (símbolo não-ASCII, achado P6) e `𝑥$a$` (letra fora do
      // BMP, achado P8). Sem esta guarda, o `$` no meio era lido como
      // abertura de dollar-quote, o fechamento nunca era achado, e a
      // "string" engolia o resto do arquivo inteiro.
      const anterior = i > 0 ? sql[i - 1] : "";
      const dentroDeIdentificador = ehCaractereDeIdentificador(anterior);
      if (!dentroDeIdentificador) {
        const restante = sql.slice(i);
        const m = PADRAO_TAG_DOLLAR_QUOTE.exec(restante);
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

/** Teto de uma requisição à Management API (leitura ou escrita). */
const TEMPO_LIMITE_DA_REQUISICAO_MS = 120_000;

/** Erro de HTTP com o status à mão: o `main` precisa distinguir 401/403 (sem
 * acesso à CAF = PARADA, nunca outro segredo) de qualquer outra falha. */
function erroDeHttp(status, texto) {
  const erro = new Error(`HTTP ${status}: ${texto.slice(0, 500)}`);
  erro.status = status;
  return erro;
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
    // Sem isto uma resposta que nunca chega prendia o job até o timeout do
    // workflow, sem mensagem. Na ESCRITA o estouro vira "ESTADO DESCONHECIDO"
    // (`gravarUmaVez`): o servidor pode ter gravado mesmo assim.
    signal: AbortSignal.timeout(TEMPO_LIMITE_DA_REQUISICAO_MS),
  });
  const texto = await r.text();
  if (!r.ok) throw erroDeHttp(r.status, texto);
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
  if (!r.ok) throw erroDeHttp(r.status, corpo);
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
  // Linha para MÁQUINA (scripts/frota/publicar-release.mjs lê do log do run):
  // a evidência de prontidão de uma loja é "esta consulta, neste ref, neste
  // commit, N linhas, nenhuma ok=false". Só para consultas com coluna `ok`.
  const linhaVeredito = veredictoDaConsulta({
    consulta,
    ref,
    sha: process.env.GITHUB_SHA,
    linhas,
  });
  if (linhaVeredito) console.log(linhaVeredito);
}

/** `VEREDITO-CONSULTA consulta=… ref=… sha=… linhas=N ok_false=K ok_nao_booleano=J`, ou null sem coluna `ok`.
 * Nas consultas de ROL FECHADO (9a, 8e, 8k, 10a, 10b, 11a, 11b, 12a, 12b, 14a, 14b, 15a, 15b, 16a, 16b, 17a, 17b, 19a, 19b, 20a, 20b, 21a, 21b, 22a, 22b, 23a, 23b, 24a, 24b, 25a, 25b, 26a, 26b, 27a, 27b, 30a, 30b, 31a, 31b, 28a, 28b, 29a, 29b, 32a, 32b, 33a, 33b, 34a, 34b, 35a, 35b, 36a, 36b, 37a, 37b, 38a, 38b, 39a, 39b, 40a, 40b, 41a, 41b, 43a, 43b, 45a, 45b, 46a, 46b — `ROL_FECHADO_POR_CONSULTA`) a linha
 * ganha ` rol=ok` SÓ quando a resposta é EXATAMENTE o rol (colunas, itens, sem
 * faltar, repetir nem sobrar, `ok` booleano em todas); qualquer outra coisa sai
 * ` rol=invalido`, e o portão (`evidenciaDaProva`) nunca a trata como positiva. */
function veredictoDaConsulta({ consulta, ref, sha, linhas }) {
  const prefixo = `VEREDITO-CONSULTA consulta=${consulta} ref=${ref} sha=${sha || "local"}`;
  if (Object.hasOwn(ROL_FECHADO_POR_CONSULTA, consulta)) {
    const lista = Array.isArray(linhas) ? linhas : [];
    const estruturaOk =
      estruturaDoRolFechado(lista, ROL_FECHADO_POR_CONSULTA[consulta]) ===
        null && lista.every((l) => typeof l.ok === "boolean");
    const okFalse = lista.filter((l) => l && l.ok === false).length;
    const naoBooleano = lista.filter(
      (l) => !l || typeof l.ok !== "boolean",
    ).length;
    return `${prefixo} linhas=${lista.length} ok_false=${okFalse} ok_nao_booleano=${naoBooleano} rol=${estruturaOk ? "ok" : "invalido"}`;
  }
  if (!Array.isArray(linhas) || linhas.length === 0)
    return `${prefixo} linhas=0 ok_false=0 ok_nao_booleano=0`;
  if (!linhas.every((l) => l && Object.hasOwn(l, "ok"))) return null;
  const okFalse = linhas.filter((l) => l.ok === false).length;
  const naoBooleano = linhas.filter((l) => typeof l.ok !== "boolean").length;
  return `${prefixo} linhas=${linhas.length} ok_false=${okFalse} ok_nao_booleano=${naoBooleano}`;
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
  "79-82": ["6a-conferir-79-a-82"],
  83: ["7a-conferir-83"],
  // O backfill 92-202 só grava se a 8e (o corpo vivo de cada função que 92..202
  // definem + os objetos que criam) der ok=true em TODAS as linhas.
  "92-202": ["8e-conferir-92-a-202-aplicado"],
  // O backfill 60-66 só grava se a 9a devolver EXATAMENTE o rol fechado, todo
  // ok=true (`conferirRolFechado`). A forma do ledger NÃO é da 9a: `rodarLedger`
  // a lê e a confere à parte (`classificarLedgerDa60a66`).
  "60-66": ["9a-conferir-60-a-66-aplicado"],
};

/** Linhas que são dado AO VIVO da loja — mudam legitimamente com o tempo ou
 * com uma decisão do dono — e não uma checagem estrutural. Ignoradas na
 * pré-checagem do ledger (achado #2 da rodada 3: sem isto, ligar o cartão
 * no passo 6 do runbook, ou o dono mudar o prazo padrão de devolução, faz
 * a pré-checagem de 75-78 falhar para sempre, mesmo com o schema certo):
 *   - "loja existente com as 3 formas ligadas" (2b) — quais formas de
 *     pagamento a loja aceita hoje;
 *   - "75 política padrão" (1a) — os prazos (7/30/90) são o SEED, não uma
 *     trava: o dono pode mudar em Ajustes → Trocas e devoluções;
 *   - "76 cartão nasce desligado" (1a) — só é `true` ANTES do passo 6;
 *     depois de ligar o cartão, esta linha vira `false` OK. */
const IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER = new Set([
  "loja existente com as 3 formas ligadas",
  "75 política padrão",
  "76 cartão nasce desligado",
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
    if (Object.hasOwn(ROL_FECHADO_POR_CONSULTA, nomeConsulta)) {
      // ROL FECHADO (9a e 8e): ver `conferirRolFechado`. A MESMA tabela
      // (`ROL_FECHADO_POR_CONSULTA`) que o veredito da consulta usa.
      conferirRolFechado({
        faixa,
        nomeConsulta,
        linhas,
        rol: ROL_FECHADO_POR_CONSULTA[nomeConsulta],
      });
      continue;
    }
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

/**
 * O ROL FECHADO das consultas de pré-checagem das faixas 60-66 (9a) e 92-202
 * (8e): os itens que a consulta devolve, cada um UMA vez. A pré-checagem das
 * faixas 72..83 só recusa "0 linhas" ou `ok !== true` — para elas isso já
 * bastava e mudar o critério delas é fora de escopo. Para estas duas é FRACO:
 * uma resposta PARCIAL (faltam itens, mas os presentes são ok=true), uma linha
 * duplicada, um item desconhecido ou um `ok` que não é o booleano `true`
 * autorizariam gravar o ledger de uma faixa cujo efeito não foi provado inteiro.
 * Gravar registro de migration NÃO tem desfazer barato (o portão passa a
 * acreditar que a faixa está lá), por isso o critério aqui é o de lista fechada
 * — e a Savy vai usar a 92-202. Nenhum rótulo destes está em
 * `IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER` (as faixas de rol fechado nem consultam
 * essa lista). tests/banco/lote-60-66-viva.cjs prova, num Postgres real, que
 * cada rol é EXATAMENTE o que a consulta devolve; tests/ci_conferir_banco_test.ts
 * prova que cada item de rol existe no .sql.
 */
const ROL_DA_9A = [
  "acl buscar_por_codigo_barras",
  "acl get_admin_orders_cancelados_recentes",
  "acl get_admin_orders_paged",
  "acl registrar_venda_presencial",
  "assinatura get_admin_orders_paged",
  "atributos buscar_por_codigo_barras",
  "atributos get_admin_orders_cancelados_recentes",
  "atributos get_admin_orders_paged",
  "atributos get_product_recommendations",
  "atributos limpar_cotacoes_fora_da_janela",
  "atributos registrar_venda_presencial",
  "atributos upsert_store_config",
  "coluna marketplace_orders.canal",
  "coluna marketplace_orders.vendedor_id",
  "coluna product_variants.codigo_barras",
  "coluna produtos.codigo_barras",
  "controle: funcoes de public visiveis a este papel",
  "corpo final buscar_por_codigo_barras",
  "corpo final get_admin_orders_cancelados_recentes",
  "corpo final get_admin_orders_paged",
  "corpo final get_product_recommendations",
  "corpo final limpar_cotacoes_fora_da_janela",
  "corpo final registrar_venda_presencial",
  "corpo final upsert_store_config",
  "default de store_config.free_shipping_min",
  "fk marketplace_orders.vendedor_id",
  "gatilho shipping_quotes_cache_limpa_ao_gravar",
  "indice idx_marketplace_orders_presencial",
  "indice product_variants_codigo_barras_unico",
  "indice produtos_codigo_barras_unico",
  "indice shipping_quotes_cache_created_at_idx",
  "privilegio authenticated le produtos.codigo_barras",
  "restricao marketplace_orders_canal_check",
  "restricao shipping_quotes_cache_chave_unica",
  "sobrecargas buscar_por_codigo_barras",
  "sobrecargas get_admin_orders_cancelados_recentes",
  "sobrecargas get_admin_orders_paged",
  "sobrecargas get_product_recommendations",
  "sobrecargas limpar_cotacoes_fora_da_janela",
  "sobrecargas registrar_venda_presencial",
  "sobrecargas upsert_store_config",
  "vista vw_produtos_admin colunas",
  "vista vw_produtos_admin definicao",
  "vista vw_produtos_admin opcoes",
  "vista vw_produtos_public colunas",
  "vista vw_produtos_public definicao",
  "vista vw_produtos_public opcoes",
];
const ROL_DA_8E = [
  "coluna order_refunds.criada_sob_autorizacao existe",
  "coluna order_refunds.mp_chargeback_case_id existe",
  "coluna order_refunds.mp_chargeback_id existe",
  "coluna order_refunds.mp_chargeback_valor_do_caso existe",
  "coluna order_refunds.post_autorizado_em existe",
  "controle: funcoes de public visiveis a este papel",
  "corpo final admin_devolucao_concluir",
  "corpo final admin_devolucao_decidir",
  "corpo final admin_devolucao_liberar_vinculo_reverso",
  "corpo final admin_devolucao_reemitir_reembolso",
  "corpo final admin_devolucao_registrar",
  "corpo final admin_devolucao_reprovar",
  "corpo final admin_devolucoes_listar",
  "corpo final autorizar_post_do_estorno",
  "corpo final cancelar_pedido_com_cobranca",
  "corpo final confirmar_pagamento",
  "corpo final confirmar_retorno_do_produto",
  "corpo final crm_clientes",
  "corpo final crm_visao",
  "corpo final devolucao_detalhe",
  "corpo final devolucao_elegibilidade",
  "corpo final devolucoes_do_pedido",
  "corpo final ensure_role_protection",
  "corpo final fin_caixa_abrir",
  "corpo final fin_caixa_atual",
  "corpo final fin_caixa_fechar",
  "corpo final fin_caixa_historico",
  "corpo final fin_caixa_movimentar",
  "corpo final fin_categoria_salvar",
  "corpo final fin_categorias_listar",
  "corpo final fin_conta_salvar",
  "corpo final fin_contas_listar",
  "corpo final fin_dre",
  "corpo final fin_extrato",
  "corpo final fin_lancamento_baixar",
  "corpo final fin_lancamento_cancelar",
  "corpo final fin_lancamento_salvar",
  "corpo final fin_previstos",
  "corpo final fin_resumo",
  "corpo final get_admin_analytics_v2",
  "corpo final get_admin_customers_paged",
  "corpo final get_admin_orders_cancelados_recentes",
  "corpo final get_admin_orders_paged",
  "corpo final get_admin_user_detail",
  "corpo final get_category_analytics",
  "corpo final get_coupon_stats",
  "corpo final get_retention_rate",
  "corpo final get_segmented_push_count",
  "corpo final get_segmented_push_targets",
  "corpo final handle_profile_role_sync_to_auth",
  "corpo final is_admin_atual",
  "corpo final painel_inicio",
  "corpo final pedido__mudar_status",
  "corpo final pedido__saldo_a_estornar",
  "corpo final prevent_role_change",
  "corpo final registrar_contestacao_no_ledger",
  "corpo final registrar_estorno_externo_do_mp",
  "corpo final registrar_estorno_manual",
  "corpo final registrar_pagamento_recebido",
  "corpo final registrar_venda_presencial",
  "corpo final rls_admin_atual",
  "corpo final salvar_config_pagamento_cartao",
  "corpo final salvar_politica_de_devolucao",
  "corpo final save_store_identity",
  "corpo final solicitar_estorno",
  "corpo final update_order_status_atomic",
  "corpo final upsert_store_config",
  "indice uq_order_refunds_pedido_contestacao existe",
  "indice uq_order_refunds_pedido_refund_mp existe",
  "politica marketplace_order_history.order_history_select_policy existe",
  "politica marketplace_order_items.order_items_select_policy existe",
  "politicas de public que citam rls_admin_atual",
  "tabela contestacoes_decisao_final existe",
];
/** O rol da 8k (subtotal divergente, ou as duas tabelas VAZIAS PROVADAS): as 20
 * linhas que scripts/publicacao/consultas/8k-subtotal-divergente-ou-vazia-provada.sql
 * devolve, cada uma UMA vez, sempre as mesmas (com dados, sem dados ou com papel
 * cego). Diferente da 9a e da 8e ela NÃO serve de pré-checagem do ledger: é o
 * diagnóstico exigido antes do apply do lote 92-202 (`conferenciasAntesDoApply`),
 * e o portão só a aceita como POSITIVA com ` rol=ok` no veredito.
 * tests/banco/subtotal-vazia-provada-viva.cjs prova, num Postgres real, que este
 * rol é EXATAMENTE o que a consulta devolve. */
const ROL_DA_8K = [
  "  dos quais sem nenhum item",
  "controle: itens de pedido visiveis",
  "controle: pedidos visiveis",
  "marketplace_order_items.id: tipo",
  "marketplace_order_items.order_id: tipo",
  "marketplace_order_items.price: tipo",
  "marketplace_order_items.quantity: tipo",
  "marketplace_order_items: metadados do papel efetivo",
  "marketplace_order_items: relkind",
  "marketplace_order_items: row_security_active",
  "marketplace_order_items: select de tabela inteira",
  "marketplace_orders.id: tipo",
  "marketplace_orders.subtotal: tipo",
  "marketplace_orders: metadados do papel efetivo",
  "marketplace_orders: relkind",
  "marketplace_orders: row_security_active",
  "marketplace_orders: select de tabela inteira",
  "papel efetivo",
  "pedidos com soma dos itens diferente do subtotal",
  "vazia provada",
];
/** O rol da 10a (a prova de objetos do lote da migration 20261203000000, cupons
 * desligados não dão desconto — issue #645): as 21 linhas que
 * scripts/publicacao/consultas/10a-conferir-cupons-desligados-aplicado.sql devolve,
 * cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira
 * `AUSENTE` na própria linha, nunca some uma linha). Como a 8k, NÃO serve de
 * pré-checagem de ledger (o lote não tem backfill: é de apply normal): o portão a
 * lê como `consulta` do lote e só a aceita como POSITIVA ou NEGATIVA com ` rol=ok`.
 * tests/banco/cupons-desligados-portao-viva.cjs prova, num Postgres real, que este
 * rol é EXATAMENTE o que a consulta devolve. */
const ROL_DA_10A = [
  "controle: funcoes de public visiveis a este papel",
  "funcao do gatilho: EXECUTE para PUBLIC",
  "funcao do gatilho: EXECUTE para anon",
  "funcao do gatilho: EXECUTE para authenticated",
  "funcao do gatilho: SECURITY DEFINER",
  "funcao do gatilho: corpo (sha256)",
  "funcao do gatilho: linguagem e retorno",
  "funcao do gatilho: search_path",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: condicao WHEN",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: existe em marketplace_orders",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: funcao executada",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: habilitado",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: momento e evento",
  "indice marketplace_orders_chave_da_compra_unica: definicao",
  "indice marketplace_orders_chave_da_compra_unica: existe",
  "validate_coupon_secure_v2: EXECUTE para PUBLIC",
  "validate_coupon_secure_v2: EXECUTE para authenticated",
  "validate_coupon_secure_v2: SECURITY DEFINER",
  "validate_coupon_secure_v2: corpo (sha256)",
  "validate_coupon_secure_v2: search_path",
  "validate_coupon_secure_v2: sobrecargas",
];

/** O rol da 10b (a consulta de AUSÊNCIA do mesmo lote, `ausenciaConfirmadaPor`): as
 * 6 linhas que scripts/publicacao/consultas/10b-antes-cupons-desligados-gatilho-e-corpo.sql
 * devolve — o que o pré-voo da migration exige, lido ANTES de aplicar. */
const ROL_DA_10B = [
  "coluna marketplace_orders.coupon_id: existe",
  "coluna store_config.enable_coupons: existe",
  "controle: funcoes de public visiveis a este papel",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: ausente em marketplace_orders",
  "validate_coupon_secure_v2: corpo e o baseline (sha256)",
  "validate_coupon_secure_v2: sobrecargas",
];
/** O rol da 11a (a prova de objetos do lote da migration 20261204000000, a venda do
 * balcão se anula no mesmo dia): as 14 linhas que
 * scripts/publicacao/consultas/11a-conferir-anular-venda-presencial-aplicado.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente
 * vira `AUSENTE` na própria linha). Como a 10a, NÃO serve de pré-checagem de ledger
 * (o lote não tem backfill: é de apply normal). tests/banco/anular-venda-portao-viva.cjs
 * prova, num Postgres real, que este rol é EXATAMENTE o que a consulta devolve. */
const ROL_DA_11A = [
  "anular_venda_presencial: EXECUTE para PUBLIC",
  "anular_venda_presencial: EXECUTE para anon",
  "anular_venda_presencial: EXECUTE para authenticated",
  "anular_venda_presencial: EXECUTE para service_role",
  "anular_venda_presencial: SECURITY DEFINER",
  "anular_venda_presencial: corpo (sha256)",
  "anular_venda_presencial: linguagem e retorno",
  "anular_venda_presencial: search_path",
  "anular_venda_presencial: sobrecargas",
  "controle: funcoes de public visiveis a este papel",
  "dependencia devolver_estoque(uuid): existe",
  "dependencia fin__dia e fin__hoje: existem",
  "dependencia is_admin_atual(): existe",
  "dependencia pedido__mudar_status(...): existe",
];
/** O rol da 11b (a consulta de AUSÊNCIA do mesmo lote, `ausenciaConfirmadaPor`): as 8
 * linhas que scripts/publicacao/consultas/11b-antes-anular-venda-presencial-funcao-ausente.sql
 * devolve — o que o pré-voo da migration exige, lido ANTES de aplicar. */
const ROL_DA_11B = [
  "anular_venda_presencial: ausente",
  "colunas usadas: existem",
  "controle: funcoes de public visiveis a este papel",
  "dependencia devolver_estoque(uuid): existe",
  "dependencia fin__dia e fin__hoje: existem",
  "dependencia is_admin(): existe",
  "dependencia is_admin_atual(): corpo e o esperado (md5)",
  "dependencia pedido__mudar_status(...): corpo e o esperado (md5)",
  "tabelas usadas: existem",
];
/** O rol da 12a (a prova de objetos do lote das migrations 20261205000000 e
 * 20261206000000, o cupom preso diz quando a vaga volta e a vaga do pedido nunca
 * cobrado volta em 1 h): as 24 linhas que
 * scripts/publicacao/consultas/12a-conferir-cupom-preso-aplicado.sql devolve, cada uma
 * UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na
 * própria linha). Como a 10a e a 11a, NÃO serve de pré-checagem de ledger (o lote não
 * tem backfill: é de apply normal). A linha do job do cron diz `NAO VERIFICAVEL` (e
 * fica ok) só quando a RLS do cron.job vale para o papel (row_security_active) e ele
 * não vê job nenhum: ver o cabeçalho da consulta.
 * tests/banco/cupom-preso-portao-viva.cjs prova, num Postgres real, que este rol é
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_12A = [
  "controle: funcoes de public visiveis a este papel",
  "cupom__vaga_volta_em: EXECUTE para PUBLIC, anon, authenticated e service_role",
  "cupom__vaga_volta_em: corpo (sha256)",
  "cupom__vaga_volta_em: sobrecargas",
  "dependencia auth.uid(): existe",
  "dependencia devolver_uso_cupom(uuid): existe",
  "devolver_cupons_de_pedidos_mortos: EXECUTE para PUBLIC",
  "devolver_cupons_de_pedidos_mortos: EXECUTE para anon",
  "devolver_cupons_de_pedidos_mortos: EXECUTE para authenticated",
  "devolver_cupons_de_pedidos_mortos: SECURITY DEFINER",
  "devolver_cupons_de_pedidos_mortos: corpo (sha256)",
  "devolver_cupons_de_pedidos_mortos: search_path",
  "devolver_cupons_de_pedidos_mortos: sobrecargas",
  "donos da varredura e da RPC: EXECUTE no auxiliar",
  "job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo",
  "vaga_do_cupom_presa: EXECUTE para PUBLIC",
  "vaga_do_cupom_presa: EXECUTE para anon",
  "vaga_do_cupom_presa: EXECUTE para authenticated",
  "vaga_do_cupom_presa: EXECUTE para service_role",
  "vaga_do_cupom_presa: SECURITY DEFINER",
  "vaga_do_cupom_presa: corpo (sha256)",
  "vaga_do_cupom_presa: linguagem e retorno",
  "vaga_do_cupom_presa: search_path",
  "vaga_do_cupom_presa: sobrecargas",
];
/** O rol da 12b (a consulta de AUSÊNCIA do mesmo lote, `ausenciaConfirmadaPor`): as 10
 * linhas que scripts/publicacao/consultas/12b-antes-cupom-preso-funcoes-ausentes.sql
 * devolve — o que os pré-voos das duas migrations exigem, lido ANTES de aplicar. */
const ROL_DA_12B = [
  "colunas usadas: existem",
  "controle: funcoes de public visiveis a este papel",
  "cupom__vaga_volta_em: ausente",
  "dependencia auth.uid(): existe",
  "dependencia devolver_uso_cupom(uuid): existe",
  "devolver_cupons_de_pedidos_mortos: corpo e o da 20260970 (sha256)",
  "devolver_cupons_de_pedidos_mortos: sobrecargas",
  "job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo",
  "tabelas usadas: existem",
  "vaga_do_cupom_presa: ausente",
];
/** O rol da 14a (a prova de objetos do lote da migration 20261207000000, o contador
 * duplicado do cupom morre — apaga `coupons.used_count`): as 4 linhas que
 * scripts/publicacao/consultas/14a-conferir-contador-duplicado-apagado.sql devolve, cada
 * uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na
 * própria linha). Como a 10a, a 11a e a 12a, NÃO serve de pré-checagem de ledger (o lote
 * não tem backfill: é de apply normal).
 * tests/banco/contador-duplicado-portao-viva.cjs prova, num Postgres real, que este rol é
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_14A = [
  "controle: funcoes de public visiveis a este papel",
  "coupons.usage_count: forma do baseline (integer, aceita NULL, DEFAULT 0)",
  "coupons.used_count: coluna",
  "public.coupons: tabela",
];
/** O rol da 14b (a consulta do ANTES do mesmo lote, `ausenciaConfirmadaPor`): as 13
 * linhas que scripts/publicacao/consultas/14b-antes-contador-duplicado-coluna-presente-e-zerada.sql
 * devolve — a condição em que o dono aprovou apagar (coluna PRESENTE e zerada, nada
 * dependendo dela), lida ANTES de aplicar. Aqui o "antes" é o contrário da 10b/11b/12b:
 * a coluna tem de EXISTIR. */
const ROL_DA_14B = [
  "controle: funcoes de public visiveis a este papel",
  "coupons.usage_count: forma do baseline (integer, aceita NULL, DEFAULT 0)",
  "coupons.used_count: coluna presente",
  "coupons.used_count: comentario proprio",
  "coupons.used_count: dependentes (fora o default da propria coluna)",
  "coupons.used_count: forma do baseline (integer, aceita NULL, DEFAULT 0)",
  "coupons.used_count: linhas com valor diferente de 0 (NULL conta)",
  "coupons.used_count: permissao propria por coluna (attacl)",
  "funcoes de qualquer schema que citam used_count",
  "gatilhos que citam used_count",
  "politicas de public que citam used_count",
  "public.coupons: a seguranca por linha vale para este papel",
  "visoes de public que citam used_count",
];
/** O rol da 15a (a prova de objetos do lote da migration 20261208000000, o checkout mostra os cupons
 * da cliente): as 37 linhas que scripts/publicacao/consultas/15a-conferir-cupons-do-checkout-aplicado.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na
 * própria linha, nunca some uma linha). Como a 10a, a 11a, a 12a e a 14a, NÃO serve de pré-checagem de
 * ledger (o lote não tem backfill: é de apply normal): o portão a lê como `consulta` do lote e só a
 * aceita como POSITIVA ou NEGATIVA com ` rol=ok`.
 * tests/banco/cupons-do-checkout-portao-viva.cjs prova, num Postgres real, que este rol é EXATAMENTE o
 * que a consulta devolve. */
const ROL_DA_15A = [
  "admin_cupom_clientes: EXECUTE",
  "admin_cupom_clientes: corpo (sha256)",
  "admin_cupom_clientes: forma",
  "admin_cupom_clientes: sobrecargas",
  "admin_cupom_definir_clientes: EXECUTE",
  "admin_cupom_definir_clientes: corpo (sha256)",
  "admin_cupom_definir_clientes: forma",
  "admin_cupom_definir_clientes: sobrecargas",
  "controle: funcoes de public visiveis a este papel",
  "coupons.alcance: CHECK coupons_alcance_check",
  "coupons.alcance: coluna (tipo, NOT NULL, default)",
  "cupom_clientes: colunas",
  "cupom_clientes: politicas (nome, comando, papeis)",
  "cupom_clientes: privilegios de PUBLIC",
  "cupom_clientes: privilegios de anon",
  "cupom_clientes: privilegios de authenticated",
  "cupom_clientes: regra da politica de leitura",
  "cupom_clientes: seguranca por linha (RLS) ligada",
  "cupons_do_checkout: EXECUTE",
  "cupons_do_checkout: corpo (sha256)",
  "cupons_do_checkout: forma",
  "cupons_do_checkout: sobrecargas",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: condicao WHEN",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: existe em marketplace_orders",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: funcao executada",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: habilitado",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: momento e evento",
  "gatilhos de cupom no pedido: ordem de disparo",
  "indice marketplace_orders_chave_da_compra_unica: definicao",
  "pedido_com_cupom_so_nasce_para_a_lista: EXECUTE",
  "pedido_com_cupom_so_nasce_para_a_lista: corpo (sha256)",
  "pedido_com_cupom_so_nasce_para_a_lista: forma",
  "pedido_com_cupom_so_nasce_para_a_lista: sobrecargas",
  "validate_coupon_secure_v2: EXECUTE",
  "validate_coupon_secure_v2: corpo (sha256)",
  "validate_coupon_secure_v2: forma",
  "validate_coupon_secure_v2: sobrecargas",
];
/** O rol da 15b (a consulta de AUSÊNCIA do lote da migration 20261208000000,
 * `ausenciaConfirmadaPor`): as 15 linhas que
 * scripts/publicacao/consultas/15b-antes-cupons-do-checkout-pecas-ausentes.sql devolve — o que o
 * pré-voo da migration exige (colunas, funções do admin atual, gatilho da 20261203000000 ativo,
 * índice único da chave de compra, corpo da validação igual ao da 20261203000000) e a AUSÊNCIA de
 * tudo que ela cria, lidos ANTES de aplicar. Como a 10b/11b/12b, e ao contrário da 14b, o "antes"
 * aqui é a ausência dos objetos novos.
 * tests/banco/cupons-do-checkout-portao-viva.cjs prova, num Postgres real, que este rol é
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_15B = [
  "admin_cupom_clientes: funcao",
  "admin_cupom_definir_clientes: funcao",
  "colunas que as pecas da migration leem: existem",
  "controle: funcoes de public visiveis a este papel",
  "coupons.alcance: coluna",
  "coupons_alcance_check: constraint",
  "cupom_clientes: tabela",
  "cupons_do_checkout: funcao",
  "gatilho tr_pedido_com_cupom_exige_a_chave_ligada: ativo (BEFORE INSERT)",
  "gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: ausente em marketplace_orders",
  "indice marketplace_orders_chave_da_compra_unica: definicao",
  "is_admin, is_admin_atual e rls_admin_atual: existem",
  "pedido_com_cupom_so_nasce_para_a_lista: funcao",
  "validate_coupon_secure_v2: corpo e o da 20261203000000 (sha256)",
  "validate_coupon_secure_v2: sobrecargas",
];
/** O rol da 16a (a prova de objetos do lote das migrations 20261209000000 e 20261210000000, o cupom
 * do PIX anulado volta em minutos): as 32 linhas que
 * scripts/publicacao/consultas/16a-conferir-pix-anulado-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na própria linha, nunca some uma
 * linha). Como a 10a, a 11a, a 12a, a 14a e a 15a, NÃO serve de pré-checagem de ledger (o lote não tem
 * backfill: é de apply normal): o portão a lê como `consulta` do lote e só a aceita como POSITIVA ou
 * NEGATIVA com ` rol=ok`.
 * tests/banco/cupom-pix-anulado-portao-viva.cjs prova, num Postgres real, que este rol é EXATAMENTE o
 * que a consulta devolve. */
const ROL_DA_16A = [
  "controle: funcoes de public visiveis a este papel",
  "cupom__vaga_volta_em: EXECUTE para PUBLIC, anon, authenticated e service_role",
  "cupom__vaga_volta_em: assinatura",
  "cupom__vaga_volta_em: corpo (sha256)",
  "cupom__vaga_volta_em: forma",
  "cupom__vaga_volta_em: sobrecargas",
  "dependencia devolver_uso_cupom(uuid): existe",
  "devolver_cupons_de_pedidos_mortos: EXECUTE",
  "devolver_cupons_de_pedidos_mortos: corpo (sha256)",
  "devolver_cupons_de_pedidos_mortos: forma",
  "devolver_cupons_de_pedidos_mortos: sobrecargas",
  "donos da varredura e da RPC: EXECUTE no auxiliar",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: condicao WHEN",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: existe em marketplace_orders",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: funcao executada",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: habilitado",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: momento e evento",
  "job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo",
  "pedido__foto_da_cobranca_ao_cancelar: EXECUTE para PUBLIC, anon, authenticated e service_role",
  "pedido__foto_da_cobranca_ao_cancelar: corpo (sha256)",
  "pedido__foto_da_cobranca_ao_cancelar: forma",
  "pedido__foto_da_cobranca_ao_cancelar: sobrecargas",
  "pedido_cobranca_ao_cancelar: chave estrangeira",
  "pedido_cobranca_ao_cancelar: chave primaria",
  "pedido_cobranca_ao_cancelar: colunas (nome, tipo, NOT NULL, default)",
  "pedido_cobranca_ao_cancelar: politicas",
  "pedido_cobranca_ao_cancelar: privilegios de PUBLIC, anon, authenticated e service_role",
  "pedido_cobranca_ao_cancelar: seguranca por linha (RLS) ligada",
  "vaga_do_cupom_presa: EXECUTE",
  "vaga_do_cupom_presa: corpo (sha256)",
  "vaga_do_cupom_presa: forma",
  "vaga_do_cupom_presa: sobrecargas",
];
/** O rol da 16b (a consulta de AUSÊNCIA do lote das migrations 20261209000000 e 20261210000000,
 * `ausenciaConfirmadaPor`): as 14 linhas que
 * scripts/publicacao/consultas/16b-antes-pix-anulado-foto-ausente.sql devolve — o que os pré-voos das
 * duas migrations exigem (colunas de marketplace_orders, o auxiliar de 9 parâmetros, a RPC e a varredura
 * com os corpos das 20261205/20261206 e UMA sobrecarga cada, a função `devolver_uso_cupom`, o job de
 * 15 em 15 minutos ativo) e a AUSÊNCIA de tudo que a 20261209000000 cria (tabela, função e gatilho da foto), lidos ANTES
 * de aplicar. Como a 10b/11b/12b/15b, o "antes" aqui é a ausência dos objetos novos.
 * tests/banco/cupom-pix-anulado-portao-viva.cjs prova, num Postgres real, que este rol é EXATAMENTE o
 * que a consulta devolve. */
const ROL_DA_16B = [
  "controle: funcoes de public visiveis a este papel",
  "cupom__vaga_volta_em: assinatura",
  "cupom__vaga_volta_em: corpo e o da 20261206000000 (sha256)",
  "cupom__vaga_volta_em: sobrecargas",
  "dependencia devolver_uso_cupom(uuid): existe",
  "devolver_cupons_de_pedidos_mortos: corpo e o da 20261206000000 (sha256)",
  "devolver_cupons_de_pedidos_mortos: sobrecargas",
  "gatilho tr_pedido_foto_da_cobranca_ao_cancelar: ausente em marketplace_orders",
  "job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo",
  "marketplace_orders: colunas que o gatilho e as funcoes leem",
  "pedido__foto_da_cobranca_ao_cancelar: funcao",
  "pedido_cobranca_ao_cancelar: tabela",
  "vaga_do_cupom_presa: corpo e o da 20261205000000 (sha256)",
  "vaga_do_cupom_presa: sobrecargas",
];
/** O rol da 17a (a prova de objetos do lote das migrations 20261212000000, 20261213000000 e
 * 20261214000000, o estoque do painel segue UMA regra: cada uma só troca o CORPO de UMA função): as 14
 * linhas que scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql devolve, cada uma
 * UMA vez, as mesmas em qualquer estado do banco (função ausente vira `AUSENTE` na própria linha, nunca
 * some uma linha) — por função (`get_admin_analytics_v2`, `get_admin_products_paged`, `painel_inicio`)
 * sobrecargas, forma, corpo e EXECUTE, mais o controle e as colunas. Como a 10a/11a/12a/14a/15a/16a, NÃO
 * serve de pré-checagem de ledger (o lote não tem backfill: é de apply normal): o portão a lê como
 * `consulta` do lote e só a aceita como POSITIVA ou NEGATIVA com ` rol=ok`.
 * tests/banco/estoque-do-painel-portao-viva.cjs prova, num Postgres real, que este rol é EXATAMENTE o
 * que a consulta devolve. */
const ROL_DA_17A = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: EXECUTE",
  "get_admin_analytics_v2: corpo e o da 20261214000000 (sha256)",
  "get_admin_analytics_v2: forma",
  "get_admin_analytics_v2: sobrecargas",
  "get_admin_products_paged: EXECUTE",
  "get_admin_products_paged: corpo e o da 20261213000000 (sha256)",
  "get_admin_products_paged: forma",
  "get_admin_products_paged: sobrecargas",
  "painel_inicio: EXECUTE",
  "painel_inicio: corpo e o da 20261212000000 (sha256)",
  "painel_inicio: forma",
  "painel_inicio: sobrecargas",
  "produtos e product_variants: colunas que os corpos novos leem",
];
/** O rol da 17b (a consulta de AUSÊNCIA do lote das migrations 20261212000000, 20261213000000 e
 * 20261214000000, o estoque do painel segue UMA regra; `ausenciaConfirmadaPor`): as 11 linhas que
 * scripts/publicacao/consultas/17b-antes-estoque-do-painel-corpos-vigentes.sql devolve — o que os
 * pré-voos das três migrations exigem (o corpo VIGENTE de antes de `get_admin_analytics_v2` e
 * `painel_inicio`, o da 20261199000000, e de `get_admin_products_paged`, o da baseline; UMA sobrecarga
 * cada), o EXECUTE que o CREATE OR REPLACE preserva (só authenticated) e as colunas de `produtos` e
 * `product_variants` que os trechos novos leem, lidos ANTES de aplicar. Ao contrário da 10b/11b/12b/15b/16b,
 * o "antes" aqui não é a ausência de objeto novo: é o corpo velho de cada função (o lote só troca corpos).
 * tests/banco/estoque-do-painel-portao-viva.cjs prova, num Postgres real, que este rol é EXATAMENTE o
 * que a consulta devolve. */
const ROL_DA_17B = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: EXECUTE",
  "get_admin_analytics_v2: corpo e o da 20261199000000 (sha256)",
  "get_admin_analytics_v2: sobrecargas",
  "get_admin_products_paged: EXECUTE",
  "get_admin_products_paged: corpo e o da 20260806000000 (sha256)",
  "get_admin_products_paged: sobrecargas",
  "painel_inicio: EXECUTE",
  "painel_inicio: corpo e o da 20261199000000 (sha256)",
  "painel_inicio: sobrecargas",
  "produtos e product_variants: colunas que os corpos novos leem",
];
/** O rol da 19a (a prova de objetos do lote da migration 20261215000000, a politica de devolucao nao
 * mostra quem a editou — achado L): as 9 linhas que
 * scripts/publicacao/consultas/19a-conferir-politica-devolucao-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (tabela ausente vira `AUSENTE` na propria linha, papel inexistente vira
 * `papel ausente`, nunca some uma linha): o controle (16 colunas), a RLS com a politica publica de SELECT,
 * `service_role` com SELECT da tabela inteira e, para `anon` e `authenticated`, SEM SELECT da tabela
 * inteira, SEM SELECT em `updated_by` e 15 de 16 colunas legiveis. Como a 10a/11a/12a/14a/15a/16a/17a, NAO
 * serve de pre-checagem de ledger (o lote nao tem backfill): o portao a le como `consulta` do lote e so a
 * aceita como POSITIVA ou NEGATIVA com ` rol=ok`.
 * tests/banco/politica-devolucao-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_19A = [
  "anon: SELECT da tabela inteira",
  "anon: SELECT em updated_by",
  "anon: colunas legiveis",
  "authenticated: SELECT da tabela inteira",
  "authenticated: SELECT em updated_by",
  "authenticated: colunas legiveis",
  "controle: colunas de politica_devolucao visiveis a este papel",
  "politica_devolucao: RLS ligada com a politica publica de SELECT",
  "service_role: SELECT da tabela inteira",
];
/** O rol da 19b (a consulta de AUSENCIA do lote da migration 20261215000000; `ausenciaConfirmadaPor`): as 9
 * linhas que scripts/publicacao/consultas/19b-antes-politica-devolucao-grant-de-tabela.sql devolve, os MESMOS
 * itens da 19a com o esperado de ANTES — `anon` e `authenticated` com SELECT da tabela inteira, com SELECT em
 * `updated_by` e 16 de 16 colunas legiveis. Uma loja que ja tem a migration reprova aqui de proposito.
 * tests/banco/politica-devolucao-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_19B = [
  "anon: SELECT da tabela inteira",
  "anon: SELECT em updated_by",
  "anon: colunas legiveis",
  "authenticated: SELECT da tabela inteira",
  "authenticated: SELECT em updated_by",
  "authenticated: colunas legiveis",
  "controle: colunas de politica_devolucao visiveis a este papel",
  "politica_devolucao: RLS ligada com a politica publica de SELECT",
  "service_role: SELECT da tabela inteira",
];

/** O rol da 20a (a prova de objetos do lote da migration 20261216000000, o cliente apaga a foto de
 * devolucao que nao usou): as 6 linhas que
 * scripts/publicacao/consultas/20a-conferir-fotos-da-devolucao-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (politica ausente vira `AUSENTE` na propria linha, nunca some uma
 * linha): o controle do catalogo, a politica de DELETE do cliente (uma), so para `authenticated`, com as
 * pecas que a fazem segura (bucket, pasta do cliente, foto fora de uso), nenhuma outra politica de DELETE/ALL
 * alcancando o bucket, e as politicas de INSERT e SELECT do cliente no lugar. Como a 10a/11a/12a/14a/15a/16a/17a/19a, NAO serve de pre-checagem de ledger (o lote
 * nao tem backfill): o portao a le como `consulta` do lote e so a aceita como POSITIVA ou NEGATIVA com
 * ` rol=ok`. tests/banco/fotos-da-devolucao-portao-viva.cjs prova, num Postgres real, que este rol e
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_20A = [
  "controle: politicas de storage.objects visiveis a este papel",
  "devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso",
  "devolucoes: DELETE so para authenticated",
  "devolucoes: INSERT e SELECT do cliente seguem no lugar",
  "devolucoes: nenhuma outra politica DELETE/ALL alcanca o bucket",
  "devolucoes: politicas de DELETE do cliente",
];
/** O rol da 20b (a consulta de AUSENCIA do lote da migration 20261216000000; `ausenciaConfirmadaPor`): as 6
 * linhas que scripts/publicacao/consultas/20b-antes-fotos-da-devolucao-sem-delete.sql devolve, os MESMOS
 * itens da 20a com o esperado de ANTES (nenhuma politica de DELETE do cliente; INSERT e SELECT presentes).
 * Uma loja que ja tem a politica reprova aqui de proposito. tests/banco/fotos-da-devolucao-portao-viva.cjs
 * prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_20B = [
  "controle: politicas de storage.objects visiveis a este papel",
  "devolucoes: DELETE so no bucket, na pasta do cliente e fora da foto em uso",
  "devolucoes: DELETE so para authenticated",
  "devolucoes: INSERT e SELECT do cliente seguem no lugar",
  "devolucoes: nenhuma outra politica DELETE/ALL alcanca o bucket",
  "devolucoes: politicas de DELETE do cliente",
];
/** O rol da 21a (a prova de objetos do lote da migration 20261217000000, o e-mail da loja tem teto e o
 * codigo do convidado nao se queima): as 14 linhas que
 * scripts/publicacao/consultas/21a-conferir-teto-de-email-aplicado.sql devolve, cada uma UMA vez, as mesmas
 * em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha): o
 * controle do catalogo, corpo (sha256) e EXECUTE das seis funcoes do lote e a tabela de contadores com RLS e
 * sem privilegio para anon/authenticated. Como a 17a/19a/20a, NAO serve de pre-checagem de ledger (o lote
 * nao tem backfill): o portao a le como `consulta` do lote e so a aceita como POSITIVA ou NEGATIVA com
 * ` rol=ok`. tests/banco/teto-de-email-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE
 * o que a consulta devolve. */
const ROL_DA_21A = [
  "chave_do_destinatario: EXECUTE",
  "chave_do_destinatario: corpo e o da 20261217000000 (sha256)",
  "controle: funcoes de public visiveis a este papel",
  "email_da_loja_contadores: RLS ligada e nada para anon/authenticated",
  "generate_order_otp_v2: EXECUTE",
  "generate_order_otp_v2: corpo e o da 20261217000000 (sha256)",
  "get_orders_by_otp_v1: EXECUTE",
  "get_orders_by_otp_v1: corpo e o da 20261217000000 (sha256)",
  "get_orders_by_otp_v2: EXECUTE",
  "get_orders_by_otp_v2: corpo e o da 20261217000000 (sha256)",
  "reivindicar_email_de_confirmacao: EXECUTE",
  "reivindicar_email_de_confirmacao: corpo e o da 20261217000000 (sha256)",
  "reservar_vaga_de_email: EXECUTE",
  "reservar_vaga_de_email: corpo e o da 20261217000000 (sha256)",
];
/** O rol da 21b (a consulta de AUSENCIA do lote da migration 20261217000000; `ausenciaConfirmadaPor`): as 8
 * linhas que scripts/publicacao/consultas/21b-antes-teto-de-email-corpos-vigentes.sql devolve — como na 17b,
 * o "antes" e o corpo VIGENTE das tres funcoes que o lote troca (com o EXECUTE de sempre) e as colunas que
 * os corpos novos leem. Uma loja que ja tem a migration reprova aqui de proposito.
 * tests/banco/teto-de-email-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_21B = [
  "controle: funcoes de public visiveis a este papel",
  "generate_order_otp_v2: EXECUTE",
  "generate_order_otp_v2: corpo e o da 20260820000000 (sha256)",
  "get_orders_by_otp_v1: EXECUTE",
  "get_orders_by_otp_v1: corpo e o da 20261181000000 (sha256)",
  "pedidos, codigos e contas: colunas que os corpos novos leem",
  "reivindicar_email_de_confirmacao: EXECUTE",
  "reivindicar_email_de_confirmacao: corpo e o da 20260821000000 (sha256)",
];
/** O rol da 22a (a prova de objetos do lote 20261218000000 + 20261218000100 + 20261219000000, as
 * portas pequenas do banco): as 15 linhas que
 * scripts/publicacao/consultas/22a-conferir-portas-do-banco-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha): a politica de
 * public_profiles so para authenticated com a condicao do lote, o gatilho do teto da imagem do perfil
 * (definicao, corpo sha256 e EXECUTE fechado), o EXECUTE da contagem do push, a view do painel sem nada
 * para PUBLIC/anon, configuracoes e codigos sem nada para PUBLIC/anon/authenticated com a service_role
 * intacta, e anon/authenticated fora dos papeis predefinidos de leitura/escrita. Como a 21a, NAO serve
 * de pre-checagem de ledger (o lote nao tem backfill). tests/banco/portas-do-banco-portao-viva.cjs prova,
 * num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_22A = [
  "anon e authenticated: fora de pg_read_all_data e pg_write_all_data",
  "app_settings e otp_verifications: service_role le e grava",
  "app_settings: RLS ligada e nada para PUBLIC/anon/authenticated",
  "controle: funcoes de public visiveis a este papel",
  "get_segmented_push_count: EXECUTE",
  "get_segmented_push_count: corpo e o vigente (md5)",
  "otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated",
  "perfil_recusa_imagem_grande: EXECUTE fechado e sem SECURITY DEFINER",
  "perfil_recusa_imagem_grande: corpo e o da 20261218000000 (sha256)",
  "profiles: gatilho do teto da imagem ligado e com a definicao da 20261218000000",
  "public_profiles: RLS ligada",
  "public_profiles: condicao da politica e a da 20261219000000 (md5)",
  "public_profiles: politicas",
  "vw_produtos_admin: authenticated le e grava",
  "vw_produtos_admin: nada para PUBLIC/anon",
];
/** O rol da 22b (a consulta de AUSENCIA do lote das portas pequenas do banco; `ausenciaConfirmadaPor`):
 * as 11 linhas que scripts/publicacao/consultas/22b-antes-portas-do-banco-estado-vigente.sql devolve — o
 * estado VIGENTE medido nas duas lojas (a politica USING (true) para PUBLIC, sem o gatilho, a contagem do
 * push aberta e a view lida pelo anon), a porta rls_admin_atual() e as colunas que o lote le. SEM linha
 * de configuracoes e codigos: numa loja ja fechada o "antes" delas ja e o "depois". Uma loja que ja tem
 * o lote reprova aqui de proposito. tests/banco/portas-do-banco-portao-viva.cjs prova, num Postgres
 * real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_22B = [
  "controle: funcoes de public visiveis a este papel",
  "get_segmented_push_count: EXECUTE",
  "get_segmented_push_count: corpo e o da 20261199000000 (md5)",
  "perfil_recusa_imagem_grande: funcao",
  "perfis, avaliacoes e perguntas: colunas que o lote le",
  "profiles: gatilho do teto da imagem",
  "public_profiles: RLS ligada",
  "public_profiles: condicao da politica e a do baseline",
  "public_profiles: politicas",
  "rls_admin_atual: corpo da 20261197000000 (md5) e EXECUTE",
  "vw_produtos_admin: anon le",
];
/** O rol da 23a (a prova de objetos do lote 20261220000000, a consulta antiga de pedido por codigo
 * fecha para o visitante): as 5 linhas que
 * scripts/publicacao/consultas/23a-conferir-consulta-antiga-de-pedido-fechada.sql devolve, cada uma UMA
 * vez, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o corpo
 * e o EXECUTE da get_orders_by_otp_v1 (FECHADA para anon e authenticated, service_role sim) e da
 * get_orders_by_otp_v2 (ABERTA). tests/banco/consulta-antiga-de-pedido-portao-viva.cjs prova, num
 * Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_23A = [
  "controle: funcoes de public visiveis a este papel",
  "get_orders_by_otp_v1: corpo e o da 20261217000000 (md5)",
  "get_orders_by_otp_v1: EXECUTE fechado para anon e authenticated",
  "get_orders_by_otp_v2: corpo e o da 20261217000000 (md5)",
  "get_orders_by_otp_v2: EXECUTE aberto para anon e authenticated",
];
/** O rol da 23b (a consulta de AUSENCIA do lote da consulta antiga de pedido; `ausenciaConfirmadaPor`):
 * as 5 linhas que scripts/publicacao/consultas/23b-antes-consulta-antiga-de-pedido-aberta.sql devolve — a
 * base de antes: a 20261217000000 aplicada (corpos), a v1 ABERTA como sempre e a v2 aberta. Uma loja que
 * ja tem o corte reprova aqui de proposito, na linha de EXECUTE da v1. */
const ROL_DA_23B = [
  "controle: funcoes de public visiveis a este papel",
  "get_orders_by_otp_v1: corpo e o da 20261217000000 (md5)",
  "get_orders_by_otp_v1: EXECUTE aberto para anon e authenticated",
  "get_orders_by_otp_v2: corpo e o da 20261217000000 (md5)",
  "get_orders_by_otp_v2: EXECUTE aberto para anon e authenticated",
];
/** O rol da 24a (a prova de objetos do lote 20261221000000, a media de avaliacoes e o voto "util" fecham
 * para o visitante): as 3 linhas que
 * scripts/publicacao/consultas/24a-conferir-avaliacoes-fechadas-ao-visitante.sql devolve, cada uma UMA
 * vez, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o EXECUTE
 * de get_reviews_metrics e de increment_helpful FECHADO para anon (authenticated e service_role sim, PUBLIC
 * nao). tests/banco/avaliacoes-fechadas-ao-visitante-portao-viva.cjs prova, num Postgres real, que este
 * rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_24A = [
  "controle: funcoes de public visiveis a este papel",
  "get_reviews_metrics: EXECUTE fechado para anon (authenticated e service_role sim)",
  "increment_helpful: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 24b (a consulta de AUSENCIA do lote das avaliacoes fechadas ao visitante;
 * `ausenciaConfirmadaPor`): as 3 linhas que
 * scripts/publicacao/consultas/24b-antes-avaliacoes-abertas-ao-visitante.sql devolve — a base de antes:
 * as duas funcoes ABERTAS a anon e authenticated (PUBLIC nao). Uma loja que ja tem o corte reprova aqui
 * de proposito, nas linhas de EXECUTE. */
const ROL_DA_24B = [
  "controle: funcoes de public visiveis a este papel",
  "get_reviews_metrics: EXECUTE aberto para anon e authenticated",
  "increment_helpful: EXECUTE aberto para anon e authenticated",
];
/** O rol da 25a (a prova de objetos do lote 20261222000000, a media de avaliacoes so responde ao
 * administrador): as 5 linhas que scripts/publicacao/consultas/25a-conferir-media-de-avaliacoes-so-admin.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria
 * linha): o corpo vivo e o NOVO (md5), ele exige is_admin() antes de ler as avaliacoes, os atributos de
 * sempre e o EXECUTE seguem FECHADOS ao visitante. tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs
 * prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_25A = [
  "controle: funcoes de public visiveis a este papel",
  "get_reviews_metrics: corpo e o da 20261222000000, com a guarda de admin (md5)",
  "get_reviews_metrics: o corpo exige is_admin() antes de ler as avaliacoes",
  "get_reviews_metrics: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "get_reviews_metrics: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 25b (a consulta de AUSENCIA do lote da media de avaliacoes so-admin; `ausenciaConfirmadaPor`):
 * as 4 linhas que scripts/publicacao/consultas/25b-antes-media-de-avaliacoes-sem-guarda.sql devolve — a base
 * de antes: o corpo e o da baseline (md5), sem a guarda, com os atributos de sempre. NAO mede a ACL (e' da 24a).
 * Uma loja que ja tem a guarda reprova aqui de proposito, nas linhas do corpo. */
const ROL_DA_25B = [
  "controle: funcoes de public visiveis a este papel",
  "get_reviews_metrics: corpo e o da baseline, sem a guarda de admin (md5)",
  "get_reviews_metrics: o corpo ainda NAO exige is_admin()",
  "get_reviews_metrics: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
];
/** O rol da 26a (a prova de objetos do lote 20261223000000, o voto util so vale em avaliacao que o publico
 * ve): as 5 linhas que scripts/publicacao/consultas/26a-conferir-voto-util-so-em-avaliacao-publica.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria
 * linha): o corpo vivo e o NOVO (md5), ele exige avaliacao publicada antes de gravar o voto, os atributos de
 * sempre e o EXECUTE seguem FECHADOS ao visitante.
 * tests/banco/voto-util-so-em-avaliacao-publica-portao-viva.cjs prova, num Postgres real, que este rol e
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_26A = [
  "controle: funcoes de public visiveis a este papel",
  "increment_helpful: corpo e o da 20261223000000, com a guarda de status (md5)",
  "increment_helpful: o corpo exige avaliacao publicada antes de gravar o voto",
  "increment_helpful: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "increment_helpful: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 26b (a consulta de AUSENCIA do lote do voto util; `ausenciaConfirmadaPor`): as 4 linhas que
 * scripts/publicacao/consultas/26b-antes-voto-util-sem-guarda-de-status.sql devolve — a base de antes: o corpo
 * e o da 20261050000000 (md5), sem a guarda de status, com os atributos de sempre. NAO mede a ACL (e' da 24a).
 * Uma loja que ja tem a guarda reprova aqui de proposito, nas linhas do corpo. */
const ROL_DA_26B = [
  "controle: funcoes de public visiveis a este papel",
  "increment_helpful: corpo e o da 20261050000000, sem a guarda de status (md5)",
  "increment_helpful: o corpo ainda NAO exige avaliacao publicada",
  "increment_helpful: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
];
/** O rol da 27a (a prova de objetos do lote 20261224000000, a avaliacao nasce sem a resposta da loja): as 6 linhas que
 * scripts/publicacao/consultas/27a-conferir-avaliacao-nasce-sem-resposta-da-loja.sql devolve, cada uma UMA vez, as mesmas
 * em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha): a funcao do gatilho tem o corpo da
 * migration (md5) e limpa as quatro colunas so fora do administrador, tem os atributos de sempre e esta FECHADA a
 * PUBLIC/anon/authenticated/service_role; e o gatilho existe (BEFORE INSERT por linha em public.reviews, ligado).
 * tests/banco/avaliacao-nasce-sem-resposta-da-loja-portao-viva.cjs prova, num Postgres real, que este rol e
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_27A = [
  "controle: funcoes de public visiveis a este papel",
  "avaliacao_nasce_sem_a_resposta_da_loja: corpo e o da 20261224000000 (md5)",
  "avaliacao_nasce_sem_a_resposta_da_loja: o corpo limpa as quatro colunas, so fora do administrador e da sessao direta",
  "avaliacao_nasce_sem_a_resposta_da_loja: atributos de sempre (SECURITY DEFINER, VOLATILE, retorna trigger, search_path=public)",
  "avaliacao_nasce_sem_a_resposta_da_loja: EXECUTE fechado a PUBLIC, anon, authenticated e service_role",
  "tr_avaliacao_nasce_sem_a_resposta_da_loja: BEFORE INSERT por linha em public.reviews, ligado, sem WHEN, chamando a funcao",
];
/** O rol da 27b (a consulta de AUSENCIA do lote da avaliacao sem resposta; `ausenciaConfirmadaPor`): as 6 linhas que
 * scripts/publicacao/consultas/27b-antes-avaliacao-aceita-resposta-forjada.sql devolve — a base de antes: a funcao e o
 * gatilho ainda nao existem e as pecas de que o apply depende (as quatro colunas, rls_admin_atual, o gatilho irmao do
 * selo) estao de pe. Uma loja que ja tem a funcao ou o gatilho reprova aqui de proposito. */
const ROL_DA_27B = [
  "controle: funcoes de public visiveis a este papel",
  "avaliacao_nasce_sem_a_resposta_da_loja: a funcao ainda NAO existe",
  "tr_avaliacao_nasce_sem_a_resposta_da_loja: o gatilho ainda NAO existe",
  "reviews: as quatro colunas que o gatilho reescreve, com os tipos de sempre",
  "rls_admin_atual(): existe e devolve boolean (20261197000000)",
  "tr_avaliacao_nasce_verificada: o gatilho irmao do selo (AFTER INSERT por linha em reviews) esta de pe",
];
/** O rol da 30a (a prova de objetos do lote 20261227000000 + 20261228000000, os numeros do painel: a taxa de
 * devolucao do CRM fala da mesma turma de vendas e o "Hoje" compara ate a mesma hora): as 9 linhas que
 * scripts/publicacao/consultas/30a-conferir-numeros-do-painel-aplicado.sql devolve, cada uma UMA vez, as mesmas
 * em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): para cada uma das duas funcoes
 * (crm_visao e painel_inicio), o corpo vivo e o NOVO (md5), ele traz o corte na mesma hora, os atributos de
 * sempre e o EXECUTE segue FECHADO ao visitante.
 * tests/banco/numeros-do-painel-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_30A = [
  "controle: funcoes de public visiveis a este papel",
  "crm_visao: corpo e o da 20261227000000, com a taxa da turma e o corte na mesma hora (md5)",
  "crm_visao: o corpo traz a turma de vendas e o corte na mesma hora",
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
  "crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)",
  "painel_inicio: corpo e o da 20261228000000, com a semana passada cortada na mesma hora (md5)",
  "painel_inicio: o corpo traz o corte na mesma hora",
  "painel_inicio: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
  "painel_inicio: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 30b (a consulta de AUSENCIA do lote dos numeros do painel; `ausenciaConfirmadaPor`): as 7 linhas
 * que scripts/publicacao/consultas/30b-antes-numeros-do-painel-corpos-vigentes.sql devolve - a base de antes:
 * crm_visao com o corpo da 20261199000000 e painel_inicio com o da 20261212000000 (md5), sem o corte na mesma
 * hora, com os atributos de sempre. NAO mede a ACL. Uma loja que ja tem um dos cortes reprova aqui de
 * proposito, nas linhas do corpo e do marcador daquela funcao. */
const ROL_DA_30B = [
  "controle: funcoes de public visiveis a este papel",
  "crm_visao: corpo e o da 20261199000000, sem o corte na mesma hora (md5)",
  "crm_visao: o corpo ainda NAO corta o anterior na mesma hora",
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
  "painel_inicio: corpo e o da 20261212000000, sem o corte na mesma hora (md5)",
  "painel_inicio: o corpo ainda NAO corta a semana passada na mesma hora",
  "painel_inicio: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
];
/** O rol da 33a (a prova de objetos do lote 20261232000000, a grade do CRM mede a recencia do mesmo instante da lista):
 * as 5 linhas que scripts/publicacao/consultas/33a-conferir-grade-do-crm-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o corpo vivo de crm_visao e o
 * NOVO (md5), ele mede o periodo ate agora (LEAST da meia-noite de amanha com now()), os atributos de sempre e o
 * EXECUTE segue FECHADO ao visitante.
 * tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que
 * a consulta devolve. */
const ROL_DA_33A = [
  "controle: funcoes de public visiveis a este papel",
  "crm_visao: corpo e o da 20261232000000, com a ancora de agora (md5)",
  "crm_visao: o corpo mede o periodo ate agora (LEAST da meia-noite de amanha com now())",
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
  "crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 33b (a consulta de AUSENCIA do lote da grade do CRM; `ausenciaConfirmadaPor`): as 4 linhas que
 * scripts/publicacao/consultas/33b-antes-grade-do-crm-corpo-vigente.sql devolve - a base de antes: crm_visao com o
 * corpo da 20261227000000 (md5), sem a ancora de agora, com os atributos de sempre. NAO mede a ACL. Uma loja que ja
 * tem a ancora de agora (ou que ainda esta no corpo da 20261199000000, sem a 27) reprova aqui de proposito, nas
 * linhas do corpo e do marcador. */
const ROL_DA_33B = [
  "controle: funcoes de public visiveis a este papel",
  "crm_visao: corpo e o da 20261227000000, sem a ancora de agora (md5)",
  "crm_visao: o corpo ainda NAO mede o periodo ate agora",
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
];
/** O rol da 31a (a prova de objetos do lote 20261229000000, o endereco da compra fica no pedido): as 9 linhas que
 * scripts/publicacao/consultas/31a-conferir-endereco-da-compra-fica-no-pedido.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o corpo vivo de create_
 * marketplace_order_v23 e v24 e o NOVO (md5), cada um copia o endereco da conta antes de gravar o pedido, os
 * atributos de sempre e o EXECUTE de sempre (PUBLIC nao; anon, authenticated e service_role sim).
 * tests/banco/endereco-no-pedido-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_31A = [
  "controle: funcoes de public visiveis a este papel",
  "create_marketplace_order_v23: corpo e o da 20261229000000, com a copia do endereco (md5)",
  "create_marketplace_order_v24: corpo e o da 20261229000000, com a copia do endereco (md5)",
  "create_marketplace_order_v23: o corpo copia o endereco da conta antes de gravar o pedido",
  "create_marketplace_order_v24: o corpo copia o endereco da conta antes de gravar o pedido",
  "create_marketplace_order_v23: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "create_marketplace_order_v23: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)",
  "create_marketplace_order_v24: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)",
];
/** O rol da 31b (a consulta de AUSENCIA do lote do endereco da compra; `ausenciaConfirmadaPor`): as 7 linhas que
 * scripts/publicacao/consultas/31b-antes-endereco-da-compra-so-no-ponteiro.sql devolve — a base de antes: os dois
 * corpos sao os da 20261174000000 (md5), sem a copia do endereco, com os atributos de sempre. NAO mede a ACL (e' da
 * 31a). Uma loja que ja tem a copia reprova aqui de proposito, nas linhas dos corpos. */
const ROL_DA_31B = [
  "controle: funcoes de public visiveis a este papel",
  "create_marketplace_order_v23: corpo e o da 20261174000000, sem a copia do endereco (md5)",
  "create_marketplace_order_v24: corpo e o da 20261174000000, sem a copia do endereco (md5)",
  "create_marketplace_order_v23: o corpo ainda NAO copia o endereco da conta",
  "create_marketplace_order_v24: o corpo ainda NAO copia o endereco da conta",
  "create_marketplace_order_v23: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
];
/** O rol da 28a (a prova de objetos do lote 20261225000000, o reembolso da devolucao so e' "liberado" quando o
 * dinheiro sai): as 8 linhas que scripts/publicacao/consultas/28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria
 * linha): os tres corpos vivos sao os NOVOS (md5), o aviso da conclusao segue o estado real do reembolso, os
 * atributos de sempre, o EXECUTE fechado e o gatilho novo de order_refunds ligado.
 * tests/banco/reembolso-da-devolucao-portao-viva.cjs prova, num Postgres real, que este rol e'
 * EXATAMENTE o que a consulta devolve. */
const ROL_DA_28A = [
  "controle: funcoes de public visiveis a este papel",
  "devolucao_avisa_o_cliente: corpo e o da 20261225000000, com o aviso pelo estado real do reembolso (md5)",
  "devolucao_avisa_o_cliente: o aviso da conclusao segue o estado real do reembolso",
  "devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5)",
  "devolucao_avisa_reembolso_liberado: corpo e o da 20261225000000 (md5)",
  "as tres funcoes: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "as tres funcoes: EXECUTE fechado (PUBLIC, anon e authenticated nao; a auxiliar nem service_role)",
  "tr_order_refunds_avisa_reembolso_liberado: ligado so na virada para concluido (AFTER UPDATE OF status, WHEN)",
];
/** O rol da 28b (a consulta de AUSENCIA do lote do reembolso da devolucao; `ausenciaConfirmadaPor`): as 5 linhas
 * que scripts/publicacao/consultas/28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao.sql devolve — a
 * base de antes: o corpo de devolucao_avisa_o_cliente e' o da 20261175000000 (md5), que avisa "liberado" na
 * conclusao, com os atributos de sempre, e as duas funcoes novas e o gatilho novo ainda NAO existem. Uma loja
 * que ja tem a migration reprova aqui de proposito. */
const ROL_DA_28B = [
  "controle: funcoes de public visiveis a este papel",
  "devolucao_avisa_o_cliente: corpo e o da 20261175000000, que avisa liberado na conclusao (md5)",
  "devolucao_avisa_o_cliente: o aviso da conclusao ainda NAO le o estado real do reembolso",
  "devolucao_avisa_o_cliente: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "as duas funcoes novas e o gatilho de order_refunds ainda NAO existem",
];
/** O rol da 29a (a prova de objetos do lote 20261226000000, a reemissao do reembolso consulta o Mercado Pago antes
 * de pagar de novo): as 9 linhas que scripts/publicacao/consultas/29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria
 * linha): os tres corpos vivos sao os da migration (md5), os atributos de sempre, o EXECUTE como deve (as duas de
 * servidor so do service_role; a do lojista so do authenticated), a tabela de diagnostico so do servidor e a
 * reemissao decidindo pelo diagnostico e pela consulta do MP, com o ator conferido nas duas fontes.
 * tests/banco/reemissao-do-reembolso-portao-viva.cjs prova, num Postgres real, que este rol e' EXATAMENTE o que a
 * consulta devolve. */
const ROL_DA_29A = [
  "controle: funcoes de public visiveis a este papel",
  "registrar_diagnostico_do_estorno: corpo e o da 20261226000000 (md5)",
  "reemitir_reembolso_da_devolucao: corpo e o da 20261226000000 (md5)",
  "admin_devolucao_reembolso_por_fora: corpo e o da 20261226000000 (md5)",
  "as tres funcoes: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "as duas funcoes de servidor: EXECUTE so do service_role (PUBLIC, anon e authenticated nao)",
  "admin_devolucao_reembolso_por_fora: EXECUTE so do authenticated (PUBLIC e anon nao)",
  "order_refund_diagnostico: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon e authenticated)",
  "reemitir_reembolso_da_devolucao: decide pelo diagnostico e pela consulta do MP e confere o ator nas duas fontes",
];
/** O rol da 29b (a consulta de AUSENCIA do lote da reemissao do reembolso; `ausenciaConfirmadaPor`): as 5 linhas
 * que scripts/publicacao/consultas/29b-antes-reemissao-do-reembolso-base-conhecida.sql devolve — a base de antes:
 * as tres funcoes novas e a tabela ainda NAO existem e as tres funcoes que a migration chama (concluir_estorno,
 * pedido__saldo_a_estornar, devolucao__avisar_reembolso da 20261225000000) tem o corpo conhecido. Uma loja que ja
 * tem a migration, ou que ainda nao tem o lote 28, reprova aqui de proposito. */
const ROL_DA_29B = [
  "controle: funcoes de public visiveis a este papel",
  "as tres funcoes novas e a tabela order_refund_diagnostico ainda NAO existem",
  "concluir_estorno: corpo e o conhecido da 2026110000100 (md5)",
  "pedido__saldo_a_estornar: corpo e o da 20261198000000 (md5)",
  "devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5; o lote 28 aplicado)",
];
/** O rol da 32a (a prova de objetos do lote 20261230000000 + 20261231000000, a busca de clientes: a tela Clientes, o balcao e o
 * cupom exclusivo acham pelo numero do WhatsApp; a aba Clientes do CRM ignora acento): as 9 linhas que
 * scripts/publicacao/consultas/32a-conferir-busca-de-clientes-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer
 * estado do banco (funcao ausente vira `AUSENTE` na propria linha): para cada uma das duas funcoes (get_admin_customers_paged e
 * crm_clientes), o corpo vivo e o NOVO (md5), ele traz a regra nova, os atributos de sempre e o EXECUTE segue FECHADO ao
 * visitante.
 * tests/banco/busca-de-clientes-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_32A = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_customers_paged: corpo e o da 20261230000000, com a busca por digitos do WhatsApp (md5)",
  "get_admin_customers_paged: o corpo traz os digitos do termo e o corte do 55",
  "get_admin_customers_paged: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, extensions)",
  "get_admin_customers_paged: EXECUTE fechado para anon (authenticated e service_role sim)",
  "crm_clientes: corpo e o da 20261231000000, com nome e e-mail sem acento (md5)",
  "crm_clientes: o corpo ignora o acento do nome",
  "crm_clientes: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
  "crm_clientes: EXECUTE fechado para anon (authenticated e service_role sim)",
];
/** O rol da 32b (a consulta de AUSENCIA do lote da busca de clientes; `ausenciaConfirmadaPor`): as 7 linhas que
 * scripts/publicacao/consultas/32b-antes-busca-de-clientes-corpos-vigentes.sql devolve - a base de antes: as duas funcoes com o
 * corpo da 20261199000000 (md5), sem a regra nova, com os atributos de sempre. NAO mede a ACL. Uma loja que ja tem uma das duas
 * reprova aqui de proposito, nas linhas do corpo e do marcador daquela funcao. */
const ROL_DA_32B = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_customers_paged: corpo e o da 20261199000000, sem a busca por digitos (md5)",
  "get_admin_customers_paged: o corpo ainda NAO calcula os digitos do termo",
  "get_admin_customers_paged: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, extensions)",
  "crm_clientes: corpo e o da 20261199000000, sem o acento ignorado (md5)",
  "crm_clientes: o corpo ainda NAO ignora o acento do nome",
  "crm_clientes: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)",
];
/** O rol da 35a (a prova de objetos da migration 20261234000000, o lucro so conta produto com custo: o grafico "Lucro acumulado" e
 * o "Top 5 produtos mais lucrativos" do CRM > Visao geral deixam de tratar produto sem custo como margem de 100%): as 6 linhas que
 * scripts/publicacao/consultas/35a-conferir-lucro-so-com-custo-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer estado
 * do banco (funcao ausente vira `AUSENTE` na propria linha): o controle, UMA so funcao, o corpo vivo e o NOVO (md5), ele traz a
 * regra nova, os atributos de sempre e o EXECUTE segue FECHADO ao visitante.
 * tests/banco/lucro-so-com-custo-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_35A = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: sobrecargas",
  "get_admin_analytics_v2: corpo e o da 20261234000000, com o lucro so de produto com custo (md5)",
  "get_admin_analytics_v2: o corpo so soma lucro de produto com custo e conta os sem custo",
  "get_admin_analytics_v2: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "get_admin_analytics_v2: EXECUTE fechado para anon (authenticated sim)",
];
/** O rol da 35b (a consulta de AUSENCIA do lote do lucro so com custo; `ausenciaConfirmadaPor`): as 5 linhas que
 * scripts/publicacao/consultas/35b-antes-lucro-so-com-custo-corpo-vigente.sql devolve - a base de antes: a funcao com o corpo da
 * 20261214000000 (md5), sem a regra nova, com os atributos de sempre. NAO mede a ACL. Uma loja que ja tem o corpo novo (ou ainda
 * esta no da 20261199000000) reprova aqui de proposito, nas linhas do corpo e do marcador. */
const ROL_DA_35B = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: sobrecargas",
  "get_admin_analytics_v2: corpo e o da 20261214000000, sem o lucro so de produto com custo (md5)",
  "get_admin_analytics_v2: o corpo ainda NAO conta os produtos sem custo",
  "get_admin_analytics_v2: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
];
/** O rol da 36a (a prova de objetos da migration 20261235000000, a venda repetida do balcao devolve a venda feita: a RPC do PDV
 * `registrar_venda_presencial` toma uma trava consultiva pela chave de idempotencia antes de conferir a chave): as 6 linhas que
 * scripts/publicacao/consultas/36a-conferir-venda-repetida-do-balcao-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer
 * estado do banco (funcao ausente vira `AUSENTE` na propria linha): o controle, UMA so funcao, o corpo vivo e o NOVO (md5), ele toma
 * a trava pela chave, os atributos de sempre e o EXECUTE so para authenticated (PUBLIC, anon e service_role sem).
 * tests/banco/venda-balcao-mesma-chave-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_36A = [
  "controle: funcoes de public visiveis a este papel",
  "registrar_venda_presencial: sobrecargas",
  "registrar_venda_presencial: corpo e o da 20261235000000, com a trava pela chave (md5)",
  "registrar_venda_presencial: o corpo toma a trava consultiva pela chave de idempotencia",
  "registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)",
  "registrar_venda_presencial: EXECUTE so para authenticated (PUBLIC, anon e service_role sem)",
];
/** O rol da 36b (a consulta de AUSENCIA do lote da venda repetida do balcao; `ausenciaConfirmadaPor`): as 5 linhas que
 * scripts/publicacao/consultas/36b-antes-venda-repetida-do-balcao-corpo-vigente.sql devolve - a base de antes: a funcao com o corpo
 * da 20261199000000 (md5), sem a trava pela chave, com os atributos de sempre. NAO mede a ACL (o pre-voo da migration a confere).
 * Uma loja que ja tem o corpo novo (ou num corpo que ninguem mediu) reprova aqui de proposito, nas linhas do corpo e do marcador. */
const ROL_DA_36B = [
  "controle: funcoes de public visiveis a este papel",
  "registrar_venda_presencial: sobrecargas",
  "registrar_venda_presencial: corpo e o da 20261199000000, sem a trava pela chave (md5)",
  "registrar_venda_presencial: o corpo ainda NAO toma a trava pela chave de idempotencia",
  "registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)",
];
/** O rol da 37a (a prova de objetos da migration 20261236000000, a compra que da R$ 0,00 nao se paga pelo app: a
 * `create_marketplace_order_v24` recusa, antes de gravar o pedido, de baixar o estoque e de gastar a vaga do cupom, o pedido de
 * pagamento pelo app cujo total calculado pelo servidor e zero): as 6 linhas que
 * scripts/publicacao/consultas/37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql devolve, cada uma UMA vez, as
 * mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o controle, UMA so funcao, o corpo vivo e o
 * NOVO (md5), ele traz a recusa, os atributos de sempre e o EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao).
 * tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE
 * o que a consulta devolve. */
const ROL_DA_37A = [
  "controle: funcoes de public visiveis a este papel",
  "create_marketplace_order_v24: sobrecargas",
  "create_marketplace_order_v24: corpo e o da 20261236000000, com a recusa do total zero pelo app (md5)",
  "create_marketplace_order_v24: o corpo recusa o pedido pelo app cujo total do servidor e zero",
  "create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "create_marketplace_order_v24: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)",
];
/** O rol da 37b (a consulta de AUSENCIA do lote da compra de zero reais; `ausenciaConfirmadaPor`): as 5 linhas que
 * scripts/publicacao/consultas/37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente.sql devolve - a base de antes: a
 * funcao com o corpo da 20261229000000 (md5), sem a recusa, com os atributos de sempre. NAO mede a ACL (o pre-voo da migration a
 * confere). Uma loja que ja tem o corpo novo (ou num corpo que ninguem mediu, p.ex. ainda no da 20261174000000) reprova aqui de
 * proposito, nas linhas do corpo e do marcador. */
const ROL_DA_37B = [
  "controle: funcoes de public visiveis a este papel",
  "create_marketplace_order_v24: sobrecargas",
  "create_marketplace_order_v24: corpo e o da 20261229000000, sem a recusa do total zero pelo app (md5)",
  "create_marketplace_order_v24: o corpo ainda NAO recusa o pedido pelo app cujo total do servidor e zero",
  "create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
];
/** O rol da 39a (a prova de objetos da migration 20261238000000, a cliente pede a exclusao da conta e a correcao do e-mail; DADO DE
 * CLIENTE): as 19 linhas que scripts/publicacao/consultas/39a-conferir-pedidos-de-privacidade-aplicado.sql devolve, cada uma UMA
 * vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha): o controle, a tabela inteira (colunas,
 * constraints e a regra de cada CHECK, a chave sem cascata, os dois indices), a RLS ligada com as tres politicas e a expressao delas,
 * os privilegios (PUBLIC e anon nenhum; authenticated so le a tabela e so escreve as colunas do pedido; service_role le, grava e
 * decide, NAO apaga), a funcao do gatilho (uma sobrecarga, corpo por md5, atributos, EXECUTE fechado ao visitante) e o gatilho.
 * tests/banco/pedidos-de-privacidade-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_39A = [
  "controle: funcoes de public visiveis a este papel",
  "pedidos_de_privacidade: colunas (nome, tipo, NOT NULL, default)",
  "pedidos_de_privacidade: as 8 constraints pelo nome",
  "pedidos_de_privacidade: a regra de cada CHECK (tipo, situacao, e-mail, carimbo, observacao)",
  "pedidos_de_privacidade: chave user_id -> auth.users, sem cascata",
  "uq_pedidos_de_privacidade_um_aberto: unico parcial, um pedido aberto por cliente e tipo",
  "idx_pedidos_de_privacidade_situacao_criado: a lista do painel",
  "pedidos_de_privacidade: seguranca por linha (RLS)",
  "pedidos_de_privacidade: as tres politicas (nome, comando, papel), nenhuma de DELETE",
  "pedidos_de_privacidade: a expressao de cada politica (a cliente so o dela, o admin de agora)",
  "pedidos_de_privacidade: PUBLIC e anon sem nenhum privilegio (tabela ou coluna)",
  "pedidos_de_privacidade: authenticated, privilegios de tabela",
  "pedidos_de_privacidade: authenticated, colunas que escreve",
  "pedidos_de_privacidade: service_role le, grava e decide, e NAO apaga",
  "pedidos_de_privacidade__carimbar: sobrecargas",
  "pedidos_de_privacidade__carimbar: corpo e o da 20261238000000 (md5)",
  "pedidos_de_privacidade__carimbar: atributos (SECURITY INVOKER, VOLATILE, search_path=public, trigger)",
  "pedidos_de_privacidade__carimbar: EXECUTE fechado ao visitante (PUBLIC, anon, authenticated)",
  "tr_pedidos_de_privacidade_carimbar: o unico gatilho, BEFORE UPDATE por linha, ligado",
];
/** O rol da 39b (a consulta de AUSENCIA do lote dos pedidos de privacidade; `ausenciaConfirmadaPor`): as 9 linhas que
 * scripts/publicacao/consultas/39b-antes-pedidos-de-privacidade-objetos-ausentes.sql devolve - a base de antes: a tabela, os dois
 * indices, a funcao do gatilho e o gatilho AUSENTES; auth.users, auth.uid() e rls_admin_atual() presentes; e o papel `postgres`
 * (o que aplica) com REFERENCES em auth.users (a chave estrangeira do pedido). Uma loja que ja tem a migration (inteira ou pela
 * metade) reprova aqui de proposito: a migration NASCE o objeto e nao e reaplicavel. */
const ROL_DA_39B = [
  "controle: funcoes de public visiveis a este papel",
  "pedidos_de_privacidade: tabela ausente",
  "pedidos_de_privacidade: os dois indices ausentes",
  "pedidos_de_privacidade__carimbar: funcao ausente (qualquer sobrecarga)",
  "tr_pedidos_de_privacidade_carimbar: gatilho ausente (em qualquer tabela)",
  "dependencia auth.users: existe",
  "dependencia auth.uid(): existe",
  "dependencia public.rls_admin_atual(): existe",
  "auth.users: o papel postgres (que aplica a migration) tem REFERENCES",
];
/** O rol da 40a (a prova de objetos da migration 20261239000000, a identidade legal da loja: razao social, CNPJ/CPF e e-mail de
 * atendimento, tres colunas novas e opcionais de store_config, lidas pela view v_store_config e gravadas por upsert_store_config): as 11
 * linhas que scripts/publicacao/consultas/40a-conferir-identidade-legal-da-loja-aplicado.sql devolve, cada uma UMA vez, as mesmas em
 * qualquer estado do banco (objeto ausente vira `AUSENTE` ou `nenhuma` na propria linha): o controle, UMA so funcao, o corpo vivo e o
 * NOVO (md5), os tres CASE no corpo, os atributos e o EXECUTE de sempre, as tres colunas (text, nulas, sem default), as tres CHECK de
 * forma, a view com as 45 colunas, as opcoes de sempre e o ACL de sempre (o que o rollback-manual so reproduz se for exatamente esse).
 * tests/banco/loja-declara-quem-e-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_40A = [
  "controle: funcoes de public visiveis a este papel",
  "upsert_store_config: sobrecargas",
  "upsert_store_config: corpo e o da 20261239000000, com razao social, documento e e-mail (md5)",
  "upsert_store_config: o corpo so grava razao social, documento e e-mail quando a chave vem no payload",
  "upsert_store_config: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "upsert_store_config: EXECUTE fechado para anon (authenticated sim)",
  "store_config: razao social, documento e e-mail sao text, nulos e sem default",
  "store_config: as tres CHECK de forma existem, validadas, cada uma na sua coluna",
  "v_store_config: as 45 colunas, as tres novas no fim",
  "v_store_config: opcoes de sempre (security_invoker=on)",
  "v_store_config: ACL de sempre (anon, authenticated e service_role com ALL, dono postgres, ninguem mais)",
];
/** O rol da 40b (a consulta de AUSENCIA do lote da identidade legal; `ausenciaConfirmadaPor`): as 10 linhas que
 * scripts/publicacao/consultas/40b-antes-identidade-legal-da-loja-base-vigente.sql devolve - a base de antes: a funcao com o corpo da
 * 20261199000000 (md5), sem os tres CASE novos, com os atributos de sempre; as tres colunas e as tres CHECK ainda ausentes; a view com
 * as 42 colunas, as opcoes de sempre e o ACL que o rollback-manual devolve (a FOTOGRAFIA do ACL vivo, antes do apply). NAO mede o EXECUTE
 * da funcao. Uma loja que ja tem a migration reprova aqui de proposito, nas linhas do corpo, do marcador, das colunas, das CHECK e da
 * lista de colunas da view. */
const ROL_DA_40B = [
  "controle: funcoes de public visiveis a este papel",
  "upsert_store_config: sobrecargas",
  "upsert_store_config: corpo e o da 20261199000000, sem razao social, documento e e-mail (md5)",
  "upsert_store_config: o corpo ainda NAO grava razao social, documento e e-mail",
  "upsert_store_config: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)",
  "store_config: razao social, documento e e-mail ainda NAO existem",
  "store_config: as tres CHECK de forma ainda NAO existem",
  "v_store_config: as 42 colunas de sempre",
  "v_store_config: opcoes de sempre (security_invoker=on)",
  "v_store_config: ACL que o rollback devolve (anon, authenticated e service_role com ALL, dono postgres, ninguem mais)",
];
/** O rol da 41a (a prova de objetos da migration 20261240000000, a cliente e avisada quando a loja responde a pergunta dela:
 * `answer_question_atomic` cria UM aviso no sino `notificacoes` de quem perguntou e deixa de gravar a linha falsa em
 * `push_notifications_log`): as 10 linhas que scripts/publicacao/consultas/41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha): o controle,
 * as DUAS sobrecargas e, em CADA uma, o corpo vivo e o NOVO (md5), ele avisa no sino e nao grava mais no log de push, os atributos
 * de sempre e o EXECUTE segue FECHADO ao visitante. `reply_review_atomic` NAO e medida (fica de fora da migration).
 * tests/banco/pergunta-respondida-avisa-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_41A = [
  "controle: funcoes de public visiveis a este papel",
  "answer_question_atomic: sobrecargas",
  "answer_question_atomic(uuid,text): corpo e o da 20261240000000, com o aviso no sino da cliente (md5)",
  "answer_question_atomic(uuid,text): o corpo avisa no sino e nao grava mais no log de push",
  "answer_question_atomic(uuid,text): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)",
  "answer_question_atomic(uuid,text): EXECUTE fechado para anon (authenticated sim)",
  "answer_question_atomic(uuid,text,uuid): corpo e o da 20261240000000, com o aviso no sino da cliente (md5)",
  "answer_question_atomic(uuid,text,uuid): o corpo avisa no sino e nao grava mais no log de push",
  "answer_question_atomic(uuid,text,uuid): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)",
  "answer_question_atomic(uuid,text,uuid): EXECUTE fechado para anon (authenticated sim)",
];
/** O rol da 41b (a consulta de AUSENCIA do lote da pergunta respondida; `ausenciaConfirmadaPor`): as 8 linhas que
 * scripts/publicacao/consultas/41b-antes-pergunta-respondida-corpos-vigentes.sql devolve - a base de antes: as DUAS sobrecargas, cada
 * uma com o corpo vigente (md5: o da 20261065000000 na de 2 argumentos, o da 20261064000000 na de 3), sem gravar no sino da cliente e
 * com os atributos de sempre. NAO mede a ACL. Uma loja que ja tem o aviso novo reprova aqui de proposito, nas linhas do corpo e do
 * marcador da funcao. */
const ROL_DA_41B = [
  "controle: funcoes de public visiveis a este papel",
  "answer_question_atomic: sobrecargas",
  "answer_question_atomic(uuid,text): corpo e o da 20261065000000, sem o aviso no sino da cliente (md5)",
  "answer_question_atomic(uuid,text): o corpo ainda NAO grava no sino da cliente",
  "answer_question_atomic(uuid,text): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)",
  "answer_question_atomic(uuid,text,uuid): corpo e o da 20261064000000, sem o aviso no sino da cliente (md5)",
  "answer_question_atomic(uuid,text,uuid): o corpo ainda NAO grava no sino da cliente",
  "answer_question_atomic(uuid,text,uuid): atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, void)",
];
/** O rol da 43a (a prova de objetos da migration 20261241000000, o reembolso em duvida prende o saldo: a linha de
 * reembolso que PODE ter saido no Mercado Pago passa a segurar o saldo, por UMA regra so; duas saidas de 7 dias para a
 * lojista; a tela le um contrato unico): as 21 linhas que scripts/publicacao/consultas/43a-conferir-reembolso-em-duvida-aplicado.sql
 * devolve, cada uma UMA vez, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha): o controle,
 * o corpo NOVO (md5) das doze funcoes, os atributos delas, o EXECUTE de cada papel (as duas regras so do servidor, as tres portas
 * novas so do logado, a antiga admin_devolucao_reemitir_reembolso fechada), a tabela de marcas so do servidor e com as tres
 * colunas, o marcador de que o saldo desconta o em duvida e o de que as saidas dos 7 dias e o painel leem a MESMA espera.
 * tests/banco/reembolso-em-duvida-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_43A = [
  "controle: funcoes de public visiveis a este papel",
  "order_refund__pode_ter_saido: corpo e o da 20261241000000, a regra unica (md5)",
  "order_refund__liberavel_apos_espera: corpo e o da 20261241000000, a espera dos 7 dias (md5)",
  "pedido__saldo_a_estornar: corpo e o da 20261241000000, com o em duvida (md5)",
  "solicitar_estorno: corpo e o da 20261241000000, a conta pela funcao de saldo (md5)",
  "admin_devolucao_concluir: corpo e o da 20261241000000, o ramo do app pela funcao de saldo (md5)",
  "autorizar_post_do_estorno: corpo e o da 20261241000000, recusa a linha liberada por fora (md5)",
  "reemitir_reembolso_da_devolucao: corpo e o da 20261241000000, pela regra unica (md5)",
  "admin_devolucao_reembolso_por_fora: corpo e o da 20261241000000, pela regra unica e marcando a substituida (md5)",
  "devolucao_avisa_o_cliente: corpo e o da 20261241000000, a loja esta confirmando com o Mercado Pago (md5)",
  "admin_devolucao_reembolso_por_fora_apos_espera: corpo e o da 20261241000000 (md5)",
  "registrar_estorno_manual_apos_espera: corpo e o da 20261241000000 (md5)",
  "pedido_reembolsos_e_saldo: corpo e o da 20261241000000 (md5)",
  "as doze funcoes: atributos do desenho (SECURITY DEFINER, search_path=public, linguagem e volatilidade de cada uma)",
  "as duas regras do servidor (pode_ter_saido e liberavel_apos_espera): EXECUTE fechado a todos (PUBLIC, anon, authenticated e service_role)",
  "as tres portas novas do lojista: EXECUTE so do authenticated (PUBLIC e anon nao)",
  "admin_devolucao_reemitir_reembolso: EXECUTE fechado ao logado e ao visitante (a antiga, sem chamador)",
  "order_refund_prova: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon, authenticated e service_role)",
  "order_refund_prova: as tres colunas do desenho (refund_id, substituida_por_manual_em, por_fora_liberado_em)",
  "pedido__saldo_a_estornar: desconta o em duvida pela regra unica e respeita a substituida por manual",
  "as duas saidas dos 7 dias e o painel: a mesma espera (order_refund__liberavel_apos_espera)",
];
/** O rol da 43b (a consulta de AUSENCIA do lote do reembolso em duvida; `ausenciaConfirmadaPor`): as 14 linhas que
 * scripts/publicacao/consultas/43b-antes-reembolso-em-duvida-base-vigente.sql devolve - a base de antes: a tabela de marcas e as
 * cinco funcoes novas ainda NAO existem; as SETE funcoes que a migration reescreve com o corpo vigente (md5) e os atributos de
 * sempre; as duas funcoes de dinheiro que ela chama com o corpo conhecido; a antiga admin_devolucao_reemitir_reembolso existe; o
 * gatilho do aviso da devolucao ligado. NAO mede a ACL. Uma loja que ja tem a migration reprova aqui de proposito. */
const ROL_DA_43B = [
  "controle: funcoes de public visiveis a este papel",
  "order_refund_prova e as cinco funcoes novas ainda NAO existem",
  "pedido__saldo_a_estornar: corpo e o vigente da 20261198000000, sem o em duvida (md5)",
  "solicitar_estorno: corpo e o vigente da 20261197000000 (md5)",
  "admin_devolucao_concluir: corpo e o vigente da 20261197000000 (md5)",
  "autorizar_post_do_estorno: corpo e o vigente da 20261196000000 (md5)",
  "reemitir_reembolso_da_devolucao: corpo e o vigente da 20261226000000 (md5)",
  "admin_devolucao_reembolso_por_fora: corpo e o vigente da 20261226000000 (md5)",
  "devolucao_avisa_o_cliente: corpo e o vigente da 20261225000000 (md5)",
  "as sete funcoes: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, linguagem, volatilidade e retorno)",
  "concluir_estorno: corpo e o conhecido da 2026110000100 (md5; a reemissao o chama)",
  "devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5; o por fora e a saida dos 7 dias o chamam)",
  "admin_devolucao_reemitir_reembolso(uuid, boolean) existe (a migration fecha o EXECUTE dela ao logado)",
  "tr_devolucao_avisa_o_cliente: ligado a devolucao_avisa_o_cliente",
];
/** O rol da 34a (a prova de objetos da migration 20261233000000, o sino do pedido de retirada fala de retirada): as 7 linhas que
 * scripts/publicacao/consultas/34a-conferir-sino-da-retirada-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer estado do
 * banco (funcao ausente vira `AUSENTE` na propria linha): o corpo vivo de notifica_cliente_de_mudanca_de_status e o NOVO (md5), ele traz
 * o texto da retirada e ainda o da entrega, os atributos de sempre, a trigger segue ligada a ele e a ACL e a de hoje.
 * tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_34A = [
  "controle: funcoes de public visiveis a este papel",
  "notifica_cliente_de_mudanca_de_status: corpo e o da 20261233000000, com o texto da retirada (md5)",
  "notifica_cliente_de_mudanca_de_status: o corpo traz o texto da retirada",
  "notifica_cliente_de_mudanca_de_status: o corpo ainda traz o texto da entrega",
  "notifica_cliente_de_mudanca_de_status: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, trigger)",
  "tr_pedido_avisa_o_cliente: segue ligada a funcao (AFTER UPDATE OF status, por linha)",
  "notifica_cliente_de_mudanca_de_status: EXECUTE como hoje (aberto por heranca do PUBLIC)",
];
/** O rol da 34b (a consulta de AUSENCIA do lote do sino da retirada; `ausenciaConfirmadaPor`): as 6 linhas que
 * scripts/publicacao/consultas/34b-antes-sino-da-retirada-corpo-vigente.sql devolve - a base de antes: a funcao com o corpo da
 * 20261026000000 (md5), sem o texto da retirada, com os atributos de sempre, a trigger ligada e a ACL de hoje. Uma loja que ja tem a
 * migration reprova aqui de proposito, nas linhas do corpo e do marcador. */
const ROL_DA_34B = [
  "controle: funcoes de public visiveis a este papel",
  "notifica_cliente_de_mudanca_de_status: corpo e o da 20261026000000, sem o texto da retirada (md5)",
  "notifica_cliente_de_mudanca_de_status: o corpo ainda NAO traz o texto da retirada",
  "notifica_cliente_de_mudanca_de_status: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, trigger)",
  "tr_pedido_avisa_o_cliente: ligada a funcao (AFTER UPDATE OF status, por linha)",
  "notifica_cliente_de_mudanca_de_status: EXECUTE como hoje (aberto por heranca do PUBLIC)",
];
/** O rol da 38a (a prova de objetos da migration 20261237000000, a lojista renomeia e apaga categoria sem deixar produto orfao): as 8
 * linhas que scripts/publicacao/consultas/38a-conferir-gestao-de-categorias-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer
 * estado do banco (funcao ausente vira `AUSENTE` na propria linha): o corpo vivo de cada uma das TRES portas (renomear_categoria,
 * apagar_categoria_vazia, categorias_com_uso) e o NOVO (md5), os atributos das tres, o EXECUTE so de authenticated e service_role, as
 * oito auxiliares categoria__* existem e estao FECHADAS e o gatilho que avisa a vitrine do produto trocado segue ligado.
 * tests/banco/categorias-gestao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_38A = [
  "controle: funcoes de public visiveis a este papel",
  "renomear_categoria: corpo e o da 20261237000000 (md5)",
  "apagar_categoria_vazia: corpo e o da 20261237000000 (md5)",
  "categorias_com_uso: corpo e o da 20261237000000 (md5)",
  "as tres portas: atributos de sempre (SECURITY DEFINER, plpgsql, search_path=public, jsonb; apagar e renomear VOLATILE, categorias_com_uso STABLE)",
  "as tres portas: EXECUTE so para authenticated e service_role (PUBLIC e anon nao)",
  "as oito auxiliares categoria__*: existem e estao fechadas (nenhum papel de fora as executa)",
  "produtos: o gatilho set_ultima_atualizacao (avisa a vitrine do produto trocado) segue ligado",
];
/** O rol da 38b (a consulta de AUSENCIA do lote da gestao de categorias; `ausenciaConfirmadaPor`): as 6 linhas que
 * scripts/publicacao/consultas/38b-antes-gestao-de-categorias-funcoes-ausentes.sql devolve - a base de antes: as tres portas e as oito
 * auxiliares ainda ausentes, as tabelas e colunas de que a migration depende de pe, as funcoes de papel e de acento que ela chama
 * existindo e o gatilho do produto ligado. Uma loja que ja tem a migration reprova aqui de proposito, nas linhas das portas e das
 * auxiliares. */
const ROL_DA_38B = [
  "controle: funcoes de public visiveis a este papel",
  "as tres portas (renomear_categoria, apagar_categoria_vazia, categorias_com_uso) ainda NAO existem",
  "as oito auxiliares categoria__* ainda NAO existem",
  "as tabelas e colunas de que a migration depende estao de pe (categorias, produtos, banners, politica_devolucao)",
  "is_admin(), is_admin_atual() e f_unaccent(text) existem (a migration as chama)",
  "produtos: o gatilho set_ultima_atualizacao (avisa a vitrine do produto trocado) esta ligado",
];
/** O rol da 45a (a prova de objetos da migration 20261242000000, o lucro usa o custo do dia da venda: a tabela lateral so do
 * servidor, o gatilho que copia o custo do produto para cada item que nasce e os dois relatorios do lojista que passam a ler esse
 * custo): as 13 linhas que scripts/publicacao/consultas/45a-conferir-custo-do-dia-aplicado.sql devolve, cada uma UMA vez, as mesmas
 * em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha): o controle, o corpo NOVO (md5) das tres funcoes, os
 * atributos delas, o EXECUTE de cada papel (os dois relatorios so do authenticated, a funcao do gatilho fechada a todos), a tabela
 * so do servidor com as tres colunas, a chave primaria e a estrangeira em cascata, o gatilho ligado AFTER INSERT por linha, o
 * marcador de que os relatorios leem o custo do dia e caem no de hoje, e a tabela fora do realtime.
 * tests/banco/custo-do-dia-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_45A = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: corpo e o da 20261242000000, com o custo do dia da venda (md5)",
  "fin_dre: corpo e o da 20261242000000, com o custo do dia da venda (md5)",
  "marketplace_order_item__guarda_o_custo_do_dia: corpo e o da 20261242000000, o gatilho que nunca derruba a compra (md5)",
  "as tres funcoes: atributos do desenho (SECURITY DEFINER, search_path=public, linguagem, volatilidade, retorno e uma assinatura so)",
  "get_admin_analytics_v2 e fin_dre: EXECUTE so do authenticated (PUBLIC e anon nao)",
  "marketplace_order_item__guarda_o_custo_do_dia: EXECUTE fechado a todos (PUBLIC, anon, authenticated e service_role)",
  "marketplace_order_item_custo: so do servidor (RLS ligada, nenhuma policy, nenhum acesso de anon, authenticated e service_role)",
  "marketplace_order_item_custo: as tres colunas do desenho (custo, item_id, registrado_em)",
  "marketplace_order_item_custo: item_id e a chave primaria e acompanha o item (chave estrangeira com ON DELETE CASCADE)",
  "tr_marketplace_order_items_guarda_o_custo_do_dia: ligado, AFTER INSERT por linha, apontando para a funcao do gatilho",
  "get_admin_analytics_v2 e fin_dre: leem o custo do dia e caem no custo de hoje (COALESCE(oic.custo, p.custo))",
  "marketplace_order_item_custo: fora da publicacao do realtime (o custo do lojista nunca vai ao navegador)",
];
/** O rol da 45b (a consulta de AUSENCIA do lote do custo do dia; `ausenciaConfirmadaPor`): as 6 linhas que
 * scripts/publicacao/consultas/45b-antes-custo-do-dia-base-vigente.sql devolve - a base de antes: a funcao do gatilho e o gatilho
 * ainda NAO existem (a tabela lateral pode ficar de um rollback-manual); as DUAS funcoes que a migration reescreve existem com o
 * corpo vigente (md5) e os atributos de sempre; as 12 colunas que os corpos novos leem existem. NAO mede a ACL. Uma loja que ja tem
 * a migration reprova aqui de proposito. */
const ROL_DA_45B = [
  "controle: funcoes de public visiveis a este papel",
  "a funcao do gatilho e o gatilho ainda NAO existem (a tabela lateral pode ficar de um rollback-manual)",
  "get_admin_analytics_v2: corpo e o vigente da 20261234000000, sem o custo do dia (md5)",
  "fin_dre: corpo e o vigente da 20261199000000, sem o custo do dia (md5)",
  "as duas funcoes: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, linguagem, volatilidade e retorno)",
  "as 12 colunas que os corpos novos leem existem (itens do pedido, produtos e itens da devolucao)",
];
/** O rol da 46a (a prova de objetos da migration 20261243000000, desfazer o recebimento recusa pedido com devolucao viva: SO o
 * corpo de registrar_pagamento_recebido(uuid, boolean)): as 6 linhas que
 * scripts/publicacao/consultas/46a-conferir-desfazer-recebimento-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer estado
 * do banco (objeto ausente vira `AUSENTE` na propria linha): o controle, o corpo NOVO (md5), os atributos de sempre, o EXECUTE de
 * cada papel (authenticated e service_role sim; PUBLIC e anon nao), a frase da recusa com o criterio da devolucao viva no corpo e a
 * checagem depois da trava do pedido (FOR UPDATE) e antes do UPDATE que desfaz.
 * tests/banco/desfazer-recebimento-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_46A = [
  "controle: funcoes de public visiveis a este papel",
  "registrar_pagamento_recebido: corpo e o da 20261243000000, com a recusa da devolucao viva (md5)",
  "registrar_pagamento_recebido: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb, dois argumentos)",
  "registrar_pagamento_recebido: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)",
  "registrar_pagamento_recebido: a frase da recusa e o criterio da devolucao viva (NOT IN recusada, cancelada, reprovada) estao no corpo",
  "registrar_pagamento_recebido: a checagem vem depois da trava do pedido (FOR UPDATE) e antes do UPDATE que desfaz",
];
/** O rol da 46b (a consulta de AUSENCIA do lote do desfazer o recebimento; `ausenciaConfirmadaPor`): as 6 linhas que
 * scripts/publicacao/consultas/46b-antes-desfazer-recebimento-base-vigente.sql devolve - a base de antes: o corpo vigente da
 * 20261197000000 (md5) sem a recusa, os atributos de sempre, o EXECUTE como hoje, is_admin() e is_admin_atual() de pe e as 14 colunas
 * que o corpo le ou grava. Uma loja que ja tem a migration reprova aqui de proposito. */
const ROL_DA_46B = [
  "controle: funcoes de public visiveis a este papel",
  "registrar_pagamento_recebido: corpo e o vigente da 20261197000000, sem a recusa da devolucao viva (md5)",
  "registrar_pagamento_recebido: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb, dois argumentos)",
  "registrar_pagamento_recebido: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)",
  "is_admin() e is_admin_atual() existem (o corpo as chama)",
  "as 14 colunas que o corpo le ou grava existem (pedidos, historico de pagamento e devolucoes)",
];
/** O rol da 47a (a prova de objetos da migration 20261244000000, a loja escolhe como entrega na cidade e em quantos dias: os
 * corpos de create_marketplace_order_v23, create_marketplace_order_v24 e upsert_store_config, as duas colunas novas de store_config
 * com a CHECK do prazo, a trigger do So retiro e a view de 47 colunas): as 9 linhas que
 * scripts/publicacao/consultas/47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql devolve, cada uma UMA vez, as mesmas em qualquer
 * estado do banco (objeto ausente vira `AUSENTE` na propria linha): o controle, os tres corpos (md5), os atributos e o EXECUTE das
 * tres funcoes, as colunas e a CHECK, a trigger com a funcao dela e a view.
 * tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs prova, num Postgres real, que este rol e EXATAMENTE o que a consulta devolve. */
const ROL_DA_47A = [
  "controle: funcoes de public visiveis a este papel",
  "as tres funcoes: EXECUTE como sempre (PUBLIC nunca; authenticated e service_role sim; anon sim nas duas compras e nao na upsert)",
  "as tres funcoes: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno)",
  "create_marketplace_order_v23: corpo e o da 20261244000000, com o So retiro e a retirada livre (md5)",
  "create_marketplace_order_v24: corpo e o da 20261244000000, com o So retiro e a retirada livre (md5)",
  "store_config: local_delivery_enabled boolean NOT NULL DEFAULT true, local_delivery_days integer NOT NULL DEFAULT 1 e a CHECK do prazo de 0 a 30",
  "store_config_so_retirada_exige_retirada: trigger ligada (BEFORE INSERT OR UPDATE por linha), corpo da migration (md5) e a funcao dela sem EXECUTE para ninguem",
  "upsert_store_config: corpo e o da 20261244000000, que grava as duas chaves novas (md5)",
  "v_store_config: as 47 colunas na ordem (as 45 de antes + local_delivery_enabled e local_delivery_days no fim), legivel por anon, authenticated e service_role",
];
/** O rol da 47b (a consulta de AUSENCIA do lote da entrega na cidade; `ausenciaConfirmadaPor`): as 9 linhas que
 * scripts/publicacao/consultas/47b-antes-a-loja-escolhe-como-entrega-base-vigente.sql devolve - a base de antes: os tres corpos
 * vigentes (md5 da 20261229000000, da 20261236000000 e da 20261239000000), os atributos e o EXECUTE de sempre, as colunas, a CHECK,
 * a trigger e a funcao dela ainda ausentes, a view de 45 colunas e o que os corpos novos leem de pe. Uma loja que ja tem a
 * migration reprova aqui de proposito, nas linhas dos corpos, das colunas e da view. */
const ROL_DA_47B = [
  "controle: funcoes de public visiveis a este papel",
  "as duas colunas novas, a CHECK do prazo, a trigger do So retiro e a funcao dela ainda nao existem",
  "as tres funcoes: EXECUTE como sempre (PUBLIC nunca; authenticated e service_role sim; anon sim nas duas compras e nao na upsert)",
  "as tres funcoes: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno)",
  "create_marketplace_order_v23: corpo e o vigente da 20261229000000, sem o So retiro (md5)",
  "create_marketplace_order_v24: corpo e o vigente da 20261236000000, sem o So retiro (md5)",
  "store_config.enabled_shipping_methods, store_config.store_address e store_config.origin_cep existem (os corpos novos as leem) e is_local_cep(text, text, text) tambem",
  "upsert_store_config: corpo e o vigente da 20261239000000, sem as duas chaves novas (md5)",
  "v_store_config: as 45 colunas de hoje, na ordem (md5 da lista), sem as duas novas",
];
/** O CONTRATO ÚNICO do rol fechado, pela CONSULTA: a pré-checagem do ledger
 * (`conferirAntesDeGravar`) e o veredito que o portão lê (`veredictoDaConsulta`)
 * usam ESTA tabela — a lista não existe em outro lugar. As consultas das faixas
 * 72..83 e as antigas (1a/2a/6a/7a…) ficam de fora de propósito. */
// 48a/48b: só analytics, quatro linhas fixas; o corpo muda de 42 para 45, atributos e ACL iguais.
const ROL_DA_48A = [
  "controle: funcoes de public visiveis a este papel",
  "get_admin_analytics_v2: corpo e o da 20261245000000, com o desconto proporcional (md5)",
  "get_admin_analytics_v2: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno json, um argumento)",
  "get_admin_analytics_v2: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)",
];
const ROL_DA_48B = ROL_DA_48A.map((item) =>
  item.replace(
    "20261245000000, com o desconto proporcional",
    "20261242000000, antes do desconto proporcional",
  ),
);

const ROL_FECHADO_POR_CONSULTA = {
  "9a-conferir-60-a-66-aplicado": ROL_DA_9A,
  "8e-conferir-92-a-202-aplicado": ROL_DA_8E,
  "8k-subtotal-divergente-ou-vazia-provada": ROL_DA_8K,
  "10a-conferir-cupons-desligados-aplicado": ROL_DA_10A,
  "10b-antes-cupons-desligados-gatilho-e-corpo": ROL_DA_10B,
  "11a-conferir-anular-venda-presencial-aplicado": ROL_DA_11A,
  "11b-antes-anular-venda-presencial-funcao-ausente": ROL_DA_11B,
  "12a-conferir-cupom-preso-aplicado": ROL_DA_12A,
  "12b-antes-cupom-preso-funcoes-ausentes": ROL_DA_12B,
  "14a-conferir-contador-duplicado-apagado": ROL_DA_14A,
  "14b-antes-contador-duplicado-coluna-presente-e-zerada": ROL_DA_14B,
  "15a-conferir-cupons-do-checkout-aplicado": ROL_DA_15A,
  "15b-antes-cupons-do-checkout-pecas-ausentes": ROL_DA_15B,
  "16a-conferir-pix-anulado-aplicado": ROL_DA_16A,
  "16b-antes-pix-anulado-foto-ausente": ROL_DA_16B,
  "17a-conferir-estoque-do-painel-aplicado": ROL_DA_17A,
  "17b-antes-estoque-do-painel-corpos-vigentes": ROL_DA_17B,
  "19a-conferir-politica-devolucao-aplicado": ROL_DA_19A,
  "19b-antes-politica-devolucao-grant-de-tabela": ROL_DA_19B,
  "20a-conferir-fotos-da-devolucao-aplicado": ROL_DA_20A,
  "20b-antes-fotos-da-devolucao-sem-delete": ROL_DA_20B,
  "21a-conferir-teto-de-email-aplicado": ROL_DA_21A,
  "21b-antes-teto-de-email-corpos-vigentes": ROL_DA_21B,
  "22a-conferir-portas-do-banco-aplicado": ROL_DA_22A,
  "22b-antes-portas-do-banco-estado-vigente": ROL_DA_22B,
  "23a-conferir-consulta-antiga-de-pedido-fechada": ROL_DA_23A,
  "23b-antes-consulta-antiga-de-pedido-aberta": ROL_DA_23B,
  "24a-conferir-avaliacoes-fechadas-ao-visitante": ROL_DA_24A,
  "24b-antes-avaliacoes-abertas-ao-visitante": ROL_DA_24B,
  "25a-conferir-media-de-avaliacoes-so-admin": ROL_DA_25A,
  "25b-antes-media-de-avaliacoes-sem-guarda": ROL_DA_25B,
  "26a-conferir-voto-util-so-em-avaliacao-publica": ROL_DA_26A,
  "26b-antes-voto-util-sem-guarda-de-status": ROL_DA_26B,
  "27a-conferir-avaliacao-nasce-sem-resposta-da-loja": ROL_DA_27A,
  "27b-antes-avaliacao-aceita-resposta-forjada": ROL_DA_27B,
  "30a-conferir-numeros-do-painel-aplicado": ROL_DA_30A,
  "30b-antes-numeros-do-painel-corpos-vigentes": ROL_DA_30B,
  "33a-conferir-grade-do-crm-aplicado": ROL_DA_33A,
  "33b-antes-grade-do-crm-corpo-vigente": ROL_DA_33B,
  "31a-conferir-endereco-da-compra-fica-no-pedido": ROL_DA_31A,
  "31b-antes-endereco-da-compra-so-no-ponteiro": ROL_DA_31B,
  "28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro": ROL_DA_28A,
  "28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao": ROL_DA_28B,
  "29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes": ROL_DA_29A,
  "29b-antes-reemissao-do-reembolso-base-conhecida": ROL_DA_29B,
  "32a-conferir-busca-de-clientes-aplicado": ROL_DA_32A,
  "32b-antes-busca-de-clientes-corpos-vigentes": ROL_DA_32B,
  "34a-conferir-sino-da-retirada-aplicado": ROL_DA_34A,
  "34b-antes-sino-da-retirada-corpo-vigente": ROL_DA_34B,
  "35a-conferir-lucro-so-com-custo-aplicado": ROL_DA_35A,
  "35b-antes-lucro-so-com-custo-corpo-vigente": ROL_DA_35B,
  "36a-conferir-venda-repetida-do-balcao-aplicado": ROL_DA_36A,
  "36b-antes-venda-repetida-do-balcao-corpo-vigente": ROL_DA_36B,
  "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado": ROL_DA_37A,
  "37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente":
    ROL_DA_37B,
  "38a-conferir-gestao-de-categorias-aplicado": ROL_DA_38A,
  "38b-antes-gestao-de-categorias-funcoes-ausentes": ROL_DA_38B,
  "39a-conferir-pedidos-de-privacidade-aplicado": ROL_DA_39A,
  "39b-antes-pedidos-de-privacidade-objetos-ausentes": ROL_DA_39B,
  "40a-conferir-identidade-legal-da-loja-aplicado": ROL_DA_40A,
  "40b-antes-identidade-legal-da-loja-base-vigente": ROL_DA_40B,
  "41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado": ROL_DA_41A,
  "41b-antes-pergunta-respondida-corpos-vigentes": ROL_DA_41B,
  "43a-conferir-reembolso-em-duvida-aplicado": ROL_DA_43A,
  "43b-antes-reembolso-em-duvida-base-vigente": ROL_DA_43B,
  "45a-conferir-custo-do-dia-aplicado": ROL_DA_45A,
  "45b-antes-custo-do-dia-base-vigente": ROL_DA_45B,
  "46a-conferir-desfazer-recebimento-aplicado": ROL_DA_46A,
  "46b-antes-desfazer-recebimento-base-vigente": ROL_DA_46B,
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado": ROL_DA_47A,
  "47b-antes-a-loja-escolhe-como-entrega-base-vigente": ROL_DA_47B,
  "48a-conferir-lucro-com-desconto-aplicado": ROL_DA_48A,
  "48b-antes-lucro-com-desconto-base-vigente": ROL_DA_48B,
};
const COLUNAS_DO_ROL = ["esperado", "item", "ok", "vivo"];

/** A ESTRUTURA da resposta de uma consulta de rol fechado: devolve null quando é
 * exatamente o rol (todas as linhas objetos com EXATAMENTE as colunas
 * item/esperado/vivo/ok, cada item do rol uma vez, nenhum desconhecido), ou o
 * texto do que está errado. NÃO olha o valor de `ok` (isso é o resultado). */
function estruturaDoRolFechado(linhas, rol) {
  if (!Array.isArray(linhas) || linhas.length === 0) return "devolveu 0 linhas";
  for (const linha of linhas) {
    const ehObjeto =
      linha && typeof linha === "object" && !Array.isArray(linha);
    if (
      !ehObjeto ||
      JSON.stringify(Object.keys(linha).sort()) !==
        JSON.stringify(COLUNAS_DO_ROL)
    ) {
      return `devolveu uma linha sem exatamente as colunas item/esperado/vivo/ok: ${JSON.stringify(linha)?.slice(0, 200)}`;
    }
  }
  const contagem = new Map();
  for (const linha of linhas) {
    contagem.set(linha.item, (contagem.get(linha.item) ?? 0) + 1);
  }
  const duplicados = [...contagem].filter(([, n]) => n > 1).map(([i]) => i);
  const desconhecidos = [...contagem.keys()].filter((i) => !rol.includes(i));
  const faltando = rol.filter((i) => !contagem.has(i));
  if (duplicados.length || desconhecidos.length || faltando.length) {
    const partes = [];
    if (faltando.length)
      partes.push(`faltam ${faltando.length}: ${faltando.join("; ")}`);
    if (duplicados.length) partes.push(`repetidos: ${duplicados.join("; ")}`);
    if (desconhecidos.length)
      partes.push(`desconhecidos: ${desconhecidos.join("; ")}`);
    return `não devolveu EXATAMENTE o rol de ${rol.length} itens (${partes.join(" | ")})`;
  }
  return null;
}

/** Confere as linhas de uma consulta de rol fechado. Lança se: alguma linha não é
 * um objeto com EXATAMENTE as colunas item/esperado/vivo/ok; falta item, sobra item
 * ou algum item aparece mais de uma vez; ou qualquer `ok` não é o booleano `true`. */
function conferirRolFechado({ faixa, nomeConsulta, linhas, rol }) {
  const prefixo = `pré-checagem do ledger ${faixa} falhou: ${nomeConsulta}`;
  const estrutura = estruturaDoRolFechado(linhas, rol);
  if (estrutura) throw new Error(`${prefixo} ${estrutura}`);
  const reprovadas = linhas.filter((l) => l.ok !== true);
  if (reprovadas.length === 0) return;
  const l = reprovadas[0];
  throw new Error(
    `${prefixo} tem "${l.item}" com ok=${JSON.stringify(l.ok)} (esperado ${JSON.stringify(l.esperado)}, vivo ${JSON.stringify(l.vivo)})${reprovadas.length > 1 ? ` e mais ${reprovadas.length - 1} reprovada(s)` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// A forma do ledger da faixa 60-66 (D2): NÃO é da 9a (que só olha objetos e dá a
// mesma resposta antes e depois do backfill) — é lida AQUI, antes de gravar e de
// novo depois.
// ---------------------------------------------------------------------------
const LEDGER_60_66_PISO = "20261150000000";
const LEDGER_60_66_TETO = "20261167000000";
const LEDGER_60_66_PRIMEIRA = "20261160000000";
const MENSAGEM_LEDGER_60_66_JA_REGISTRADO =
  "ledger 60-66 já registrado: nada a gravar (as 7 versões 20261160..20261166 já estão no ledger com os nomes certos; NENHUMA escrita foi feita e nada foi reaplicado)";

/** O ledger já tem as 7, com os nomes certos: estado EXPLÍCITO, não prova
 * negativa. `main` o imprime e termina com saída 0, sem escrever. */
class LedgerJaRegistrado extends Error {
  constructor(faixa) {
    super(MENSAGEM_LEDGER_60_66_JA_REGISTRADO);
    this.name = "LedgerJaRegistrado";
    this.faixa = faixa;
  }
}

/** Lê do INSERT fixo (já conferido por hash) as linhas (version, name) que ele
 * grava. */
function versoesDoInsert(sql) {
  return [...String(sql).matchAll(/\('(\d{14})', '([a-z0-9_]+)'\)/g)].map(
    (m) => ({ version: m[1], name: m[2] }),
  );
}

/**
 * Classifica a leitura do ledger entre 20261150 e 20261167999999:
 *   LACUNA          150 e 167 presentes e NENHUMA versão em 160..166 → pode gravar;
 *   JA_REGISTRADO   as 7 com os nomes certos, nem uma a mais na faixa → nada a gravar;
 *   PARCIAL         algumas das 7 (ou versão a mais/nome trocado) → PARAR;
 *   FORMA_INESPERADA  zero da faixa mas 150 ou 167 ausentes → PARAR.
 * `ladoDeFora` descreve o que ficou fora do esperado, para a mensagem.
 */
function classificarLedgerDa60a66(linhas, esperadas) {
  if (!Array.isArray(linhas)) {
    return {
      estado: "FORMA_INESPERADA",
      detalhe: "leitura do ledger em formato inesperado",
    };
  }
  // FORMATO de TODAS as linhas, ANTES de classificar (desconhecido não é
  // sucesso): uma linha fora do formato não pode ser filtrada em silêncio — as
  // âncoras 150/167 mais uma linha inválida virariam LACUNA e autorizariam a
  // escrita. Cada linha: objeto com EXATAMENTE as colunas version e name,
  // version string de 14 dígitos, name string não vazia.
  for (const [i, l] of linhas.entries()) {
    const chaves =
      l && typeof l === "object" && !Array.isArray(l)
        ? Object.keys(l).sort()
        : null;
    const formaOk =
      chaves !== null &&
      chaves.length === 2 &&
      chaves[0] === "name" &&
      chaves[1] === "version" &&
      typeof l.version === "string" &&
      /^\d{14}$/.test(l.version) &&
      typeof l.name === "string" &&
      l.name.length > 0;
    if (!formaOk) {
      return {
        estado: "FORMA_INESPERADA",
        detalhe: `linha ${i + 1} da leitura do ledger fora do formato (esperava { version: 14 dígitos, name: texto não vazio }, leu ${JSON.stringify(l)})`,
      };
    }
  }
  const tem150 = linhas.some((l) => l && l.version === LEDGER_60_66_PISO);
  const tem167 = linhas.some((l) => l && l.version === LEDGER_60_66_TETO);
  const dentro = linhas.filter(
    (l) =>
      l &&
      typeof l.version === "string" &&
      l.version >= LEDGER_60_66_PRIMEIRA &&
      l.version < LEDGER_60_66_TETO,
  );
  if (dentro.length === 0) {
    if (tem150 && tem167)
      return { estado: "LACUNA", detalhe: "registrado: 0 de 7" };
    const ausentes = [];
    if (!tem150) ausentes.push(LEDGER_60_66_PISO);
    if (!tem167) ausentes.push(LEDGER_60_66_TETO);
    return {
      estado: "FORMA_INESPERADA",
      detalhe: `nenhuma das 7 registrada, mas ${ausentes.join(" e ")} ausente(s) do ledger: não é a forma da CAF`,
    };
  }
  const problemas = [];
  const porVersao = new Map();
  for (const l of dentro) {
    porVersao.set(l.version, [...(porVersao.get(l.version) ?? []), l.name]);
  }
  for (const e of esperadas) {
    const nomes = porVersao.get(e.version);
    if (!nomes) problemas.push(`falta ${e.version}`);
    else if (nomes.length !== 1 || nomes[0] !== e.name)
      problemas.push(
        `${e.version} com nome divergente (esperado "${e.name}", leu ${JSON.stringify(nomes)})`,
      );
  }
  const conhecidas = new Set(esperadas.map((e) => e.version));
  for (const v of porVersao.keys()) {
    if (!conhecidas.has(v)) problemas.push(`versão a mais na faixa: ${v}`);
  }
  if (problemas.length === 0) {
    return {
      estado: "JA_REGISTRADO",
      detalhe: "registrado: 7 de 7",
      guardasPresentes: tem150 && tem167,
    };
  }
  const registradas = esperadas.filter((e) => porVersao.has(e.version)).length;
  return {
    estado: "PARCIAL",
    detalhe: `registrado: ${registradas} de ${esperadas.length} (${problemas.join("; ")})`,
  };
}

/** Uma leitura do ledger entre 20261150 e 20261167999999 (só leitura). */
async function lerLedgerDa60a66({ ref, token }) {
  const query = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '${LEDGER_60_66_PISO}' AND '20261167999999' ORDER BY version;`;
  const corpo = await chamarLeitura({ ref, token, query });
  return extrairLinhas(corpo);
}

/**
 * A ÚNICA escrita deste script, UMA tentativa só (sem retry automático). Se ela
 * falhar por timeout, rede, HTTP 5xx, 4xx diferente de 401/403 ou corpo
 * inesperado, o INSERT PODE ter sido gravado — o resultado é DESCONHECIDO. Na
 * faixa 60-66 roda UMA leitura de reconciliação (a mesma leitura prévia) e a
 * mensagem diz REGISTRADO / NÃO REGISTRADO / PARCIAL; nas outras, manda
 * reconciliar por leitura. Em qualquer caso lança com "ESTADO DESCONHECIDO" e o
 * `main` sai 1. 401/403 não é desconhecido: o acesso foi recusado antes de
 * qualquer escrita, e o `main` PARA com o bloqueio concreto.
 */
async function gravarUmaVez({ ref, token, faixa, query, esperadas }) {
  try {
    await chamarEscrita({ ref, token, query });
  } catch (erro) {
    if (erro && (erro.status === 401 || erro.status === 403)) throw erro;
    let reconciliacao;
    if (faixa === FAIXA_LEDGER_SO_DA_CAF) {
      try {
        const c = classificarLedgerDa60a66(
          await lerLedgerDa60a66({ ref, token }),
          esperadas,
        );
        reconciliacao =
          {
            LACUNA: "NÃO REGISTRADO (0 de 7)",
            JA_REGISTRADO: "REGISTRADO (7 de 7)",
          }[c.estado] ?? `PARCIAL / forma inesperada (${c.detalhe})`;
      } catch (erroDeLeitura) {
        reconciliacao = `a leitura de reconciliação TAMBÉM falhou (${erroDeLeitura?.message ?? erroDeLeitura}): estado do registro não determinado`;
      }
    }
    const consultaDaFaixa = (CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER[faixa] ??
      [])[0];
    const novo = new Error(
      `ESTADO DESCONHECIDO: a escrita do ledger ${faixa} falhou (${erro?.message ?? erro}) e NÃO foi repetida — o INSERT pode ter sido gravado ou não.${reconciliacao ? ` Leitura de reconciliação: ${reconciliacao}.` : ""} Antes de qualquer nova tentativa, reconcilie POR LEITURA (consulta ${consultaDaFaixa} e supabase_migrations.schema_migrations; workflow conferir-banco-da-loja com gravar_ledger = nao). Só tente gravar de novo se a leitura mostrar que o registro NÃO está lá.`,
    );
    novo.estadoDesconhecido = true;
    throw novo;
  }
}

/**
 * SHA-256 dos dois arquivos de ledger, fixado na última revisão (rodada 3,
 * 26/09/2026). Por que fixar aqui, e não confiar só em `contarStatements`:
 * o INSERT do ledger é o ÚNICO caminho de escrita deste script, e vai para
 * o endpoint SEM papel restrito (`chamarEscrita`) — a barreira do papel
 * `supabase_read_only_user` não existe nesse caminho. Se o contador tiver
 * um bug residual (a rodada 3 já achou 8 casos adversariais: P1-P8), a
 * única coisa entre um arquivo corrompido/alterado e uma escrita de
 * verdade seria a contagem de statements. O hash é uma segunda checagem,
 * independente da contagem: qualquer edição — maliciosa ou um erro de
 * encoding/quebra de linha — muda o hash, e o script recusa ANTES de olhar
 * o conteúdo. Editar o ledger de propósito exige atualizar o hash aqui
 * também — a mesma fricção de dois lugares que `scripts/db-apply.cjs` e
 * `0b-conferir-corpos-vivos.sql` já usam para os corpos de função (lá,
 * md5 do corpo vivo contra o valor no rollback; aqui, sha256 do arquivo
 * inteiro). Escolhido em vez de hardcodar o INSERT dentro do script: o
 * `.sql` continua sendo a ÚNICA fonte (diff revisável no PR); duplicar o
 * texto em dois lugares (arquivo + string no script) só criaria um jeito
 * novo de os dois divergirem sem ninguém perceber.
 */
const SHA256_DO_LEDGER = {
  "72-74": "f25b2d23064bd7639c4c65e19ae85021ec0bb2e53a65d16ffbada9c755d0dbef",
  "75-78": "aa0d443015102f3fba7f326cbcd40f36f3cba9426800e3fb2787e6697062600f",
  "79-82": "505f62dd9be2da3e9af9607b700ee30c681ce5afe339fe61bcfe8b44db86a0bf",
  83: "e30d8ee7c2a1bb94ef90540e9341bd799c0d421585e4813f8fc88914934d79ae",
  "92-202": "ad494d1358fd13ac49119f2fcfd9823b430ee79042810e67fa7a1f59b66a0ff0",
  "60-66": "616290407aa9abcb8b0f300efcdddb2a5af2e7775bdcefa422232b7a35ed58aa",
};

function conferirHashDoLedger(faixa, conteudo) {
  const hash = crypto
    .createHash("sha256")
    .update(conteudo, "utf8")
    .digest("hex");
  const esperado = SHA256_DO_LEDGER[faixa];
  // eslint-disable-next-line security/detect-possible-timing-attacks -- não há segredo nem atacante remoto aqui: os dois hashes vêm de conteúdo LOCAL (o arquivo .sql no disco e a constante no código-fonte), no mesmo processo de vida curta do CI. Mesma classe de justificativa de scripts/rotate-db-password.cjs.
  if (hash !== esperado) {
    throw new Error(
      `ledger-${faixa}.sql não bate com o hash pinado (esperado ${esperado}, achou ${hash}) — se a edição foi de propósito, atualize SHA256_DO_LEDGER em conferir-banco.cjs`,
    );
  }
}

/** A leitura pós-gravação (achado desta tarefa: a faixa nova amplia o que já
 * estava no ledger, então a leitura de conferência amplia junto — sempre
 * mostrando desde 72, nunca só a faixa recém-gravada isolada). A faixa 60-66 tem
 * o PRÓPRIO intervalo (20261150..20261167999999): ler "desde 72" não serve a ela,
 * e a leitura dela é CONFERIDA (`classificarLedgerDa60a66`), não só impressa. */
const VERIFICACAO_POS_LEDGER = {
  "72-74": { rotulo: "72–78", limiteSuperior: "20261178999999" },
  "75-78": { rotulo: "72–78", limiteSuperior: "20261178999999" },
  "79-82": { rotulo: "72–82", limiteSuperior: "20261182999999" },
  83: { rotulo: "72–83", limiteSuperior: "20261183999999" },
  "92-202": { rotulo: "72–202", limiteSuperior: "20261202999999" },
  "60-66": {
    rotulo: "50–67",
    limiteInferior: LEDGER_60_66_PISO,
    limiteSuperior: "20261167999999",
  },
};

async function rodarLedger({ ref, token, faixa }) {
  if (!FAIXAS_DE_LEDGER.includes(faixa)) {
    throw new Error(
      `LEDGER inválido: "${faixa}" (esperava uma de: ${FAIXAS_DE_LEDGER.join(", ")})`,
    );
  }
  const ehDa60a66 = faixa === FAIXA_LEDGER_SO_DA_CAF;

  const arquivo = path.join(CONSULTAS_DIR, `ledger-${faixa}.sql`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `faixa` já foi conferida contra FAIXAS_DE_LEDGER (lista fixa) acima.
  const insertUnico = fs.readFileSync(arquivo, "utf8");
  conferirHashDoLedger(faixa, insertUnico);
  const total = contarStatements(insertUnico);
  if (total !== 1) {
    throw new Error(
      `ledger-${faixa}.sql tem ${total} statements — precisa ser exatamente 1 INSERT`,
    );
  }
  const esperadas = versoesDoInsert(insertUnico);

  if (ehDa60a66) {
    // LEITURA PRÉVIA (D2): a forma do ledger decide ANTES de qualquer outra
    // coisa. Já registrado = estado explícito, saída 0, nenhuma escrita; qualquer
    // outra forma que não seja a lacuna da CAF PARA (saída 1).
    console.log(
      `=== LEITURA PRÉVIA do ledger ${faixa} (${LEDGER_60_66_PISO}..20261167999999) ===`,
    );
    const previa = classificarLedgerDa60a66(
      await lerLedgerDa60a66({ ref, token }),
      esperadas,
    );
    // "Já registrado" só vale com as âncoras 20261150 e 20261167 TAMBÉM no ledger
    // (a releitura pós-gravação exige o mesmo): 7 linhas sem elas é forma
    // inesperada, não estado explícito.
    if (previa.estado === "JA_REGISTRADO" && previa.guardasPresentes === true)
      throw new LedgerJaRegistrado(faixa);
    if (previa.estado !== "LACUNA") {
      throw new Error(
        `ledger ${faixa} em forma inesperada (${previa.estado}: ${previa.detalhe}${previa.estado === "JA_REGISTRADO" ? "; 20261150/20261167 ausentes" : ""}) — PARAR: nenhuma escrita; alguém mexeu no registro e o diagnóstico vem antes`,
      );
    }
    console.log(
      "Forma do ledger OK: 20261150 e 20261167 presentes, nenhuma das 7 registrada (a lacuna da CAF).",
    );
  }

  console.log(`=== PRÉ-CHECAGEM antes de gravar o ledger ${faixa} ===`);
  await conferirAntesDeGravar({ ref, token, faixa });
  console.log("Pré-checagem OK: todas as linhas relevantes vieram ok=true.");

  console.log(`=== GRAVANDO ledger ${faixa} (endpoint de escrita) ===`);
  // A ÚNICA escrita deste script: o INSERT fixo do arquivo, idempotente
  // por ON CONFLICT DO NOTHING, UMA tentativa só (`gravarUmaVez`).
  await gravarUmaVez({ ref, token, faixa, query: insertUnico, esperadas });
  console.log(
    ehDa60a66
      ? `INSERT do ledger ${faixa} enviado (a leitura a seguir CONFERE o resultado).`
      : `Ledger ${faixa} gravado (ou já estava — ON CONFLICT DO NOTHING).`,
  );

  const {
    rotulo,
    limiteInferior = "20261172000000",
    limiteSuperior,
  } = VERIFICACAO_POS_LEDGER[faixa];
  const verificacao = `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '${limiteInferior}' AND '${limiteSuperior}' ORDER BY version;`;
  let linhas;
  try {
    const corpo = await chamarLeitura({ ref, token, query: verificacao });
    linhas = extrairLinhas(corpo);
  } catch (erro) {
    if (!ehDa60a66) throw erro;
    if (erro && (erro.status === 401 || erro.status === 403)) throw erro;
    throw new Error(
      `o INSERT do ledger ${faixa} foi enviado, mas a leitura de conferência falhou (${erro?.message ?? erro}): reconcilie POR LEITURA (9a-conferir-60-a-66-aplicado e supabase_migrations.schema_migrations) antes de qualquer nova tentativa`,
    );
  }
  let tabela;
  try {
    tabela = formatarTabela(linhas);
  } catch {
    // linha fora do formato (null, não objeto): a classificação abaixo PARA com a
    // mensagem certa; aqui só se evita que a impressão da tabela a esconda.
    tabela = JSON.stringify(linhas);
  }
  escreverResumo(
    `## Ledger ${rotulo} depois da gravação de \`${faixa}\`\n\n\`\`\`\n${tabela}\n\`\`\``,
  );
  if (ehDa60a66) {
    // A leitura posterior CONFERE: exatamente as 7, com os nomes, e 150 e 167.
    const depois = classificarLedgerDa60a66(linhas, esperadas);
    if (depois.estado !== "JA_REGISTRADO" || !depois.guardasPresentes) {
      throw new Error(
        `leitura pós-gravação do ledger ${faixa} NÃO bate com as 7 linhas esperadas (${depois.estado}: ${depois.detalhe}${depois.estado === "JA_REGISTRADO" ? "; 20261150/20261167 ausentes" : ""}) — o INSERT foi enviado: reconcilie antes de qualquer nova tentativa`,
      );
    }
    console.log(
      "Leitura pós-gravação OK: as 7 versões 20261160..20261166 estão no ledger com os nomes do ledger-60-66.sql, e 20261150/20261167 continuam lá.",
    );
  }
}

async function main() {
  const projeto = process.env.PROJETO || "loja";
  const ehCaf = projeto === PROJETO_CAF;
  const ehSavy = projeto === PROJETO_SAVY;
  // CAF e Savy explícitas: SÓ o segredo próprio de cada uma. Sem ele, PARA —
  // nunca tenta SUPABASE_ACCESS_TOKEN (o de `loja`/`sandbox`), o segredo da
  // outra loja explícita nem outro alvo.
  const token = ehCaf
    ? process.env.SUPABASE_ACCESS_TOKEN_IKCOUS
    : ehSavy
      ? process.env.SUPABASE_ACCESS_TOKEN_SAVY
      : process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      ehCaf
        ? SEM_ACESSO_CAF
        : ehSavy
          ? SEM_ACESSO_SAVY
          : "SEM SUPABASE_ACCESS_TOKEN",
    );
    process.exit(1);
    return;
  }
  const ledgerPedido = process.env.LEDGER;
  // MAPA EXPLÍCITO (D4): quais faixas cada loja explícita aceita. Qualquer outro
  // alvo (`loja`, `sandbox`, lojas de teste) recusa as duas, ANTES de qualquer
  // requisição. O `if` do job `ledger` do workflow espelha este mapa.
  const faixasDoAlvo = Object.hasOwn(
    FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA,
    projeto,
  )
    ? FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA[projeto]
    : [];
  const ledgerRecusadoNaLojaExplicita =
    ledgerPedido && !faixasDoAlvo.includes(ledgerPedido);
  if (ehCaf && ledgerRecusadoNaLojaExplicita) {
    // O ledger GRAVA em supabase_migrations.schema_migrations e as faixas dele
    // (72..83) não são deste lote: a CAF explícita só lê — EXCETO as faixas
    // 92-202 e 60-66 (backfill), que só gravam depois da pré-checagem (8e / 9a).
    console.error(
      "FALHOU: o ledger não roda para ikcous-publicada (a CAF explícita é só leitura neste script, exceto as faixas 92-202 (pré-checagem da 8e) e 60-66 (pré-checagem da 9a), as duas por rol fechado)",
    );
    process.exit(1);
    return;
  }
  if (ehSavy && ledgerRecusadoNaLojaExplicita) {
    // Idem para a Savy explícita (que NÃO tem a faixa 60-66).
    console.error(
      "FALHOU: o ledger não roda para savy (a loja cliente explícita é só leitura neste script, exceto a faixa 92-202, com a pré-checagem da 8e obrigatória)",
    );
    process.exit(1);
    return;
  }
  const lojasDaFaixa = Object.entries(FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA)
    .filter(([, faixas]) => faixas.includes(ledgerPedido))
    .map(([loja]) => loja);
  if (ledgerPedido && lojasDaFaixa.length > 0 && !ehCaf && !ehSavy) {
    // Os backfills 92-202 e 60-66 são das lojas explícitas (segredo próprio +
    // expected_sha): `loja`/`sandbox` não os gravam, nem com a pré-checagem verde.
    console.error(
      `FALHOU: a faixa ${ledgerPedido} do ledger só roda para ${lojasDaFaixa.join(" ou ")}, não para ${projeto}`,
    );
    process.exit(1);
    return;
  }

  let ref;
  try {
    ref = resolverRef(projeto);
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
    if (erro instanceof LedgerJaRegistrado) {
      // Estado explícito, não falha: nada a gravar, saída 0, sem escrita.
      console.log(erro.message);
      return;
    }
    if ((ehCaf || ehSavy) && (erro.status === 401 || erro.status === 403)) {
      console.error(
        `FALHOU: ${ehCaf ? SEM_ACESSO_CAF : SEM_ACESSO_SAVY} (HTTP ${erro.status})`,
      );
    } else {
      console.error("FALHOU:", erro.message);
    }
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
  veredictoDaConsulta,
  listarConsultas,
  ehCaractereDeIdentificador,
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
  conferirRolFechado,
  classificarLedgerDa60a66,
  versoesDoInsert,
  gravarUmaVez,
  rodarLedger,
  LedgerJaRegistrado,
  ROL_DA_9A,
  ROL_DA_8E,
  ROL_DA_8K,
  ROL_DA_10A,
  ROL_DA_10B,
  ROL_DA_11A,
  ROL_DA_11B,
  ROL_DA_12A,
  ROL_DA_12B,
  ROL_DA_14A,
  ROL_DA_14B,
  ROL_DA_15A,
  ROL_DA_15B,
  ROL_DA_16A,
  ROL_DA_16B,
  ROL_DA_17A,
  ROL_DA_17B,
  ROL_DA_19A,
  ROL_DA_19B,
  ROL_DA_20A,
  ROL_DA_20B,
  ROL_DA_21A,
  ROL_DA_21B,
  ROL_DA_22A,
  ROL_DA_22B,
  ROL_DA_23A,
  ROL_DA_23B,
  ROL_DA_24A,
  ROL_DA_24B,
  ROL_DA_25A,
  ROL_DA_25B,
  ROL_DA_26A,
  ROL_DA_26B,
  ROL_DA_27A,
  ROL_DA_27B,
  ROL_DA_30A,
  ROL_DA_30B,
  ROL_DA_33A,
  ROL_DA_33B,
  ROL_DA_31A,
  ROL_DA_31B,
  ROL_DA_28A,
  ROL_DA_28B,
  ROL_DA_29A,
  ROL_DA_29B,
  ROL_DA_32A,
  ROL_DA_32B,
  ROL_DA_34A,
  ROL_DA_34B,
  ROL_DA_35A,
  ROL_DA_35B,
  ROL_DA_36A,
  ROL_DA_36B,
  ROL_DA_37A,
  ROL_DA_37B,
  ROL_DA_38A,
  ROL_DA_38B,
  ROL_DA_39A,
  ROL_DA_39B,
  ROL_DA_40A,
  ROL_DA_40B,
  ROL_DA_41A,
  ROL_DA_41B,
  ROL_DA_43A,
  ROL_DA_43B,
  ROL_DA_45A,
  ROL_DA_45B,
  ROL_DA_46A,
  ROL_DA_46B,
  ROL_DA_47A,
  ROL_DA_47B,
  ROL_DA_48A,
  ROL_DA_48B,
  ROL_FECHADO_POR_CONSULTA,
  estruturaDoRolFechado,
  FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA,
  IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER,
  CONSULTAS_DA_PRE_CHECAGEM_DO_LEDGER,
  VERIFICACAO_POS_LEDGER,
  SHA256_DO_LEDGER,
  conferirHashDoLedger,
  main,
  CONSULTAS_DIR,
};
