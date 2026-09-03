// @vitest-environment jsdom
//
// A DIVISÃO DE TERRITÓRIO da frente glm-visual-admin-0209 (pedido do Gabriel
// em 02/09/2026: "as chaves da transportadora e o histórico de cotação não
// fazem sentido onde estão"):
//
//   Tela de FRETE (AdminShippingView) ── dona das REGRAS:
//     frete grátis, taxa fixa, CEP de origem, cobertura, entrega local.
//   Ajustes > TRANSPORTADORAS (TransportadorasSection) ── dona da API:
//     `shippingProvider`, `enabledShippingMethods`, credenciais, teste.
//   Ajustes > HISTÓRICO (HistoricoCotacoesSection) ── dona do diagnóstico.
//
// Este arquivo prende a divisão em si, porque a regressão mais barata de
// escrever é a sutil: uma tela "ajudando" a outra e gravando campo alheio.
// Salvar Frete enviando `shippingProvider` de novo revertia a escolha salva
// em Ajustes por um valor velho de formulário — sem erro nenhum, com toast
// verde dos dois lados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, updateConfig } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      freeShippingMin: 100,
      shippingFee: 10,
      shippingCoverage: "national" as "local" | "national",
      shippingProvider: "melhor_envio" as
        | "flat_fee"
        | "melhor_envio"
        | "frenet",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"] as string[],
      localDeliveryFee: 10,
      localCepRange: "",
    },
  },
  estadoDoBanco: {
    credenciais: [
      {
        provider: "melhor_envio",
        credentials: { token: "tok-salvo", sandbox: false },
      },
    ] as any[],
    credenciaisSalvas: [] as any[],
  },
  updateConfig: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        return {
          select: () =>
            Promise.resolve({ data: estadoDoBanco.credenciais, error: null }),
          upsert: (linha: any) => {
            estadoDoBanco.credenciaisSalvas.push(linha);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function digitarNoCampo(
  campo: HTMLInputElement,
  texto: string,
): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

describe("A divisão Frete (regras) × Ajustes (transportadoras)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.credenciaisSalvas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("Salvar a tela de Frete NÃO envia transportadora nem serviços (campo alheio reverteria a escolha salva)", async () => {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView active={true} onSetDirty={vi.fn()} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Torna o formulário sujo (senão o botão nem habilita).
    const campoCep = hospedeiro.querySelector(
      "#origin-cep",
    ) as HTMLInputElement;
    await digitarNoCampo(campoCep, "11111000");

    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).toHaveProperty("originCep", "11111-000");
    // O coração do teste: estes campos são DA SEÇÃO DE TRANSPORTADORAS.
    expect(payload).not.toHaveProperty("shippingProvider");
    expect(payload).not.toHaveProperty("enabledShippingMethods");
  });

  it("a tela de Frete não tem mais token nem histórico, e o atalho leva a Ajustes", async () => {
    const onNavigate = vi.fn();
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // As chaves mudaram de casa: nada de campo de senha nesta tela.
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    // O histórico também: nada de tabela de cotações.
    expect(hospedeiro.querySelector("table")).toBeNull();

    // Com cobertura nacional, o resumo diz onde a configuração foi parar e
    // oferece o caminho curto.
    const botaoAjustes = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /abrir ajustes/i.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(botaoAjustes).toBeDefined();

    await act(async () => {
      botaoAjustes.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("Salvar a seção Transportadoras grava a escolha no config E a credencial no banco", async () => {
    updateConfig.mockResolvedValue(true);
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Torna a seção suja: habilita um serviço novo (jadlog).
    const chipJadlog = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "jadlog",
    ) as HTMLButtonElement;
    expect(chipJadlog).toBeDefined();
    await act(async () => {
      chipJadlog.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    // A escolha vai para o store_config — SOMENTE os campos dela.
    expect(updateConfig).toHaveBeenCalledWith({
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac", "jadlog"],
    });

    // A credencial vai para a tabela própria, com o provedor certo.
    expect(estadoDoBanco.credenciaisSalvas).toHaveLength(1);
    expect(estadoDoBanco.credenciaisSalvas[0]).toMatchObject({
      provider: "melhor_envio",
    });
    expect(estadoDoBanco.credenciaisSalvas[0].credentials).toMatchObject({
      token: "tok-salvo",
    });
  });

  it("updateConfig recusando PARA o fluxo: a credencial não é gravada e ninguém comemora sucesso", async () => {
    // ADMIN-010 (#94): o toast de erro sai de dentro do StoreContext; aqui o
    // que se prova é o LADO DE CÁ do conserto — retorno `false` interrompe o
    // save antes do upsert e não vira toast verde.
    updateConfig.mockResolvedValue(false);

    const { toast } = await import("sonner");
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const chipJadlog = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "jadlog",
    ) as HTMLButtonElement;
    await act(async () => {
      chipJadlog.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    expect(estadoDoBanco.credenciaisSalvas).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
