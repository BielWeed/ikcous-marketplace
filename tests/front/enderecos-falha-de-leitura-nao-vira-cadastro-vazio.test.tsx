// @vitest-environment jsdom
import type { Address } from "@/types";
import { ProfileView } from "@/views/customer/ProfileView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { data: Address[] | null; error: Error | null };

const { sessao, consultas } = vi.hoisted(() => ({
  sessao: {
    usuario: { id: "conta-a", email: "cliente@example.com", user_metadata: {} },
  },
  consultas: [] as Array<(resultado: Resultado) => void>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: sessao.usuario,
    profile: { full_name: "Ana", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));

// Hook, tela e lista reais; só a leitura remota fica controlada.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const promessa = new Promise<Resultado>((resolve) => {
        consultas.push(resolve);
      });
      const cadeia = Object.assign(promessa, {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
      });
      return cadeia;
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useOrders", () => {
  const fetchUserOrders = vi.fn();
  return { useOrders: () => ({ orders: [], fetchUserOrders }) };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja",
      businessHours: "Seg-Sex: 8h às 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CASA: Address = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: true,
};

describe("Perfil — falha de leitura não vira cadastro vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const navegar = vi.fn();

  beforeEach(() => {
    sessao.usuario = {
      id: "conta-a",
      email: "cliente@example.com",
      user_metadata: {},
    };
    consultas.length = 0;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderizar(onNavigate = navegar) {
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
  }

  async function responder(resultado: Resultado) {
    const resolver = consultas.shift();
    expect(resolver).toBeDefined();
    await act(async () => {
      resolver!(resultado);
    });
  }

  function aviso() {
    return hospedeiro.querySelector('[role="alert"]');
  }

  function tentarDeNovo() {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Tentar de novo",
    );
    expect(botao).toBeDefined();
    return act(async () => botao!.click());
  }

  it("primeira leitura falha sem cache: mostra aviso persistente e nova tentativa", async () => {
    await renderizar();
    await responder({ data: null, error: new Error("Sem rede") });

    expect(aviso()?.textContent).toContain(
      "Não conseguimos carregar seus endereços agora.",
    );
    expect(aviso()?.textContent).toContain("Tentar de novo");
    expect(hospedeiro.textContent).not.toContain("Nenhum endereço cadastrado");
    await renderizar();
    expect(aviso()).not.toBeNull();
  });

  it("tentar de novo com sucesso remove o aviso e mostra os endereços", async () => {
    await renderizar();
    await responder({ data: null, error: new Error("Sem rede") });
    await tentarDeNovo();
    await responder({ data: [CASA], error: null });

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Rua Principal");
    expect(hospedeiro.textContent).not.toContain("Nenhum endereço cadastrado");
  });

  it.each(["cache", "memória"] as const)(
    "releitura falha: mantém os dados de %s na tela",
    async (origem) => {
      if (origem === "cache") {
        localStorage.setItem(
          "ikcous_addresses_cache_conta-a",
          JSON.stringify([CASA]),
        );
      }
      await renderizar();
      if (origem === "memória") {
        await responder({ data: [CASA], error: null });
        localStorage.removeItem("ikcous_addresses_cache_conta-a");
        // A nova navegação dispara o efeito de leitura da mesma tela.
        await renderizar(vi.fn());
      }
      expect(hospedeiro.textContent).toContain("Rua Principal");
      await responder({ data: null, error: new Error("Sem rede") });

      expect(hospedeiro.textContent).toContain("Rua Principal");
      expect(aviso()?.textContent).toContain("Tentar de novo");
      expect(hospedeiro.textContent).not.toContain(
        "Nenhum endereço cadastrado",
      );
    },
  );

  it("leitura válida sem endereços continua mostrando o vazio legítimo", async () => {
    await renderizar();
    await responder({ data: [], error: null });

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Nenhum endereço cadastrado");
  });

  it("nova tentativa válida e vazia também limpa a falha anterior", async () => {
    await renderizar();
    await responder({ data: null, error: new Error("Sem rede") });
    await tentarDeNovo();
    await responder({ data: [], error: null });

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Nenhum endereço cadastrado");
  });

  it("troca de conta zera o erro mesmo enquanto a nova leitura está pendente", async () => {
    await renderizar();
    await responder({ data: null, error: new Error("Sem rede") });
    expect(aviso()).not.toBeNull();
    localStorage.setItem(
      "ikcous_addresses_cache_conta-b",
      JSON.stringify([{ ...CASA, user_id: "conta-b", street: "Rua B" }]),
    );
    sessao.usuario = { ...sessao.usuario, id: "conta-b" };
    await renderizar();

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Rua B");
    expect(hospedeiro.textContent).not.toContain("Rua Principal");
  });

  it("falha atrasada da conta anterior não cria aviso na conta atual", async () => {
    await renderizar();
    const resolverAntiga = consultas.shift()!;
    sessao.usuario = { ...sessao.usuario, id: "conta-b" };
    await renderizar();
    await responder({ data: [], error: null });
    await act(async () => {
      resolverAntiga({ data: null, error: new Error("Sem rede") });
    });

    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Nenhum endereço cadastrado");
  });
});
