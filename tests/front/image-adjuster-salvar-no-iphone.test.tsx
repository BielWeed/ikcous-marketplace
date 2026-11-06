// @vitest-environment jsdom
//
// "Salvar Ajuste" do editor de foto, três defeitos que só apareciam no iPhone
// ou no toque duplo:
//  1. O canvas do Safari não tem `ctx.filter`: a prévia (filtro CSS) mostrava
//     P&B/Vívido, mas a foto salva saía com as cores originais. Agora, sem
//     `ctx.filter`, o filtro é refeito pixel a pixel antes de gerar o arquivo.
//  2. O Safari não gera WebP e entrega PNG pesado: o recorte refaz em JPEG.
//  3. Dois toques rápidos em "Salvar Ajuste" disparavam dois recortes e dois
//     envios (o botão só desliga depois que o recorte termina).
// Não há canvas de verdade no jsdom: o canvas é um dublê que anota o que o
// componente pediu a ele.
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO = "https://example.com/produto.jpg";

interface ContextoFalso {
  canvas: HTMLCanvasElement;
  filter?: string;
  fillStyle: string;
  desenhos: unknown[][];
  pixelsGravados: Uint8ClampedArray | null;
  pediuPixels: boolean;
  [chave: string]: unknown;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let contextos: ContextoFalso[];
let pedidosDeBlob: string[];
let aoPedirBlob: (tipo: string) => Blob;
// Canvas de exportação = o único com mais de 64 px (o de 64x64 é a análise da foto).
const doExport = () => contextos.filter((c) => c.canvas.width > 64);

function instalarCanvas(comFiltro: boolean) {
  contextos = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const existente = contextos.find((c) => c.canvas === this);
      if (existente) return existente as never;
      const ctx: ContextoFalso = {
        canvas: this,
        fillStyle: "",
        desenhos: [],
        pixelsGravados: null,
        pediuPixels: false,
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        fillRect() {},
        drawImage(...args: unknown[]) {
          ctx.desenhos.push(args);
        },
        getImageData(_x: number, _y: number, w: number, h: number) {
          ctx.pediuPixels = true;
          // Foto inteira vermelha: sob P&B os três canais têm de ficar iguais.
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i += 4) {
            data.set([255, 0, 0, 255], i);
          }
          return { data, width: w, height: h };
        },
        putImageData(imagem: { data: Uint8ClampedArray }) {
          ctx.pixelsGravados = new Uint8ClampedArray(imagem.data);
        },
      };
      if (comFiltro) ctx.filter = "none";
      contextos.push(ctx);
      return ctx as never;
    },
  );
  pedidosDeBlob = [];
  aoPedirBlob = (tipo) => new Blob(["x"], { type: tipo });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (cb: BlobCallback, tipo?: string) => {
      pedidosDeBlob.push(tipo ?? "");
      cb(aoPedirBlob(tipo ?? ""));
    },
  );
}

// Image() de mentira: a foto "carrega" logo depois de receber o src.
class ImagemFalsa {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const botao = (nome: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );

async function abrir(onConfirm: (b: Blob) => Promise<void>) {
  await act(async () => {
    raiz.render(
      <ImageAdjuster
        isOpen
        onClose={() => {}}
        onConfirm={onConfirm}
        imageUrl={FOTO}
      />,
    );
  });
  // A prévia termina de carregar: libera o "Salvar Ajuste".
  await act(async () => {
    document.body
      .querySelector<HTMLImageElement>('img[alt="Ajuste"]')
      ?.dispatchEvent(new Event("load"));
  });
}

async function escolherPreset(nome: string) {
  await act(async () => botao("Filtros")!.click());
  await act(async () => botao(nome)!.click());
}

async function salvar(vezes = 1) {
  await act(async () => {
    for (let i = 0; i < vezes; i++) botao("Salvar Ajuste")!.click();
    await esperar();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("Image", ImagemFalsa);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageAdjuster — Salvar Ajuste sem ctx.filter (Safari do iPhone)", () => {
  it("P&B escolhido: a foto salva sai em tons de cinza, refeita pixel a pixel, e o canvas final recebe esse desenho", async () => {
    instalarCanvas(false);
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    await escolherPreset("P&B");
    await salvar();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const camada = doExport().find((c) => c.pixelsGravados);
    expect(camada, "ninguém gravou pixels filtrados").toBeTruthy();
    const px = camada!.pixelsGravados!;
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[0]).toBeLessThan(255); // o vermelho puro não passou intacto
    expect(px[3]).toBe(255);
    // O canvas que vira arquivo recebeu a camada filtrada por cima do fundo.
    const principal = doExport().find((c) => c !== camada)!;
    expect(principal.desenhos.some((d) => d[0] === camada!.canvas)).toBe(true);
    // E nada atribuiu `filter`: no Safari isso só criaria uma propriedade sem efeito.
    expect("filter" in principal).toBe(false);
  });

  it("sem filtro nenhum (tudo em repouso): não gasta tempo lendo pixels", async () => {
    instalarCanvas(false);
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    await salvar();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(doExport().some((c) => c.pediuPixels)).toBe(false);
    expect(doExport().some((c) => c.pixelsGravados)).toBe(false);
  });
});

describe("ImageAdjuster — Salvar Ajuste com ctx.filter (Chrome, Firefox)", () => {
  it("segue usando o filtro do canvas: nada de ler pixels", async () => {
    instalarCanvas(true);
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    await escolherPreset("P&B");
    await salvar();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const principal = doExport()[0];
    expect(principal.filter).toBe(
      "brightness(105%) contrast(120%) saturate(0%) grayscale(100%) sepia(0%)",
    );
    expect(doExport().some((c) => c.pediuPixels)).toBe(false);
  });
});

describe("ImageAdjuster — o Safari devolve PNG no lugar de WebP", () => {
  it("o arquivo entregue é o JPEG, não o PNG pesado", async () => {
    instalarCanvas(true);
    aoPedirBlob = (tipo) =>
      tipo === "image/webp"
        ? new Blob([new Uint8Array(3000)], { type: "image/png" })
        : new Blob([new Uint8Array(300)], { type: tipo });
    const recebidos: Blob[] = [];
    await abrir(async (b) => {
      recebidos.push(b);
    });
    await salvar();

    expect(pedidosDeBlob).toEqual(["image/webp", "image/jpeg"]);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].type).toBe("image/jpeg");
  });

  it("navegador que gera WebP: um pedido só, entrega o WebP", async () => {
    instalarCanvas(true);
    const recebidos: Blob[] = [];
    await abrir(async (b) => {
      recebidos.push(b);
    });
    await salvar();

    expect(pedidosDeBlob).toEqual(["image/webp"]);
    expect(recebidos[0].type).toBe("image/webp");
  });
});

describe("ImageAdjuster — área segura do iPhone instalado", () => {
  // O app instalado desenha por baixo da barra de status e pinta uma faixa
  // preta (index.css, html::before) POR CIMA de tudo na altura dela; o editor
  // é uma camada de tela cheia fora do AdminLayout. Sem folga, "Voltar" e o
  // título ficavam sob a faixa e "Cancelar"/"Salvar" na área da barra de início.
  // `pt-safe`/`pb-safe` valem 0 fora do iPhone instalado.
  it("a camada do editor reserva a folga do topo e a de baixo", async () => {
    instalarCanvas(true);
    await abrir(async () => {});
    const camada = document.body.querySelector('[role="dialog"]');
    expect(camada?.classList.contains("pt-safe")).toBe(true);
    expect(camada?.classList.contains("pb-safe")).toBe(true);
  });
});

describe("ImageAdjuster — toque duplo em Salvar Ajuste", () => {
  it("dois toques seguidos entregam UM recorte só", async () => {
    instalarCanvas(true);
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    await salvar(2);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(pedidosDeBlob).toHaveLength(1);
  });

  it("enquanto o envio do primeiro ainda não terminou, o segundo toque também é ignorado", async () => {
    instalarCanvas(true);
    let terminar: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    await abrir(onConfirm);
    await salvar();
    await salvar(); // o envio do primeiro segue pendente
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      terminar();
      await esperar();
    });
    await salvar(); // terminou: um toque novo vale
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("se o envio falhar, a trava solta e dá para tentar de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    instalarCanvas(true);
    const onConfirm = vi
      .fn<(b: Blob) => Promise<void>>()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValue(undefined);
    await abrir(onConfirm);
    await salvar();
    await salvar();

    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("se o canvas não gerar o arquivo (blob nulo), a trava solta também", async () => {
    instalarCanvas(true);
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    const original = aoPedirBlob;
    aoPedirBlob = () => null as never;
    await salvar();
    expect(onConfirm).not.toHaveBeenCalled();

    aoPedirBlob = original;
    await salvar();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
