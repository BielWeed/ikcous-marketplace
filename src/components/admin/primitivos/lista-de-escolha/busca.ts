import { normalizeText } from "@/lib/utils";
import type { OpcaoDaLista } from "./tipos";

/** A partir daqui a lista ganha busca (Estado 27, Parcelas 48, Categoria). */
export const OPCOES_PARA_BUSCAR = 10;

/** `busca` explícita da tela vence; sem ela, liga com 10 opções ou mais. */
export function buscaLigada(
  opcoes: readonly OpcaoDaLista[],
  busca?: boolean,
): boolean {
  return busca ?? opcoes.length >= OPCOES_PARA_BUSCAR;
}

/**
 * As opções que batem com o termo, na ordem original. Ignora acento e caixa
 * (`normalizeText`) e procura no rótulo, na sigla ("RJ") e nos `termos`
 * escondidos. Termo vazio devolve todas.
 */
export function filtrarOpcoes<O extends OpcaoDaLista>(
  opcoes: readonly O[],
  termo: string,
): readonly O[] {
  const chave = normalizeText(termo);
  if (!chave) return opcoes;
  return opcoes.filter((o) =>
    [o.rotulo, o.sigla, o.termos].some((texto) =>
      normalizeText(texto).includes(chave),
    ),
  );
}

export interface ParteDoTrecho {
  readonly texto: string;
  readonly achado: boolean;
}

/**
 * Corta o rótulo em pedaços para o `<mark>`: o trecho que bate com o termo
 * (sem acento nem caixa) e o resto. O índice é achado no texto normalizado e
 * levado de volta ao ORIGINAL caractere a caractere: "São" tem 3 letras na
 * tela e 4 códigos depois do NFD, e o destaque não pode escorregar por isso.
 * Termo que só bateu pela sigla ou pelos termos não destaca nada.
 */
export function partesDoTrecho(
  texto: string,
  termo: string,
): readonly ParteDoTrecho[] {
  const chave = normalizeText(termo);
  if (!chave) return [{ texto, achado: false }];

  // Cada caractere visível do original vira o seu pedaço normalizado; `inicio`
  // guarda, para cada código do texto normalizado, de qual caractere ele veio.
  // Marca combinante solta (acento já separado na fonte) some no normalizado
  // e fica grudada no caractere anterior.
  const caracteres = Array.from(texto);
  const posicoes: number[] = [];
  let normalizado = "";
  let deslocamento = 0;
  const inicioDoCaractere: number[] = [];
  for (const caractere of caracteres) {
    inicioDoCaractere.push(deslocamento);
    const pedaco = caractere
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    for (let k = 0; k < pedaco.length; k++) {
      posicoes.push(inicioDoCaractere.length - 1);
    }
    normalizado += pedaco;
    deslocamento += caractere.length;
  }
  inicioDoCaractere.push(deslocamento);

  const achadoEm = normalizado.indexOf(chave);
  if (achadoEm < 0) return [{ texto, achado: false }];

  const primeiro = posicoes[achadoEm];
  const ultimo = posicoes[achadoEm + chave.length - 1];
  // O fim avança sobre as marcas combinantes que seguem o último caractere.
  let fimDoCaractere = ultimo + 1;
  while (
    fimDoCaractere < caracteres.length &&
    /^[\u0300-\u036f]$/.test(caracteres[fimDoCaractere])
  ) {
    fimDoCaractere += 1;
  }
  const de = inicioDoCaractere[primeiro];
  const ate = inicioDoCaractere[fimDoCaractere];

  const partes: ParteDoTrecho[] = [];
  if (de > 0) partes.push({ texto: texto.slice(0, de), achado: false });
  partes.push({ texto: texto.slice(de, ate), achado: true });
  if (ate < texto.length)
    partes.push({ texto: texto.slice(ate), achado: false });
  return partes;
}
