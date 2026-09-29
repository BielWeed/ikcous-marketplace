// A matemática de recorte/zoom/rotação do `ImageAdjuster` (achado
// ImageAdjuster-963, frente edge-e-imagens, 15/09/2026): eram 3 cálculos
// não triviais escondidos dentro de um componente de 1800+ linhas, usado em
// 4 telas (AdminBannersView, AdminProductFormView, OrderDetailsView,
// sheet.tsx), e SEM nenhum teste que olhasse para o resultado geométrico —
// só o scrim de contraste tinha cobertura
// (tests/front/banner-legivel-e-que-para.test.tsx). Uma mudança futura em
// preset de proporção ou em rotação podia inverter um sinal ou trocar a
// ordem de duas transformações e nada apitaria antes de virar banner
// cortado errado em produção.
//
// Por que extrair para cá em vez de só testar dentro do componente: estas
// três contas não dependem de DOM nem de canvas — só de números (tamanho
// natural da imagem, viewport, zoom, rotação, offset). Como função pura,
// dá para testar caso a caso sem montar `ImageAdjuster` inteiro. O
// componente importa daqui; o comportamento visual não muda (mesma
// matemática, só de mudança de casa).

/** As 4 rotações que o editor permite (múltiplos de 90°, controladas pelo
 * botão de girar — `fineRotation`, o ajuste fino em graus, entra à parte). */
export type RotacaoEmGraus = 0 | 90 | 180 | 270;

export interface DimensoesNaturais {
  naturalWidth: number;
  naturalHeight: number;
}

export interface DimensoesDoViewport {
  viewportWidth: number;
  viewportHeight: number;
}

export interface ParametrosDeEscalaBase
  extends DimensoesNaturais,
    DimensoesDoViewport {
  rotation: RotacaoEmGraus;
}

/**
 * Escala mínima para a imagem COBRIR o viewport (equivalente a
 * `background-size: cover`), considerando que uma rotação de 90°/270° troca
 * largura por altura antes de comparar com o viewport.
 *
 * Sem imagem carregada ainda (naturalWidth/Height zerados) devolve 1 — é o
 * mesmo fallback que o componente usava antes de extrair, para não dividir
 * por zero enquanto a <img> não disparou `onLoad`.
 */
export function getBaseScale(params: ParametrosDeEscalaBase): number {
  const {
    naturalWidth,
    naturalHeight,
    viewportWidth,
    viewportHeight,
    rotation,
  } = params;

  if (!naturalWidth || !naturalHeight) return 1;

  const rotacionada = rotation === 90 || rotation === 270;
  const largura = rotacionada ? naturalHeight : naturalWidth;
  const altura = rotacionada ? naturalWidth : naturalHeight;

  const escalaX = viewportWidth / largura;
  const escalaY = viewportHeight / altura;

  // Math.max (não min): "cobrir" o viewport pode deixar sobra pra fora dos
  // dois lados que não são o gargalo — é isso que garante que não sobre
  // fundo vazio nas bordas do quadro de recorte.
  return Math.max(escalaX, escalaY);
}

export interface ParametrosDeClamp
  extends DimensoesNaturais,
    DimensoesDoViewport {
  x: number;
  y: number;
  zoom: number;
  baseScale: number;
  rotation: RotacaoEmGraus;
}

export interface OffsetClampado {
  x: number;
  y: number;
}

/**
 * Limita o deslocamento (pan) da imagem para que ela nunca deixe uma borda
 * vazia dentro do quadro de recorte, no zoom e rotação atuais.
 *
 * Quando a imagem (já escalada) é MENOR que o viewport num eixo — caso raro,
 * mas possível com zoom bem baixo numa foto pequena — não dá para satisfazer
 * "nunca vaza": min > max nesse eixo. Nesse caso o retângulo colapsa e a
 * imagem fica centralizada nesse eixo em vez de grudada numa borda
 * arbitrária (mesma regra que o componente já tinha).
 */
export function clampOffset(params: ParametrosDeClamp): OffsetClampado {
  const {
    x,
    y,
    zoom,
    baseScale,
    rotation,
    naturalWidth,
    naturalHeight,
    viewportWidth,
    viewportHeight,
  } = params;

  const escala = baseScale * zoom;
  const rotacionada = rotation === 90 || rotation === 270;
  const largura = (rotacionada ? naturalHeight : naturalWidth) * escala;
  const altura = (rotacionada ? naturalWidth : naturalHeight) * escala;

  let minX = viewportWidth - largura / 2 - naturalWidth / 2;
  let maxX = largura / 2 - naturalWidth / 2;
  let minY = viewportHeight - altura / 2 - naturalHeight / 2;
  let maxY = altura / 2 - naturalHeight / 2;

  // Imagem mais estreita/baixa que o viewport nesse eixo: centraliza em vez
  // de deixar o clamp inverter (min > max quebraria o Math.max/Math.min).
  if (minX > maxX) {
    const centroX = (viewportWidth - naturalWidth) / 2;
    minX = centroX;
    maxX = centroX;
  }
  if (minY > maxY) {
    const centroY = (viewportHeight - naturalHeight) / 2;
    minY = centroY;
    maxY = centroY;
  }

  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

export interface ParametrosDeRecorte
  extends DimensoesNaturais,
    DimensoesDoViewport {
  /** Largura de exportação escolhida pelo usuário (px do arquivo final). */
  exportWidth: number;
  baseScale: number;
  zoom: number;
  offset: { x: number; y: number };
  /** Rotação em múltiplos de 90° e o ajuste fino (graus), somados no
   * componente antes de desenhar — mantidos separados aqui só para deixar
   * a origem de cada um óbvia em teste. */
  rotation: number;
  fineRotation: number;
}

export interface RetanguloDeDesenho {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface ResultadoDoRecorte {
  /** Tamanho físico do canvas de saída. */
  targetWidth: number;
  targetHeight: number;
  /** Razão entre o canvas físico (px de exportação) e o viewport exibido
   * na tela (px de CSS) — todo deslocamento/escala do editor precisa passar
   * por aqui antes de virar coordenada de canvas. */
  scaleCanvas: number;
  /** Primeiro translate: leva a origem do canvas para o centro dele. */
  translateParaCentro: { x: number; y: number };
  /** Segundo translate, aplicado ANTES do rotate: centraliza o ponto da
   * imagem que está no centro do viewport, convertido para px de canvas.
   * A ordem importa — rotacionar antes deste translate rotacionaria em
   * torno do canto errado. */
  translateAntesDaRotacao: { x: number; y: number };
  anguloEmRadianos: number;
  /** Argumentos de `ctx.drawImage(img, x, y, largura, altura)`, já centrados
   * na origem (translate + rotate) — por isso x/y são negativos (metade da
   * largura/altura para a esquerda/cima). */
  desenho: RetanguloDeDesenho;
}

/**
 * Calcula os parâmetros geométricos que `handleCrop` usa para desenhar a
 * imagem no canvas de exportação (translate → rotate → drawImage). Fica de
 * fora daqui, no componente, só o que precisa de canvas de verdade: criar o
 * elemento, aplicar os filtros CSS (`ctx.filter`) e chamar `toBlob`.
 */
export function calcularParametrosDeRecorte(
  params: ParametrosDeRecorte,
): ResultadoDoRecorte {
  const {
    exportWidth,
    viewportWidth,
    viewportHeight,
    baseScale,
    zoom,
    offset,
    naturalWidth,
    naturalHeight,
    rotation,
    fineRotation,
  } = params;

  const targetWidth = exportWidth;
  const targetHeight = Math.round(
    targetWidth * (viewportHeight / viewportWidth),
  );

  // Razão entre o canvas físico (px de exportação) e o viewport exibido na
  // tela (px de CSS) — todo deslocamento/escala do editor precisa passar por
  // aqui antes de virar coordenada de canvas.
  const scaleCanvas = targetWidth / viewportWidth;
  const physScale = baseScale * zoom * scaleCanvas;

  // Onde o centro da imagem está, em px de viewport, relativo ao centro do
  // próprio viewport (não ao canto) — é o que o translate de canvas precisa.
  const centroDoViewportX = viewportWidth / 2;
  const centroDoViewportY = viewportHeight / 2;
  const imgLeftFromCenter = offset.x + naturalWidth / 2 - centroDoViewportX;
  const imgTopFromCenter = offset.y + naturalHeight / 2 - centroDoViewportY;

  const imgDrawW = naturalWidth * physScale;
  const imgDrawH = naturalHeight * physScale;

  return {
    targetWidth,
    targetHeight,
    scaleCanvas,
    translateParaCentro: { x: targetWidth / 2, y: targetHeight / 2 },
    translateAntesDaRotacao: {
      x: imgLeftFromCenter * scaleCanvas,
      y: imgTopFromCenter * scaleCanvas,
    },
    anguloEmRadianos: ((rotation + fineRotation) * Math.PI) / 180,
    desenho: {
      x: -imgDrawW / 2,
      y: -imgDrawH / 2,
      largura: imgDrawW,
      altura: imgDrawH,
    },
  };
}
