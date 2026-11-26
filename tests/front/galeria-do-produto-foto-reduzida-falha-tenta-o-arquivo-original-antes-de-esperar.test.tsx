// @vitest-environment jsdom
//
// Galeria do produto — foto servida REDUZIDA (transformação do Supabase) que
// falha: antes de gastar uma nova tentativa com espera, a galeria troca NA HORA
// para o arquivo original. Só se a original também falhar entra a espera e a
// contagem de tentativas (a falha da reduzida não custa tentativa nenhuma).
//   1. erro da reduzida  -> endereço do arquivo original, sem esperar relógio;
//   2. erro da original  -> só então a nova tentativa depois da espera (1,5 s);
//   3. foto de fora do Supabase (sem versão reduzida) não tem original a tentar:
//      o primeiro erro já vai para a espera.
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL =
  "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/produtos/blusa.jpg";
const DE_FORA = "https://cdn.exemplo.test/blusa.jpg";

let raiz: Root;
let hospedeiro: HTMLDivElement;

const foto = () =>
  hospedeiro.querySelector<HTMLImageElement>("img.main-product-image");

function falhar(img: HTMLImageElement | null) {
  expect(img).not.toBeNull();
  act(() => {
    img?.dispatchEvent(new Event("error"));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function montar(url: string) {
  act(() =>
    raiz.render(
      <GaleriaDoProduto
        fotos={[url]}
        nome="Blusa"
        indice={0}
        onMudarIndice={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GaleriaDoProduto — foto reduzida que falha", () => {
  it("o 1º erro troca na hora para o arquivo original; o erro da original espera 1,5 s", async () => {
    montar(ORIGINAL);
    const inicial = foto()?.getAttribute("src");
    expect(inicial).toContain("/storage/v1/render/image/public/");

    falhar(foto());
    // Sem andar o relógio: já está no arquivo original, sem marca de tentativa.
    expect(foto()?.getAttribute("src")).toBe(ORIGINAL);
    expect(foto()?.hasAttribute("srcset")).toBe(false);

    // A original também falha: agora sim a espera (sorteio 0,5 = 1,5 s).
    falhar(foto());
    await avancar(1_499);
    expect(foto()?.getAttribute("src")).toBe(ORIGINAL);
    await avancar(1);
    // Nova tentativa = elemento novo, de volta à versão reduzida, com a marca.
    expect(foto()?.getAttribute("src")).toContain("/storage/v1/render/image/");
    expect(foto()?.getAttribute("src")).toContain("_r=1");
  });

  it("foto de fora do Supabase não tem original a tentar: o 1º erro já espera", async () => {
    montar(DE_FORA);
    expect(foto()?.getAttribute("src")).toBe(DE_FORA);

    falhar(foto());
    expect(foto()?.getAttribute("src")).toBe(DE_FORA);
    await avancar(1_500);
    expect(foto()?.getAttribute("src")).toBe(`${DE_FORA}?_r=1`);
  });
});
