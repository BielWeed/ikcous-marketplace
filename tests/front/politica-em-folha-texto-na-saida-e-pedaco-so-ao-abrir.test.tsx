// @vitest-environment jsdom
//
// Folha da política — borda sem guarda:
//  Ao FECHAR, a folha ainda faz a animação de saída: título e texto continuam
//     os da política que estava aberta (a folha não esvazia nem encolhe enquanto
//     some). O jsdom não roda animação; aqui a leitura de estilo é dublada para
//     o Radix enxergar uma animação de saída e esperar o `animationend`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { nomeDaPolitica } from "@/lib/nomes-das-politicas";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja da Ana" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

// Aquece o import pesado (folha, textos das políticas) fora do tempo do teste.
beforeAll(async () => {
  await import("@/components/politicas/PoliticaEmFolha");
}, 60_000);

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function simularAnimacaoDeSaida() {
  // O jsdom não tem `CSS.escape`, que o Radix usa ao ouvir o fim da animação.
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
  const original = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
    (elemento: Element, pseudo?: string | null) => {
      const real = original(elemento, pseudo);
      return new Proxy(real, {
        get(alvo, propriedade) {
          if (propriedade === "animationName") {
            return elemento.getAttribute("data-state") === "closed"
              ? "slide-out"
              : "slide-in";
          }
          const valor = Reflect.get(alvo, propriedade) as unknown;
          return typeof valor === "function" ? valor.bind(alvo) : valor;
        },
      });
    },
  );
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-politica"]');

describe("PoliticaEmFolha — texto durante a animação de saída", () => {
  it("fechada a folha, título e texto seguem os da política aberta até a animação acabar", async () => {
    simularAnimacaoDeSaida();
    const { PoliticaEmFolha } = await import(
      "@/components/politicas/PoliticaEmFolha"
    );
    await act(async () => {
      raiz.render(<PoliticaEmFolha tipo={null} onFechar={vi.fn()} />);
    });
    expect(folha()).toBeNull();

    await act(async () => {
      raiz.render(<PoliticaEmFolha tipo="termos" onFechar={vi.fn()} />);
    });
    expect(folha()?.textContent).toContain(nomeDaPolitica("termos"));
    expect(
      folha()?.querySelector('[data-testid="politica-termos"]'),
    ).not.toBeNull();

    // Fecha: a folha ainda está na tela (animação de saída) e NÃO esvaziou.
    await act(async () => {
      raiz.render(<PoliticaEmFolha tipo={null} onFechar={vi.fn()} />);
    });
    expect(folha()).not.toBeNull();
    expect(folha()?.getAttribute("data-state")).toBe("closed");
    expect(folha()?.textContent).toContain(nomeDaPolitica("termos"));
    expect(
      folha()?.querySelector('[data-testid="politica-termos"]'),
    ).not.toBeNull();

    // A animação termina: a folha sai de vez.
    await act(async () => {
      const evento = new Event("animationend", { bubbles: true });
      Object.defineProperty(evento, "animationName", { value: "slide-out" });
      folha()?.dispatchEvent(evento);
    });
    expect(folha()).toBeNull();
  });
});
