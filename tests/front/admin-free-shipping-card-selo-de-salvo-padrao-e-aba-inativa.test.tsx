// @vitest-environment jsdom
//
// CARD DE FRETE GRATIS (painel) — tres bordas que o teste vizinho
// (admin-free-shipping-card.test.tsx) nao cobria:
//  1. o selo de situacao: depois de salvar diz "Salvo"; ao mexer de novo ele
//     some (volta a "Ainda nao salvo" ou, se a escolha voltou ao que estava
//     salvo, a "Sem alteracoes") — nunca fica um "Salvo" velho na tela;
//  2. loja sem o estilo no retrato da config (config incompleta) abre no
//     estilo "completo", o de sempre;
//  3. o Salvar solta a trava depois de gravar: dá para mexer e salvar DE NOVO
//     na mesma abertura da tela (a trava presa fazia o 2o Salvar ser engolido);
//  4. enquanto a loja ainda carrega, o aviso de "leitura falhou" não aparece
//     (o que vale é o "Carregando…");
//  5. a aba INATIVA (o painel mantem telas montadas em segundo plano) nao
//     avisa o painel de nada: um `onSetDirty(false)` vindo dela apagaria a
//     marca de "alteracoes nao salvas" da tela que esta ativa.
import { AdminFreeShippingCardView } from "@/views/admin/AdminFreeShippingCardView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: { freeShippingCardStyle: "completo" } as Record<string, unknown>,
  loaded: true,
  falhou: false,
  updateConfig: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    isLoaded: estado.loaded,
    updateConfig: estado.updateConfig,
    refresh: estado.refresh,
    configIndisponivel: estado.falhou,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("card de frete gratis: selo de salvo, padrao e aba inativa", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onSetDirty = vi.fn<(dirty: boolean) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    estado.config = { freeShippingCardStyle: "completo" };
    estado.loaded = true;
    estado.falhou = false;
    estado.updateConfig.mockReset().mockResolvedValue(true);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  function montar(active = true) {
    act(() =>
      root.render(
        <AdminFreeShippingCardView active={active} onSetDirty={onSetDirty} />,
      ),
    );
  }
  function radio(estilo: string) {
    const alvo = container.querySelector<HTMLInputElement>(
      `input[value="${estilo}"]`,
    );
    if (!alvo) throw new Error(`Radio ${estilo} não está na tela.`);
    return alvo;
  }
  function salvar() {
    const botao = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    );
    if (!botao) throw new Error("Botão Salvar não está na tela.");
    return botao;
  }
  function selo() {
    return [...container.querySelectorAll('p[role="status"]')]
      .map((p) => p.textContent)
      .find((t) =>
        ["Ainda não salvo", "Salvo", "Sem alterações"].includes(t ?? ""),
      );
  }

  it("selo: sem mexer diz 'Sem alterações'; ao escolher, 'Ainda não salvo'; ao salvar, 'Salvo'", async () => {
    montar();
    expect(selo()).toBe("Sem alterações");
    act(() => radio("compacto").click());
    expect(selo()).toBe("Ainda não salvo");
    await act(async () => salvar().click());
    expect(selo()).toBe("Salvo");
  });

  it("selo: depois de salvo, mexer de novo tira o 'Salvo' (mesmo se a escolha volta ao salvo)", async () => {
    montar();
    act(() => radio("compacto").click());
    await act(async () => salvar().click());
    expect(selo()).toBe("Salvo");

    act(() => radio("completo").click());
    expect(selo()).toBe("Ainda não salvo");
    // Voltou ao que estava salvo: nada pendente, e o "Salvo" velho não volta.
    act(() => radio("compacto").click());
    expect(selo()).toBe("Sem alterações");
  });

  it("config sem o estilo (retrato incompleto) abre no 'completo', sem alteração pendente", () => {
    estado.config = {};
    montar();
    expect(radio("completo").checked).toBe(true);
    expect(radio("compacto").checked).toBe(false);
    expect(salvar().disabled).toBe(true);
    expect(selo()).toBe("Sem alterações");
  });

  it("salvar solta a trava: mexer e salvar de novo na mesma abertura grava as duas vezes", async () => {
    montar();
    act(() => radio("compacto").click());
    await act(async () => salvar().click());
    expect(estado.updateConfig).toHaveBeenCalledTimes(1);

    act(() => radio("completo").click());
    expect(salvar().disabled).toBe(false);
    await act(async () => salvar().click());
    expect(estado.updateConfig).toHaveBeenCalledTimes(2);
    expect(estado.updateConfig).toHaveBeenLastCalledWith(
      { freeShippingCardStyle: "completo" },
      { silent: true },
    );
  });

  it("ainda carregando: o aviso de leitura falha nao aparece (mesmo com o sinal de falha ligado)", () => {
    estado.loaded = false;
    estado.falhou = true;
    montar();
    expect(container.querySelector("[data-aviso-loja-sem-dados]")).toBeNull();
    expect(container.textContent).toContain("Carregando");
  });

  it("carregou e a leitura falhou: o aviso aparece (controle do teste anterior)", () => {
    estado.loaded = true;
    estado.falhou = true;
    montar();
    expect(
      container.querySelector("[data-aviso-loja-sem-dados]"),
    ).not.toBeNull();
  });

  it("aba inativa nao avisa o painel de nada (nem 'sujo', nem 'limpo')", () => {
    montar(false);
    expect(onSetDirty).not.toHaveBeenCalled();
  });

  it("aba ativa avisa o painel (controle do teste anterior)", () => {
    montar(true);
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});
