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
 * Nas consultas de ROL FECHADO (9a, 8e, 8k, 10a, 10b — `ROL_FECHADO_POR_CONSULTA`) a linha
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
/** O CONTRATO ÚNICO do rol fechado, pela CONSULTA: a pré-checagem do ledger
 * (`conferirAntesDeGravar`) e o veredito que o portão lê (`veredictoDaConsulta`)
 * usam ESTA tabela — a lista não existe em outro lugar. As consultas das faixas
 * 72..83 e as antigas (1a/2a/6a/7a…) ficam de fora de propósito. */
const ROL_FECHADO_POR_CONSULTA = {
  "9a-conferir-60-a-66-aplicado": ROL_DA_9A,
  "8e-conferir-92-a-202-aplicado": ROL_DA_8E,
  "8k-subtotal-divergente-ou-vazia-provada": ROL_DA_8K,
  "10a-conferir-cupons-desligados-aplicado": ROL_DA_10A,
  "10b-antes-cupons-desligados-gatilho-e-corpo": ROL_DA_10B,
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
