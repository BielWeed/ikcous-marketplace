// @vitest-environment jsdom
// Se o CPF falha, o nome novo já foi salvo: o Perfil/cabeçalho têm de ser
// atualizados mesmo assim (antes seguiam com o nome antigo).
import * as cpfDaConta from "@/lib/cpf-da-conta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, fetchProfile, getSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  fetchProfile: vi.fn(),
}));
const CONTA_A = { id: "conta-a", email: "conta-a@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };
const autenticacao: { user: typeof CONTA_A | null; cpfInicial: string } = {
  user: CONTA_A,
  cpfInicial: "",
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: autenticacao.user,
    profile: PERFIL,
    fetchProfile,
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession },
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

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

function botaoSalvar() {
  return [...document.body.querySelectorAll("button")].find((botao) =>
    botao.textContent?.includes("Salvar alterações"),
  )!;
}

async function salvar() {
  await act(async () => botaoSalvar().click());
}

describe("Conta — CPF recusado não deixa o nome antigo no cabeçalho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-a", user: CONTA_A } },
    });
    autenticacao.user = CONTA_A;
    rpc.mockImplementation((nome: string) =>
      nome === "get_my_complete_profile"
        ? Promise.resolve({
            data: [{ full_name: "Nome antigo", whatsapp: "" }],
            error: null,
          })
        : Promise.resolve({
            data: nome === "get_my_cpf" ? "" : null,
            error: null,
          }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("nome mudou e o CPF falhou: avisa o erro do CPF e atualiza o perfil do contexto", async () => {
    vi.spyOn(cpfDaConta, "gravarCpfDaConta").mockResolvedValue({
      ok: false,
      motivo: "cpf_invalido",
    });
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    digitar("full_name", "Nome novo");
    digitar("cpf", "52998224725");
    await salvar();

    expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
      p_full_name: "Nome novo",
      p_whatsapp: null,
    });
    expect(toast.error).toHaveBeenCalledWith(
      cpfDaConta.mensagemFalhaCpf("cpf_invalido"),
    );
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
