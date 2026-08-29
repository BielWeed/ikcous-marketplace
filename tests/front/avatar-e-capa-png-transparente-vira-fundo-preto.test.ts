// @vitest-environment jsdom
//
// A cliente sobe um PNG com fundo transparente (logo, figurinha) como foto de
// perfil ou como capa. `compressImage` (avatars.ts) e `compressCoverImage`
// (covers.ts) desenham a imagem num <canvas> e chamam
// `canvas.toDataURL("image/jpeg", …)` sem pintar nada antes. JPEG não tem
// canal alfa: a área transparente do PNG é composta sobre PRETO por padrão
// do canvas, e a foto "aparece corrompida" com fundo preto onde era
// transparente.
//
// O jsdom desta suíte não tem `getContext("2d")` real (não há dependência
// `canvas` instalada — decisão registrada em vitest.config.ts para não pagar
// esse peso sem um teste que precise). Por isso o teste substitui o contexto
// por um dublê que GRAVA A ORDEM das chamadas: a prova de que o fundo é
// pintado ANTES de desenhar a imagem em cima é a única forma de exercitar o
// mecanismo real sem renderizar pixel de verdade — pintar depois não
// resolveria nada (a imagem já estaria em cima).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dublê de <img>: jsdom não carrega imagem de verdade (sem rede), então
// `onload` nunca dispararia sozinho. Este dublê simula o carregamento
// assíncrono chamando `onload` num `setTimeout(0)`, do jeito que o navegador
// real dispara depois do `src` ser atribuído.
class ImagemFalsa {
  width = 64;
  height = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = "";
  set src(valor: string) {
    this.#src = valor;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this.#src;
  }
}

interface ContextoFalso {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

describe("PNG transparente vira fundo preto no avatar e na capa", () => {
  let chamadas: string[];
  let contexto: ContextoFalso;
  // A COR VIGENTE NO INSTANTE DO `fillRect` — e não a cor lida no fim.
  // Num `CanvasRenderingContext2D` real o `fillStyle` default é PRETO
  // (`#000000`): quem apagar a linha `ctx.fillStyle = "#FFFFFF"` e deixar o
  // `fillRect` de pé reintroduz exatamente o defeito original — fundo preto —
  // e uma asserção que só mede a ORDEM continuaria verde. Por isso a cor é
  // capturada onde ela decide, dentro do `fillRect`.
  let corNoFillRect: string | null;

  beforeEach(() => {
    chamadas = [];
    corNoFillRect = null;
    contexto = {
      fillStyle: "",
      fillRect: vi.fn(() => {
        corNoFillRect = contexto.fillStyle;
        chamadas.push("fillRect");
      }),
      drawImage: vi.fn(() => chamadas.push("drawImage")),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      // Dublê deliberadamente parcial do CanvasRenderingContext2D real —
      // só o que o código sob teste usa.
      contexto as any,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      (tipo?: string) => `data:${tipo ?? "image/png"};base64,FAKE`,
    );
    vi.stubGlobal("Image", ImagemFalsa);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("compressImage (avatar): pinta um fundo ANTES de desenhar a imagem — senão a área transparente vira preto no JPEG", async () => {
    const { compressImage } = await import("@/utils/avatars");

    await compressImage("data:image/png;base64,QUALQUERCOISA");

    expect(contexto.fillRect).toHaveBeenCalled();
    expect(contexto.drawImage).toHaveBeenCalled();
    const posicaoFill = chamadas.indexOf("fillRect");
    const posicaoDraw = chamadas.indexOf("drawImage");
    expect(posicaoFill).toBeGreaterThanOrEqual(0);
    expect(posicaoFill).toBeLessThan(posicaoDraw);
    // Ordem certa com a cor errada é o defeito original de volta.
    expect(corNoFillRect?.toUpperCase()).toBe("#FFFFFF");
  });

  it("compressCoverImage (capa): pinta um fundo ANTES de desenhar a imagem — mesmo defeito, mesmo conserto", async () => {
    const { compressCoverImage } = await import("@/utils/covers");

    await compressCoverImage("data:image/png;base64,QUALQUERCOISA");

    expect(contexto.fillRect).toHaveBeenCalled();
    expect(contexto.drawImage).toHaveBeenCalled();
    const posicaoFill = chamadas.indexOf("fillRect");
    const posicaoDraw = chamadas.indexOf("drawImage");
    expect(posicaoFill).toBeGreaterThanOrEqual(0);
    expect(posicaoFill).toBeLessThan(posicaoDraw);
    // Ordem certa com a cor errada é o defeito original de volta.
    expect(corNoFillRect?.toUpperCase()).toBe("#FFFFFF");
  });

  // O fundo pintado não pode trocar o tipo devolvido: o resto do app (upload,
  // `updateProfile`, exibição) já espera `image/jpeg` — mudar para PNG aqui
  // quebraria em outro lugar sem sinal nenhum no teste desta função.
  it("continua devolvendo image/jpeg — o conserto não troca o tipo que o resto do app espera", async () => {
    const { compressImage } = await import("@/utils/avatars");
    const { compressCoverImage } = await import("@/utils/covers");

    const avatarComprimido = await compressImage(
      "data:image/png;base64,QUALQUERCOISA",
    );
    const capaComprimida = await compressCoverImage(
      "data:image/png;base64,QUALQUERCOISA",
    );

    expect(avatarComprimido.startsWith("data:image/jpeg")).toBe(true);
    expect(capaComprimida.startsWith("data:image/jpeg")).toBe(true);
  });
});
