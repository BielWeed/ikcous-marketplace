#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- os arquivos moram em <pasta das cópias>/<loja>-<ref>-<carimbo>-*.sql: a pasta passa por exigirPastaSegura (absoluta, fora do repositório e de qualquer árvore git), a loja casa RE_PROJETO e está no cadastro, o ref casa RE_REF e o carimbo é só dígitos. */
/**
 * copiar-banco.mjs — a CÓPIA DO BANCO de uma loja no PC do dono, antes da
 * transferência do projeto para a org central (A22 do plano da org central;
 * receitas 6.2 e 6.3 de docs/runbooks/org-central-supabase.md). A
 * transferência não tem "desfazer" de dados: se algo der errado, esta cópia é
 * o que sobra.
 *
 *   node scripts/frota/copiar-banco.mjs --loja <nome do lojas.json> [--aplicar]
 *
 * O QUE FAZ, com --aplicar: duas vezes o `supabase db dump` do CLI, com o
 * LOGIN DO DONO no CLI (sem senha do banco: o CLI cria sozinho o papel
 * temporário `cli_login_postgres` no banco da loja, como em todo comando
 * dele sem senha):
 *   1. o ESQUEMA:  supabase db dump --project-ref <ref> -f <…>-esquema.sql
 *   2. os DADOS:   supabase db dump --project-ref <ref> --data-only --use-copy -f <…>-dados.sql
 * (a mesma dupla da doc "Backup and restore using the CLI" do Supabase; o
 * `db dump` roda o pg_dump num contêiner, então o Docker Desktop tem de estar
 * ligado). Os papéis do banco (`--role-only`) ficam de fora: o plano pede
 * esquema e dados.
 *
 * ONDE: %LOCALAPPDATA%\ikcous\copias\<loja>-<ref>-<AAAAMMDD-HHMMSS>-{esquema,dados}.sql
 * (UTC). A pasta passa por exigirPastaSegura (a mesma regra do cofre local):
 * absoluta, fora deste repositório e de QUALQUER árvore git, porque o arquivo
 * tem dado de cliente (LGPD) e nunca pode ir para o git.
 *
 * AS TRAVAS:
 *  - SEM --aplicar NADA roda: nenhum comando, nenhuma pasta criada. O ensaio
 *    diz a loja, o ref, a pasta e os arquivos que faria;
 *  - o ref sai SÓ do cadastro (scripts/frota/lojas.json) pelo nome da loja
 *    (`lojaDoProjeto`, com `Object.hasOwn`): loja fora do cadastro e ref cru
 *    são recusados antes de qualquer comando;
 *  - cada dump grava num `.parcial`; só depois que OS DOIS saíram com código
 *    0 e com conteúdo, os dois viram o nome final. Qualquer falha apaga os
 *    `.parcial` DESTA rodada: nunca fica uma cópia pela metade com cara de
 *    inteira. Arquivo final que já existe = recusa (nunca sobrescreve);
 *  - NUNCA imprime o endereço de conexão: o CLI roda sem shell, com a
 *    entrada, a saída e o erro dele DESCARTADOS (o que ele escreve pode
 *    conter o host, o usuário e a senha temporária do banco), e nenhum
 *    endereço nem senha vai nos argumentos. Em falha, só o código de saída;
 *    a mensagem de erro do executor também não é impressa (só o `code`);
 *  - argv varrido: só `--loja <nome>` e `--aplicar`. Qualquer outra coisa
 *    (um `--db-url=…` colado, um endereço) é uso errado (código 2), sem
 *    repetir o argumento.
 *
 * TESTE: com IKCOUS_TESTE_SEM_COMANDO_REAL definida (o teste define), main
 * sem deps.executar RECUSA em vez de rodar o CLI: esquecer a injeção num
 * teste falha alto e nunca roda o `supabase` de verdade.
 *
 * Saída: 0 OK (ou ensaio), 1 recusado ou falhou, 2 uso errado. Testado por
 * tests/frota_copiar_banco_test.ts.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ErroDoCofre, exigirPastaSegura } from "./cofre-local.mjs";

const require = createRequire(import.meta.url);
const { RE_PROJETO, RE_REF, carregarLojas, lojaDoProjeto } =
  require("./lojas.cjs");

const SENTINELA_DE_TESTE = "IKCOUS_TESTE_SEM_COMANDO_REAL";
/** pg_dump de um banco grande demora; 30 min é o teto de uma cópia. */
const PRAZO_DO_DUMP_MS = 30 * 60 * 1000;
const PARCIAL = ".parcial";

const USO = [
  "Uso:",
  "  node scripts/frota/copiar-banco.mjs --loja <nome do lojas.json> [--aplicar]",
  "Sem --aplicar, só diz o que faria. O ref sai do cadastro; nunca se passa endereço de conexão.",
].join("\n");

export class ErroDaCopia extends Error {
  /** @param {string} mensagem  texto SEM endereço de conexão */
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroDaCopia";
  }
}

class UsoErrado extends ErroDaCopia {
  constructor(mensagem) {
    super(mensagem);
    this.name = "UsoErrado";
  }
}

/** Só as mensagens que nós escrevemos; o resto não é impresso. */
function mensagemSegura(e) {
  if (e instanceof ErroDaCopia) return e.message;
  return "erro inesperado (detalhes não impressos)";
}

/** %LOCALAPPDATA%\ikcous\copias */
export function pastaDasCopias(env = process.env) {
  const base = env?.LOCALAPPDATA;
  if (typeof base !== "string" || base === "" || !path.isAbsolute(base)) {
    throw new ErroDaCopia(
      "LOCALAPPDATA ausente ou relativo: a cópia só mora no Windows do dono (%LOCALAPPDATA%\\ikcous\\copias).",
    );
  }
  return path.join(base, "ikcous", "copias");
}

function lerArgumentos(argv) {
  let loja = null;
  let aplicar = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv.at(i);
    if (a === "--aplicar" && !aplicar) {
      aplicar = true;
    } else if (a === "--loja" && loja === null && i + 1 < argv.length) {
      i++;
      loja = argv.at(i);
    } else {
      throw new UsoErrado(
        "argumento desconhecido, repetido ou sem valor (não repetido aqui).",
      );
    }
  }
  if (loja === null) throw new UsoErrado("falta --loja <nome>.");
  return { loja, aplicar };
}

/** A loja do cadastro e o ref dela; nunca um ref digitado. */
function lojaDoCadastro(nome, cadastro) {
  const loja =
    typeof nome === "string" && RE_PROJETO.test(nome)
      ? lojaDoProjeto(nome, cadastro)
      : null;
  if (!loja || typeof loja.ref !== "string" || !RE_REF.test(loja.ref)) {
    throw new ErroDaCopia(
      "loja fora do cadastro (scripts/frota/lojas.json): use o NOME da loja, nunca o ref. Nada foi feito.",
    );
  }
  return { nome, ref: loja.ref };
}

/** AAAAMMDD-HHMMSS em UTC. */
function carimbo(data) {
  const iso = data.toISOString(); // 2026-12-01T03:04:05.000Z
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

function conferirPasta(pasta) {
  try {
    return exigirPastaSegura(pasta);
  } catch (e) {
    if (e instanceof ErroDoCofre) {
      throw new ErroDaCopia(
        `${e.message.replace(/^Cofre: /, "").replace("a pasta do cofre", "a pasta das cópias")} Pasta: ${pasta}. Nada foi feito.`,
      );
    }
    throw e;
  }
}

/** Só .exe no Windows: spawn sem shell não roda .cmd; sem .exe, o nome puro. */
function comandoDoSupabase(env) {
  if (process.platform !== "win32") return "supabase";
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    const c = path.join(dir, "supabase.exe");
    if (dir && existsSync(c)) return c;
  }
  return "supabase";
}

/** Executor real: spawn SEM shell, com entrada, saída e erro do CLI
 * DESCARTADOS (podem ter o endereço de conexão), e prazo. */
function executorReal(env) {
  if (env.IKCOUS_TESTE_SEM_COMANDO_REAL !== undefined) {
    throw new ErroDaCopia(
      `${SENTINELA_DE_TESTE} definida (processo de teste): o supabase real não roda; injete deps.executar.`,
    );
  }
  const comando = comandoDoSupabase(env);
  return (args, opcoes) =>
    new Promise((resolve, reject) => {
      const filho = spawn(comando, args, {
        cwd: opcoes.cwd,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        timeout: PRAZO_DO_DUMP_MS,
      });
      filho.on("error", reject);
      filho.on("close", (codigo) =>
        resolve({ codigo: Number.isInteger(codigo) ? codigo : 1 }),
      );
    });
}

async function tamanho(arquivo) {
  try {
    const s = await stat(arquivo);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

async function apagarSeExiste(arquivo) {
  try {
    await unlink(arquivo);
  } catch {
    // já não existe: nada a fazer
  }
}

/** Um dump num `.parcial`. Devolve o tamanho; qualquer falha LANÇA. */
async function umDump(executar, { rotulo, ref, extra, destino, pasta }) {
  let r;
  try {
    r = await executar(
      ["db", "dump", "--project-ref", ref, ...extra, "-f", destino],
      { cwd: pasta },
    );
  } catch (e) {
    const codigo =
      typeof e?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(e.code)
        ? e.code
        : "erro";
    throw new ErroDaCopia(
      `o supabase não rodou para o ${rotulo} (${codigo}). Ele está instalado e no PATH?`,
    );
  }
  const codigo = Number.isInteger(r?.codigo) ? r.codigo : 1;
  if (codigo !== 0) {
    throw new ErroDaCopia(
      `o supabase db dump do ${rotulo} saiu com código ${codigo}. A fala do CLI não é impressa (pode ter o endereço de conexão). Confira: o Docker Desktop está ligado? O login do CLI é o do dono (supabase login)? O projeto está ativo?`,
    );
  }
  const bytes = await tamanho(destino);
  if (bytes <= 0) {
    throw new ErroDaCopia(
      `o supabase db dump do ${rotulo} saiu com código 0, mas o arquivo veio vazio ou não existe.`,
    );
  }
  return bytes;
}

async function copiar({ loja, ref, pasta, base, executar, saida }) {
  const final = {
    esquema: path.join(pasta, `${base}-esquema.sql`),
    dados: path.join(pasta, `${base}-dados.sql`),
  };
  const parcial = {
    esquema: `${final.esquema}${PARCIAL}`,
    dados: `${final.dados}${PARCIAL}`,
  };
  for (const f of [...Object.values(final), ...Object.values(parcial)]) {
    if (existsSync(f)) {
      throw new ErroDaCopia(
        `já existe ${f}: uma cópia nunca é sobrescrita. Espere um segundo e rode de novo (o nome leva a hora). Nada foi feito.`,
      );
    }
  }
  await mkdir(pasta, { recursive: true });
  const renomeados = [];
  try {
    saida.log(`copiando o esquema de ${loja} (ref ${ref})…`);
    const bytesEsquema = await umDump(executar, {
      rotulo: "esquema",
      ref,
      extra: [],
      destino: parcial.esquema,
      pasta,
    });
    saida.log(`copiando os dados de ${loja} (ref ${ref})…`);
    const bytesDados = await umDump(executar, {
      rotulo: "dados",
      ref,
      extra: ["--data-only", "--use-copy"],
      destino: parcial.dados,
      pasta,
    });
    await rename(parcial.esquema, final.esquema);
    renomeados.push(final.esquema);
    await rename(parcial.dados, final.dados);
    saida.log(
      `SIM: cópia do banco de ${loja} (ref ${ref}) gravada:\n  ${final.esquema} (${bytesEsquema} bytes)\n  ${final.dados} (${bytesDados} bytes)\nTem dado de cliente: não mande a ninguém, não ponha no repositório. Se for a cópia de antes da transferência, guarde também fora do PC.`,
    );
  } catch (e) {
    // nada pela metade: os .parcial desta rodada saem, e o esquema já
    // renomeado também, se o dos dados não chegou a virar o nome final
    for (const f of [...Object.values(parcial), ...renomeados])
      await apagarSeExiste(f);
    throw e;
  }
}

/**
 * @param {string[]} argv
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   executar?: (args: string[], opcoes: { cwd: string }) => Promise<{ codigo: number }>,
 *   agora?: () => Date,
 *   cadastro?: any,
 *   saida?: { log: (l: string) => void, erro: (l: string) => void },
 * }} [deps]  o teste injeta o executor (nenhum comando real), o ambiente e a hora
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  const saida = deps.saida ?? {
    log: (l) => console.log(l),
    erro: (l) => console.error(l),
  };
  let args;
  try {
    args = lerArgumentos(argv);
  } catch (e) {
    saida.erro(`USO ERRADO: ${mensagemSegura(e)}`);
    saida.erro(USO);
    return 2;
  }
  try {
    const { nome, ref } = lojaDoCadastro(
      args.loja,
      deps.cadastro ?? carregarLojas(),
    );
    const pasta = conferirPasta(pastaDasCopias(env));
    const base = `${nome}-${ref}-${carimbo((deps.agora ?? (() => new Date()))())}`;
    if (!args.aplicar) {
      saida.log(
        [
          `ENSAIO (nada rodou): copiaria o banco de ${nome} (ref ${ref}) com o login do supabase deste PC:`,
          `  supabase db dump --project-ref ${ref} -f ${path.join(pasta, `${base}-esquema.sql`)}`,
          `  supabase db dump --project-ref ${ref} --data-only --use-copy -f ${path.join(pasta, `${base}-dados.sql`)}`,
          "Precisa do Docker Desktop ligado. Para copiar de verdade, rode de novo com --aplicar.",
        ].join("\n"),
      );
      return 0;
    }
    const executar = deps.executar ?? executorReal(env);
    await copiar({ loja: nome, ref, pasta, base, executar, saida });
    return 0;
  } catch (e) {
    saida.erro(`NÃO: ${mensagemSegura(e)}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().then(
    (c) => {
      process.exitCode = c;
    },
    () => {
      console.error("erro inesperado (detalhes não impressos)");
      process.exitCode = 1;
    },
  );
}
