#!/usr/bin/env node
/**
 * Prova o par (migration, rollback-manual) ANTES de qualquer clique de
 * aplicação — nenhuma das sete verificações do CI deste repositório olha
 * SQL (ver CLAUDE.md), então uma migration com erro de sintaxe ou um
 * rollback infiel só falham quando alguém aplica de verdade.
 *
 * TUDO o que toca banco roda dentro de UMA transação terminada em
 * `ROLLBACK`, inclusive quando algo dá errado no meio (try/finally).
 *
 * A DEFESA DE VERDADE É A FASE 0 (estática, sem banco) — não o contrário.
 * O Postgres não tem um modo "proibir COMMIT", então a ÚNICA forma de
 * IMPEDIR que uma migration escreva fora da transação da prova é recusar o
 * arquivo ANTES de rodar uma linha sequer. É por isso que a Fase 0
 * reconhece a família INTEIRA de comandos de controle de transação —
 * `BEGIN`, `COMMIT`, `COMMIT PREPARED`, `END`, `ROLLBACK`, `ABORT`,
 * `START TRANSACTION`, `PREPARE TRANSACTION` —, sempre ancorada em início de
 * instrução (começo do arquivo ou logo depois de um `;`), nunca uma palavra
 * solta no meio de uma expressão: `ALTER TABLE t ALTER COLUMN c SET DEFAULT
 * (CASE WHEN true THEN 1 ELSE 2 END);` é SQL legítimo, não controle de
 * transação, e um regex ingênuo que recusasse essa migration válida vira
 * ruído que alguém desliga.
 *
 * A checagem de RUNTIME (`estaEmTransacao`) NÃO é a defesa — é o estopim
 * pós-fato para o que a Fase 0 não pôde enumerar (uma função PL/pgSQL
 * chamada em runtime que encerra a transação por dentro, por exemplo). Ela
 * roda logo depois de aplicar a migration, e de nova logo depois de aplicar
 * o rollback-manual: se alguma forma de encerrar a transação escapou da
 * Fase 0, O BANCO JÁ FOI ESCRITO EM DEFINITIVO antes do script perceber — a
 * checagem de runtime só evita que o script CONTINUE e imprima um veredito
 * de sucesso sobre um banco que já mudou por fora da transação da prova. Por
 * isso a mensagem de INSTRUMENTO_QUEBRADO deste caminho diz explicitamente
 * que a migration (ou o rollback-manual) JÁ ESTÁ GRAVADA — nunca só "nada
 * foi executado depois", que é verdadeiro e ao mesmo tempo esconde o que
 * doeria.
 *
 * O veredito de sucesso NÃO se chama "PROVADO": ele só significa "não achei
 * divergência nas dimensões que este script sabe comparar" — nunca "o
 * rollback está correto em qualquer sentido". A saída sempre lista, no
 * sucesso e na falha, quais dimensões foram medidas e quais não foram (ver
 * `DIMENSOES_MEDIDAS`/`DIMENSOES_NAO_MEDIDAS`). Em especial: DADO DE LINHA
 * (DML) NÃO É COMPARADO — um `UPDATE`/`INSERT`/`DELETE` de backfill esquecido
 * pelo rollback-manual passa sem uma palavra, porque este script compara
 * ESQUEMA, nunca o conteúdo das linhas.
 *
 * USO:
 *   node scripts/db-prove-rollback.cjs <migration.sql> [--rollback <arquivo>]
 *
 * Se `--rollback` não vier, o rollback-manual é resolvido pela convenção já
 * em uso no repositório: `rollback-manual-<nome-do-arquivo-da-migration>.sql`
 * na raiz (ver os ~19 arquivos existentes com esse padrão).
 *
 * ESTADOS DE SAÍDA (distintos, o `else` de uma classificação é sempre a
 * DÚVIDA, nunca o sucesso — ver dominios/testes-e-verificacao.md):
 *   0  SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS — nenhuma divergência nas
 *                             dimensões que este script sabe comparar (ver
 *                             cabeçalho). NÃO é "rollback provado correto":
 *                             dado de linha, por exemplo, fica de fora.
 *   1  erro de uso/inesperado (arquivo não encontrado, exceção não prevista).
 *   2  RECUSADO            — Fase 0 recusou (estática, sem banco).
 *   3  FALHOU              — rollback infiel, controle negativo violado, ou
 *                             a migration/rollback deu erro de SQL ao
 *                             aplicar (erro real do Postgres, nunca vira
 *                             INDETERMINADO — ver C7).
 *   4  INSTRUMENTO-QUEBRADO — controle positivo não reagiu, não há
 *                             sobrevivente para o controle negativo, ou a
 *                             migration/rollback encerrou a transação por
 *                             baixo do script (ver `estaEmTransacao`).
 *   5  INDETERMINADO       — não deu para medir por falha de FERRAMENTA (sem
 *                             DATABASE_URL, sem pacote `pg`, falha ao
 *                             conectar) — nunca por erro de SQL da migration.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm de argumento de linha de comando ou são resolvidos contra
 * PROJECT_ROOT/MIGRATIONS_DIR, mesma convenção já usada em
 * scripts/db-apply.cjs e scripts/db-prove-checkout-060.cjs. Nunca há entrada
 * de rede nem payload de terceiro.
 */
/* eslint-disable security/detect-object-injection --
 * Indexação dinâmica (`sql[i]`, `m[1]`, `foto.tabelas[nome]`) é o próprio
 * mecanismo de um parser de SQL local e de um comparador de fotos genérico;
 * a fonte é sempre um arquivo .sql do repositório ou uma linha vinda do
 * próprio Postgres, nunca entrada de rede. `codigoDeSaida` resolve o código
 * de saída por um `Map` (não por `ESTADOS[estado]`), então não existe mais
 * nenhuma indexação dinâmica sensível fora deste bloco — a supressão de
 * arquivo inteiro deixou de esconder qualquer coisa que valha reabrir.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

/**
 * SQL malformado — hoje só um caso: dollar-quote (`$$` ou `$tag$`) aberto e
 * nunca fechado. É um estado PRÓPRIO, nunca "resto do arquivo é ruído": a
 * versão anterior engolia tudo até o fim do arquivo em silêncio, e isso já
 * deixou um `COMMIT` real invisível para a Fase 0 (ver o mutante M3 nos
 * testes).
 */
class SqlMalformadoError extends Error {}

// ---------------------------------------------------------------------------
// Fase 0 — recusa estática, SEM banco. Coração da testabilidade do script:
// tudo abaixo é função pura, importável por um teste sem exigir node_modules
// nem conexão nenhuma (mesmo padrão de scripts/db-apply.cjs).
// ---------------------------------------------------------------------------

/**
 * Remove comentário de linha (`--`), comentário de bloco ANINHADO (`/* *\/`,
 * onde Postgres soma profundidade — um `/*` dentro de outro `/*` só fecha no
 * `*\/` que zera a profundidade, nunca no primeiro), string simples (`'...'`,
 * com o escape `''`, e com o escape de barra invertida `\'` quando a string
 * tem o prefixo `E`/`e` — string de escape do Postgres) e corpo delimitado
 * por dollar-quote (`$$...$$` ou `$tag$...$tag$`) — nessa ordem de
 * varredura, num único passe pelo texto. Um dollar-quote sem fechamento
 * lança `SqlMalformadoError`: nunca trata o restante do arquivo como ruído.
 *
 * Por que isto existe: um `BEGIN` dentro de `AS $function$ ... BEGIN ... END
 * $function$` é obrigatório e legítimo (é o corpo PL/pgSQL). Um `BEGIN` fora
 * de qualquer dollar-quote é controle de transação e é isso que a Fase 0
 * recusa. Sem remover o corpo da função primeiro, uma busca ingênua por
 * `BEGIN` acusaria toda função PL/pgSQL do repositório. O mesmo vale para
 * ocorrências dentro de comentário ou de string — "vamos remover o
 * BEGIN/COMMIT" dentro de um comentário não pode disparar a recusa, e nem
 * pode um comentário aninhado mal fechado VAZAR uma palavra sensível para
 * fora e disparar uma recusa falsa.
 */
function removerRuido(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const dois = sql.slice(i, i + 2);
    if (dois === "--") {
      let j = sql.indexOf("\n", i);
      if (j === -1) j = n;
      i = j;
      continue;
    }
    if (dois === "/*") {
      // Postgres ANINHA comentário de bloco. A versão anterior fechava no
      // primeiro `*/` encontrado, então `/* fora /* dentro */ fim */` fechava
      // logo depois de "dentro", e " fim */" virava SQL de verdade — se essa
      // sobra tivesse a palavra BEGIN/COMMIT, a Fase 0 recusava uma migration
      // válida por causa de uma palavra dentro de um comentário.
      let profundidade = 1;
      let j = i + 2;
      while (j < n && profundidade > 0) {
        const par = sql.slice(j, j + 2);
        if (par === "/*") {
          profundidade += 1;
          j += 2;
          continue;
        }
        if (par === "*/") {
          profundidade -= 1;
          j += 2;
          continue;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (sql[i] === "'") {
      // String de escape (`E'...'`/`e'...'`): backslash escapa o próximo
      // caractere, inclusive uma aspa simples. Numa string comum (sem o
      // prefixo E), o Postgres trata backslash como caractere literal desde
      // sempre (standard_conforming_strings) — só o `''` fecha. Sem
      // distinguir os dois casos, `E'nao\'da'` fechava a "string" na aspa
      // escapada, e a aspa de fechamento real virava a ABERTURA de uma nova
      // string nunca fechada, que engolia o resto do arquivo — inclusive um
      // `COMMIT` real depois dela.
      const charAntes = i > 0 ? sql[i - 1] : "";
      const charDoisAntes = i > 1 ? sql[i - 2] : "";
      const ehStringDeEscape =
        (charAntes === "E" || charAntes === "e") &&
        !/[A-Za-z0-9_]/.test(charDoisAntes);
      let j = i + 1;
      while (j < n) {
        if (ehStringDeEscape && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      out += "''";
      continue;
    }
    if (sql[i] === "$") {
      /* eslint-disable-next-line security/detect-unsafe-regex --
       * Medido em 25/08/2026: 0,04 ms contra 60 mil caracteres adversariais
       * (`"A ".repeat(30000)`) e 0,20 ms contra a maior migration real do
       * repositório (205 KB). Entrada é sempre um arquivo .sql local, nunca
       * rede. */
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const fechamento = sql.indexOf(tag, i + tag.length);
        if (fechamento === -1) {
          throw new SqlMalformadoError(
            `dollar-quote ${tag} aberto e nunca fechado — SQL malformado, não é "resto do arquivo é ruído"`,
          );
        }
        i = fechamento + tag.length;
        out += " ";
        continue;
      }
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * `CREATE FUNCTION` sem `OR REPLACE` — recusado porque `DROP`+`CREATE` (ou
 * `CREATE` de uma função que já existe) perde os grants, e quem chamava a
 * função quebra em silêncio. Roda em cima do texto já limpo por
 * `removerRuido`, então nunca acusa comentário nem string.
 */
function detectarCreateFunctionCru(sqlLimpo) {
  const achados = [];
  /* eslint-disable-next-line security/detect-unsafe-regex --
   * Medido em 25/08/2026: 0,08 ms contra 60 mil caracteres adversariais e
   * 0,04 ms contra a maior migration real do repositório (205 KB). Entrada é
   * sempre uma migration local já limpa por removerRuido, nunca rede. */
  const re = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/gi;
  let m;
  while ((m = re.exec(sqlLimpo))) {
    if (!m[1]) achados.push(m[0].replace(/\s+/g, " "));
  }
  return achados;
}

/**
 * Família COMPLETA de comandos de controle de transação em nível superior —
 * não só BEGIN/COMMIT (B1). Cada regex é ANCORADA em início de instrução
 * (começo do texto, ou logo depois de um `;`), nunca `\bPALAVRA\b` solta no
 * meio de uma expressão: `ALTER TABLE t ALTER COLUMN c SET DEFAULT (CASE
 * WHEN true THEN 1 ELSE 2 END);` é SQL legítimo, e sem essa âncora um regex
 * ingênuo recusaria essa migration válida (medido pelo revisor). `COMMIT
 * PREPARED` precisa vir ANTES de `COMMIT` na lista — senão a entrada
 * `COMMIT` sozinha já casa o prefixo e a variante de duas palavras nunca é
 * reconhecida como tal (o `(?!\s+PREPARED)` reforça a mesma separação).
 * `ROLLBACK TO SAVEPOINT ...` fica de fora de propósito: não encerra a
 * transação externa, só desfaz até um ponto dentro dela.
 */
const FAMILIA_TRANSACAO = [
  ["BEGIN", /(?:^|;)\s*BEGIN\b/i],
  ["COMMIT PREPARED", /(?:^|;)\s*COMMIT\s+PREPARED\b/i],
  ["COMMIT", /(?:^|;)\s*COMMIT\b(?!\s+PREPARED)/i],
  ["END", /(?:^|;)\s*END\b/i],
  ["ROLLBACK", /(?:^|;)\s*ROLLBACK\b(?!\s+TO\b)/i],
  ["ABORT", /(?:^|;)\s*ABORT\b/i],
  ["START TRANSACTION", /(?:^|;)\s*START\s+TRANSACTION\b/i],
  ["PREPARE TRANSACTION", /(?:^|;)\s*PREPARE\s+TRANSACTION\b/i],
];

/**
 * Controle de transação explícita de nível superior. Só é confiável porque
 * roda em cima do texto já limpo por `removerRuido` — o `BEGIN`/`END` de
 * corpo PL/pgSQL já foi removido junto com o resto do dollar-quote, então o
 * que sobra aqui é mesmo controle de transação. `begin`/`commit` continuam
 * existindo pelo nome (histórico do contrato), `achados` é a lista completa
 * na ordem de `FAMILIA_TRANSACAO`, usada para montar a mensagem de recusa
 * com QUALQUER membro da família, não só os dois originais.
 */
function detectarTransacaoExplicita(sqlLimpo) {
  const achados = FAMILIA_TRANSACAO.filter(([, re]) => re.test(sqlLimpo)).map(
    ([nome]) => nome,
  );
  return {
    begin: achados.includes("BEGIN"),
    commit: achados.includes("COMMIT") || achados.includes("COMMIT PREPARED"),
    achados,
  };
}

/** Recusa estática. Não precisa de banco — é o coração da testabilidade. */
function avaliarFase0({ sqlMigration, temRollback }) {
  const motivos = [];

  let limpo;
  try {
    limpo = removerRuido(sqlMigration);
  } catch (e) {
    if (e instanceof SqlMalformadoError) {
      return { recusado: true, motivos: [`SQL malformado: ${e.message}`] };
    }
    throw e;
  }

  const funcoesCras = detectarCreateFunctionCru(limpo);
  if (funcoesCras.length > 0) {
    motivos.push(
      `CREATE FUNCTION sem OR REPLACE (perde grants): ${funcoesCras.join(", ")}`,
    );
  }

  const transacao = detectarTransacaoExplicita(limpo);
  if (transacao.achados.length > 0) {
    motivos.push(
      `migration contém controle de transação em nível superior (${transacao.achados.join("/")}) — invalida o ROLLBACK da prova`,
    );
  }

  if (!temRollback) {
    motivos.push("rollback-manual correspondente não encontrado");
  }

  return { recusado: motivos.length > 0, motivos };
}

// ---------------------------------------------------------------------------
// Alvos e fotos — o que a migration mexe, e como comparar antes/depois/final.
// ---------------------------------------------------------------------------

/**
 * Detecta, por regex sobre o SQL já limpo, quais funções e tabelas a
 * migration menciona. Best-effort: alimenta a Fase 1-4 (o que é ALVO — o
 * resto do schema vira sobrevivente/controle negativo em
 * `particionarPorAlvo`), nunca a Fase 0 (que não depende disto).
 */
function detectarAlvos(sqlMigration) {
  const limpo = removerRuido(sqlMigration);
  const funcoes = new Set();
  const tabelas = new Set();

  const reFuncao =
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Medido em 25/08/2026: 0,23 ms contra 60 mil caracteres adversariais e
     * 0,04 ms contra a maior migration real do repositório (205 KB).
     * Entrada é sempre uma migration local já limpa por removerRuido, nunca
     * rede. */
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = reFuncao.exec(limpo))) funcoes.add(m[1]);

  const reAlter =
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Medido em 25/08/2026: 0,12 ms contra 60 mil caracteres adversariais e
     * 0,04 ms contra a maior migration real do repositório (205 KB). */
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  while ((m = reAlter.exec(limpo))) tabelas.add(m[1]);

  const reCreateTable =
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Medido em 25/08/2026: 0,07 ms contra 60 mil caracteres adversariais e
     * 0,04 ms contra a maior migration real do repositório (205 KB). */
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  while ((m = reCreateTable.exec(limpo))) tabelas.add(m[1]);

  const rePolicy =
    /(?:CREATE|DROP|ALTER)\s+POLICY\s+"?[^"\s]+"?\s+ON\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  while ((m = rePolicy.exec(limpo))) tabelas.add(m[1]);

  const reIndex =
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Medido em 25/08/2026: 0,22 ms contra 60 mil caracteres adversariais e
     * 0,24 ms contra a maior migration real do repositório (205 KB). */
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?[a-zA-Z_][a-zA-Z0-9_]*"?\s+ON\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  while ((m = reIndex.exec(limpo))) tabelas.add(m[1]);

  return { funcoes: [...funcoes], tabelas: [...tabelas] };
}

/**
 * Compara duas fotos (objetos JSON-serializáveis) recursivamente e devolve
 * a lista do que diferiu, com caminho pontuado — nunca só "diferente", pois
 * "quando forem diferentes, mostre O QUE diferiu" é exigência da tarefa.
 * Array (`colunas`, `policies`, `indices`, `constraints`, `triggers`) é
 * convertido para objeto indexado (`{0: ..., 1: ...}`) ANTES de comparar, em
 * vez de virar FOLHA comparada por igualdade de string inteira (C3): sem
 * isso, um `'light'::text` -> `'dark'::text` perdido no meio de 26 colunas
 * despejava as DUAS listas inteiras (~4 KB) no relatório de FALHOU só para
 * mostrar aquele campo. Descer por índice aponta só o item (e o campo
 * dentro dele) que realmente mudou.
 * Além de `diferencas` (string pronta para imprimir, formato inalterado),
 * devolve `detalhes`: os valores CRUS (`antes`/`depois`, não formatados) de
 * cada divergência, para quem quiser classificar conteúdo vs. formatação
 * (ver `resumirDivergencias`) sem reprocessar a string já montada.
 */
function compararFotos(a, b, caminho = "") {
  const diferencas = [];
  const detalhes = [];
  const chaves = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const chave of chaves) {
    let va = a ? a[chave] : undefined;
    let vb = b ? b[chave] : undefined;
    const p = caminho ? `${caminho}.${chave}` : chave;

    if (Array.isArray(va))
      va = Object.fromEntries(va.map((v, idx) => [idx, v]));
    if (Array.isArray(vb))
      vb = Object.fromEntries(vb.map((v, idx) => [idx, v]));

    const objA = va !== null && typeof va === "object";
    const objB = vb !== null && typeof vb === "object";
    if (objA && objB) {
      const sub = compararFotos(va, vb, p);
      diferencas.push(...sub.diferencas);
      detalhes.push(...sub.detalhes);
      continue;
    }
    const sa = JSON.stringify(va);
    const sb = JSON.stringify(vb);
    if (sa !== sb) {
      diferencas.push(`${p}: antes=${sa} depois=${sb}`);
      detalhes.push({ caminho: p, antes: va, depois: vb });
    }
  }
  return { igual: diferencas.length === 0, diferencas, detalhes };
}

/**
 * Separa divergências de CONTEÚDO das de só espaço/formatação — dá
 * resolução ao relatório de FALHOU (C5) sem afrouxar o veredito: o exit code
 * continua 3 nos dois casos, porque quem decide FALHOU vs SEM_DIVERGENCIA é
 * sempre `compararFotos` sem normalização nenhuma (é isso que "não
 * normalize" significa aqui). Esta função só rotula o relatório: colapsa
 * CORRIDAS de espaço (indentação diferente) para não gritar "conteúdo" numa
 * reindentação inofensiva. É um classificador BEST-EFFORT, não perfeito —
 * uma corrida de espaços que por acaso está dentro de um literal de string
 * também colapsa aqui (a lista de diferenças completa, sempre impressa, é
 * quem mostra a verdade byte-a-byte para quem for conferir). `JSON.stringify`
 * entra porque transforma quebra de linha real em `\n` literal (dois
 * caracteres, não mais espaço em branco), então a corrida de espaço só é
 * colapsada DENTRO de uma mesma linha, nunca através de linhas.
 */
function resumirDivergencias(detalhes) {
  const normalizar = (valor) =>
    String(JSON.stringify(valor)).replace(/\s+/g, " ").trim();
  let conteudo = 0;
  let formatacao = 0;
  for (const d of detalhes) {
    if (normalizar(d.antes) === normalizar(d.depois)) {
      formatacao += 1;
    } else {
      conteudo += 1;
    }
  }
  return { conteudo, formatacao };
}

/**
 * A decisão final, isolada em função pura para poder ser testada sem banco.
 * A ordem importa e é a mesma da Fase 1-4 do contrato:
 *   1. controle positivo não reagiu -> INSTRUMENTO-QUEBRADO (aprovaria um
 *      arquivo vazio).
 *   2. sem sobrevivente para comparar -> INSTRUMENTO-QUEBRADO ("0 objetos
 *      comparados" não é aprovação).
 *   3. sobrevivente mudou -> FALHOU (a mudança não foi cirúrgica).
 *   4. foto ANTES != foto FINAL -> FALHOU (rollback infiel).
 *   5. senão -> SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS.
 * Não existe `else` de sucesso por omissão: cada ramo acima é um estado
 * nomeado, e o último só é alcançado depois de todos os anteriores passarem.
 * O nome do último ramo é deliberadamente descritivo, não "PROVADO": ele diz
 * o que foi medido, nunca "está tudo certo" em sentido absoluto.
 */
function classificarResultado({
  controlePositivoIgual,
  temSobrevivente,
  controleNegativoIgual,
  fidelidadeIgual,
}) {
  if (controlePositivoIgual) {
    return {
      estado: "INSTRUMENTO_QUEBRADO",
      motivo:
        "a migration não mudou nada mensurável nos alvos detectados — o script aprovaria um arquivo vazio",
    };
  }
  if (!temSobrevivente) {
    return {
      estado: "INSTRUMENTO_QUEBRADO",
      motivo:
        "nenhum objeto sobrevivente disponível para o controle negativo (0 objetos comparados)",
    };
  }
  if (!controleNegativoIgual) {
    return {
      estado: "FALHOU",
      motivo:
        "controle negativo violado — o objeto que não deveria mudar, mudou",
    };
  }
  if (!fidelidadeIgual) {
    return {
      estado: "FALHOU",
      motivo: "rollback infiel — foto ANTES difere da foto FINAL",
    };
  }
  return { estado: "SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS", motivo: "" };
}

/**
 * Divide uma foto completa do schema `public` (ver `tirarFotoCompleta`) em
 * `alvo` (o que `detectarAlvos` reconheceu como tocado pela migration) e
 * `sobrevivente` (tudo o resto). Substitui `escolherSobrevivente`: em vez de
 * escolher UMA tabela arbitrária como controle negativo — que na prática era
 * sempre `_ninja_migrations`, um campo constante que não discriminava nada
 * (C9) — tudo que não é alvo passa a ser sobrevivente, de graça.
 */
function particionarPorAlvo(foto, alvos) {
  const tabelasAlvo = new Set(
    (alvos.tabelas || []).map((t) => t.toLowerCase()),
  );
  const funcoesAlvo = new Set(
    (alvos.funcoes || []).map((f) => f.toLowerCase()),
  );

  const alvo = { tabelas: {}, funcoes: {} };
  const sobrevivente = { tabelas: {}, funcoes: {} };

  for (const [nome, valor] of Object.entries(foto.tabelas || {})) {
    const destino = tabelasAlvo.has(nome.toLowerCase()) ? alvo : sobrevivente;
    destino.tabelas[nome] = valor;
  }
  for (const [nome, valor] of Object.entries(foto.funcoes || {})) {
    const destino = funcoesAlvo.has(nome.toLowerCase()) ? alvo : sobrevivente;
    destino.funcoes[nome] = valor;
  }

  return { alvo, sobrevivente };
}

// ---------------------------------------------------------------------------
// Resolução de caminho — migration e rollback-manual correspondente.
// ---------------------------------------------------------------------------

function resolverCaminhoMigration(arg) {
  if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;
  const relCwd = path.resolve(process.cwd(), arg);
  if (fs.existsSync(relCwd)) return relCwd;
  const relMigrations = path.join(MIGRATIONS_DIR, path.basename(arg));
  if (fs.existsSync(relMigrations)) return relMigrations;
  return null;
}

/**
 * Convenção do repositório: `rollback-manual-<nome-do-arquivo>.sql`, na raiz
 * do projeto (ver os ~19 arquivos hoje existentes com esse padrão).
 */
function resolverCaminhoRollback(migrationPath, argRollback) {
  if (argRollback) {
    return path.isAbsolute(argRollback)
      ? argRollback
      : path.resolve(process.cwd(), argRollback);
  }
  const nomeBase = path.basename(migrationPath);
  return path.join(PROJECT_ROOT, `rollback-manual-${nomeBase}`);
}

// ---------------------------------------------------------------------------
// Captura no banco (Fase 1-3). Nada aqui roda sem uma transação já aberta.
// ---------------------------------------------------------------------------

/**
 * Força a atribuição de um xid à transação atual chamando
 * `pg_current_xact_id()` — diferente de `pg_current_xact_id_if_assigned()`,
 * que devolve NULL enquanto a transação atual não escreveu nada ainda. É
 * essa diferença que resolve o C1: uma migration só de leitura, ou só de
 * comentário, nunca escreve nada, então `..._if_assigned()` confundia "nada
 * para escrever" com "transação encerrada" — a checagem de runtime abortava
 * como INSTRUMENTO_QUEBRADO num arquivo perfeitamente são, e o diagnóstico
 * CORRETO para arquivo vazio (que existe exatamente para provar isso) ficava
 * inalcançável. Chamado uma vez, logo depois do `BEGIN` do script.
 */
async function capturarXid(client) {
  const { rows } = await client.query(
    "SELECT pg_current_xact_id()::text AS xid",
  );
  return rows[0].xid;
}

/**
 * Verifica se a conexão ainda está DENTRO da MESMA transação identificada
 * por `xidEsperado` (capturado com `capturarXid` logo depois do BEGIN do
 * script) — em vez de perguntar "existe uma transação?" (ver `capturarXid`
 * para o porquê disso ser o C1). Qualquer forma de encerrar a transação
 * escondida na migration ou no rollback-manual — `COMMIT`, `END`,
 * `START TRANSACTION ... END`, `COMMIT AND CHAIN`, ou qualquer variante que
 * ninguém tenha enumerado — faz o Postgres atribuir um xid NOVO à próxima
 * chamada: ou porque uma nova transação explícita começou (`COMMIT AND
 * CHAIN`), ou porque a sessão caiu em modo autocommit e cada statement
 * seguinte vira sua própria mini-transação implícita. Nos dois casos o xid
 * muda, e é isso — não uma palavra reconhecida — que este SELECT detecta.
 */
async function estaEmTransacao(client, xidEsperado) {
  const { rows } = await client.query(
    "SELECT pg_current_xact_id()::text AS xid",
  );
  return rows[0].xid === xidEsperado;
}

/**
 * Fotografa TODO o schema `public` de uma vez: tabelas, views, matviews e
 * sequences (`relkind IN ('r','p','v','m','S')` — antes só `('r','p')`, o
 * que deixava view e matview INVISÍVEIS nos dois lados da comparação: uma
 * migration que cria uma view e um rollback que a esquece passava como
 * sucesso, porque nenhum dos dois lados sequer olhava para ela — B2), com
 * `relrowsecurity`, `relforcerowsecurity`, ACL, owner e a definição
 * (`pg_get_viewdef`, só para view/matview — `viewdef` fica `null` para o
 * resto), colunas, funções (com ACL), policies, índices, constraints (com a
 * definição real via `pg_get_constraintdef`, não só o tipo) e triggers. Sete
 * queries no total, sempre — não importa quantas tabelas o banco tenha. É
 * isto que fecha o C4 (RLS desligado pela migration e esquecido pelo
 * rollback passava como sucesso, porque `capturarTabela` nem olhava
 * `relrowsecurity`) e o C9 de graça (ver `particionarPorAlvo`).
 *
 * O que esta foto NÃO cobre — ver `DIMENSOES_NAO_MEDIDAS` para a lista
 * completa impressa a cada execução: dado de linha (DML), a definição
 * completa de uma sequence (start/increment/min/max/cycle — só existência,
 * ACL e owner entram), e qualquer objeto fora do schema `public`.
 */
async function tirarFotoCompleta(client) {
  const tabelasRaw = (
    await client.query(
      `SELECT c.relname AS nome, c.relkind, c.relrowsecurity,
              c.relforcerowsecurity, c.relacl::text AS acl,
              pg_get_userbyid(c.relowner) AS owner,
              CASE WHEN c.relkind IN ('v', 'm')
                   THEN pg_get_viewdef(c.oid)
                   ELSE NULL
              END AS viewdef
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        ORDER BY c.relname`,
    )
  ).rows;

  const colunas = (
    await client.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name`,
    )
  ).rows;

  const funcoesRaw = (
    await client.query(
      `SELECT p.proname AS nome, pg_get_functiondef(p.oid) AS def,
              p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY p.proname, pg_get_functiondef(p.oid)`,
    )
  ).rows;

  const policies = (
    await client.query(
      `SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname`,
    )
  ).rows;

  const indices = (
    await client.query(
      `SELECT tablename, indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname`,
    )
  ).rows;

  const constraints = (
    await client.query(
      `SELECT rel.relname AS tablename, con.conname, con.contype,
              pg_get_constraintdef(con.oid) AS definicao
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY rel.relname, con.conname`,
    )
  ).rows;

  const triggers = (
    await client.query(
      `SELECT rel.relname AS tablename, t.tgname,
              pg_get_triggerdef(t.oid) AS definicao
         FROM pg_trigger t
         JOIN pg_class rel ON rel.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ORDER BY rel.relname, t.tgname`,
    )
  ).rows;

  const foto = { tabelas: {}, funcoes: {} };

  for (const t of tabelasRaw) {
    foto.tabelas[t.nome] = {
      relkind: t.relkind,
      relrowsecurity: t.relrowsecurity,
      relforcerowsecurity: t.relforcerowsecurity,
      acl: t.acl,
      owner: t.owner,
      viewdef: t.viewdef,
      colunas: [],
      policies: [],
      indices: [],
      constraints: [],
      triggers: [],
    };
  }
  const tabela = (nome) => foto.tabelas[nome];
  for (const c of colunas) tabela(c.table_name)?.colunas.push(c);
  for (const p of policies) tabela(p.tablename)?.policies.push(p);
  for (const idx of indices) tabela(idx.tablename)?.indices.push(idx);
  for (const c of constraints) tabela(c.tablename)?.constraints.push(c);
  for (const t of triggers) tabela(t.tablename)?.triggers.push(t);

  for (const f of funcoesRaw) {
    if (!foto.funcoes[f.nome]) foto.funcoes[f.nome] = [];
    foto.funcoes[f.nome].push({ def: f.def, acl: f.acl, owner: f.owner });
  }

  return foto;
}

// ---------------------------------------------------------------------------
// Leitura de DATABASE_URL — mesmo padrão de scripts/db-apply.cjs e
// scripts/db-prove-checkout-060.cjs.
// ---------------------------------------------------------------------------

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    if (!fs.existsSync(caminho)) continue;
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) {
      return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
    }
  }
  return null;
}

const ESTADOS = {
  SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS: 0,
  RECUSADO: 2,
  FALHOU: 3,
  INSTRUMENTO_QUEBRADO: 4,
  INDETERMINADO: 5,
};

/**
 * Derivado de `ESTADOS` (fonte única) uma vez, no carregamento do módulo —
 * `Object.entries` é acesso estático, nunca indexação por variável. Resolver
 * o código de saída por `.get()` em vez de `ESTADOS[estado]` elimina o
 * warning `security/detect-object-injection` (C4) sem esconder o sinal: o
 * padrão perigoso (indexar objeto por string vinda de fora) deixou de
 * existir aqui, em vez de ser suprimido.
 */
const CODIGOS_DE_SAIDA = new Map(Object.entries(ESTADOS));

/**
 * Resolve o código de saída numérico de um estado. Nunca devolve
 * `undefined` — `process.exit(undefined)` sai com 0, que é exatamente o
 * formato de "o `else` da classificação virou sucesso": um estado novo ou um
 * typo faria um hook ou o CI lerem sucesso (C8). Estado desconhecido sai com
 * 1 (erro de uso), nunca com 0.
 */
function codigoDeSaida(estado) {
  const codigo = CODIGOS_DE_SAIDA.get(estado);
  return typeof codigo === "number" ? codigo : 1;
}

/**
 * O que este script COMPARA entre as fotos antes/depois/final, e o que ele
 * deliberadamente NÃO compara. Impresso sempre — sucesso ou falha — junto
 * com o veredito (ver `provarPar`): um veredito de sucesso que não diz o que
 * mediu é indistinguível de "provei tudo", e essa confusão é exatamente o
 * que autorizava um clique de aplicação que ninguém tinha verificado de
 * verdade.
 */
const DIMENSOES_MEDIDAS = [
  "tabelas e colunas (nome, tipo, nullable, default)",
  "views e matviews (definição via pg_get_viewdef)",
  "sequences (existência, ACL, owner — não a definição completa)",
  "RLS (relrowsecurity, relforcerowsecurity) e policies",
  "ACL e owner de tabelas, views, matviews, sequences e funções",
  "funções (corpo via pg_get_functiondef, ACL, owner)",
  "índices (definição via pg_indexes)",
  "constraints (definição via pg_get_constraintdef)",
  "triggers (definição via pg_get_triggerdef)",
];

const DIMENSOES_NAO_MEDIDAS = [
  "dado de linha (DML) — INSERT/UPDATE/DELETE de backfill não é comparado; " +
    "um rollback que esquece de desfazer um UPDATE de dado passa sem aviso",
  "definição completa de sequences (start/increment/min/max/cycle)",
  "objetos fora do schema public (extensions, outros schemas, storage)",
  "comportamento em runtime de função/trigger — só a DEFINIÇÃO é comparada, nunca o resultado de uma chamada real",
];

function textoDimensoes() {
  return [
    "",
    "dimensões MEDIDAS nesta prova:",
    ...DIMENSOES_MEDIDAS.map((d) => `  - ${d}`),
    "",
    "dimensões NÃO medidas (fora do alcance deste script — ver cabeçalho):",
    ...DIMENSOES_NAO_MEDIDAS.map((d) => `  - ${d}`),
  ].join("\n");
}

function sair(estado, mensagem) {
  console.log(`\n=== ${estado} ===${mensagem ? `\n${mensagem}` : ""}`);
  process.exit(codigoDeSaida(estado));
}

/**
 * Orquestra as Fases 1-4 (fotografar antes, aplicar migration, checar as
 * DUAS travas de runtime, aplicar rollback-manual, fotografar de novo,
 * classificar) DENTRO de uma transação já aberta pelo chamador — `client`
 * precisa já estar logo depois do `BEGIN` do script (o próprio `BEGIN` e o
 * `ROLLBACK` final continuam em `main()`, que é quem garante a rede de
 * segurança mesmo se algo daqui lançar). Extraído de dentro de `main()` para
 * poder ser exercitado por um client FALSO em teste, sem precisar de banco —
 * antes desta extração, esta orquestração só existia dentro de `main()`, que
 * nenhum teste chamava, e por isso um mutante que apagasse as duas
 * checagens de `estaEmTransacao` sobrevivia aos 27 testes (C2).
 */
async function provarPar(client, { sqlMigration, sqlRollback }) {
  const xidTransacao = await capturarXid(client);

  const alvos = detectarAlvos(sqlMigration);
  console.log(
    `\nalvos detectados — funções: ${alvos.funcoes.join(", ") || "(nenhuma)"}; ` +
      `tabelas: ${alvos.tabelas.join(", ") || "(nenhuma)"}`,
  );

  const fotoAntesCompleta = await tirarFotoCompleta(client);
  const { alvo: alvoAntes, sobrevivente: sobreviventeAntes } =
    particionarPorAlvo(fotoAntesCompleta, alvos);
  const temSobrevivente =
    Object.keys(sobreviventeAntes.tabelas).length > 0 ||
    Object.keys(sobreviventeAntes.funcoes).length > 0;
  console.log(
    temSobrevivente
      ? "sobrevivente (controle negativo): todo o schema public fora dos alvos detectados."
      : "sobrevivente (controle negativo): (nenhum objeto disponível fora dos alvos)",
  );

  let veredito = "INDETERMINADO";
  let detalhe = "não foi possível concluir a medição.";
  let abortou = false;

  // --- Fase 2 — aplica a migration ----------------------------------------
  try {
    await client.query(sqlMigration);
  } catch (e) {
    veredito = "FALHOU";
    detalhe = `migration falhou ao aplicar: ${e.message}`;
    abortou = true;
  }

  if (!abortou && !(await estaEmTransacao(client, xidTransacao))) {
    veredito = "INSTRUMENTO_QUEBRADO";
    detalhe =
      "a migration encerrou a transação aberta pelo script " +
      "(COMMIT/END/ROLLBACK/ABORT/START TRANSACTION escondido, ou forma " +
      "equivalente). O ROLLBACK final deste script é NO-OP: a migration " +
      "JÁ ESTÁ GRAVADA no banco, de forma permanente — o rollback-manual " +
      "não chegou a ser executado.";
    abortou = true;
  }

  let controlePositivo = { igual: true, diferencas: [], detalhes: [] };
  if (!abortou) {
    const fotoDepoisCompleta = await tirarFotoCompleta(client);
    const { alvo: alvoDepois } = particionarPorAlvo(fotoDepoisCompleta, alvos);
    controlePositivo = compararFotos(alvoAntes, alvoDepois);
    console.log(
      controlePositivo.igual
        ? "\ncontrole positivo: a migration NÃO mudou nada mensurável."
        : `\ncontrole positivo: a migration mudou ${controlePositivo.diferencas.length} campo(s).`,
    );
  }

  let controleNegativo = { igual: true, diferencas: [], detalhes: [] };
  let fidelidade = { igual: true, diferencas: [], detalhes: [] };

  if (!abortou && !controlePositivo.igual) {
    // --- Fase 3 — aplica o rollback-manual --------------------------------
    try {
      await client.query(sqlRollback);
    } catch (e) {
      veredito = "FALHOU";
      detalhe = `rollback-manual falhou ao aplicar: ${e.message}`;
      abortou = true;
    }

    if (!abortou && !(await estaEmTransacao(client, xidTransacao))) {
      veredito = "INSTRUMENTO_QUEBRADO";
      detalhe =
        "o rollback-manual encerrou a transação aberta pelo script " +
        "(COMMIT/END/ROLLBACK/ABORT/START TRANSACTION escondido, ou forma " +
        "equivalente) antes do ROLLBACK final do script. A migration (e a " +
        "parte do rollback-manual já executada até aí) JÁ ESTÁ GRAVADA no " +
        "banco, de forma permanente.";
      abortou = true;
    }

    if (!abortou) {
      const fotoFinalCompleta = await tirarFotoCompleta(client);
      const { alvo: alvoFinal, sobrevivente: sobreviventeFinal } =
        particionarPorAlvo(fotoFinalCompleta, alvos);

      controleNegativo = compararFotos(sobreviventeAntes, sobreviventeFinal);
      fidelidade = compararFotos(alvoAntes, alvoFinal);
    }
  }

  if (!abortou) {
    const classificacao = classificarResultado({
      controlePositivoIgual: controlePositivo.igual,
      temSobrevivente,
      controleNegativoIgual: controleNegativo.igual,
      fidelidadeIgual: fidelidade.igual,
    });
    veredito = classificacao.estado;

    if (veredito === "SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS") {
      detalhe = "foto ANTES == foto FINAL; sobrevivente intacto.";
    } else if (veredito === "FALHOU") {
      const comparacaoQueFalhou = !controleNegativo.igual
        ? controleNegativo
        : fidelidade;
      const resumo = resumirDivergencias(comparacaoQueFalhou.detalhes);
      detalhe = [
        classificacao.motivo,
        "",
        `divergências de conteúdo: ${resumo.conteudo}`,
        `divergências só de espaço/formatação: ${resumo.formatacao}`,
        "",
        ...comparacaoQueFalhou.diferencas.map((d) => `  ${d}`),
      ].join("\n");
    } else {
      detalhe = classificacao.motivo;
    }
  }

  return { veredito, detalhe: `${detalhe}\n${textoDimensoes()}` };
}

async function main() {
  const args = process.argv.slice(2);
  const migrationArg = args[0];
  if (!migrationArg) {
    console.error(
      "Uso: node scripts/db-prove-rollback.cjs <migration.sql> [--rollback <arquivo>]",
    );
    process.exit(1);
  }
  const idxRollback = args.indexOf("--rollback");
  const rollbackArg = idxRollback !== -1 ? args[idxRollback + 1] : null;

  const migrationPath = resolverCaminhoMigration(migrationArg);
  if (!migrationPath) {
    console.error(`Migration não encontrada: ${migrationArg}`);
    process.exit(1);
  }
  const rollbackPath = resolverCaminhoRollback(migrationPath, rollbackArg);
  const sqlMigration = fs.readFileSync(migrationPath, "utf8");
  const temRollback = fs.existsSync(rollbackPath);

  console.log(`migration: ${migrationPath}`);
  console.log(
    `rollback-manual: ${rollbackPath}${temRollback ? "" : " (NAO ENCONTRADO)"}`,
  );

  // --- Fase 0 — sem banco -------------------------------------------------
  const fase0 = avaliarFase0({ sqlMigration, temRollback });
  if (fase0.recusado) {
    sair("RECUSADO", fase0.motivos.map((m) => `  - ${m}`).join("\n"));
    return;
  }
  console.log("\nFase 0: nenhuma recusa estática.");

  const sqlRollback = fs.readFileSync(rollbackPath, "utf8");

  // --- A partir daqui, precisa de banco ------------------------------------
  const databaseUrl = lerDatabaseUrl();
  if (!databaseUrl) {
    sair("INDETERMINADO", "DATABASE_URL não encontrada — não dá para medir.");
    return;
  }

  let Client;
  try {
    Client = require("pg").Client;
  } catch {
    sair("INDETERMINADO", "Pacote 'pg' não instalado — não dá para medir.");
    return;
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
  } catch (e) {
    sair("INDETERMINADO", `Falha ao conectar no banco: ${e.message}`);
    return;
  }

  let veredito = "INDETERMINADO";
  let detalhe = "não foi possível concluir a medição.";

  try {
    await client.query("BEGIN");
    try {
      const resultado = await provarPar(client, { sqlMigration, sqlRollback });
      veredito = resultado.veredito;
      detalhe = resultado.detalhe;
    } finally {
      // Fase 4 — SEMPRE ROLLBACK, com sucesso ou com exceção no meio. Se a
      // transação já foi encerrada por um COMMIT/END escondido (detectado
      // acima e já reportado como INSTRUMENTO_QUEBRADO), isto só emite o
      // aviso inofensivo do Postgres "there is no transaction in progress" —
      // nunca aplica nada de novo.
      await client.query("ROLLBACK").catch(() => {});
    }
  } catch (e) {
    veredito = "INDETERMINADO";
    detalhe = `erro durante a medição: ${e.message}`;
  } finally {
    await client.end();
  }

  sair(veredito, detalhe);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}

module.exports = {
  SqlMalformadoError,
  removerRuido,
  detectarCreateFunctionCru,
  detectarTransacaoExplicita,
  avaliarFase0,
  detectarAlvos,
  compararFotos,
  resumirDivergencias,
  classificarResultado,
  particionarPorAlvo,
  capturarXid,
  estaEmTransacao,
  tirarFotoCompleta,
  provarPar,
  codigoDeSaida,
  resolverCaminhoMigration,
  resolverCaminhoRollback,
  DIMENSOES_MEDIDAS,
  DIMENSOES_NAO_MEDIDAS,
  ESTADOS,
};
