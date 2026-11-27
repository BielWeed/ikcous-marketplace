// Pacote cifrado do cofre local (T9 do plano "fechar o caminho de loja nova").
// Transforma o mapa { slug: texto } do cofre (refresh token OAuth e senha do
// banco de cada loja) em bytes que só a frase do dono abre, e de volta. É a
// base do backup: o cofre DPAPI morre com o PC; o pacote não.
//
// FORMATO (tudo concatenado):
//   CABECALHO  texto fixo (magia, versão, parâmetros do scrypt e cifra), em UTF-8
//   sal        16 bytes aleatórios (scrypt)
//   iv         12 bytes aleatórios (AES-GCM)
//   cifrado    AES-256-GCM do JSON do mapa
//   etiqueta   16 bytes (tag do GCM)
//
// CHAVE: scrypt(frase NFC, sal, 32 bytes, N=2^17, r=8, p=1, maxmem 256 MB); o
// maxmem padrão do Node (32 MB) recusa N=2^17 (que pede 128 MB).
//
// CABEÇALHO: os bytes do cabeçalho LIDOS DO PACOTE entram como AAD (dado
// autenticado) na decifragem; não há comparação de texto antes. Assim nenhum
// byte dele muda sem o GCM recusar, e quem garante isso é a cifra, não um if.
//
// ERROS: frase errada, pacote cortado ou adulterado dão TODOS a mesma
// ErroDoPacote genérica, sem conteúdo, sem a frase e sem o erro de baixo nível
// (nem como cause). Este módulo não faz log de nada.
//
// Só a crypto nativa do Node: nada de algoritmo próprio nem dependência.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from "node:crypto";

export const PARAMETROS_SCRYPT = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
});

export const CABECALHO = `ikcous-pacote-do-cofre v1 scrypt N=${PARAMETROS_SCRYPT.N} r=${PARAMETROS_SCRYPT.r} p=${PARAMETROS_SCRYPT.p} aes-256-gcm\n`;

const BYTES_CABECALHO = Buffer.from(CABECALHO, "utf8");
const TAM_SAL = 16;
const TAM_IV = 12;
const TAM_ETIQUETA = 16;
const TAM_CHAVE = 32;
const FRASE_MINIMA = 12;
const MENSAGEM_GENERICA =
  "Pacote do cofre: frase errada ou arquivo danificado.";

export class ErroDoPacote extends Error {
  /** @param {string} mensagem  texto SEM conteúdo, SEM frase, SEM erro de baixo nível */
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroDoPacote";
  }
}

const generico = () => new ErroDoPacote(MENSAGEM_GENERICA);

/** Frase em NFC (o mesmo texto digitado em teclados diferentes vira os mesmos
 * bytes); recusa o que não é texto ou tem menos de 12 caracteres. */
function exigirFrase(frase) {
  if (
    typeof frase !== "string" ||
    [...frase.normalize("NFC")].length < FRASE_MINIMA
  ) {
    throw new ErroDoPacote(
      `Pacote do cofre: a frase precisa ter pelo menos ${FRASE_MINIMA} caracteres.`,
    );
  }
  return frase.normalize("NFC");
}

/** Objeto simples cujos valores são todos texto. */
function mapaValido(mapa) {
  if (mapa === null || typeof mapa !== "object" || Array.isArray(mapa)) {
    return false;
  }
  const proto = Object.getPrototypeOf(mapa);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(mapa).every((v) => typeof v === "string");
}

function derivarChave(frase, sal) {
  return new Promise((resolve, reject) => {
    scrypt(frase, sal, TAM_CHAVE, PARAMETROS_SCRYPT, (e, chave) =>
      e ? reject(e) : resolve(chave),
    );
  });
}

/**
 * @param {string} frase  12+ caracteres
 * @param {Record<string, string>} mapa  { slug: texto }
 * @returns {Promise<Uint8Array>}
 */
export async function cifrar(frase, mapa) {
  const f = exigirFrase(frase);
  if (!mapaValido(mapa)) {
    throw new ErroDoPacote(
      "Pacote do cofre: o conteúdo tem de ser um objeto { loja: texto }.",
    );
  }
  const sal = randomBytes(TAM_SAL);
  const iv = randomBytes(TAM_IV);
  let chave;
  try {
    chave = await derivarChave(f, sal);
  } catch {
    throw new ErroDoPacote("Pacote do cofre: não consegui derivar a chave.");
  }
  try {
    const c = createCipheriv("aes-256-gcm", chave, iv, {
      authTagLength: TAM_ETIQUETA,
    });
    c.setAAD(BYTES_CABECALHO);
    const cifrado = Buffer.concat([
      c.update(JSON.stringify(mapa), "utf8"),
      c.final(),
    ]);
    return new Uint8Array(
      Buffer.concat([BYTES_CABECALHO, sal, iv, cifrado, c.getAuthTag()]),
    );
  } finally {
    chave.fill(0);
  }
}

/**
 * @param {string} frase
 * @param {Uint8Array} bytes  o que cifrar devolveu
 * @returns {Promise<Record<string, string>>}
 */
export async function decifrar(frase, bytes) {
  const f = exigirFrase(frase);
  const tamCab = BYTES_CABECALHO.length;
  // o JSON mais curto ("{}") tem 2 bytes
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < tamCab + TAM_SAL + TAM_IV + 2 + TAM_ETIQUETA
  ) {
    throw generico();
  }
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  const cabecalho = b.subarray(0, tamCab);
  const sal = b.subarray(tamCab, tamCab + TAM_SAL);
  const iv = b.subarray(tamCab + TAM_SAL, tamCab + TAM_SAL + TAM_IV);
  const cifrado = b.subarray(
    tamCab + TAM_SAL + TAM_IV,
    b.length - TAM_ETIQUETA,
  );
  const etiqueta = b.subarray(b.length - TAM_ETIQUETA);

  let chave;
  try {
    chave = await derivarChave(f, sal);
  } catch {
    throw generico();
  }
  let mapa;
  try {
    const d = createDecipheriv("aes-256-gcm", chave, iv, {
      authTagLength: TAM_ETIQUETA,
    });
    d.setAAD(cabecalho);
    d.setAuthTag(etiqueta);
    const claro = Buffer.concat([d.update(cifrado), d.final()]);
    mapa = JSON.parse(claro.toString("utf8"));
    claro.fill(0);
  } catch {
    throw generico();
  } finally {
    chave.fill(0);
  }
  if (!mapaValido(mapa)) throw generico();
  return mapa;
}
