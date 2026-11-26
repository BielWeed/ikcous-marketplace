/* eslint-disable security/detect-non-literal-fs-filename -- lê só os .sql da pasta de migrations deste repositório (caminho resolvido aqui ou passado por quem chama, nunca de rede). */
/**
 * instalador-banco.mjs — o BANCO da loja nova, do zero, pela Management API
 * (L4b, T6–T8, 26/11/2026). Quem chama é o orquestrador `nova-loja.mjs`
 * (passo `banco`); quem fala HTTP é o cliente da Management API (T2). Este
 * módulo não abre conexão nem lê segredo: recebe um `cliente` e devolve o que
 * aconteceu.
 *
 * POR QUE EXISTE (ensaio de 25/11, `equipe/escala-de-assinantes/
 * ENSAIO-INSTALACAO-DO-ZERO.md`): a fila aplica 276/276 num banco vazio, MAS
 *   - rodar de novo QUEBRA: 115 das 276 não são idempotentes (muitas recusam
 *     de propósito com B1_BASELINE_DIVERGENT). Retomar é "fila menos o
 *     ledger", nunca "reaplicar tudo";
 *   - o ledger (`supabase_migrations.schema_migrations`) não nasce sozinho, e
 *     o portão da publicação (`versoesAplicadas` em publicar-release.mjs)
 *     TRAVA com ledger vazio. `POST /database/migrations` não aceita a versão,
 *     então o registro vai pelo `POST /database/query`, DENTRO da mesma
 *     transação do corpo (falhou um, volta o outro);
 *   - a ordem é por TEXTO: as duas versões de 13 dígitos (2026110000000 e
 *     2026110000100) caem nas posições 83/84; em ordem numérica cairiam antes
 *     da baseline e quebrariam.
 *
 * AS TRÊS PEÇAS:
 *   planejarInstalacao(estado, arquivos)  pura: decide recusar / instalar / nada.
 *   envelopeDoArquivo(arquivo)            pura: o SQL de UMA requisição.
 *   instalar(cliente, plano, {aplicar})   executa; sem `aplicar: true` só lê.
 *                                         Toda chamada passa pelo ritmo da
 *                                         Management API (clienteComRitmo).
 *
 * CONTRATO DO CLIENTE (o T2 implementa):
 *   cliente.consultar(sql) → Promise<Array<object>> com as linhas do ÚLTIMO
 *   comando. Rejeita com um Error que tem `tipo`:
 *     "sql"  — SÓ quando o corpo da resposta é um erro do PRÓPRIO Postgres
 *              com SQLSTATE (`codigo` = o SQLSTATE de 5 caracteres). Como o
 *              envelope é BEGIN…COMMIT numa requisição só, o COMMIT não
 *              rodou: nada daquele arquivo ficou gravado. Resposta do GATEWAY
 *              (413, 429, 401, 403, 5xx, corpo sem SQLSTATE) NÃO é "sql",
 *              mesmo que ela diga que nada rodou: o instalador não adivinha;
 *     qualquer outro (timeout, rede, HTTP do gateway, erro sem tipo) — a
 *              requisição pode ter comitado e perdido a resposta. ESTADO
 *              DESCONHECIDO: para, não repete, e manda conferir o ledger (que
 *              diz a verdade porque o registro vai na mesma transação do corpo).
 *
 * A MARCA DE INSTALAÇÃO (`supabase_migrations.ikcous_instalacao`, linha id=1;
 * revisão Opus de 26/11, bloqueante 2): nasce na MESMA transação do ledger e
 * só ganha `concluida_em` depois da conferência final. Ledger NÃO vazio só se
 * retoma com a marca EM CURSO; sem marca (todas as lojas de hoje) ou com ela
 * concluída é "loja já instalada" e RECUSA: loja que vende e está atrasada
 * recebe migration nova pelo aplicar-migrations.yml (portão de publicação),
 * nunca por aqui. (Guarda por store_config não serve: toda loja instalada tem
 * a ficha id=1 — quem a semeia é a 20261540000000, na própria fila, e antes
 * dela nenhuma migration a gravava: os INSERT das antigas estão dentro do corpo
 * de upsert_store_config. A linha não distingue loja instalada de loja que
 * vende.) A ÚNICA exceção é a loja que ESTE instalador
 * terminou e que está completa (marca concluída + ledger == fila inteira):
 * rodar de novo dá JA_INSTALADA, saída de sucesso, só leituras (26/11/2026;
 * antes devolvia o mesmo RECUSADO das recusas perigosas).
 *
 * OS PRIVILÉGIOS PADRÃO DE PUBLIC (26/11/2026): desde 30/05/2026 projeto
 * Supabase NOVO nasce sem o `ALTER DEFAULT PRIVILEGES` que dava acesso a
 * anon/authenticated/service_role em toda tabela, sequência e função nova de
 * public — e as migrations contam com ele (a baseline não tem GRANT). Sem ele,
 * a loja nova nasce com 42501 na vitrine e no painel, ou uma guarda de
 * migration recusa no meio. Os 9 comandos (scripts/ci/banco/
 * privilegios-padrao.cjs, os MESMOS do banco do CI) vão DENTRO da transação
 * do DDL do ledger e da marca: nascem juntos ou não nascem, e por isso
 * "ledger com versão" implica "privilégios aplicados antes da 1ª migration".
 * Toda rodada que grava reaplica o DDL (idempotente: conceder de novo não muda
 * nada) e CONFERE o pg_default_acl antes de enviar qualquer migration (ou de
 * marcar concluída): não bateu, FALHOU, nada enviado. A retomada (e o "nada")
 * lê ANTES do DDL também: se achou faltando (alguém revogou entre rodadas, ou
 * o banco foi começado antes desta trava), FALHA FECHADA sem gravar nada —
 * decisão da hub, 26/11/2026: reaplicar e seguir esconderia as tabelas que
 * nasceram sem acesso enquanto faltava. A mensagem diz o que conferir e traz
 * o SQL para reaplicar à mão; depois disso, a rodada seguinte segue.
 *
 * O QUE ESTE MÓDULO ASSUME (e a prova viva tests/banco/instalador-nova-loja-
 * viva.cjs mede num Postgres 17): a requisição é UMA sessão e o texto inteiro
 * roda como uma consulta simples (o Postgres analisa a string toda antes de
 * executar: erro de sintaxe em qualquer ponto não roda nada). Que a Management
 * API se comporta assim é o que o "gate de transporte" de
 * aplicar-migrations.yml prova a cada run; o T1 (P3) mede na loja real.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// listarMigrations: a MESMA régua da fila que o db-ci usa (raiz, 13 ou 14
// dígitos, sem rollback-manual-*, sem subpasta, ordem de texto).
const { listarMigrations } = require("../ci/banco/util.cjs");
// dividirEmStatements/contarStatements: o lexer que o aplicar-migrations.yml
// usa para recusar controle de transação no topo (dollar-quote com tag de
// dígito, E'\'', comentário aninhado). `instrucoesDeNivelDeTopo` de util.cjs
// NÃO serve aqui: o lexer dele não reconhece tag com dígito ($preflight_2026…$)
// e acusava 2190 falsos BEGIN/END nas 276 migrations reais (medido 26/11).
const {
  dividirEmStatements,
  contarStatements,
} = require("../publicacao/conferir-banco.cjs");

// Os DEFAULT PRIVILEGES de fábrica de public (ALL em tabela/sequência e
// EXECUTE em função nova para anon, authenticated e service_role) e a
// conferência deles no pg_default_acl: a MESMA fonte que o banco efêmero do CI
// usa (provisionar-efemero.cjs). Projeto Supabase novo nasce sem essa regra
// desde 30/05/2026; as migrations contam com ela (baseline sem GRANT).
const {
  comandosDosPrivilegiosPadrao,
  SQL_CONFERIR_PRIVILEGIOS_PADRAO,
} = require("../ci/banco/privilegios-padrao.cjs");

const PASTA_MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

/** Quem entra na fila: o mesmo filtro de `listarMigrations` (só o nome, sem
 * pasta). Quem entra na fila e tem nome fora de `NOME_VALIDO` é RECUSADO, não
 * some: o nome vai literal no SQL do ledger. */
const DA_FILA = /^\d{13,14}_.*\.sql$/;
const NOME_VALIDO = /^(\d{13,14})_([a-z0-9_-]+)\.sql$/;

/** O mesmo regex de aplicar-migrations.yml (CONTROLE_DE_TRANSACAO): só o que
 * ENCERRA ou REABRE a transação do envelope. SAVEPOINT, RELEASE e ROLLBACK TO
 * não encerram: passam. */
const CONTROLE_DE_TRANSACAO =
  /^(BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|ROLLBACK(?!\s+(TO|PREPARED)\b)|PREPARE\s+TRANSACTION|SET\s+TRANSACTION)\b/;

export const SQL_ESTADO =
  "SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))::int AS tabelas_em_public, to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_existe, to_regclass('supabase_migrations.ikcous_instalacao') IS NOT NULL AS marca_existe;";
export const SQL_LEDGER =
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;";
export const SQL_MARCA =
  "SELECT concluida_em IS NOT NULL AS concluida FROM supabase_migrations.ikcous_instalacao WHERE id = 1;";
export const SQL_CONCLUIR =
  "UPDATE supabase_migrations.ikcous_instalacao SET concluida_em = now() WHERE id = 1 AND concluida_em IS NULL;";
/** Leitura: `papel_dono` e `faltando` ('' = os privilégios padrão batem). */
export const SQL_PRIVILEGIOS = SQL_CONFERIR_PRIVILEGIOS_PADRAO;

const MARCAS = new Set(["ausente", "em_curso", "concluida"]);
const LOJA_JA_INSTALADA =
  "loja já instalada; migration nova vai pelo aplicar-migrations.yml";

const RECEITA_DE_RESET =
  "Este instalador NUNCA instala por cima. Se o projeto é mesmo da loja nova e não tem dado de ninguém, a receita de reset medida no ensaio de 25/11 (ENSAIO-INSTALACAO-DO-ZERO.md, seção 2.1) é: apagar as 11 políticas das migrations em storage.objects, os 4 buckets em storage.buckets (banners, branding, devolucoes, products) e as 4 tarefas em cron.job (devolver-cupons-de-pedidos-mortos, expirar-pedidos-vencidos, reconciliar-pagamentos e, desde a 20261510000000, limpar-livro-de-registro), e então DROP SCHEMA public CASCADE + recriar o public com as permissões padrão. Apagar só o public NÃO basta (82 migrations falham depois). É decisão do dono, com o SQL na frente dele.";

// ─── T6: o plano ────────────────────────────────────────────────────────────

function estadoLegivel(e) {
  return (
    e !== null &&
    typeof e === "object" &&
    Number.isInteger(e.tabelasEmPublic) &&
    e.tabelasEmPublic >= 0 &&
    typeof e.ledgerExiste === "boolean" &&
    Array.isArray(e.versoesNoLedger) &&
    e.versoesNoLedger.every((v) => typeof v === "string") &&
    (e.ledgerExiste || e.versoesNoLedger.length === 0) &&
    MARCAS.has(e.marca) &&
    // a marca nasce na MESMA transação do ledger: marca sem ledger não existe
    (e.ledgerExiste || e.marca === "ausente")
  );
}

const recusa = (motivo, estado) => ({
  acao: "recusar",
  motivo,
  estado,
  fila: [],
  jaNoLedger: 0,
  total: 0,
});

/**
 * Decide, sem tocar em nada, o que a instalação faria.
 *
 * @param estadoObservado {tabelasEmPublic, ledgerExiste, versoesNoLedger} (de lerEstado)
 * @param arquivosDoRepo  [{arquivo, corpo}] — `arquivo` é o nome (ou caminho
 *        relativo; quem tem pasta no caminho não é da fila)
 * @returns {acao: "recusar"|"instalar"|"nada"|"ja_instalada", motivo, estado,
 *          fila: [{arquivo, versao, nome, envelope}], jaNoLedger, total}
 */
export function planejarInstalacao(estadoObservado, arquivosDoRepo) {
  const estado = estadoObservado;
  if (!estadoLegivel(estado)) {
    return recusa(
      "RECUSADO: estado do banco ilegível (esperava tabelasEmPublic inteiro >= 0, ledgerExiste booleano, versoesNoLedger lista de texto e marca ausente|em_curso|concluida, sem marca quando não há ledger). Ledger não lido nunca vira 'nada falta'.",
      estado,
    );
  }
  if (!Array.isArray(arquivosDoRepo)) {
    return recusa(
      "RECUSADO: lista de arquivos do repositório ilegível.",
      estado,
    );
  }

  const fila = arquivosDoRepo
    .filter((a) => typeof a?.arquivo === "string" && DA_FILA.test(a.arquivo))
    .sort((a, b) =>
      a.arquivo < b.arquivo ? -1 : a.arquivo > b.arquivo ? 1 : 0,
    );

  const porVersao = new Map();
  for (const a of fila) {
    const m = NOME_VALIDO.exec(a.arquivo);
    if (!m) {
      return recusa(
        `RECUSADO: ${a.arquivo} está na fila mas o nome foge do padrão <13 ou 14 dígitos>_<a-z 0-9 _ ->.sql (o nome vai literal no ledger).`,
        estado,
      );
    }
    if (porVersao.has(m[1])) {
      return recusa(
        `RECUSADO: versão ${m[1]} repetida no repositório (${porVersao.get(m[1])} e ${a.arquivo}); o ledger guardaria só uma e a outra seria reaplicada na retomada.`,
        estado,
      );
    }
    porVersao.set(m[1], a.arquivo);
  }
  if (fila.length === 0) {
    return recusa(
      "RECUSADO: fila vazia — nenhuma migration <13 ou 14 dígitos>_*.sql na pasta (pasta errada?).",
      estado,
    );
  }

  const noLedger = new Set(estado.versoesNoLedger);
  // Ledger com versões = algo já rodou. Só ESTE instalador, no meio do
  // caminho (marca em curso), pode continuar; o resto é loja instalada, e
  // migration nova numa loja instalada passa pelo portão de publicação.
  // A instalada por ESTE instalador e COMPLETA (o ledger é exatamente a fila)
  // não é recusa: é "já instalada", sucesso sem gravar.
  if (
    estado.marca === "concluida" &&
    estado.tabelasEmPublic > 0 &&
    noLedger.size === porVersao.size &&
    [...noLedger].every((v) => porVersao.has(v))
  ) {
    return {
      acao: "ja_instalada",
      motivo: `JÁ INSTALADA: as ${fila.length} migrations da fila estão no ledger e a marca de instalação está concluída. Nada a fazer aqui; migration nova vai pelo aplicar-migrations.yml.`,
      estado,
      fila: [],
      jaNoLedger: noLedger.size,
      total: fila.length,
    };
  }
  if (noLedger.size > 0 && estado.marca !== "em_curso") {
    return recusa(
      `RECUSADO: ${LOJA_JA_INSTALADA} (o ledger registra ${noLedger.size} versão(ões) e a marca de instalação está ${estado.marca === "concluida" ? "concluída" : "ausente — não foi este instalador que começou este banco"}). Nada se aplica por aqui.`,
      estado,
    );
  }
  if (noLedger.size === 0 && estado.marca === "concluida") {
    return recusa(
      "RECUSADO: estado incoerente — a marca de instalação diz concluída, mas o ledger está vazio. Diagnóstico antes de qualquer apply.",
      estado,
    );
  }
  const estranhas = [...noLedger].filter((v) => !porVersao.has(v)).sort();
  if (estranhas.length > 0) {
    return recusa(
      `RECUSADO: o ledger registra ${estranhas.join(", ")}, que não existe no repositório deste checkout (checkout velho, ou ledger que não foi este instalador que escreveu). Nada se aplica; diagnóstico antes.`,
      estado,
    );
  }

  if (noLedger.size === 0 && estado.tabelasEmPublic > 0) {
    return recusa(
      `RECUSADO: o banco não está vazio (${estado.tabelasEmPublic} tabela(s) em public) e o ledger ${estado.ledgerExiste ? "existe mas está vazio" : "não existe"}: não sei o que já rodou, e 115 das 276 migrations quebram se rodarem de novo. Receita de reset: ${RECEITA_DE_RESET}`,
      estado,
    );
  }
  if (noLedger.size > 0 && estado.tabelasEmPublic === 0) {
    return recusa(
      `RECUSADO: estado incoerente — o ledger registra ${noLedger.size} versão(ões) mas public não tem tabela nenhuma (alguém apagou o public?). Diagnóstico antes de qualquer apply.`,
      estado,
    );
  }

  // O ledger tem de ser um PREFIXO da fila: retomar com lacuna aplicaria uma
  // migration antiga DEPOIS de uma mais nova (regressão silenciosa).
  const primeiraFaltando = fila.findIndex(
    (a) => !noLedger.has(a.arquivo.split("_")[0]),
  );
  if (primeiraFaltando >= 0) {
    const depois = fila
      .slice(primeiraFaltando + 1)
      .filter((a) => noLedger.has(a.arquivo.split("_")[0]));
    if (depois.length > 0) {
      return recusa(
        `RECUSADO: o ledger tem lacuna — falta ${fila.at(primeiraFaltando).arquivo} mas já registra ${depois.map((a) => a.arquivo).join(", ")}. Retomar aplicaria fora de ordem. Diagnóstico antes.`,
        estado,
      );
    }
  }

  const pendentes = fila.filter((a) => !noLedger.has(a.arquivo.split("_")[0]));
  const itens = [];
  for (const a of pendentes) {
    const m = NOME_VALIDO.exec(a.arquivo);
    let envelope;
    try {
      envelope = envelopeDoArquivo(a);
    } catch (e) {
      return recusa(
        `${e.message} (nada foi aplicado: o plano inteiro é recusado antes da 1ª gravação)`,
        estado,
      );
    }
    itens.push({ arquivo: a.arquivo, versao: m[1], nome: m[2], envelope });
  }

  return {
    acao: itens.length === 0 ? "nada" : "instalar",
    motivo:
      itens.length === 0
        ? `nada a aplicar: as ${fila.length} migrations da fila já estão no ledger; falta só marcar a instalação como concluída`
        : noLedger.size === 0
          ? `instalação do zero: ${itens.length} migrations, em ordem de texto`
          : `retomada: ${noLedger.size} já no ledger, faltam ${itens.length} (a partir de ${itens[0].arquivo})`,
    estado,
    fila: itens,
    jaNoLedger: noLedger.size,
    total: fila.length,
  };
}

/** Os arquivos da fila deste repositório, com o corpo, pela régua do db-ci. */
export function arquivosDoRepo(pasta = PASTA_MIGRATIONS) {
  return listarMigrations(pasta).map((caminho) => ({
    arquivo: path.basename(caminho),
    corpo: fs.readFileSync(caminho, "utf8"),
  }));
}

// ─── T7: o envelope ─────────────────────────────────────────────────────────

/** Pula espaço e comentários (de linha e de bloco ANINHÁVEL, como o Postgres)
 * até a primeira palavra do comando — cópia de inicioDoStatement de
 * aplicar-migrations.yml. */
function inicioDoStatement(s) {
  let i = 0;
  for (;;) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    if (s.startsWith("--", i)) {
      while (i < s.length && s.charAt(i) !== "\n" && s.charAt(i) !== "\r") i++;
      continue;
    }
    if (s.startsWith("/*", i)) {
      let nivel = 1;
      i += 2;
      while (i < s.length && nivel > 0) {
        if (s.startsWith("/*", i)) {
          nivel++;
          i += 2;
        } else if (s.startsWith("*/", i)) {
          nivel--;
          i += 2;
        } else i++;
      }
      continue;
    }
    break;
  }
  return s.slice(i).toUpperCase();
}

/**
 * O SQL de UMA requisição: `BEGIN;` + corpo + registro no ledger + `COMMIT;`.
 * O registro vai DENTRO da transação: se o corpo falha, o registro não
 * acontece; se o registro falha, o corpo volta. Formato de
 * aplicar-migrations.yml (`(version, name)`, `statements` fica NULL), MAS SEM
 * `ON CONFLICT`: versão já registrada (outro instalador, reenvio) dá 23505 e a
 * transação inteira volta. Com `ON CONFLICT DO NOTHING` o reenvio de uma
 * versão antiga regravava o corpo dela por cima do de uma mais nova, sem erro
 * (revisão Opus de 26/11, bloqueante 1: taxa() de 0,05 voltava a 0,10).
 * LANÇA (RECUSADO) se o corpo tem controle de transação no topo (encerraria o
 * envelope no meio), não termina em ';' ou o nome foge do padrão.
 */
export function envelopeDoArquivo({ arquivo, corpo } = {}) {
  const m = NOME_VALIDO.exec(typeof arquivo === "string" ? arquivo : "");
  if (!m) {
    throw new Error(
      `RECUSADO (nome fora do padrão <13 ou 14 dígitos>_<a-z 0-9 _ ->.sql): ${arquivo}`,
    );
  }
  if (typeof corpo !== "string" || contarStatements(corpo) === 0) {
    throw new Error(`RECUSADO (arquivo sem nenhum comando): ${arquivo}`);
  }
  for (const s of dividirEmStatements(corpo)) {
    if (CONTROLE_DE_TRANSACAO.test(inicioDoStatement(s))) {
      throw new Error(
        `RECUSADO (controle de transação no topo do arquivo; o envelope comitaria pela metade): ${arquivo}`,
      );
    }
  }
  if (contarStatements(`${corpo}\nSELECT 1`) === contarStatements(corpo)) {
    throw new Error(
      `RECUSADO (o arquivo termina sem ponto e vírgula): ${arquivo}`,
    );
  }
  const registro = `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${m[1]}', '${m[2]}');`;
  return `BEGIN;\n${corpo}\n${registro}\nCOMMIT;\n`;
}

/** Os privilégios padrão de public (os 9 comandos de privilegios-padrao.cjs,
 * ver o cabeçalho), o ledger no formato do CLI do Supabase (as mesmas 4
 * instruções de pkg/migration/history.go: tabela só com version, depois as
 * colunas) E a marca de instalação, numa transação só (nascem juntos ou não
 * nascem) e idempotente: rodar duas vezes não muda nada (conceder de novo é
 * nada; a linha da marca que já existe, em curso, fica como está). Só roda
 * quando o plano é "instalar" ou "nada", isto é, ledger vazio ou marca em
 * curso: nunca numa loja já instalada. */
export function ddlDoLedger() {
  // Uma instrução por linha; o "" final dá o "\n" depois do COMMIT.
  return [
    "BEGIN;",
    ...comandosDosPrivilegiosPadrao().map((c) => `${c};`),
    "CREATE SCHEMA IF NOT EXISTS supabase_migrations;",
    "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY);",
    "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];",
    "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;",
    "CREATE TABLE IF NOT EXISTS supabase_migrations.ikcous_instalacao (id int PRIMARY KEY CHECK (id = 1), iniciada_em timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz);",
    "INSERT INTO supabase_migrations.ikcous_instalacao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;",
    "COMMIT;",
    "",
  ].join("\n");
}

// ─── T8: a execução ─────────────────────────────────────────────────────────

/** Até três LEITURAS: quantas tabelas em public, se o ledger e a marca
 * existem, o que o ledger registra e se a marca está concluída. Resposta fora
 * do formato LANÇA (nunca vira "vazio"). Tabela da marca sem a linha 1 conta
 * como "ausente" (não foi este instalador que a deixou assim). */
export async function lerEstado(cliente) {
  const linhas = await cliente.consultar(SQL_ESTADO);
  const l = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (
    !l ||
    !Number.isInteger(l.tabelas_em_public) ||
    typeof l.ledger_existe !== "boolean" ||
    typeof l.marca_existe !== "boolean"
  ) {
    throw new Error(
      `resposta do estado fora do formato: ${JSON.stringify(linhas)?.slice(0, 200)}`,
    );
  }
  let versoes = [];
  if (l.ledger_existe) {
    const r = await cliente.consultar(SQL_LEDGER);
    if (!Array.isArray(r) || !r.every((x) => typeof x?.version === "string")) {
      throw new Error(
        `resposta do ledger fora do formato: ${JSON.stringify(r)?.slice(0, 200)}`,
      );
    }
    versoes = r.map((x) => x.version);
  }
  let marca = "ausente";
  if (l.marca_existe) {
    const r = await cliente.consultar(SQL_MARCA);
    if (
      !Array.isArray(r) ||
      r.length > 1 ||
      (r.length === 1 && typeof r[0]?.concluida !== "boolean")
    ) {
      throw new Error(
        `resposta da marca fora do formato: ${JSON.stringify(r)?.slice(0, 200)}`,
      );
    }
    if (r.length === 1) marca = r[0].concluida ? "concluida" : "em_curso";
  }
  return {
    tabelasEmPublic: l.tabelas_em_public,
    ledgerExiste: l.ledger_existe,
    versoesNoLedger: versoes,
    marca,
  };
}

function mesmoEstado(a, b) {
  const va = [...a.versoesNoLedger].sort().join(",");
  const vb = [...b.versoesNoLedger].sort().join(",");
  return (
    a.ledgerExiste === b.ledgerExiste &&
    a.tabelasEmPublic > 0 === b.tabelasEmPublic > 0 &&
    a.marca === b.marca &&
    va === vb
  );
}

const DICA_DO_LEDGER =
  "O DDL do ledger é idempotente: conferir se supabase_migrations.schema_migrations e supabase_migrations.ikcous_instalacao existem (nascem juntos ou não nascem).";
const DICA_DA_MARCA =
  "As migrations já estavam todas conferidas no ledger; só a marca de conclusão ficou em dúvida. Rodar de novo: o plano dá 'nada' e marca.";

function falhaDeEscrita(erro, arquivo, versao, aplicados, dica) {
  const msg = String(erro?.message ?? erro).slice(0, 500);
  if (erro?.tipo === "sql") {
    const codigo = erro.codigo ?? "?";
    return {
      estado: "FALHOU",
      arquivo,
      codigo,
      aplicados,
      mensagem: `FALHOU em ${arquivo} (código ${codigo}): ${msg}. O banco recusou dentro da transação: nada deste arquivo foi gravado, e os ${aplicados.length} anteriores desta rodada estão no ledger. Corrija e rode de novo: a retomada começa por este arquivo.`,
    };
  }
  return {
    estado: "ESTADO_DESCONHECIDO",
    arquivo,
    codigo: erro?.codigo ?? erro?.tipo ?? "?",
    aplicados,
    mensagem: `ESTADO DESCONHECIDO: confira o ledger antes de qualquer nova tentativa. ${arquivo} foi enviado e a resposta não veio (${msg}): a transação pode ter comitado ou voltado inteira. ${versao ? `Se a versão ${versao} estiver em supabase_migrations.schema_migrations, comitou; se não estiver, nada dela ficou.` : dica} Nada foi repetido; rodar o instalador de novo relê o ledger e retoma do ponto certo.`,
  };
}

// ─── O ritmo da Management API ──────────────────────────────────────────────

/**
 * A Management API aceita 120 pedidos por minuto por projeto e por endpoint;
 * passou disso, responde 429 até o fim da janela
 * (https://supabase.com/docs/reference/api/introduction, "Rate limits",
 * conferido em 26/11/2026). A fila inteira são ~290 pedidos ao MESMO
 * database/query, e um banco vazio aplica cada um em milissegundos: sem ritmo,
 * o 121º toma 429. A doc NÃO diz que o 429 é recusado antes de executar, então
 * um 429 num envelope continua sendo ESTADO DESCONHECIDO (como qualquer
 * resposta do gateway) e nunca se repete sozinho: o jeito é não chegar ao
 * limite. Entre o FIM de uma resposta e o envio seguinte passam ao menos
 * INTERVALO_MINIMO_MS; como cada pedido chega ao servidor antes da própria
 * resposta, chegam no máximo ~100 em qualquer janela de 60 s, com folga para
 * as leituras de quem chama.
 */
export const INTERVALO_MINIMO_MS = 600;

/**
 * O `cliente` com ritmo: cada `consultar` espera, se preciso, até
 * `intervaloMs` depois do fim da chamada anterior (com erro ou sem). Nunca
 * repete nada. `ritmo` (injetável; o teste usa relógio falso):
 *   intervaloMs  inteiro >= 0 (0 = sem espera: banco local, sem limite);
 *                qualquer outro valor vale INTERVALO_MINIMO_MS (torto nunca
 *                fica mais rápido);
 *   agora        () => ms (padrão: performance.now, que não anda para trás);
 *   esperar      (ms) => Promise (padrão: setTimeout).
 * A espera nunca passa de `intervaloMs`: um relógio que volta para trás não
 * trava a instalação.
 */
export function clienteComRitmo(cliente, ritmo = {}) {
  const iv = ritmo?.intervaloMs;
  const intervaloMs =
    Number.isSafeInteger(iv) && iv >= 0 ? iv : INTERVALO_MINIMO_MS;
  const agora =
    typeof ritmo?.agora === "function"
      ? ritmo.agora
      : () => globalThis.performance.now();
  const esperar =
    typeof ritmo?.esperar === "function"
      ? ritmo.esperar
      : (ms) => new Promise((ok) => setTimeout(ok, ms));
  let fimDaAnterior = null;
  return {
    async consultar(sql) {
      if (fimDaAnterior !== null && intervaloMs > 0) {
        const falta = Math.min(
          intervaloMs,
          fimDaAnterior + intervaloMs - agora(),
        );
        if (falta > 0) await esperar(falta);
      }
      try {
        return await cliente.consultar(sql);
      } finally {
        fimDaAnterior = agora();
      }
    },
  };
}

/** Lê a conferência dos privilégios padrão (SÓ leitura). Resposta fora do
 * formato LANÇA: nunca vira "bate". */
export async function lerPrivilegiosPadrao(cliente) {
  const linhas = await cliente.consultar(SQL_PRIVILEGIOS);
  const l = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (
    !l ||
    typeof l.papel_dono !== "string" ||
    typeof l.faltando !== "string"
  ) {
    throw new Error(
      `resposta da conferência dos privilégios padrão fora do formato: ${JSON.stringify(linhas)?.slice(0, 200)}`,
    );
  }
  return { papelDono: l.papel_dono, faltando: l.faltando };
}

const FASE_DOS_PRIVILEGIOS = "privilégios padrão";
const SEM_ELES =
  "sem eles as tabelas e funções das migrations nascem sem acesso para anon, authenticated e service_role (42501 na vitrine e no painel) ou uma guarda de migration recusa no meio";

function falhaNaLeituraDosPrivilegios(erro, aplicados, quando) {
  return {
    estado: "FALHOU",
    fase: FASE_DOS_PRIVILEGIOS,
    aplicados,
    mensagem: `FALHOU ao conferir os privilégios padrão de public ${quando} (${String(erro?.message ?? erro).slice(0, 300)}). Nenhuma migration foi enviada nesta rodada. Conferência é só leitura e o DDL é idempotente: rodar de novo é seguro.`,
  };
}

/** A recusa da retomada que achou os privilégios padrão faltando: em
 * português simples, o que pode ter acontecido, o que conferir e o SQL para
 * reaplicar à mão (os MESMOS 9 comandos do DDL e a mesma conferência). */
function recusaDaRetomadaSemPrivilegios({ papelDono, faltando }) {
  const comandos = comandosDosPrivilegiosPadrao()
    .map((c) => `${c};`)
    .join("\n");
  return [
    `FALHOU: esta retomada achou os privilégios padrão de public FALTANDO para o papel ${papelDono} (falta: ${faltando}). Nada foi gravado nesta rodada.`,
    "Por que parar: as migrations que já rodaram criaram tabelas, sequências e funções. As que nasceram enquanto os privilégios faltavam podem ter ficado sem acesso para anon, authenticated e service_role (a vitrine e o painel dariam 42501), e reaplicar agora só vale para o que nascer daqui para a frente.",
    "Antes de reaplicar à mão, conferir no SQL Editor desta loja: (1) quem tirou a regra e quando; (2) as permissões das tabelas de public (Database → Tables, ou pg_class.relacl), comparando com uma loja antiga — atenção, algumas tabelas são fechadas de propósito pelas migrations, como frota_lojas e frota_segredo. O que tiver nascido sem acesso precisa de GRANT próprio.",
    `Depois, reaplicar à mão (o mesmo que o instalador aplica):\n${comandos}`,
    `E conferir (tem de voltar faltando vazio):\n${SQL_PRIVILEGIOS}`,
    "Feito isso, rodar o instalador de novo: a retomada segue do ponto do ledger.",
  ].join("\n\n");
}

/**
 * Executa o plano. Sem `aplicar: true` (literal) é ENSAIO: só leituras.
 * Sempre relê o estado antes (o banco pode ter mudado desde o plano: outro
 * instalador, alguém no SQL Editor) e, se mudou, RECUSA sem gravar. Para na
 * primeira falha, nunca repete. Antes da 1ª migration (e antes de marcar
 * concluída) os privilégios padrão de public têm de bater no pg_default_acl;
 * não bateu, FALHOU sem enviar nada (ver o cabeçalho). TODA chamada ao
 * banco passa pelo ritmo (clienteComRitmo, `opcoes.ritmo`; padrão: 600 ms
 * entre o fim de uma resposta e o envio seguinte, relógio de verdade).
 *
 * @returns {estado: "OK"|"ENSAIO"|"NADA_A_FAZER"|"JA_INSTALADA"|"RECUSADO"|
 *          "FALHOU"|"ESTADO_DESCONHECIDO", mensagem, aplicados?, aplicaria?,
 *          arquivo?, codigo?, fase?, releituraFalhou?}  (releituraFalhou: os
 *          envios voltaram sem erro e a releitura da conferência falhou)
 */
export async function instalar(clienteSemRitmo, plano, opcoes = {}) {
  const aplicar = opcoes?.aplicar === true;
  const cliente = clienteComRitmo(clienteSemRitmo, opcoes?.ritmo);
  if (!plano || plano.acao === "recusar") {
    return {
      estado: "RECUSADO",
      mensagem: plano?.motivo ?? "RECUSADO: sem plano",
      aplicados: [],
    };
  }
  if (
    plano.acao !== "instalar" &&
    plano.acao !== "nada" &&
    plano.acao !== "ja_instalada"
  ) {
    return {
      estado: "RECUSADO",
      mensagem: `RECUSADO: ação de plano desconhecida (${plano.acao})`,
      aplicados: [],
    };
  }

  let agora;
  try {
    agora = await lerEstado(cliente);
  } catch (e) {
    return {
      estado: "FALHOU",
      fase: "leitura",
      aplicados: [],
      mensagem: `FALHOU ao ler o estado do banco: ${String(e?.message ?? e).slice(0, 300)}. Nada foi gravado.`,
    };
  }
  if (!mesmoEstado(plano.estado, agora)) {
    return {
      estado: "RECUSADO",
      aplicados: [],
      mensagem: `RECUSADO: o banco mudou desde o plano (ledger com ${agora.versoesNoLedger.length} versão(ões), esperava ${plano.estado.versoesNoLedger.length}; marca ${agora.marca}, esperava ${plano.estado.marca}). Outro instalador rodando, ou alguém mexeu: planeje de novo. Nada foi gravado.`,
    };
  }

  if (plano.acao === "ja_instalada") {
    // Só leituras, com ou sem `aplicar`: este instalador não grava em loja
    // instalada. O sucesso só sai se os privilégios padrão também batem — uma
    // loja instalada antes desta trava (ou que perdeu a regra) aparece aqui.
    let priv;
    try {
      priv = await lerPrivilegiosPadrao(cliente);
    } catch (e) {
      return falhaNaLeituraDosPrivilegios(e, [], "da loja já instalada");
    }
    if (priv.faltando !== "") {
      return {
        estado: "FALHOU",
        fase: FASE_DOS_PRIVILEGIOS,
        aplicados: [],
        mensagem: `FALHOU: a loja está instalada (marca concluída, ledger completo), mas os privilégios padrão de public do papel ${priv.papelDono} não batem (falta: ${priv.faltando}); ${SEM_ELES}. Este instalador não grava em loja instalada: diagnóstico antes (conferir as permissões das tabelas; a consulta 185-privilegios-padrao-em-public mede a regra).`,
      };
    }
    return {
      estado: "JA_INSTALADA",
      aplicados: [],
      mensagem: `${plano.motivo} Privilégios padrão de public conferidos (papel ${priv.papelDono}). Nada foi gravado.`,
    };
  }

  if (!aplicar) {
    if (plano.acao === "nada") {
      // Só chega aqui com a marca EM CURSO e o ledger completo: a rodada
      // anterior aplicou e conferiu tudo, e a resposta da marca se perdeu.
      return {
        estado: "ENSAIO",
        aplicados: [],
        aplicaria: [],
        mensagem: `ENSAIO (nada gravado): ${plano.motivo}. Rode com --aplicar para marcar.`,
      };
    }
    return {
      estado: "ENSAIO",
      aplicados: [],
      aplicaria: plano.fila.map((i) => i.arquivo),
      mensagem: `ENSAIO (nada gravado): ${plano.motivo}. Antes da 1ª, os privilégios padrão de public. Rode com --aplicar para gravar.`,
    };
  }

  // Retomada ("instalar" com ledger, ou "nada"): o que já nasceu nasceu com os
  // privilégios que havia. Faltando agora = falha FECHADA, nada gravado.
  if (plano.jaNoLedger > 0) {
    let antes;
    try {
      antes = await lerPrivilegiosPadrao(cliente);
    } catch (e) {
      return falhaNaLeituraDosPrivilegios(e, [], "antes de retomar");
    }
    if (antes.faltando !== "") {
      return {
        estado: "FALHOU",
        fase: FASE_DOS_PRIVILEGIOS,
        aplicados: [],
        mensagem: recusaDaRetomadaSemPrivilegios(antes),
      };
    }
  }

  const aplicados = [];
  try {
    await cliente.consultar(ddlDoLedger());
  } catch (e) {
    return falhaDeEscrita(e, "(ledger)", null, aplicados, DICA_DO_LEDGER);
  }
  let priv;
  try {
    priv = await lerPrivilegiosPadrao(cliente);
  } catch (e) {
    return falhaNaLeituraDosPrivilegios(e, aplicados, "depois do DDL");
  }
  if (priv.faltando !== "") {
    return {
      estado: "FALHOU",
      fase: FASE_DOS_PRIVILEGIOS,
      aplicados,
      mensagem: `FALHOU: o DDL dos privilégios padrão de public voltou sem erro, mas o pg_default_acl do papel ${priv.papelDono} não bate (falta: ${priv.faltando}); ${SEM_ELES}. Nenhuma migration foi enviada nesta rodada. Diagnóstico antes de rodar de novo.`,
    };
  }

  if (plano.acao === "nada") {
    try {
      await cliente.consultar(SQL_CONCLUIR);
    } catch (e) {
      return falhaDeEscrita(e, "(marca de conclusão)", null, [], DICA_DA_MARCA);
    }
    return {
      estado: "NADA_A_FAZER",
      aplicados: [],
      mensagem: `${plano.motivo}: marcada agora. A loja está instalada; migration nova vai pelo aplicar-migrations.yml.`,
    };
  }

  for (const item of plano.fila) {
    try {
      await cliente.consultar(item.envelope);
    } catch (e) {
      return falhaDeEscrita(e, item.arquivo, item.versao, aplicados);
    }
    aplicados.push(item.arquivo);
  }

  // Conferência: o OK só sai se o ledger registra TODAS as versões enviadas.
  let depois;
  try {
    depois = await lerEstado(cliente);
  } catch (e) {
    return {
      estado: "FALHOU",
      fase: "conferência",
      // a releitura não aconteceu: o que os envios fizeram não foi visto
      // (o nova-loja.mjs diz INCERTO, não NÃO)
      releituraFalhou: true,
      aplicados,
      mensagem: `FALHOU ao conferir o ledger depois de aplicar (${String(e?.message ?? e).slice(0, 300)}): os ${aplicados.length} envios voltaram sem erro, mas sem a conferência não digo OK.`,
    };
  }
  const registradas = new Set(depois.versoesNoLedger);
  const faltam = plano.fila
    .filter((i) => !registradas.has(i.versao))
    .map((i) => i.versao);
  if (faltam.length > 0) {
    return {
      estado: "FALHOU",
      fase: "conferência",
      aplicados,
      mensagem: `FALHOU na conferência: o ledger não registra ${faltam.join(", ")} depois de envio sem erro. Diagnóstico antes de rodar de novo.`,
    };
  }
  if (depois.marca !== "em_curso") {
    return {
      estado: "FALHOU",
      fase: "conferência",
      aplicados,
      mensagem: `FALHOU na conferência: a marca de instalação está ${depois.marca}, esperava em_curso (o DDL a cria junto com o ledger). Não marco concluída; diagnóstico antes.`,
    };
  }

  // Só depois da conferência, e numa requisição À PARTE: a marca concluída é
  // o que encerra este instalador nesta loja (dali em diante, JA_INSTALADA ou recusa).
  try {
    await cliente.consultar(SQL_CONCLUIR);
  } catch (e) {
    return falhaDeEscrita(
      e,
      "(marca de conclusão)",
      null,
      aplicados,
      DICA_DA_MARCA,
    );
  }
  return {
    estado: "OK",
    aplicados,
    mensagem: `OK: ${aplicados.length} migrations aplicadas e registradas; o ledger tem ${registradas.size}; instalação marcada como concluída.`,
  };
}
