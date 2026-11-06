// @vitest-environment jsdom
//
// PERFIL: LISTA DE ENDEREÇOS AO VOLTAR AO APP (dois aparelhos).
//
// O tablet (B) fica com o Perfil montado no fundo. No celular (A) a cliente
// apaga um endereço errado e cadastra outro. De volta ao tablet, o Perfil
// mostrava a lista ANTIGA: ela só era lida ao montar a tela. Agora, ao voltar
// para a aba do Perfil e ao voltar do segundo plano (guarda de 30 s), a lista
// é relida -- uma consulta por volta -- e, sem rede, a que estava na tela fica
// sem banner de erro.
//
// O banco é um dublê: o "outro aparelho" mexe nele DIRETAMENTE.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileView } from "@/views/customer/ProfileView";

const { conta, banco, avisos } = vi.hoisted(() => ({
  // Objeto ESTÁVEL: o `user` do auth não troca de identidade a cada render.
  conta: {
    usuario: { id: "conta-a", email: "ana@example.com", user_metadata: {} },
  },
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    leituras: 0,
    falharLeitura: false,
  },
  avisos: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: conta.usuario,
    profile: { full_name: "Ana", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));
vi.mock("sonner", () => ({ toast: avisos }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia: any = {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          banco.leituras++;
          const resposta = banco.falharLeitura
            ? { data: null, error: { message: "rede caiu" } }
            : { data: [...banco.linhas], error: null };
          return Promise.resolve(resposta).then(ok, ko);
        },
      };
      return cadeia;
    },
  },
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

function endereco(id: string, rua: string, is_default: boolean) {
  return {
    id,
    user_id: "conta-a",
    name: id,
    recipient_name: "Ana",
    cep: "38500-000",
    street: rua,
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: null,
    is_default,
  };
}

let estadoDaVisibilidade: "visible" | "hidden" = "visible";

describe("ProfileView — relê os endereços ao voltar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const navegar = vi.fn();

  beforeEach(() => {
    banco.linhas = [
      endereco("casa", "Rua da Casa Antiga", true),
      endereco("errado", "Rua do Endereco Errado", false),
    ];
    banco.leituras = 0;
    banco.falharLeitura = false;
    avisos.error.mockClear();
    estadoDaVisibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estadoDaVisibilidade,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar(isActive: boolean) {
    await act(async () => {
      raiz.render(<ProfileView onNavigate={navegar} isActive={isActive} />);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  // O que o celular (A) fez: apagou o endereço errado e cadastrou outro.
  function celularMexeNaConta() {
    banco.linhas = [
      endereco("casa", "Rua da Casa Antiga", true),
      endereco("novo", "Rua do Endereco Novo", false),
    ];
  }

  async function voltarDoSegundoPlano(depoisDeMs: number) {
    await act(async () => {
      estadoDaVisibilidade = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.setSystemTime(Date.now() + depoisDeMs);
      estadoDaVisibilidade = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  it("o app volta do segundo plano: a lista do Perfil acompanha o que o celular fez, com UMA consulta", async () => {
    await montar(true);
    expect(texto()).toContain("Rua do Endereco Errado");
    expect(banco.leituras).toBe(1);

    celularMexeNaConta();
    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(texto()).toContain("Rua do Endereco Novo");
    expect(texto()).not.toContain("Rua do Endereco Errado");
  });

  it("voltar do segundo plano antes de 30 s não consulta de novo", async () => {
    await montar(true);
    celularMexeNaConta();

    await voltarDoSegundoPlano(10_000);

    expect(banco.leituras).toBe(1);
    expect(texto()).toContain("Rua do Endereco Errado");
  });

  it("Perfil escondido atrás de outra aba: o app voltar do segundo plano não o faz consultar", async () => {
    await montar(false);
    const leiturasDaMontagem = banco.leituras;
    celularMexeNaConta();

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(leiturasDaMontagem);
  });

  it("a aba do Perfil volta a ser a visível: relê UMA vez e mostra a conta como está", async () => {
    await montar(false);
    const leiturasDaMontagem = banco.leituras;
    celularMexeNaConta();

    await montar(true);

    expect(banco.leituras).toBe(leiturasDaMontagem + 1);
    expect(texto()).toContain("Rua do Endereco Novo");
    expect(texto()).not.toContain("Rua do Endereco Errado");
  });

  it("sem rede ao voltar: a lista que estava na tela fica, sem aviso e sem banner de erro", async () => {
    await montar(true);
    banco.falharLeitura = true;

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(texto()).toContain("Rua do Endereco Errado");
    expect(avisos.error).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
