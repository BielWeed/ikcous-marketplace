/* eslint-disable security/detect-non-literal-fs-filename -- os caminhos são <pasta>/<slug>.<ext>: a pasta é validada na criação (absoluta, fora do repositório e de qualquer árvore git) e o slug casa RE_PROJETO antes de qualquer acesso ao disco. */
// Cofre LOCAL do acesso OAuth das lojas (peça T3 do L4b). Guarda, por loja, um
// texto opaco (o acesso-oauth.mjs grava ali o refresh token e o client_secret)
// só no PC do dono, cifrado pela DPAPI do Windows no escopo do USUÁRIO: só a
// mesma conta do Windows, nesta máquina, decifra.
//
// CONTRATO (as duas implementações cumprem; tests/frota_nova_loja_cofre_test.ts):
//   ler(slug)          -> texto | null  (null = nada gravado para a loja)
//   gravar(slug, txt)  -> substitui de forma atômica (arquivo novo + rename)
//   apagar(slug)       -> some com o valor; idempotente
//   listar()           -> slugs com valor gravado, em ordem; sem decifrar
//                         nada, sem trava, sem nome fora do padrão; cofre
//                         vazio ou pasta inexistente = []
//   travar(slug)       -> função liberar(); a SEGUNDA trava da mesma loja é
//                         recusada (CofreTravado), mesmo vinda de outro processo
//
// IMPLEMENTAÇÕES:
//   criarCofreMemoria()  testes e ensaio, nada sai da memória do processo;
//   criarCofreDpapi()    %LOCALAPPDATA%\ikcous\frota\acesso\<slug>.dpapi. O
//     valor vai ao Windows PowerShell 5.1 por STDIN (em base64, para nenhum
//     acento depender da página de código do console) e NUNCA na linha de
//     comando: o script é fixo e vai por -EncodedCommand. Quem cifra é
//     ConvertFrom-SecureString sem -Key (DPAPI, escopo do usuário). O
//     PSModulePath do filho aponta só para os módulos do 5.1 (herdar o do
//     PowerShell 7 quebra o Microsoft.PowerShell.Security).
//
// RECUSAS: pasta relativa, dentro deste repositório ou dentro de QUALQUER
// árvore git (cofre versionado = segredo publicado); slug fora do padrão do
// cadastro de lojas; valor vazio. Nenhuma mensagem de erro carrega o valor, nem
// a saída do PowerShell (ela pode ecoar o que recebeu).
//
// TRAVA ÓRFÃ: se um processo morrer segurando a trava, o arquivo
// <slug>.trava fica; a mensagem de CofreTravado diz qual arquivo apagar
// (depois de conferir que nenhum comando da loja está rodando). Se a marca não
// chega a ser escrita (disco cheio, antivírus), a própria travar apaga o
// arquivo que acabou de criar, só se ele ainda for o dela, e recusa com
// ErroDoCofre codigo TRAVA_NAO_GRAVOU.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { RE_PROJETO } = require("./lojas.cjs");

const RAIZ_DO_REPOSITORIO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const CABECALHO = "ikcous-cofre-dpapi-v1";
const TETO_VALOR = 64 * 1024;
const PRAZO_POWERSHELL_MS = 60_000;

export const SCRIPT_CIFRAR = [
  "$ErrorActionPreference = 'Stop'",
  "$t = [Console]::In.ReadToEnd().Trim()",
  "$s = ConvertTo-SecureString -String $t -AsPlainText -Force",
  "[Console]::Out.Write((ConvertFrom-SecureString -SecureString $s))",
].join("\n");

export const SCRIPT_DECIFRAR = [
  "$ErrorActionPreference = 'Stop'",
  "$c = [Console]::In.ReadToEnd().Trim()",
  "$s = ConvertTo-SecureString -String $c",
  "$p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)",
  "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) }",
  "finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }",
].join("\n");

export class ErroDoCofre extends Error {
  /**
   * @param {string} mensagem  texto SEM o valor e SEM a saída do PowerShell
   * @param {{ codigo?: string }} [extra]
   */
  constructor(mensagem, extra = {}) {
    super(mensagem);
    this.name = "ErroDoCofre";
    if (extra.codigo !== undefined) this.codigo = extra.codigo;
  }
}

export class CofreTravado extends ErroDoCofre {
  constructor(mensagem) {
    super(mensagem);
    this.name = "CofreTravado";
  }
}

function exigirSlug(slug) {
  if (typeof slug !== "string" || !RE_PROJETO.test(slug)) {
    throw new ErroDoCofre(
      "Cofre: nome de loja inválido (o mesmo padrão do cadastro: minúsculas, dígitos e hífen, começando por letra).",
    );
  }
}

function exigirValor(valor) {
  if (typeof valor !== "string" || valor === "" || valor.length > TETO_VALOR) {
    throw new ErroDoCofre(
      "Cofre: valor vazio, grande demais ou que não é texto.",
    );
  }
}

/** %LOCALAPPDATA%\ikcous\frota\acesso */
export function pastaPadraoDoCofre(env = process.env) {
  const base = env?.LOCALAPPDATA;
  if (typeof base !== "string" || !path.isAbsolute(base)) {
    throw new ErroDoCofre(
      "Cofre: LOCALAPPDATA ausente ou relativo (o cofre DPAPI só existe no Windows do dono).",
    );
  }
  return path.join(base, "ikcous", "frota", "acesso");
}

/** %LOCALAPPDATA%\ikcous\frota\banco: o cofre da senha do banco de cada loja
 * (nova-loja.mjs grava, backup-do-cofre.mjs copia). Uma função só, para os
 * dois nunca divergirem. */
export function pastaPadraoDoCofreDoBanco(env = process.env) {
  return path.join(path.dirname(pastaPadraoDoCofre(env)), "banco");
}

// ------------------------------------------------------------------ memória --

export function criarCofreMemoria() {
  const valores = new Map();
  const travas = new Map();
  return {
    async ler(slug) {
      exigirSlug(slug);
      return valores.has(slug) ? valores.get(slug) : null;
    },
    async gravar(slug, valor) {
      exigirSlug(slug);
      exigirValor(valor);
      valores.set(slug, valor);
    },
    async apagar(slug) {
      exigirSlug(slug);
      valores.delete(slug);
    },
    async listar() {
      return [...valores.keys()].sort();
    },
    async travar(slug) {
      exigirSlug(slug);
      if (travas.has(slug)) {
        throw new CofreTravado(
          `Cofre: a loja ${slug} já está travada por outra operação.`,
        );
      }
      const dono = Symbol(slug);
      travas.set(slug, dono);
      return async () => {
        if (travas.get(slug) === dono) travas.delete(slug);
      };
    },
  };
}

// -------------------------------------------------------------------- DPAPI --

function mesmoOuDentro(filho, pai) {
  const normal = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(normal(pai), normal(filho));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Caminho real: o ancestral existente mais próximo passa por realpath (para
 * junção/atalho não esconder o repositório) e o resto é colado de volta. */
function caminhoReal(p) {
  let existente = p;
  const resto = [];
  while (!existsSync(existente)) {
    const acima = path.dirname(existente);
    if (acima === existente) break;
    resto.unshift(path.basename(existente));
    existente = acima;
  }
  return {
    real: path.join(realpathSync(existente), ...resto),
    existente: realpathSync(existente),
  };
}

/** Pasta absoluta, fora deste repositório e de qualquer árvore git; devolve o
 * caminho resolvido. Exportada para o estado do nova-loja.mjs (mesma regra). */
export function exigirPastaSegura(pasta) {
  if (typeof pasta !== "string" || pasta === "" || !path.isAbsolute(pasta)) {
    throw new ErroDoCofre(
      "Cofre: a pasta do cofre tem de ser um caminho absoluto.",
    );
  }
  const { real, existente } = caminhoReal(path.resolve(pasta));
  if (mesmoOuDentro(real, realpathSync(RAIZ_DO_REPOSITORIO))) {
    throw new ErroDoCofre(
      "Cofre: a pasta do cofre não pode ficar dentro do repositório (risco de ir para o git).",
    );
  }
  for (let d = existente; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, ".git"))) {
      throw new ErroDoCofre(
        "Cofre: a pasta do cofre não pode ficar dentro de uma árvore git (risco de ir para o git).",
      );
    }
    if (path.dirname(d) === d) break;
  }
  return path.resolve(pasta);
}

function caminhoDoPowerShell(env) {
  const raiz = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return {
    exe: path.win32.join(
      raiz,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    modulos: path.win32.join(
      raiz,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "Modules",
    ),
  };
}

/** Executor real: spawn sem shell, entrada por stdin, prazo de 60 s. */
function executarProcesso(comando, args, { entrada, env }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new ErroDoCofre("Cofre DPAPI: só existe no Windows."));
      return;
    }
    const filho = spawn(comando, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const saida = [];
    const erro = [];
    const relogio = setTimeout(() => filho.kill(), PRAZO_POWERSHELL_MS);
    filho.stdout.on("data", (b) => saida.push(b));
    filho.stderr.on("data", (b) => erro.push(b));
    filho.on("error", (e) => {
      clearTimeout(relogio);
      reject(e);
    });
    filho.on("close", (codigo) => {
      clearTimeout(relogio);
      resolve({
        codigo,
        saida: Buffer.concat(saida).toString("utf8"),
        erro: Buffer.concat(erro).toString("utf8"),
      });
    });
    filho.stdin.on("error", () => {}); // processo que morre cedo não derruba o Node
    filho.stdin.end(entrada, "utf8");
  });
}

const codificado = (script) =>
  Buffer.from(script, "utf16le").toString("base64");

/**
 * @param {{
 *   pasta?: string,
 *   executar?: (comando: string, args: string[], o: { entrada: string, env: Record<string,string> }) =>
 *     Promise<{ codigo: number|null, saida: string, erro: string }>,
 *   env?: Record<string, string|undefined>,
 *   abrirArquivo?: typeof open,
 * }} [opcoes]  abrirArquivo existe para o teste simular disco que falha.
 */
export function criarCofreDpapi({
  pasta,
  executar = executarProcesso,
  env = process.env,
  abrirArquivo = open,
} = {}) {
  const raiz = exigirPastaSegura(pasta ?? pastaPadraoDoCofre(env));
  const ps = caminhoDoPowerShell(env);
  const envFilho = { ...env, PSModulePath: ps.modulos };
  const arquivo = (slug, ext) => path.join(raiz, `${slug}.${ext}`);

  async function powershell(script, entrada, oQue) {
    let r;
    try {
      r = await executar(
        ps.exe,
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          codificado(script),
        ],
        { entrada, env: envFilho },
      );
    } catch (e) {
      const nome = /^[A-Za-z]{1,40}$/.test(String(e?.name)) ? e.name : "erro";
      throw new ErroDoCofre(
        `Cofre DPAPI: não consegui rodar o PowerShell para ${oQue} (${nome}).`,
      );
    }
    if (r?.codigo !== 0) {
      // a saída e o erro do PowerShell ficam de fora: podem ecoar a entrada
      throw new ErroDoCofre(
        `Cofre DPAPI: o PowerShell falhou ao ${oQue} (código ${Number.isInteger(r?.codigo) ? r.codigo : "?"}).`,
      );
    }
    return String(r.saida ?? "").trim();
  }

  return {
    async ler(slug) {
      exigirSlug(slug);
      let texto;
      try {
        texto = await readFile(arquivo(slug, "dpapi"), "utf8");
      } catch (e) {
        if (e?.code === "ENOENT") return null;
        throw new ErroDoCofre(
          `Cofre DPAPI: não consegui ler o arquivo da loja ${slug}.`,
        );
      }
      const [cabecalho, cifrado] = texto.split(/\r?\n/);
      if (cabecalho !== CABECALHO || !/^[0-9a-f]{32,}$/i.test(cifrado ?? "")) {
        throw new ErroDoCofre(
          `Cofre DPAPI: o arquivo da loja ${slug} não está no formato do cofre.`,
        );
      }
      const b64 = await powershell(SCRIPT_DECIFRAR, cifrado, "decifrar");
      const bytes = Buffer.from(b64, "base64");
      if (b64 === "" || bytes.toString("base64") !== b64) {
        throw new ErroDoCofre(
          `Cofre DPAPI: a decifragem da loja ${slug} devolveu algo inesperado.`,
        );
      }
      return bytes.toString("utf8");
    },

    async gravar(slug, valor) {
      exigirSlug(slug);
      exigirValor(valor);
      const cifrado = await powershell(
        SCRIPT_CIFRAR,
        Buffer.from(valor, "utf8").toString("base64"),
        "cifrar",
      );
      if (!/^[0-9a-f]{32,}$/i.test(cifrado)) {
        throw new ErroDoCofre(
          "Cofre DPAPI: a cifragem devolveu algo inesperado; nada foi gravado.",
        );
      }
      await mkdir(raiz, { recursive: true });
      const final = arquivo(slug, "dpapi");
      const temporario = `${final}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        const h = await abrirArquivo(temporario, "wx", 0o600);
        try {
          await h.writeFile(`${CABECALHO}\n${cifrado}\n`, "utf8");
          await h.sync();
        } finally {
          await h.close();
        }
        await rename(temporario, final);
      } catch {
        await unlink(temporario).catch(() => {});
        throw new ErroDoCofre(
          `Cofre DPAPI: não consegui gravar o arquivo da loja ${slug}; o anterior ficou como estava.`,
        );
      }
    },

    async apagar(slug) {
      exigirSlug(slug);
      try {
        await unlink(arquivo(slug, "dpapi"));
      } catch (e) {
        if (e?.code !== "ENOENT") {
          throw new ErroDoCofre(
            `Cofre DPAPI: não consegui apagar o arquivo da loja ${slug}.`,
          );
        }
      }
    },

    async listar() {
      let entradas;
      try {
        entradas = await readdir(raiz, { withFileTypes: true });
      } catch (e) {
        if (e?.code === "ENOENT") return [];
        throw new ErroDoCofre(
          "Cofre DPAPI: não consegui listar a pasta do cofre.",
        );
      }
      // só o nome do arquivo decide: nada é aberto nem decifrado; .trava,
      // .tmp de gravação interrompida, pasta e slug fora do padrão ficam fora
      const slugs = [];
      for (const e of entradas) {
        if (!e.isFile() || !e.name.endsWith(".dpapi")) continue;
        const slug = e.name.slice(0, -".dpapi".length);
        if (RE_PROJETO.test(slug)) slugs.push(slug);
      }
      return slugs.sort();
    },

    async travar(slug) {
      exigirSlug(slug);
      await mkdir(raiz, { recursive: true });
      const caminho = arquivo(slug, "trava");
      const marca = `${process.pid} ${new Date().toISOString()} ${randomBytes(8).toString("hex")}`;
      let h;
      try {
        h = await abrirArquivo(caminho, "wx", 0o600);
      } catch (e) {
        if (e?.code === "EEXIST") {
          throw new CofreTravado(
            `Cofre: a loja ${slug} já está travada por outra operação (arquivo ${caminho}). Se nenhum comando da loja estiver rodando, apague esse arquivo e repita.`,
          );
        }
        throw new ErroDoCofre(
          `Cofre: não consegui criar a trava da loja ${slug}.`,
        );
      }
      try {
        try {
          await h.writeFile(marca, "utf8");
        } finally {
          await h.close();
        }
      } catch {
        // O arquivo foi criado por NÓS (o "wx" acima), mas a marca não ficou
        // inteira. Ele só é apagado se ainda for o nosso: vazio ou com um
        // pedaço do começo da nossa marca. Outro conteúdo = alguém apagou o
        // nosso e travou depois; esse fica. O erro de baixo nível fica de fora
        // (a mensagem dele carrega o caminho do cofre).
        let nossaSaiu = false;
        try {
          const atual = await readFile(caminho, "utf8");
          if (marca.startsWith(atual)) await unlink(caminho);
          nossaSaiu = true; // apagada agora, ou o que está lá não é a nossa
        } catch (e) {
          nossaSaiu = e?.code === "ENOENT";
        }
        throw new ErroDoCofre(
          nossaSaiu
            ? `Cofre: não consegui gravar a trava da loja ${slug}; nada ficou travado por esta operação. Repita o comando.`
            : `Cofre: não consegui gravar a trava da loja ${slug} nem apagá-la; o próximo comando da loja vai dizer qual arquivo apagar.`,
          { codigo: "TRAVA_NAO_GRAVOU" },
        );
      }
      let solta = false;
      return async () => {
        if (solta) return;
        solta = true;
        // só apaga se a trava ainda for ESTA (nunca a de quem travou depois)
        const atual = await readFile(caminho, "utf8").catch(() => null);
        if (atual === marca) await unlink(caminho).catch(() => {});
      };
    },
  };
}
