// @vitest-environment jsdom
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loja, updateConfig, invoke, erroToast, sucessoToast } = vi.hoisted(
  () => ({
    loja: { atual: {} as StoreConfig },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
    erroToast: vi.fn(),
    sucessoToast: vi.fn(),
  }),
);
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.atual, isLoaded: true, updateConfig }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/pagamento-pelo-app-no-painel", () => ({
  usePagamentoPeloApp: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: sucessoToast, error: erroToast },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Abas de frete grátis", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = {
      originCep: "38400-000",
      storeCity: "Cidade Exemplo",
      storeState: "MG",
      storeAddress: "Rua Exemplo, 123",
      freeShippingMin: 0,
      shippingCoverage: "local",
      localDeliveryFee: 10,
      localDeliveryDays: 1,
      localDeliveryEnabled: true,
      localCepRange: "38400",
      enabledShippingMethods: ["pac", "sedex"],
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    } as StoreConfig;
    updateConfig.mockImplementation(async (patch: Partial<StoreConfig>) => {
      loja.atual = { ...loja.atual, ...patch };
      return true;
    });
    invoke.mockImplementation(
      async (_: string, { body }: { body: { action: string } }) =>
        body.action === "ler_configuracao_frete"
          ? {
              data: {
                success: true,
                modo: "multi",
                ligados: ["frenet"],
                provedores: {
                  frenet: { tem_chave: true, sandbox: false, servicos: ["1"] },
                },
              },
            }
          : { data: { success: true, ligados: [] } },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function montar() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => root.render(<AdminShippingView active />));
  }
  async function clicar(texto: string, contexto: ParentNode = host) {
    const b = [...contexto.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("aria-label") === texto,
    );
    expect(b, texto).toBeTruthy();
    expect(b!.disabled, texto).toBe(false);
    await act(async () => b!.click());
  }
  async function escolher(id: string, texto: string) {
    const bloco = host.querySelector(id)!;
    const radio = [
      ...bloco.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((b) => b.textContent?.includes(texto));
    expect(radio, texto).toBeTruthy();
    await act(async () => radio!.click());
  }
  async function digitar(id: string, valor: string) {
    const campo = host.querySelector<HTMLInputElement>(`#${id}`)!;
    expect(campo, id).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("move foco e seleção sem desmontar os painéis nem apagar a digitação", async () => {
    await montar();
    await clicar("Frete grátis", host.querySelector("#painel-frete-gratis")!);
    await escolher(
      "#bloco-frete-local-estrategias",
      "Grátis acima de um valor",
    );
    await digitar("frete-gratis-acima-de", "150");
    const local = host.querySelector<HTMLButtonElement>("#aba-gratis-local")!;
    const nacional = host.querySelector<HTMLButtonElement>(
      "#aba-gratis-nacional",
    )!;
    const painelLocal = host.querySelector<HTMLElement>("#gratis-local")!;
    const painelNacional = host.querySelector<HTMLElement>("#gratis-nacional")!;
    const campo = painelLocal.querySelector<HTMLInputElement>(
      "#frete-gratis-acima-de",
    )!;

    local.focus();
    const atalho = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => local.dispatchEvent(atalho));
    expect(atalho.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(local);
    expect(local.getAttribute("aria-selected")).toBe("true");
    expect(nacional.getAttribute("aria-selected")).toBe("false");

    for (const [tecla, atual, outra] of [
      ["ArrowRight", nacional, local],
      ["ArrowRight", local, nacional],
      ["ArrowLeft", nacional, local],
      ["Home", local, nacional],
      ["End", nacional, local],
    ] as const) {
      const evento = new KeyboardEvent("keydown", {
        key: tecla,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => document.activeElement?.dispatchEvent(evento));
      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(atual);
      expect(atual.tabIndex).toBe(0);
      expect(outra.tabIndex).toBe(-1);
      expect(atual.getAttribute("aria-selected")).toBe("true");
      expect(outra.getAttribute("aria-selected")).toBe("false");
      expect(painelLocal.hidden).toBe(atual !== local);
      expect(painelNacional.hidden).toBe(atual !== nacional);
    }

    await clicar("Na sua região", host.querySelector('[role="tablist"]')!);
    expect(host.querySelector("#frete-gratis-acima-de")).toBe(campo);
    expect(campo.value).toMatch(/150/);
    expect(host.querySelector("#gratis-nacional")).toBe(painelNacional);
    expect(local.tabIndex).toBe(0);
  });
});
