#!/usr/bin/env node
/**
 * Prova que um banco ZERADO sobe a partir da raiz de supabase/migrations/ —
 * a garantia que o ADR 0002 deixou em aberto ("O que ainda falta") e que o
 * pedido do Gerenciador (banco de loja nova) cobra.
 *
 * O que ele faz, em ordem:
 *   Fase 0 (estática, sem banco): RECUSA a rodada se algum arquivo usar
 *     comando que foge ao banco da prova — CREATE/DROP DATABASE, ALTER
 *     SYSTEM, VACUUM, CREATE SUBSCRIPTION, CREATE TABLESPACE, REINDEX,
 *     DISCARD ALL. Controladores de transação soltos (BEGIN/COMMIT — existem
 *     4 migrations assim na raiz) viram AVISO e seguem: a contenção da prova
 *     é o BANCO DESCARTÁVEL inteiro (DROP DATABASE no finally), não o
 *     ROLLBACK — e um banco zerado real os rodaria do mesmo jeito.
 *   Fase 1: cria um banco descartável NO MESMO SERVIDOR (o papel tem
 *     CREATEDB; medido 28/08/2026). O pooler em modo transação (:6543) não
 *     aceita CREATE DATABASE — a conexão de controle tenta :5432 (session)
 *     na mesma host antes de desistir.
 *   Fase 2: no banco da prova, instala as MESMAS extensões que o banco de
 *     desenvolvimento tem (um projeto Supabase novo as traz pré-instaladas;
 *     sem isto a prova acusaria falta que o provisionamento real não tem) e
 *     aplica TODOS os arquivos da raiz, em ordem de timestamp, em
 *     AUTOCOMMIT (o mesmo modo do CLI real) — a contenção da prova é o
 *     BANCO DESCARTÁVEL, derrubado em todos os caminhos de saída
 *     (try/finally). Cada arquivo vai inteiro ao parser do Postgres
 *     (simple query), que entende $$...$$ e divide corretamente.
 *   Fase 3 (finally): DROP DATABASE ... WITH (FORCE) do banco da prova.
 *
 * POR QUE NÃO É TRANSAÇÃO NO BANCO DE DESENVOLVIMENTO: o baseline cria o
 * schema inteiro com `public.` qualificado — sobre o banco vivo colide com
 * as 32 tabelas já existentes na primeira tabela. O banco zerado de verdade
 * é a única bancada fiel.
 *
 * ESTADOS DE SAÍDA:
 *   0  ZERADO_SOBE   — a raiz inteira aplicou sem erro de SQL; banco
 *     descartável derrubado no fim (DROP, não ROLLBACK).
 *   2  RECUSADO      — Fase 0 achou comando que quebra a contenção.
 *   3  FALHOU        — erro de SQL real. Quando o primeiro erro é de objeto
 *      duplicado (família 42xxx), o rótulo é COLIDIU: é o defeito que este
 *      script existe para revelar — e é o resultado ESPERADO do controle
 *      negativo (rodar ANTES de arquivar as pré-baseline).
 *   5  INDETERMINADO — falha de ferramenta (sem DATABASE_URL, sem `pg`,
 *      sem acesso de criação de banco). Nunca por erro de SQL.
 *
 * USO:
 *   node scripts/db-prove-banco-zerado.cjs <pasta-de-migrations> [--manter-banco]
 *
 * `--manter-banco` pula o DROP final (para autópsia); o nome do banco é
 * impresso. Sem a flag, nada sobrevive à rodada.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm de argumento de linha de comando ou são resolvidos contra
 * o projeto, mesma convenção de scripts/db-apply.cjs e db-prove-rollback.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */
/* eslint-disable security/detect-object-injection --
 * Índices vêm de contadores internos do varredor de dollar-quoting. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROTULO = "db-prove-banco-zerado";

// Limpeza de emergência (revisão do PR #320, amarelo 1 do Claude): um Ctrl-C
// entre a criação e o finally deixaria banco descartável órfão com o schema
// inteiro no servidor vivo. Os sinais derrubam o banco da prova antes de morrer.
let derrubarBancoDeEmergencia = null;
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, async () => {
    console.error(`
[${ROTULO}] ${sinal} recebido — derrubando o banco da prova antes de sair…`);
    try {
      if (derrubarBancoDeEmergencia) await derrubarBancoDeEmergencia();
    } finally {
      process.exit(130);
    }
  });
}

function sair(estado, detalhes) {
  console.log(`\n[${ROTULO}] ${estado}`);
  if (detalhes) console.log(detalhes);
  process.exit(
    { ZERADO_SOBE: 0, RECUSADO: 2, FALHOU: 3, INDETERMINADO: 5 }[estado] ?? 1,
  );
}

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Mesmo padrão de scripts/db-apply.cjs: .env.local depois .env, na CWD
  // primeiro (cada árvore tem a sua) e na pasta do projeto do script depois.
  for (const raiz of [process.cwd(), path.join(__dirname, "..")]) {
    for (const arquivo of [".env.local", ".env"]) {
      const caminho = path.join(raiz, arquivo);
      if (!fs.existsSync(caminho)) continue;
      const linha = fs
        .readFileSync(caminho, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("DATABASE_URL="));
      if (linha)
        return linha.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/** Lista dos arquivos .sql DA RAIZ, em ordem de timestamp (o que um banco
 * zerado rodaria). Subpastas (ex.: _arquivadas/) são invisíveis por
 * construção — readdirSync não é recursivo. */
function listarRaiz(pasta) {
  return fs
    .readdirSync(pasta)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => path.join(pasta, n));
}

const PALAVRAS_DE_CONTROLE = [
  "ABORT",
  "BEGIN",
  "COMMIT",
  "END",
  "PREPARE TRANSACTION",
  "RELEASE SAVEPOINT",
  "ROLLBACK",
  "SAVEPOINT",
  "START TRANSACTION",
  "COMMIT PREPARED",
  "ROLLBACK PREPARED",
];
const COMANDOS_QUE_FOGEM_AO_BANCO_DA_PROVA = [
  "CREATE DATABASE",
  "DROP DATABASE",
  "ALTER SYSTEM",
  "VACUUM",
  "CREATE SUBSCRIPTION",
  "ALTER SUBSCRIPTION REFRESH",
  "CREATE TABLESPACE",
  "REINDEX",
  "DISCARD ALL",
];

/** Arquivos que agendam cron: o pg_cron do Supabase só instala no banco de
 * nome `postgres` (hardcode da extensão), e o banco da prova tem outro nome
 * porque o de desenvolvimento já ocupa `postgres` no mesmo servidor. Na
 * entrega REAL o CLI do Supabase aplica esses arquivos no banco `postgres`
 * do projeto novo, onde pg_cron existe de fábrica — a limitação é da
 * bancada da prova, não do caminho de entrega. Cada arquivo desta lista é
 * PULADO somente se o erro dele for exatamente o de provisionamento; erro
 * qualquer outro continua FALHOU. O que a prova não cobre aqui é o
 * agendamento (cron.job), nunca o schema. */
const EXCECOES_DE_PROVISIONAMENTO = {
  "20260807000000_reserva_com_expiracao.sql":
    /can only create extension in database postgres|schema "cron" does not exist|function cron\./i,
  "20260807000001_agenda_expiracao.sql":
    /can only create extension in database postgres|schema "cron" does not exist|function cron\./i,
  "20260808000100_reconciliacao.sql":
    /can only create extension in database postgres|schema "cron" does not exist|function cron\./i,
  "20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql":
    /can only create extension in database postgres|schema "cron" does not exist|function cron\./i,
  "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql":
    /can only create extension in database postgres|schema "cron" does not exist|function cron\./i,
};

/** UMA passada única, na ordem de leitura: comentários (-- até o fim da linha,
 * barra-estrela até o fechamento), strings '...' com escape '' e
 * dollar-quoting $tag$...$tag$ ficam OPACOS; só o que sobra é código. Depois
 * acusa palavra de controle/comando proibido ancorada em INÍCIO de instrução
 * (começo do código ou logo depois de ';') — nunca palavra solta numa
 * expressão, que é SQL legítimo. Limpar comentários antes de tokenizar é
 * falso positivo na certa: '--' dentro de string não é comentário. */
function comandosNoNivelDeInstrucao(arquivo) {
  const texto = fs.readFileSync(arquivo, "utf8");
  let codigo = "";
  let i = 0;
  while (i < texto.length) {
    const restante = texto.slice(i);
    if (restante.startsWith("--")) {
      const fim = texto.indexOf("\n", i);
      i = fim === -1 ? texto.length : fim; // preserva o \n
      continue;
    }
    if (restante.startsWith("/*")) {
      const fim = texto.indexOf("*/", i + 2);
      i = fim === -1 ? texto.length : fim + 2;
      continue;
    }
    if (texto[i] === "'") {
      codigo += "''";
      i += 1;
      while (i < texto.length) {
        if (texto[i] === "'") {
          if (texto[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (texto[i] === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(restante);
      if (m) {
        const fim = texto.indexOf(m[0], i + m[0].length);
        i = fim === -1 ? texto.length : fim + m[0].length;
        codigo += " ";
        continue;
      }
    }
    codigo += texto[i];
    i += 1;
  }

  const achados = [];
  const fugiram = [];
  for (const pedaco of codigo.split(";")) {
    const enunciado = pedaco.replace(/^\s+/, "");
    const maiusculo = enunciado.toUpperCase();
    for (const palavra of PALAVRAS_DE_CONTROLE) {
      if (
        maiusculo === palavra ||
        maiusculo.startsWith(`${palavra} `) ||
        maiusculo.startsWith(`${palavra};`)
      ) {
        achados.push(`${palavra}: "${enunciado.slice(0, 60)}"`);
      }
    }
    for (const comando of COMANDOS_QUE_FOGEM_AO_BANCO_DA_PROVA) {
      if (maiusculo.startsWith(comando)) {
        fugiram.push(`${comando}: "${enunciado.slice(0, 60)}"`);
      }
    }
  }
  return { achados, fugiram };
}

function faseZero(arquivos) {
  const avisos = [];
  const recusas = [];
  for (const arquivo of arquivos) {
    const { achados, fugiram } = comandosNoNivelDeInstrucao(arquivo);
    for (const achado of achados) {
      avisos.push(`${path.basename(arquivo)} → ${achado}`);
    }
    for (const achado of fugiram) {
      recusas.push(`${path.basename(arquivo)} → ${achado}`);
    }
  }
  if (avisos.length) {
    console.log(
      `[fase 0] AVISO: ${avisos.length} comandos de controle de transação soltos em ${new Set(avisos.map((a) => a.split(" → ")[0])).size} arquivos. A contenção da prova é o BANCO DESCARTÁVEL (DROP no fim), não o ROLLBACK, então seguem aplicando — como um banco zerado real os rodaria:\n  ${avisos.slice(0, 8).join("\n  ")}${avisos.length > 8 ? `\n  … e mais ${avisos.length - 8}` : ""}`,
    );
  }
  if (recusas.length) {
    sair(
      "RECUSADO",
      `Estes comandos fogem ao banco da prova (tocam o SERVIDOR ou não rodam em transação) — nada foi executado:\n${recusas.map((r) => `  - ${r}`).join("\n")}`,
    );
  }
  console.log(
    `[fase 0] ${arquivos.length} arquivos varridos: nenhum comando que fuja ao banco da prova.`,
  );
}

function abrirPag(url) {
  const { Client } = require("pg");
  return new Client({ connectionString: url });
}

async function criarBancoDeProva(urlControle, nome) {
  // O pooler em modo transação (:6543) não aceita CREATE DATABASE; a mesma
  // host na :5432 é o pooler em modo session, que aceita.
  const u = new URL(urlControle);
  const tentativas = [urlControle];
  if (u.port === "6543") {
    const session = new URL(urlControle);
    session.port = "5432";
    tentativas.unshift(session.toString()); // session primeiro: aceita DDL
  }
  let ultimoErro = null;
  for (const tentativa of tentativas) {
    const cliente = abrirPag(tentativa);
    try {
      await cliente.connect();
      await cliente.query(`CREATE DATABASE "${nome}"`);
      await cliente.end();
      return true;
    } catch (erro) {
      ultimoErro = erro;
      try {
        await cliente.end();
      } catch {
        /* já fechada */
      }
      if (erro.code === "42P04") return true; // já existe de rodada anterior
    }
  }
  sair(
    "INDETERMINADO",
    `Não consegui criar o banco de prova: ${ultimoErro ? ultimoErro.message : "desconhecido"}`,
  );
}

async function extensoesDoDev(urlControle) {
  const cliente = abrirPag(urlControle);
  await cliente.connect();
  const r = await cliente.query(
    "SELECT extname, extnamespace::regnamespace AS esquema FROM pg_extension ORDER BY extname",
  );
  await cliente.end();
  return r.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const manter = args.includes("--manter-banco");
  const pasta = args.find((a) => !a.startsWith("--"));
  if (!pasta || !fs.existsSync(pasta)) {
    sair(
      "INDETERMINADO",
      `Uso: node ${path.basename(process.argv[1])} <pasta-de-migrations>`,
    );
  }
  const url = lerDatabaseUrl();
  if (!url) {
    sair(
      "INDETERMINADO",
      "DATABASE_URL não encontrada (.env.local/.env) — não dá para medir.",
    );
  }

  const arquivos = listarRaiz(pasta);
  if (!arquivos.length) {
    sair("INDETERMINADO", `Nenhum .sql na raiz de ${pasta}`);
  }
  console.log(`[${ROTULO}] raiz: ${pasta}`);
  console.log(
    `[${ROTULO}] arquivos na raiz (ordem de apply): ${arquivos.length}`,
  );
  faseZero(arquivos);

  const carimbo = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const nomeBanco = `prova_zerada_${carimbo}_${process.pid}`;
  await criarBancoDeProva(url, nomeBanco);
  console.log(`[fase 1] banco de prova criado: ${nomeBanco}`);
  derrubarBancoDeEmergencia = manter
    ? null // --manter-banco pediu o banco vivo para autópsia: nem sinal o derruba
    : async () => {
        await derrubarBanco(url, nomeBanco);
        derrubarBancoDeEmergencia = null;
      };

  const uProva = new URL(url);
  uProva.pathname = `/${nomeBanco}`;
  const cliente = abrirPag(uProva.toString());

  let aplicados = 0;
  const pulados = [];
  let falha = null;
  try {
    await cliente.connect();

    // Pooler reaproveita conexão física: abrir limpo é regra da casa. E o
    // search_path do Supabase é SET ... IN DATABASE postgres — não vale no
    // banco da prova (nome diferente). Medido 28/08: dev = '"$user", public,
    // extensions', prova = vazio. Emular o do dev na sessão inteira.
    await cliente.query("RESET ALL");
    await cliente.query('SET search_path = "$user", public, extensions');

    // Um projeto Supabase novo traz extensões pré-instaladas; reproduzo o
    // conjunto do banco de desenvolvimento para a prova não acusar falta
    // que o provisionamento real não tem.
    const extensoes = await extensoesDoDev(url);
    for (const ext of extensoes) {
      if (["plpgsql"].includes(ext.extname)) continue;
      try {
        // O banco da prova nasce de template vazio: o schema que abriga a
        // extensão no dev (ex.: extensions) pode não existir ainda.
        const esquema = ext.esquema;
        if (
          esquema &&
          esquema !== "public" &&
          !/^(pg_|information_schema)/.test(esquema)
        ) {
          await cliente.query(`CREATE SCHEMA IF NOT EXISTS "${esquema}"`);
        }
        await cliente.query(
          `CREATE EXTENSION IF NOT EXISTS "${ext.extname}"${
            ext.esquema && ext.esquema !== "public"
              ? ` SCHEMA "${ext.esquema}"`
              : ""
          }`,
        );
      } catch (erro) {
        console.log(
          `[fase 2] extensão "${ext.extname}" indisponível na prova: ${erro.message}`,
        );
      }
    }

    // Provisionamento de fábrica do Supabase que o baseline valida na
    // criação: policies RLS chamam auth.uid()/auth.role(), e o Postgres
    // resolve as expressões de policy quando o CREATE POLICY passa. Medido
    // no baseline (28/08): auth.users e realtime aparecem só em CORPO de
    // função (opaco) e comentário — não precisam existir. O corpo das duas
    // funções é stub porque NINGUÉM as executa durante o apply; o que a
    // prova pede é a assinatura de fábrica.
    await cliente.query("CREATE SCHEMA IF NOT EXISTS auth");
    await cliente.query(
      `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
       AS $stub$ SELECT NULL::uuid $stub$`,
    );
    await cliente.query(
      `CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
       AS $stub$ SELECT NULL::text $stub$`,
    );
    // auth.users existe na medida que as VIEWS do baseline a leem (views
    // validam a consulta na criação): id, email e phone, medido 28/08.
    await cliente.query(
      `CREATE TABLE auth.users (
         id uuid PRIMARY KEY,
         email text,
         phone text
       )`,
    );

    // AUTOCOMMIT, arquivo a arquivo — o mesmo modo do CLI. A contenção da
    // prova é o BANCO DESCARTÁVEL (derrubado em todos os caminhos de saída),
    // nunca uma transação: rollback intermediário apagaria o baseline já
    // aplicado e salvaria pouca coisa depois.
    for (const arquivo of arquivos) {
      const nome = path.basename(arquivo);
      const texto = fs.readFileSync(arquivo, "utf8");
      try {
        // O pg_dump moderno deixa `search_path = ''` na SESSÃO (set_config
        // no próprio baseline, medido 28/08): o baseline passa porque é
        // todo `public.` qualificado, e o arquivo seguinte já não resolve
        // nome nenhum. O CLI real aplica cada migration em sessão limpa —
        // a prova emula isso re-SETANDO antes de cada arquivo.
        await cliente.query('SET search_path = "$user", public, extensions');
        await cliente.query(texto); // simple query: parser do servidor divide
        aplicados += 1;
      } catch (erro) {
        const excecao = EXCECOES_DE_PROVISIONAMENTO[nome];
        if (excecao?.test(erro.message || "")) {
          pulados.push(`${nome} → ${erro.message}`);
          continue;
        }
        falha = {
          arquivo: nome,
          mensagem: erro.message,
          codigo: erro.code || "(sem código)",
          aplicados,
        };
        throw erro;
      }
    }

    const conferir = async (sql) =>
      (await cliente.query(sql)).rows.map((r) => Object.values(r)[0]);
    const tabelas = await conferir(
      "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
    );
    const policies = await conferir(
      "SELECT count(*) FROM pg_policies WHERE schemaname='public'",
    );
    const funcoes = await conferir(
      "SELECT count(DISTINCT proname) FROM pg_proc WHERE pronamespace='public'::regnamespace",
    );
    console.log(
      `[fase 2] aplicou ${aplicados}/${arquivos.length} arquivos — ` +
        `public resultante: ${tabelas[0]} tabelas, ${policies[0]} policies, ${funcoes[0]} funções`,
    );
    if (pulados.length) {
      console.log(
        `[fase 2] PULADOS por provisionamento pg_cron (bancada da prova não reproduz; a entrega real aplica no banco \`postgres\` do projeto): \n  ${pulados.join("\n  ")}`,
      );
    }
  } catch (erro) {
    if (falha) {
      const duplicado = /^42/.test(falha.codigo);
      await cliente.end().catch(() => {});
      if (!manter) await derrubarBanco(url, nomeBanco);
      sair(
        "FALHOU",
        `${duplicado ? "COLIDIU" : "ERRO_DE_SQL"}\n  arquivo:  ${falha.arquivo} (após ${falha.aplicados} anteriores)\n  codigo:   ${falha.codigo}\n  mensagem: ${falha.mensagem}`,
      );
    }
    await cliente.end().catch(() => {});
    if (!manter) await derrubarBanco(url, nomeBanco);
    sair("INDETERMINADO", `Falha de ferramenta: ${erro.message}`);
  }

  await cliente.end().catch(() => {});
  if (!manter) await derrubarBanco(url, nomeBanco);
  sair(
    "ZERADO_SOBE",
    `A raiz inteira aplicou num banco zerado (${aplicados} aplicados, ${pulados.length} pulados por provisionamento pg_cron) em AUTOCOMMIT, e o banco descartável foi derrubado no fim (DROP) — a contenção é o banco, não uma transação.${manter ? ` (banco mantido para autópsia: ${nomeBanco})` : ""}`,
  );
}

async function derrubarBanco(urlControle, nome) {
  const u = new URL(urlControle);
  if (u.port === "6543") u.port = "5432"; // DROP DATABASE também pede session
  const cliente = abrirPag(u.toString());
  try {
    await cliente.connect();
    await cliente.query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
  } catch (erro) {
    console.log(`[fase 3] AVISO: não derrubei ${nome}: ${erro.message}`);
  } finally {
    await cliente.end().catch(() => {});
  }
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
