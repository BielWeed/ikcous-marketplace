// @vitest-environment jsdom
//
// MINHA CONTA — a loja pode corrigir o e-mail da sessão enquanto a cliente
// digita. Mesma conta (mesmo id) + e-mail novo NÃO relê o cadastro por cima do
// que ela digitou (nome, WhatsApp, CPF); outra CONTA (id diferente) relê tudo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, fetchProfile, sessao } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchProfile: vi.fn(),
  sessao: {
    user: { id: "cliente-1", email: "antigo@example.com" } as {
      id: string;
      email: string;
    },
  },
}));
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: sessao.user,
    profile: PERFIL,
    fetchProfile,
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "token", user: sessao.user } },
        }),
    },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "set_my_cpf" || args[0] === "update_my_profile_secure"
        ? pedidoCpfComCabecalho(resposta)
        : resposta;
    },
  },
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

function campo(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function digitar(id: string, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(campo(id), valor);
    campo(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function esperarAte(condicao: () => boolean, timeoutMs = 2000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: sem resposta em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function leituras() {
  return rpc.mock.calls.filter((c) => c[0] === "get_my_complete_profile")
    .length;
}

describe("Conta — e-mail da sessão muda durante a digitação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let nomeNoBanco: string;

  beforeEach(() => {
    vi.resetAllMocks();
    sessao.user = { id: "cliente-1", email: "antigo@example.com" };
    nomeNoBanco = "Nome salvo";
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: nomeNoBanco, whatsapp: "" }],
          error: null,
        });
      }
      if (nome === "get_my_cpf")
        return Promise.resolve({ data: "", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
    await esperarAte(() => !campo("cpf").disabled);
    expect(campo("full_name").value).toBe("Nome salvo");
  }

  async function renderizarDeNovo() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("mesma conta com e-mail novo mantém nome, WhatsApp e CPF digitados", async () => {
    await montar();
    digitar("full_name", "Nome digitado");
    digitar("phone", "34999998888");
    digitar("cpf", "52998224725");

    sessao.user = { id: "cliente-1", email: "novo@example.com" };
    await renderizarDeNovo();

    expect(campo("full_name").value).toBe("Nome digitado");
    expect(campo("phone").value).toBe("(34) 99999-8888");
    expect(campo("cpf").value).toBe("529.982.247-25");
    expect(leituras()).toBe(1);
  });

  it("outra conta (id diferente) relê o cadastro e descarta o que era da anterior", async () => {
    await montar();
    digitar("full_name", "Nome digitado");

    nomeNoBanco = "Nome da outra conta";
    sessao.user = { id: "cliente-2", email: "outra@example.com" };
    await renderizarDeNovo();
    await esperarAte(() => campo("full_name").value === "Nome da outra conta");

    expect(campo("full_name").value).toBe("Nome da outra conta");
    expect(leituras()).toBe(2);
  });
});
