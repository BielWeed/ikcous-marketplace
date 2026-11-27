/**
 * Cadastro de lojas SINTÉTICO no pior caso de tamanho, para os testes de
 * escala da frota (tests/frota_expressoes_test.ts, tests/frota_grupo_do_banco_test.ts).
 *
 * Tudo inventado (nenhum nome, ref ou segredo de loja real): N assinantes com
 * o nome no MÁXIMO de RE_PROJETO (40 caracteres: 1 letra + 39), ref de 20
 * letras único e `segredoDoToken` com o sufixo no máximo de RE_SEGREDO (24).
 * O objeto devolvido é o BRUTO (o que lojas.json teria); quem usa passa por
 * `validarCadastro`, então um cadastro fora das regras falha o teste.
 */

const LETRAS = "abcdefghijklmnopqrstuvwxyz";

/** `i` em base 26 com letras (a = 0), com zeros ("a") à esquerda até
 * `largura`: índices diferentes dão textos diferentes. */
function emLetras(i: number, largura: number): string {
  let s = "";
  let n = i;
  do {
    s = LETRAS[n % 26] + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return s.padStart(largura, "a");
}

export const NOME_MAXIMO = 40;
export const SUFIXO_MAXIMO = 24;

export function nomeSintetico(i: number): string {
  // "loja-" + letras do índice, completado com "x" até o máximo do formato.
  return `loja-${emLetras(i, 4)}-`.padEnd(NOME_MAXIMO, "x");
}

export function refSintetico(i: number): string {
  return emLetras(i, 20);
}

export function segredoSintetico(i: number): string {
  const sufixo = `L${String(i).padStart(4, "0")}`.padEnd(SUFIXO_MAXIMO, "X");
  return `SUPABASE_ACCESS_TOKEN_${sufixo}`;
}

/**
 * O mesmo cadastro, mas com TODAS as `n` lojas no segredo da org central
 * (`segredo`, o `segredoDoGitHub` de scripts/frota/org-central.json): o modelo
 * de 01/12/2026, em que a loja nova nasce na org e divide o token dela.
 */
export function cadastroSinteticoNaOrg(
  n: number,
  segredo: string,
): { lojas: Record<string, any> } {
  const bruto = cadastroSintetico(n);
  for (const l of Object.values(bruto.lojas)) l.segredoDoToken = segredo;
  return bruto;
}

/** `{ lojas: { … } }` com `n` assinantes sintéticas, na ordem do índice. */
export function cadastroSintetico(n: number): { lojas: Record<string, any> } {
  const lojas: Record<string, any> = {};
  for (let i = 0; i < n; i++) {
    lojas[nomeSintetico(i)] = {
      ref: refSintetico(i),
      classe: "assinante",
      apelido: `Loja ${i}`,
      segredoDoToken: segredoSintetico(i),
      functionsNomeadas: i % 2 === 0,
    };
  }
  return { lojas };
}
