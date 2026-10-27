// @vitest-environment jsdom
//
// Lote 221, "Sobre a loja": sem internet, o mapa embutido e o link do Google
// Maps levam a uma página de erro. Agora, sem rede, a tela mostra o endereço
// em texto e o aviso "Sem internet" no lugar do mapa; com rede, nada muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigDeTeste = Record<string, unknown>;

let configAtual: ConfigDeTeste = {};
let semInternet = false;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
}));

// O hook de rede que a casca já tem; aqui só o valor que ele devolve.
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => semInternet,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Mudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Mudo);
vi.stubGlobal("IntersectionObserver", Mudo);

const LOJA: ConfigDeTeste = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  storeAddress: "Rua das Flores, 120, Centro",
};

describe("AboutStoreView — sem internet, endereço em texto no lugar do mapa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    semInternet = false;
    configAtual = { ...LOJA };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
  }

  it("com internet: o mapa e o link do Google Maps aparecem", async () => {
    await montar();
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(
      hospedeiro.querySelector('a[href*="google.com/maps"]'),
    ).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Sem internet");
  });

  it("sem internet: nada de mapa nem link; o endereço aparece em texto com o aviso", async () => {
    semInternet = true;
    await montar();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(hospedeiro.querySelector('a[href*="google.com/maps"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("Sem internet");
    expect(hospedeiro.textContent).toContain("Rua das Flores, 120, Centro");
  });

  it("sem internet e sem endereço, o texto usa o CEP ou a cidade que a loja tem", async () => {
    semInternet = true;
    configAtual = { ...LOJA, storeAddress: "" };
    await montar();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(hospedeiro.textContent).toContain("Sem internet");
    expect(hospedeiro.textContent).toContain("Monte Carmelo, MG");
  });
});
