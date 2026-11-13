// @vitest-environment jsdom
//
// "Salvar Ajuste" com a rede pendurada. O recorte baixa a foto de novo e a
// espera só terminava em onload/onerror, sem prazo: com a rede parada o ref de
// "recorte em andamento" ficava ligado para sempre, os toques seguintes eram
// descartados e o botão continuava "Salvar Ajuste", sem aviso nenhum. Agora a
// espera tem prazo de 15 s: estourou, a lojista é avisada em português simples
// e o próximo toque tenta de novo.
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO = "https://example.com/produto.jpg";

let raiz: Root;
let hospedeiro: HTMLDivElement;
// Cada `new Image()` do recorte entra aqui; `penduradas` diz quantas das
// primeiras nunca respondem (a rede parou), as demais carregam normalmente.
let imagensCriadas: ImagemDaRede[];
let penduradas: number;

class ImagemDaRede {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  srcRecebido: string | null = null;
  constructor() {
    imagensCriadas.push(this);
  }
  set src(v: string) {
    this.srcRecebido = v;
    const indice = imagensCriadas.indexOf(this);
    if (indice < penduradas) return; // rede pendurada: nunca responde
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this.srcRecebido ?? "";
  }
}

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function instalarCanvas() {
  const contexto = {
    fillStyle: "",
    filter: "none",
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fillRect() {},
    drawImage() {},
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => contexto as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (cb: BlobCallback, tipo?: string) => {
      cb(new Blob(["x"], { type: tipo ?? "image/webp" }));
    },
  );
}

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

async function tocarSalvar(ms: number) {
  await act(async () => {
    botao("Salvar Ajuste")!.click();
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  imagensCriadas = [];
  penduradas = 0;
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("Image", ImagemDaRede);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(toast.error).mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  instalarCanvas();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageAdjuster — Salvar Ajuste com a rede pendurada", () => {
  it("passados 15 s a lojista é avisada e o toque seguinte tenta de novo", async () => {
    const onConfirm = vi.fn(async () => {});
    await abrir(onConfirm);
    vi.useFakeTimers();
    penduradas = 1; // só a primeira tentativa pendura

    await tocarSalvar(1_000);
    // Dentro do prazo: nenhum aviso, nada entregue, e um novo toque é descartado.
    expect(toast.error).not.toHaveBeenCalled();
    await tocarSalvar(1_000);
    expect(imagensCriadas).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    const aviso = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(aviso).toBe(
      "Não deu para carregar a foto agora. Tente salvar de novo.",
    );
    expect(onConfirm).not.toHaveBeenCalled();

    // A foto pendurada é solta: nada que ela faça depois chega ao recorte.
    expect(imagensCriadas[0].onload).toBeNull();
    expect(imagensCriadas[0].onerror).toBeNull();

    // Novo toque: o recorte volta a baixar a foto e desta vez conclui.
    await tocarSalvar(100);
    expect(imagensCriadas).toHaveLength(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
