#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- o destino do --exportar é validado (absoluto, pasta existente, fora do repositório e de qualquer árvore git) antes de qualquer escrita; o --importar só LÊ o arquivo que o dono indicou. */
/**
 * backup-do-cofre.mjs — backup do cofre local das lojas (T10 do plano "fechar
 * o caminho de loja nova", 26/11/2026). O cofre DPAPI (cofre-local.mjs) morre
 * com o PC; este arquivo, guardado num pendrive ou no Drive do dono, é o que
 * recupera as autorizações de todas as lojas.
 *
 *   node scripts/frota/backup-do-cofre.mjs --exportar <destino absoluto> [--substituir]
 *   node scripts/frota/backup-do-cofre.mjs --importar <arquivo> [--substituir]
 *
 * O QUE VAI NO BACKUP: os DOIS cofres DPAPI do nova-loja.mjs, inteiros:
 *   acesso/<slug>  %LOCALAPPDATA%\ikcous\frota\acesso (refresh OAuth e afins)
 *   banco/<slug>   %LOCALAPPDATA%\ikcous\frota\banco  (senha do banco)
 * como UM mapa { "acesso/<slug>": texto, "banco/<slug>": texto } cifrado pelo
 * pacote-do-cofre.mjs (scrypt + AES-256-GCM) com a frase do dono.
 *
 * --exportar: recusa destino relativo, com pasta inexistente, dentro do
 * repositório ou de qualquer árvore git (a mesma regra do cofre) e destino que
 * já existe (só com --substituir); recusa cofre vazio. Pede a frase DUAS
 * vezes. Grava num arquivo temporário ao lado do destino, RELÊ esse arquivo do
 * disco, decifra em memória e só se o conteúdo bater com o cofre ele vira o
 * destino (rename). Releitura que não bate: o temporário é apagado e o
 * destino fica como estava.
 *
 * --importar: pede a frase uma vez e decifra (frase errada e arquivo
 * danificado dão a MESMA mensagem genérica). Recusa a importação inteira, sem
 * gravar nada, se qualquer entrada estiver fora do formato. Trava cada loja
 * nos dois cofres (a mesma trava do acesso-oauth.mjs) e, sob a trava: entrada
 * que falta é gravada, igual é pulada, diferente é CONFLITO — com qualquer
 * conflito sem --substituir, nada é gravado. Depois relê cada entrada gravada.
 * Repetir o comando é seguro: o que já foi gravado aparece como igual.
 *
 * A FRASE: só pelo terminal, sem eco (lerFraseSemEco, modo cru do TTY), nunca
 * de argv nem de variável de ambiente. Stdin que não é terminal (pipe, ou o
 * Git Bash/mintty sem pseudo-console) é recusado: frase com eco, nunca. Frase
 * com espaço nas pontas é recusada (o espaço invisível faria o backup não
 * abrir depois).
 *
 * ARGV VARRIDO: só --exportar <caminho>, --importar <caminho> e --substituir.
 * Qualquer outra coisa (uma frase colada, um token, --frase=...) recusa com
 * código 2 ANTES de pedir frase, e o argumento nunca é repetido na mensagem.
 *
 * SEGREDOS: nenhum valor do cofre e nem a frase vão para stdout, stderr, erro
 * ou log. As mensagens são só as nossas, as do pacote (genéricas) e as do
 * cofre (sem valor); qualquer outro erro vira "erro inesperado".
 *
 * Saída: 0 OK, 1 recusado ou falhou, 2 uso errado. Testado por
 * tests/frota_backup_do_cofre_test.ts.
 */
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, statSync } from "node:fs";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  ErroDoCofre,
  criarCofreDpapi,
  exigirPastaSegura,
  pastaPadraoDoCofre,
} from "./cofre-local.mjs";
import { ErroDoPacote, cifrar, decifrar } from "./pacote-do-cofre.mjs";

const require = createRequire(import.meta.url);
const { RE_PROJETO } = require("./lojas.cjs");

// o mesmo teto do cofre-local (exigirValor): conferido ANTES de gravar
// qualquer coisa, para nenhuma entrada ser recusada no meio da importação
const TETO_VALOR = 64 * 1024;

export const MENSAGEM_ESPACO_NAS_PONTAS =
  "a frase tem espaço no começo ou no fim; digite de novo sem ele";

const USO = [
  "Uso:",
  "  node scripts/frota/backup-do-cofre.mjs --exportar <destino absoluto> [--substituir]",
  "  node scripts/frota/backup-do-cofre.mjs --importar <arquivo> [--substituir]",
  "A frase é pedida no terminal (não aparece ao digitar); nunca vai na linha de comando.",
].join("\n");

export class ErroDoBackup extends Error {
  /** @param {string} mensagem  texto SEM valor do cofre e SEM a frase */
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroDoBackup";
  }
}

class UsoErrado extends ErroDoBackup {
  constructor(mensagem) {
    super(mensagem);
    this.name = "UsoErrado";
  }
}

/** Só as mensagens que nós escrevemos (sem valor); o resto não é impresso. */
function mensagemSegura(e) {
  if (
    e instanceof ErroDoBackup ||
    e instanceof ErroDoPacote ||
    e instanceof ErroDoCofre
  ) {
    return e.message;
  }
  return "erro inesperado (detalhes não impressos)";
}

// ------------------------------------------------------------------ argv --

/**
 * Só as flags conhecidas. Nada do argv é repetido nas mensagens: o que está
 * ali pode ser uma frase ou um token colado no lugar errado.
 * @param {string[]} argv
 */
export function lerArgumentos(argv) {
  let modo;
  let caminho;
  let substituir = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv.at(i);
    if (a === "--exportar" || a === "--importar") {
      if (modo !== undefined) {
        throw new UsoErrado("use --exportar OU --importar, uma vez só.");
      }
      const valor = argv.at(i + 1);
      if (typeof valor !== "string" || valor === "" || valor.startsWith("-")) {
        throw new UsoErrado(`${a} pede um caminho logo depois.`);
      }
      modo = a.slice(2);
      caminho = valor;
      i++;
    } else if (a === "--substituir") {
      if (substituir) throw new UsoErrado("--substituir repetido.");
      substituir = true;
    } else {
      throw new UsoErrado(
        `argumento desconhecido na posição ${i + 1} (não é repetido aqui: pode ser uma frase ou um token). A frase nunca vai na linha de comando: ela é pedida no terminal.`,
      );
    }
  }
  if (modo === undefined) {
    throw new UsoErrado("falta --exportar <destino> ou --importar <arquivo>.");
  }
  return { modo, caminho, substituir };
}

// ------------------------------------------------------- frase sem eco --

/** C0 (abaixo do espaço) e C1 (0x80 a 0x9f): teclas de controle, não letra. */
function ehControle(ch) {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x20 || (c >= 0x7f && c <= 0x9f);
}

/**
 * Lê uma linha do terminal SEM ECO (modo cru): nada do que é digitado aparece
 * na tela. Backspace apaga; Enter termina; Ctrl+C ou Ctrl+D cancela. Tecla de
 * controle (seta, tab, Esc) recusa a frase inteira. Stdin que não é terminal
 * é recusado: a frase nunca é lida com eco.
 * @param {string} pergunta
 * @param {{ entrada?: any, eco?: { write: (t: string) => unknown } }} [o]
 * @returns {Promise<string>}
 */
export function lerFraseSemEco(
  pergunta,
  { entrada = process.stdin, eco = process.stderr } = {},
) {
  if (!entrada?.isTTY || typeof entrada.setRawMode !== "function") {
    return Promise.reject(
      new ErroDoBackup(
        "a frase só é lida de um terminal, sem eco, e esta entrada não é um terminal. Rode no Windows PowerShell; no Git Bash, rode com: winpty node scripts/frota/backup-do-cofre.mjs ...",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const letras = [];
    let controle = false;
    let acabou = false;
    const terminar = (erro) => {
      if (acabou) return;
      acabou = true;
      entrada.removeListener("data", aoReceber);
      entrada.removeListener("end", aoFechar);
      entrada.removeListener("error", aoFechar);
      try {
        entrada.setRawMode(false);
      } catch {
        // terminal já fechado: nada a restaurar
      }
      entrada.pause();
      eco.write("\n");
      if (erro) reject(erro);
      else resolve(letras.join(""));
    };
    const aoFechar = () =>
      terminar(
        new ErroDoBackup("a entrada fechou antes do Enter; nada foi feito."),
      );
    const aoReceber = (pedaco) => {
      for (const ch of String(pedaco)) {
        if (ch === "\r" || ch === "\n") {
          terminar(
            controle
              ? new ErroDoBackup(
                  "a frase tem tecla de controle (seta, tab, Esc); digite de novo só com letras, números, espaço e símbolos.",
                )
              : null,
          );
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") {
          terminar(new ErroDoBackup("cancelado; nada foi feito."));
          return;
        }
        if (ch === "\b" || ch === "\u007f") {
          letras.pop();
        } else if (ehControle(ch)) {
          controle = true;
        } else {
          letras.push(ch);
        }
      }
    };
    eco.write(pergunta);
    entrada.setRawMode(true);
    entrada.setEncoding("utf8");
    entrada.on("data", aoReceber);
    entrada.on("end", aoFechar);
    entrada.on("error", aoFechar);
    entrada.resume();
  });
}

function exigirSemEspacoNasPontas(frase) {
  if (typeof frase !== "string" || frase !== frase.trim()) {
    throw new ErroDoBackup(MENSAGEM_ESPACO_NAS_PONTAS);
  }
  return frase;
}

// ----------------------------------------------------------------- cofres --

function cofresReais() {
  return {
    acesso: criarCofreDpapi(),
    banco: criarCofreDpapi({
      pasta: path.join(path.dirname(pastaPadraoDoCofre()), "banco"),
    }),
  };
}

/** "acesso/<slug>" -> { cofre, slug } ou null se fora do formato. */
function separarChave(chave) {
  const m = /^(acesso|banco)\/(.+)$/u.exec(chave);
  if (m === null || !RE_PROJETO.test(m[2])) return null;
  return { cofre: m[1], slug: m[2] };
}

// --------------------------------------------------------------- exportar --

function exigirDestino(destino, substituir) {
  if (!path.isAbsolute(destino)) {
    throw new ErroDoBackup(
      "o destino tem de ser um caminho absoluto (ex.: E:\\backup\\cofre-ikcous.bin).",
    );
  }
  const pasta = path.dirname(destino);
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) {
    throw new ErroDoBackup("a pasta do destino não existe; crie-a antes.");
  }
  try {
    exigirPastaSegura(pasta);
  } catch {
    throw new ErroDoBackup(
      "o destino não pode ficar dentro de um repositório git (risco de o backup ir para o git); use um pendrive ou uma pasta fora dos projetos.",
    );
  }
  if (existsSync(destino)) {
    if (lstatSync(destino).isDirectory()) {
      throw new ErroDoBackup("o destino é uma pasta; indique um arquivo.");
    }
    if (!substituir) {
      throw new ErroDoBackup(
        "o destino já existe; para trocar o backup antigo, repita com --substituir.",
      );
    }
  }
}

async function exportar({ caminho, substituir }, d) {
  exigirDestino(caminho, substituir);
  const cofres = d.cofres ?? cofresReais();
  const chaves = [];
  for (const [nome, cofre] of [
    ["acesso", cofres.acesso],
    ["banco", cofres.banco],
  ]) {
    for (const slug of await cofre.listar()) {
      chaves.push({ nome, cofre, slug });
    }
  }
  if (chaves.length === 0) {
    throw new ErroDoBackup("o cofre está vazio; não há o que exportar.");
  }

  const frase = exigirSemEspacoNasPontas(
    await d.lerFrase("Frase do backup (não aparece ao digitar): "),
  );
  const repetida = await d.lerFrase("Repita a frase: ");
  if (
    typeof repetida !== "string" ||
    repetida.normalize("NFC") !== frase.normalize("NFC")
  ) {
    throw new ErroDoBackup("as duas frases não batem; nada foi gravado.");
  }

  const pares = [];
  for (const { nome, cofre, slug } of chaves) {
    const valor = await cofre.ler(slug);
    if (typeof valor !== "string" || valor === "") {
      throw new ErroDoBackup(
        `a loja ${slug} saiu do cofre (${nome}) durante a leitura; nada foi gravado. Repita o comando.`,
      );
    }
    pares.push([`${nome}/${slug}`, valor]);
  }
  const mapa = Object.fromEntries(pares);
  const bytes = await cifrar(frase, mapa);

  const temporario = `${caminho}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const h = await open(temporario, "wx", 0o600);
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
  } catch {
    await unlink(temporario).catch(() => {});
    throw new ErroDoBackup(
      "não consegui gravar o arquivo do backup; o destino ficou como estava.",
    );
  }
  try {
    // a releitura: o que está NO DISCO tem de abrir com a frase e ser o cofre
    let relido;
    try {
      relido = await decifrar(frase, await d.lerArquivo(temporario));
    } catch {
      relido = null;
    }
    if (!isDeepStrictEqual(relido, mapa)) {
      throw new ErroDoBackup(
        "a releitura do arquivo gravado não bateu com o cofre (disco ou pendrive com defeito?); nada ficou no destino.",
      );
    }
    if (!substituir && existsSync(caminho)) {
      throw new ErroDoBackup(
        "o destino apareceu durante a gravação; nada foi trocado. Repita com --substituir se quiser trocá-lo.",
      );
    }
    try {
      await rename(temporario, caminho);
    } catch {
      throw new ErroDoBackup(
        "não consegui pôr o backup no destino; o destino ficou como estava.",
      );
    }
  } catch (e) {
    await unlink(temporario).catch(() => {});
    throw e;
  }

  const lojas = new Set(chaves.map((c) => c.slug)).size;
  const deCada = (nome) => chaves.filter((c) => c.nome === nome).length;
  d.saida.log(
    `OK: backup gravado em ${caminho} e conferido por releitura: ${chaves.length} itens de ${lojas} loja(s) (${deCada("acesso")} de acesso OAuth, ${deCada("banco")} senha(s) do banco). Guarde a frase: sem ela o arquivo não abre.`,
  );
}

// --------------------------------------------------------------- importar --

async function importar({ caminho, substituir }, d) {
  let bytes;
  try {
    bytes = await d.lerArquivo(path.resolve(caminho));
  } catch {
    throw new ErroDoBackup("não consegui ler o arquivo do backup indicado.");
  }
  const frase = exigirSemEspacoNasPontas(await d.lerFrase("Frase do backup: "));
  const mapa = await decifrar(frase, bytes);

  // tudo conferido antes de tocar o cofre: uma entrada ruim recusa o todo
  const entradas = [];
  for (const [chave, valor] of Object.entries(mapa).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const alvo = separarChave(chave);
    if (alvo === null || valor === "" || valor.length > TETO_VALOR) {
      throw new ErroDoBackup(
        "o backup tem uma entrada fora do formato; nada foi gravado.",
      );
    }
    entradas.push({ ...alvo, chave, valor });
  }

  const cofres = d.cofres ?? cofresReais();
  const liberar = [];
  try {
    for (const e of entradas) {
      liberar.push(await cofres[e.cofre].travar(e.slug));
    }
    const novas = [];
    const iguais = [];
    const conflitos = [];
    for (const e of entradas) {
      const atual = await cofres[e.cofre].ler(e.slug);
      if (atual === null) novas.push(e);
      else if (atual === e.valor) iguais.push(e);
      else conflitos.push(e);
    }
    if (conflitos.length > 0 && !substituir) {
      throw new ErroDoBackup(
        `já existe no cofre, com outro conteúdo: ${conflitos.map((e) => e.chave).join(", ")}. Nada foi gravado. Para trocar pelo do backup, repita com --substituir.`,
      );
    }
    const gravar = [...novas, ...conflitos];
    let feitas = 0;
    for (const e of gravar) {
      try {
        await cofres[e.cofre].gravar(e.slug, e.valor);
      } catch (erro) {
        throw new ErroDoBackup(
          `não consegui gravar ${e.chave} (${mensagemSegura(erro)}); ${feitas} de ${gravar.length} já gravadas. Repetir o comando é seguro: o que já foi gravado aparece como igual.`,
        );
      }
      feitas++;
    }
    for (const e of gravar) {
      if ((await cofres[e.cofre].ler(e.slug)) !== e.valor) {
        throw new ErroDoBackup(
          `a releitura do cofre não bateu em ${e.chave}; repita o comando.`,
        );
      }
    }
    d.saida.log(
      `OK: backup importado e conferido por releitura: ${novas.length} gravado(s), ${iguais.length} iguais (pulados), ${conflitos.length} substituído(s).`,
    );
  } finally {
    for (const solta of liberar.reverse()) await solta().catch(() => {});
  }
}

// ----------------------------------------------------------- linha de comando --

/**
 * @param {string[]} argv
 * @param {{
 *   cofres?: { acesso: any, banco: any },
 *   lerFrase?: (pergunta: string) => Promise<string>,
 *   lerArquivo?: (caminho: string) => Promise<Uint8Array>,
 *   saida?: { log: (l: string) => void, erro: (l: string) => void },
 * }} [deps]  o teste injeta cofres de memória e a leitura da frase
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const d = {
    cofres: deps.cofres,
    lerFrase: deps.lerFrase ?? ((p) => lerFraseSemEco(p)),
    lerArquivo: deps.lerArquivo ?? ((c) => readFile(c)),
    saida: deps.saida ?? {
      log: (l) => console.log(l),
      erro: (l) => console.error(l),
    },
  };
  let args;
  try {
    args = lerArgumentos(argv);
  } catch (e) {
    d.saida.erro(`USO ERRADO: ${mensagemSegura(e)}`);
    d.saida.erro(USO);
    return 2;
  }
  try {
    if (args.modo === "exportar") await exportar(args, d);
    else await importar(args, d);
    return 0;
  } catch (e) {
    d.saida.erro(`RECUSADO: ${mensagemSegura(e)}`);
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
