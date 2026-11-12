// O `trim()` do JavaScript só tira espaços comuns. Um nome colado como U+200B
// (espaço de largura zero), U+2800 (Braille em branco) ou U+3164 (preenchimento
// Hangul) passava como "nome" e aparecia em branco no Perfil, nas avaliações e
// nas iniciais do avatar. Aqui "invisível" é: espaço Unicode (\p{Z}), controle
// (\p{Cc}), formatação sem desenho (\p{Cf}: U+200B, U+200D, U+FEFF...) e os
// preenchimentos que o Unicode classifica como letra ou símbolo mas não
// desenham nada (lista abaixo, por código, um a um).
const SEM_DESENHO = /^[\p{Z}\p{Cc}\p{Cf}]$/u;

const PREENCHIMENTOS_SEM_DESENHO = new Set([
  0x2800, // Braille em branco
  0x115f, // Hangul, preenchimento de consoante inicial
  0x1160, // Hangul, preenchimento de vogal
  0x3164, // Hangul, preenchimento
  0xffa0, // Hangul, preenchimento de meia largura
  0x17b4, // Khmer, vogal inerente (sem som e sem desenho)
  0x17b5, // Khmer, vogal inerente (sem som e sem desenho)
]);

/** Este caractere (um só, por código) não desenha nada na tela? */
export function caractereSemDesenho(caractere: string): boolean {
  return (
    SEM_DESENHO.test(caractere) ||
    PREENCHIMENTOS_SEM_DESENHO.has(caractere.codePointAt(0) ?? 0)
  );
}

// Marca combinante (\p{M}: U+034F, acento solto, U+FE0F...) só desenha junto de
// um caractere base antes dela. Texto feito só de marcas não aparece na tela.
const MARCA_COMBINANTE = /^\p{M}$/u;

/**
 * Diz se o nome tem ao menos um caractere que aparece na tela. A marca
 * combinante sozinha não conta; se vier depois de uma letra, é a letra que
 * torna o texto visível.
 */
export function nomeTemConteudoVisivel(
  nome: string | null | undefined,
): boolean {
  for (const caractere of nome ?? "") {
    if (!caractereSemDesenho(caractere) && !MARCA_COMBINANTE.test(caractere)) {
      return true;
    }
  }
  return false;
}

/**
 * O nome para mostrar: aparado quando tem conteúdo visível, `reserva` quando
 * é vazio, só espaço ou só caractere invisível (que o `||` tomaria por nome).
 */
export function nomeOuReserva(
  nome: string | null | undefined,
  reserva: string,
): string {
  return nomeTemConteudoVisivel(nome) ? (nome ?? "").trim() : reserva;
}
