// @vitest-environment jsdom
//
// RELEASE 1.5.6 — na SuperFrete, a chave `pac` pede o PAC E o Mini Envios, e
// a cliente vê só o mais barato como "Entrega econômica". Sem toggle novo
// (escolha do dono): o chip `pac` precisa DIZER isso à lojista, senão ela
// liga "pac" achando que é só o PAC. Só o texto muda: o valor gravado
// continua a chave `pac`, e com outro provedor o chip continua "pac".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      shippingProvider: "superfrete" as string,
      enabledShippingMethods: ["sedex", "pac"] as string[],
    },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig: vi.fn(() => Promise.resolve(true)),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// Banco vazio: nenhuma credencial salva. Todo filtro devolve a mesma
// consulta, que resolve em lista vazia.
vi.mock("@/lib/supabase", () => {
  const consulta: any = Object.assign(
    Promise.resolve({ data: [], error: null }),
    {
      not: () => consulta,
      neq: () => consulta,
      eq: () => consulta,
      order: () => consulta,
      limit: () => consulta,
    },
  );
  return {
    supabase: {
      from: () => ({
        select: () => consulta,
        upsert: () => Promise.resolve({ error: null }),
      }),
      functions: {
        invoke: vi.fn(() => Promise.resolve({ data: null, error: null })),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TransportadorasSection — chip pac na SuperFrete (1.5.6)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function abrir(provider: string) {
    estadoDaLoja.atual = {
      shippingProvider: provider,
      enabledShippingMethods: ["sedex", "pac"],
    };
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  const chips = () => {
    const titulo = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Serviços que o cliente pode escolher",
    );
    return [...(titulo?.parentElement?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent?.trim() ?? "",
    );
  };

  it("com a SuperFrete, o chip pac diz 'PAC e Mini Envios (o mais barato)'", async () => {
    await abrir("superfrete");
    expect(chips()).toEqual([
      "sedex",
      "PAC e Mini Envios (o mais barato)",
      "jadlog",
    ]);
  });

  it("com o Melhor Envio (controle), o chip continua 'pac' — o Mini não entra pela chave pac lá", async () => {
    await abrir("melhor_envio");
    expect(chips()).toEqual(["sedex", "pac", "jadlog"]);
  });
});
