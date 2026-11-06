// O filtro de cor do editor de foto (`ImageAdjuster`), refeito pixel a pixel.
//
// Por que existe: a prévia do editor usa o filtro CSS (`filter: brightness(...)
// contrast(...) ...`), que o Safari do iPhone aplica. Mas o salvamento usava
// `ctx.filter` do canvas, que o Safari (e todo navegador do iPhone, que usa o
// motor dele) NÃO tem: atribuir não dá erro, só cria uma propriedade sem
// efeito, e a foto saía com as cores originais enquanto a prévia mostrava o
// P&B/Vívido escolhido. Aqui o mesmo filtro é refeito em cima dos pixels, para
// o caso de o canvas não aplicar o filtro sozinho.
//
// Fidelidade ao CSS (Filter Effects Module Level 1): as cinco funções entram
// NA ORDEM da prévia (brightness, contrast, saturate, grayscale, sepia), cada
// uma com a matriz padrão, e o resultado de cada passo é cortado em 0–1 antes
// do próximo (cada função do CSS é uma primitiva de filtro com saída cortada).
// O canal de transparência não é tocado. Função pura: sem DOM, sem canvas.

export interface FiltrosDeCor {
  /** Em %, como o slider do editor: 100 = sem mudança. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Em %: 0 = sem mudança; acima de 100 vale 100 (o CSS corta em 1). */
  grayscale: number;
  sepia: number;
}

/**
 * O canvas aplica `ctx.filter` sozinho? Só no Chrome/Firefox a propriedade
 * existe. A checagem tem de vir ANTES de qualquer atribuição: no Safari
 * atribuir `ctx.filter = ...` cria uma propriedade comum no objeto e
 * a checagem passaria a dizer "sim" para um filtro que nunca roda.
 */
export function canvasAplicaFiltro(ctx: object): boolean {
  return "filter" in ctx;
}

/** Os cinco botões na posição de repouso (100/100/100/0/0): não há o que aplicar. */
export function filtrosDeCorSaoNeutros(filtros: FiltrosDeCor): boolean {
  return (
    filtros.brightness === 100 &&
    filtros.contrast === 100 &&
    filtros.saturation === 100 &&
    filtros.grayscale === 0 &&
    filtros.sepia === 0
  );
}

const corta = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const fracao = (percentual: number): number => Math.max(0, percentual) / 100;
const fracaoAte1 = (percentual: number): number =>
  Math.min(1, Math.max(0, percentual) / 100);

/**
 * Aplica, no lugar, o filtro de cor a um `ImageData.data` (RGBA, 4 bytes por
 * pixel). Resto que não completa um pixel é ignorado.
 */
export function aplicarFiltrosDeCor(
  dados: Uint8ClampedArray,
  filtros: FiltrosDeCor,
): void {
  if (filtrosDeCorSaoNeutros(filtros)) return;

  const brilho = fracao(filtros.brightness);
  const contraste = fracao(filtros.contrast);
  // Intercepto do contraste: C' = contraste*C + (0,5 - 0,5*contraste).
  const baseDoContraste = 0.5 - 0.5 * contraste;
  const s = fracao(filtros.saturation);
  // grayscale(g) e sepia(g) usam a = 1 - g nas matrizes do CSS.
  const g = 1 - fracaoAte1(filtros.grayscale);
  const p = 1 - fracaoAte1(filtros.sepia);

  // saturate(s)
  const sRR = 0.213 + 0.787 * s;
  const sRG = 0.715 - 0.715 * s;
  const sRB = 0.072 - 0.072 * s;
  const sGR = 0.213 - 0.213 * s;
  const sGG = 0.715 + 0.285 * s;
  const sGB = 0.072 - 0.072 * s;
  const sBR = 0.213 - 0.213 * s;
  const sBG = 0.715 - 0.715 * s;
  const sBB = 0.072 + 0.928 * s;

  // grayscale(1 - g)
  const gRR = 0.2126 + 0.7874 * g;
  const gRG = 0.7152 - 0.7152 * g;
  const gRB = 0.0722 - 0.0722 * g;
  const gGR = 0.2126 - 0.2126 * g;
  const gGG = 0.7152 + 0.2848 * g;
  const gGB = 0.0722 - 0.0722 * g;
  const gBR = 0.2126 - 0.2126 * g;
  const gBG = 0.7152 - 0.7152 * g;
  const gBB = 0.0722 + 0.9278 * g;

  // sepia(1 - p)
  const pRR = 0.393 + 0.607 * p;
  const pRG = 0.769 - 0.769 * p;
  const pRB = 0.189 - 0.189 * p;
  const pGR = 0.349 - 0.349 * p;
  const pGG = 0.686 + 0.314 * p;
  const pGB = 0.168 - 0.168 * p;
  const pBR = 0.272 - 0.272 * p;
  const pBG = 0.534 - 0.534 * p;
  const pBB = 0.131 + 0.869 * p;

  const fim = dados.length - (dados.length % 4);
  /* eslint-disable security/detect-object-injection -- índice numérico do próprio laço, dentro do tamanho do array; não é chave vinda de usuário. */
  for (let i = 0; i < fim; i += 4) {
    let r = dados[i] / 255;
    let gr = dados[i + 1] / 255;
    let b = dados[i + 2] / 255;

    // brightness
    r = corta(r * brilho);
    gr = corta(gr * brilho);
    b = corta(b * brilho);

    // contrast
    r = corta(r * contraste + baseDoContraste);
    gr = corta(gr * contraste + baseDoContraste);
    b = corta(b * contraste + baseDoContraste);

    // saturate
    let nr = corta(sRR * r + sRG * gr + sRB * b);
    let ng = corta(sGR * r + sGG * gr + sGB * b);
    let nb = corta(sBR * r + sBG * gr + sBB * b);
    r = nr;
    gr = ng;
    b = nb;

    // grayscale
    nr = corta(gRR * r + gRG * gr + gRB * b);
    ng = corta(gGR * r + gGG * gr + gGB * b);
    nb = corta(gBR * r + gBG * gr + gBB * b);
    r = nr;
    gr = ng;
    b = nb;

    // sepia
    nr = corta(pRR * r + pRG * gr + pRB * b);
    ng = corta(pGR * r + pGG * gr + pGB * b);
    nb = corta(pBR * r + pBG * gr + pBB * b);

    dados[i] = Math.round(nr * 255);
    dados[i + 1] = Math.round(ng * 255);
    dados[i + 2] = Math.round(nb * 255);
  }
  /* eslint-enable security/detect-object-injection */
}
