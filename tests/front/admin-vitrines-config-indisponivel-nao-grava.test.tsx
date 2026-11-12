// @vitest-environment jsdom
//
// VITRINES COM A LEITURA DA LOJA FALHA (r225-a, 12/11/2026).
//
// Sem leitura e sem cópia no aparelho, `config.homeSections` vem indefinido e a
// tela caía nas 3 vitrines DE FÁBRICA, mostradas como se fossem as atuais, com
// tudo habilitado: um toque gravava a lista de fábrica POR CIMA das vitrines
// personalizadas reais (produtos escolhidos incluídos). Com a leitura falha a
// tela avisa, trava toda ação que grava e o próprio handler recusa gravar; com a
// config carregada nada muda. Molde: admin-coupons-view-config-indisponivel-...
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({
  // `undefined` = nunca leu a config (é o caso da leitura falha sem cópia local).
  homeSections: undefined as unknown[] | undefined,
  configIndisponivel: undefined as boolean | undefined,
  updateConfig: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { homeSections: estado.homeSections },
    updateConfig: estado.updateConfig,
    refresh: estado.refresh,
    configIndisponivel: estado.configIndisponivel,
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (p: { children: React.ReactNode }) =>
        createElement("div", null, p.children),
      Item: (p: { children: React.ReactNode }) =>
        createElement("div", null, p.children),
    },
  };
});
// O cartão real fica como está (com o liga/desliga desabilitado). Ao lado dele
// entra um botão que chama `aoAlternarAtiva` SEM olhar `travado`: é ele que
// prova que o HANDLER recusa gravar, mesmo que a aparência falhe um dia.
vi.mock(
  "@/components/admin/vitrines/CartaoDaVitrine",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/components/admin/vitrines/CartaoDaVitrine")
      >();
    return {
      CartaoDaVitrine: (p: Parameters<typeof real.CartaoDaVitrine>[0]) =>
        createElement(
          "div",
          null,
          createElement(real.CartaoDaVitrine, p),
          createElement("button", {
            type: "button",
            "data-forcar-ligar-desligar": p.secao.id,
            onClick: () => p.aoAlternarAtiva(p.secao.id),
          }),
        ),
    };
  },
);

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
}
const aviso = () =>
  hospedeiro.querySelector<HTMLElement>("[data-aviso-loja-sem-dados]");
const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.includes(texto),
  );
const ligaDesliga = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Exibir na loja: Últimos Lançamentos"]',
  );
const forcado = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    '[data-forcar-ligar-desligar="new_arrivals"]',
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  estado.homeSections = undefined;
  estado.configIndisponivel = undefined;
  estado.updateConfig.mockReset().mockResolvedValue(true);
  estado.refresh.mockReset().mockResolvedValue(undefined);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("Vitrines — leitura da loja falha (configIndisponivel)", () => {
  it("avisa que os dados da loja não carregaram", async () => {
    estado.configIndisponivel = true;
    await montar();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Não foi possível carregar os dados da loja",
    );
  });

  it("'Tentar de novo' do aviso relê só a configuração", async () => {
    estado.configIndisponivel = true;
    await montar();
    const tentar = Array.from(
      aviso()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((b) => b.textContent?.includes("Tentar de novo"));
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());

    expect(estado.refresh).toHaveBeenCalledTimes(1);
    expect(estado.refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it("clicar em liga/desliga não grava a lista de fábrica", async () => {
    estado.configIndisponivel = true;
    await montar();

    expect(ligaDesliga()).not.toBeNull();
    expect(ligaDesliga()?.disabled).toBe(true);
    await act(async () => ligaDesliga()?.click());

    expect(estado.updateConfig).not.toHaveBeenCalled();
  });

  it("o handler recusa gravar mesmo se o botão chegar a disparar", async () => {
    estado.configIndisponivel = true;
    await montar();

    expect(forcado()).not.toBeNull();
    await act(async () => forcado()?.click());

    expect(estado.updateConfig).not.toHaveBeenCalled();
  });

  it("'Nova vitrine' e o menu 'Mais ações' (restaurar padrão) ficam desabilitados", async () => {
    estado.configIndisponivel = true;
    await montar();

    expect(botao("Nova vitrine")?.disabled).toBe(true);
    expect(
      hospedeiro.querySelector<HTMLButtonElement>('[aria-label="Mais ações"]')
        ?.disabled,
    ).toBe(true);
    expect(
      hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Editar vitrine Últimos Lançamentos"]',
      )?.disabled,
    ).toBe(true);
  });

  it.each([
    ["false", false],
    ["ausente (contexto antigo)", undefined],
  ] as const)(
    "configIndisponivel %s: sem aviso e o liga/desliga grava como sempre",
    async (_nome, valor) => {
      estado.configIndisponivel = valor;
      await montar();

      expect(aviso()).toBeNull();
      expect(botao("Nova vitrine")?.disabled).toBe(false);
      expect(ligaDesliga()?.disabled).toBe(false);
      await act(async () => ligaDesliga()?.click());

      expect(estado.updateConfig).toHaveBeenCalledTimes(1);
      const [alteracao] = estado.updateConfig.mock.calls[0] as [
        { homeSections: { id: string; active: boolean }[] },
      ];
      expect(alteracao.homeSections.map((s) => [s.id, s.active])).toEqual([
        ["new_arrivals", false],
        ["offers", true],
        ["bestsellers", true],
      ]);
      expect(estado.refresh).not.toHaveBeenCalled();
    },
  );
});
