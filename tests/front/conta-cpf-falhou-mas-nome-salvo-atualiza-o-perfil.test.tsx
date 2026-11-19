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

  async function abrirConta() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
  }

  it.each([
    {
      caso: "só o nome mudou",
      nome: "Nome novo",
      whatsapp: "",
      motivo: "falha",
      mensagem:
        "Seu nome foi salvo. Não foi possível salvar o CPF agora. Tente de novo em Perfil > Segurança e conta.",
    },
    {
      caso: "só o WhatsApp mudou",
      nome: "",
      whatsapp: "11987654321",
      motivo: "falha",
      mensagem:
        "Seu WhatsApp foi salvo. Não foi possível salvar o CPF agora. Tente de novo em Perfil > Segurança e conta.",
    },
    {
      caso: "só o CPF mudou",
      nome: "",
      whatsapp: "",
      motivo: "falha",
      mensagem:
        "Não foi possível salvar o CPF agora. Tente de novo em Perfil > Segurança e conta.",
    },
    {
      caso: "o servidor recusou o CPF como inválido",
      nome: "Nome novo",
      whatsapp: "",
      motivo: "cpf_invalido",
      mensagem:
        "Seu nome foi salvo. CPF inválido. Confira os números e tente de novo.",
    },
    {
      caso: "a sessão acabou depois de salvar o nome",
      nome: "Nome novo",
      whatsapp: "",
      motivo: "sem_sessao",
      mensagem: "Seu nome foi salvo. Entre na conta para salvar o CPF.",
    },
    {
      caso: "a conta mudou antes de gravar o CPF",
      nome: "Nome novo",
      whatsapp: "",
      motivo: "conta_trocada",
      mensagem:
        "Seu nome foi salvo. A conta mudou durante a operação: o CPF não foi salvo. Confira a conta e tente de novo.",
    },
  ] as const)(
    "$caso: avisa o que foi salvo",
    async ({ nome, whatsapp, motivo, mensagem }) => {
      const gravarCpf = vi
        .spyOn(cpfDaConta, "gravarCpfDaConta")
        .mockResolvedValue({
          ok: false,
          motivo,
        });
      await abrirConta();
      if (nome) digitar("full_name", nome);
      if (whatsapp) digitar("phone", whatsapp);
      digitar("cpf", "52998224725");
      await salvar();

      expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
        p_full_name: nome || null,
        p_whatsapp: whatsapp ? "(11) 98765-4321" : null,
      });
      expect(gravarCpf).toHaveBeenCalledOnce();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(mensagem);
      expect(fetchProfile).toHaveBeenCalledTimes(
        motivo === "conta_trocada" ? 0 : 1,
      );
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("nome e WhatsApp salvos, mas sem confirmação do CPF: não diz que o CPF falhou", async () => {
    vi.spyOn(cpfDaConta, "gravarCpfDaConta").mockResolvedValue({
      ok: false,
      motivo: "prazo_esgotado",
    });
    await abrirConta();
    digitar("full_name", "Nome novo");
    digitar("phone", "11987654321");
    digitar("cpf", "52998224725");
    await salvar();

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      "Seu nome e seu WhatsApp foram salvos. Não deu para confirmar: o dado pode ter sido salvo. Estamos conferindo sua conta; confira antes de tentar de novo.",
    );
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Seu nome e seu WhatsApp foram salvos. Não deu para confirmar: o dado pode ter sido salvo.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("CPF inválido no formulário bloqueia tudo: não diz que o nome foi salvo", async () => {
    await abrirConta();
    digitar("full_name", "Nome novo");
    digitar("cpf", "11111111111");
    await salvar();

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("CPF inválido", {
      description: "Confira os números ou deixe o campo em branco.",
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "update_my_profile_secure",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith("set_my_cpf", expect.anything());
  });
});
