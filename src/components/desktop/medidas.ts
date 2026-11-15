// Medidas de layout do computador (Onda 0 do app-cliente-desktop, F1.2,
// contrato C2). Todo token das constantes de classes começa por `lg:`, `xl:` ou
// `2xl:` -- R1 (spec §4.1): "só prefixo de desktop", nunca `md:`/`sm:`/sem
// prefixo. As frentes que usam grade ou coluna de computador importam daqui,
// em vez de escrever a classe solta em cada tela -- muda aqui, muda em
// todo lugar de uma vez.
//
// Valor = contrato. Mudar o VALOR de alguma constante aqui é mudar C2, não
// ajuste solto de uma tarefa de frente; `tests/front/desktop-medidas.test.ts`
// compara palavra por palavra.

/** Altura mínima já usada em CabecalhoDoComputador (lg:min-h-[121px]).
 * A classe fica literal para o Tailwind; P30 confere a equivalência. */
export const ALTURA_DO_CABECALHO_DO_COMPUTADOR = 121;

/** Container de página no computador: 1280px até 2xl, 1440px daí para cima. */
export const CONTAINER_DO_COMPUTADOR =
  "lg:mx-auto lg:w-full lg:max-w-[1280px] lg:px-8 2xl:max-w-[1440px]";

/** Grade de produtos: 4 colunas no lg, 5 no xl. */
export const GRADE_DE_PRODUTOS_NO_COMPUTADOR =
  "lg:grid-cols-4 lg:gap-5 xl:grid-cols-5";

/** Coluna grudada (compra, resumo do checkout, conta): sticky com rolagem interna.
 * O teto desconta a altura REAL do cabeçalho do computador (121px, o valor de
 * ALTURA_DO_CABECALHO_DO_COMPUTADOR, literal aqui para o Tailwind; `--header-height`
 * é a variável do CELULAR e vale 52px) mais 48px
 * (24 do topo grudado + 24 de folga embaixo). O cabeçalho fica FORA da área que
 * rola, então `top-6` conta a partir do fim dele e o cartão nunca fica sob ele. */
export const COLUNA_FIXA_NO_COMPUTADOR =
  "lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-121px-48px)] lg:overflow-y-auto";

/** Folha que vira gaveta à direita no computador (contrato C9). */
export const GAVETA_NO_COMPUTADOR =
  "lg:w-full lg:max-w-[440px] lg:gap-0 lg:rounded-l-3xl lg:p-0";

/** Título de página (h1) na escala de site (spec §3.4). */
export const TITULO_DE_PAGINA_NO_COMPUTADOR =
  "lg:text-4xl lg:leading-none lg:tracking-tighter";

/** Rótulo em caixa alta: zinc-500 no computador (zinc-400 reprova AA em fundo branco). */
export const ROTULO_NO_COMPUTADOR = "lg:text-[11px] lg:text-zinc-500";
