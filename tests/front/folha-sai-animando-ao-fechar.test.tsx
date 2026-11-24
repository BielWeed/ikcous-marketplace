// @vitest-environment jsdom
//
// Nova vitrine, Editar vitrine e Nova categoria eram montadas com
// `{aberta && <Folha/>}` sobre um `<Sheet open>` fixo: ao fechar (X, véu, Esc,
// Cancelar) a tela-mãe desmontava a folha antes de a animação de saída rodar, e
// ela SUMIA SECA. Agora a folha fica montada até a saída terminar.
// O jsdom não anima: o dublê faz o `Presence` do Radix enxergar a animação.
import { useConteudoAteASaida } from "@/hooks/useConteudoAteASaida";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  simularSaidaAnimada,
  terminarSaida,
} from "./duble-saida-animada-da-folha";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateConfig = vi.fn(async () => true);
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      homeSections: [
        {
          id: "custom_1",
          title: "Presentes",
          active: true,
          isCustom: true,
          maxItems: 6,
          productIds: [],
        },
      ],
    },
    updateConfig,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.history.replaceState(
    { view: "admin-carousels" },
    "",
    "/admin/carousels",
  );
  vi.spyOn(window.history, "back").mockImplementation(() => {});
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

describe("useConteudoAteASaida", () => {
  function Sonda({ valor }: { valor: string | null }) {
    const { aberta, chave } = useConteudoAteASaida(valor, 320);
    return createElement(
      "output",
      { "data-aberta": String(aberta) },
      chave ?? "nada",
    );
  }
  const ler = () => hospedeiro.querySelector("output") as HTMLElement;
  const mostrar = (valor: string | null) =>
    act(async () => raiz.render(createElement(Sonda, { valor })));

  it("segura o último conteúdo durante a saída e o solta depois", async () => {
    vi.useFakeTimers();
    await mostrar("Presentes");
    expect(ler().textContent).toBe("Presentes");
    expect(ler().dataset.aberta).toBe("true");

    await mostrar(null);
    expect(ler().dataset.aberta).toBe("false");
    expect(ler().textContent).toBe("Presentes");

    await act(async () => {
      vi.advanceTimersByTime(319);
    });
    expect(ler().textContent).toBe("Presentes");
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(ler().textContent).toBe("nada");
  });

  it("dados novos a cada render (como as seções da tela) resolvidos pela chave não geram laço", async () => {
    function SondaDeDados({ id }: { id: string | null }) {
      const { chave } = useConteudoAteASaida(id, 320);
      // Objetos NOVOS a cada render, achados pelo id retido.
      const secoes = [{ id: "custom_1", titulo: "Presentes" }];
      const exibida = chave ? secoes.find((x) => x.id === chave) : null;
      return createElement("output", {}, exibida?.titulo ?? "nada");
    }
    await act(async () =>
      raiz.render(createElement(SondaDeDados, { id: "custom_1" })),
    );
    await act(async () =>
      raiz.render(createElement(SondaDeDados, { id: null })),
    );
    expect(ler().textContent).toBe("Presentes");
  });

  it("cada abertura ganha um número novo (key): reabrir durante a saída nasce de novo", async () => {
    vi.useFakeTimers();
    const aberturas: number[] = [];
    function SondaDeAbertura({ valor }: { valor: string | null }) {
      const { abertura } = useConteudoAteASaida(valor, 320);
      aberturas.push(abertura);
      return null;
    }
    const render = (valor: string | null) =>
      act(async () => raiz.render(createElement(SondaDeAbertura, { valor })));
    await render("a");
    await render("a");
    expect(aberturas.at(-1)).toBe(1);
    await render(null);
    expect(aberturas.at(-1)).toBe(1);
    await render("b");
    expect(aberturas.at(-1)).toBe(2);
    // Trocar de chave com a folha aberta também nasce de novo.
    await render("c");
    expect(aberturas.at(-1)).toBe(3);
  });

  it("reabrir durante a saída cancela a limpeza e mostra o conteúdo novo", async () => {
    vi.useFakeTimers();
    await mostrar("Presentes");
    await mostrar(null);
    await mostrar("Kits");
    expect(ler().textContent).toBe("Kits");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(ler().textContent).toBe("Kits");
    expect(ler().dataset.aberta).toBe("true");
  });
});

describe("AdminCarouselsView — a saída das folhas anima", () => {
  const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const botaoPorTexto = (texto: string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent?.trim() === texto,
    );

  async function montar() {
    simularSaidaAnimada();
    await act(async () => raiz.render(createElement(AdminCarouselsView, {})));
  }

  it("Nova vitrine: Cancelar mantém a folha na tela até a saída terminar", async () => {
    await montar();
    await act(async () => botaoPorTexto("Nova vitrine")?.click());
    expect(dialogo()?.getAttribute("data-state")).toBe("open");

    await act(async () => botaoPorTexto("Cancelar")?.click());
    // Antes: a folha já tinha sumido aqui (a tela a desmontava).
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.getAttribute("data-state")).toBe("closed");

    await act(async () => terminarSaida(dialogo() as HTMLElement));
    expect(dialogo()).toBeNull();
  });

  it("Nova vitrine: reabrir depois da saída abre a folha de novo", async () => {
    await montar();
    await act(async () => botaoPorTexto("Nova vitrine")?.click());
    await act(async () => botaoPorTexto("Cancelar")?.click());
    await act(async () => terminarSaida(dialogo() as HTMLElement));
    expect(dialogo()).toBeNull();

    await act(async () => botaoPorTexto("Nova vitrine")?.click());
    expect(dialogo()?.getAttribute("data-state")).toBe("open");
  });

  it("Editar vitrine: o X mantém a folha, com o nome da vitrine, até a saída terminar", async () => {
    await montar();
    await act(async () =>
      document
        .querySelector<HTMLElement>('[aria-label="Editar vitrine Presentes"]')
        ?.click(),
    );
    expect(dialogo()?.getAttribute("data-state")).toBe("open");

    await act(async () =>
      dialogo()
        ?.querySelector<HTMLElement>('button[aria-label="Fechar"]')
        ?.click(),
    );
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.getAttribute("data-state")).toBe("closed");
    // O conteúdo continua o da vitrine que estava aberta (não esvazia no meio).
    const campo = dialogo()?.querySelector<HTMLInputElement>(
      'input[name="title"]',
    );
    expect(campo?.value).toBe("Presentes");

    await act(async () => terminarSaida(dialogo() as HTMLElement));
    expect(dialogo()).toBeNull();
  });
});
