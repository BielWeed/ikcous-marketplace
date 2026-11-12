// @vitest-environment jsdom
//
// CARD DE FRETE GRÁTIS COM A LEITURA DA LOJA FALHA (lote r64-g, 07/11/2026).
//
// Sem leitura e sem cópia no aparelho, `config` é a de fábrica ("completo") e
// a tela o mostrava como a escolha ATUAL da loja, com o Salvar ligado. Gravar
// dali manda só o estilo ao servidor, mas o `updateConfig` mescla o resultado
// na config de fábrica e a guarda no cofre do aparelho como se fosse a da loja.
// Com a leitura falha a tela avisa e trava a escolha e o Salvar.
import { AdminFreeShippingCardView } from "@/views/admin/AdminFreeShippingCardView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  style: "completo",
  loaded: true,
  // `undefined` imita o contexto antigo (dublê sem o campo).
  configIndisponivel: undefined as boolean | undefined,
  updateConfig: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { freeShippingCardStyle: estado.style },
    isLoaded: estado.loaded,
    updateConfig: estado.updateConfig,
    refresh: estado.refresh,
    configIndisponivel: estado.configIndisponivel,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("card de frete grátis — leitura da loja falha (configIndisponivel)", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    estado.style = "completo";
    estado.loaded = true;
    estado.configIndisponivel = undefined;
    estado.updateConfig.mockReset().mockResolvedValue(true);
    estado.refresh.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));
  function montar() {
    act(() => root.render(<AdminFreeShippingCardView active />));
  }
  const radio = (style: string) =>
    container.querySelector<HTMLInputElement>(`input[value="${style}"]`)!;
  const salvar = () =>
    [...container.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("Salvar"),
    )!;
  const aviso = () =>
    container.querySelector<HTMLElement>("[data-aviso-loja-sem-dados]");

  it("leitura falha: mostra o aviso, trava a escolha e o Salvar; nada é gravado", async () => {
    estado.configIndisponivel = true;
    montar();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Não foi possível carregar os dados da loja",
    );
    // O fieldset trava os campos: vale o `:disabled` calculado, não a propriedade.
    expect(radio("compacto").matches(":disabled")).toBe(true);
    expect(salvar().matches(":disabled")).toBe(true);

    act(() => radio("compacto").click());
    await act(async () => salvar().click());
    expect(estado.updateConfig).not.toHaveBeenCalled();
  });

  it("leitura falha com a escolha já mexida: o Salvar fica travado mesmo assim", async () => {
    // Prova a trava do botão sozinha: escolhe com a config boa e só então a
    // leitura passa a falha.
    estado.configIndisponivel = false;
    montar();
    act(() => radio("compacto").click());
    expect(salvar().matches(":disabled")).toBe(false);

    estado.configIndisponivel = true;
    montar();

    expect(aviso()).not.toBeNull();
    expect(salvar().matches(":disabled")).toBe(true);
    await act(async () => salvar().click());
    expect(estado.updateConfig).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' do aviso relê só a configuração", async () => {
    estado.configIndisponivel = true;
    montar();
    const tentar = [...(aviso()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());

    expect(estado.refresh).toHaveBeenCalledTimes(1);
    expect(estado.refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it.each([
    ["false", false],
    ["ausente (contexto antigo)", undefined],
  ] as const)(
    "configIndisponivel %s: sem aviso e o Salvar grava como sempre",
    async (_nome, valor) => {
      estado.configIndisponivel = valor;
      montar();

      expect(aviso()).toBeNull();
      expect(radio("compacto").matches(":disabled")).toBe(false);
      act(() => radio("compacto").click());
      expect(salvar().matches(":disabled")).toBe(false);
      await act(async () => salvar().click());

      expect(estado.updateConfig).toHaveBeenCalledWith(
        { freeShippingCardStyle: "compacto" },
        { silent: true },
      );
      expect(estado.refresh).not.toHaveBeenCalled();
    },
  );
});
