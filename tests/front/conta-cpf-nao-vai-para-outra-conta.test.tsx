// @vitest-environment jsdom
// O salvamento de uma conta não continua na conta que entrou depois.
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
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
const CONTA_B = { id: "conta-b", email: "conta-b@example.com" };
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

function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

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
    botao.textContent?.includes("Salvar Alterações"),
  )!;
}

async function salvar() {
  await act(async () => botaoSalvar().click());
}

describe("Conta — CPF pertence à conta que começou a salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-a", user: CONTA_A } },
    });
    autenticacao.user = CONTA_A;
    autenticacao.cpfInicial = "";
    vi.spyOn(cpfDaConta, "gravarCpfDaConta");
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: `Nome ${autenticacao.user?.id}`, whatsapp: "" }],
          error: null,
        });
      }
      if (nome === "get_my_cpf") {
        return Promise.resolve({ data: autenticacao.cpfInicial, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    expect(haOperacaoSensivel()).toBe(false);
  });

  async function montar(remontarPorConta = true) {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(
        <AccountSettingsView
          key={remontarPorConta ? autenticacao.user?.id : "mesma-tela"}
        />,
      );
    });
    expect(campo("full_name").disabled).toBe(false);
  }

  async function trocarConta(remontarPorConta = true) {
    act(() => {
      autenticacao.user = CONTA_B;
    });
    await montar(remontarPorConta);
    digitar("full_name", "Rascunho de B");
    digitar("cpf", "11144477735");
  }

  function esperarSemContinuacao() {
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(campo("full_name").value).toBe("Rascunho de B");
    expect(campo("cpf").value).toBe("111.444.777-35");
  }

  it.each([true, false])(
    "não grava o CPF de A em B após resposta lenta do perfil (remonta: %s)",
    async (remontarPorConta) => {
      await montar(remontarPorConta);
      const envio = adiar<{ error: null }>();
      rpc.mockReturnValueOnce(envio.promessa);
      digitar("full_name", "Nome novo de A");
      digitar("cpf", "52998224725");
      await salvar();
      expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
        p_full_name: "Nome novo de A",
        p_whatsapp: null,
      });

      await trocarConta(remontarPorConta);
      await act(async () => envio.resolver({ error: null }));

      expect(cpfDaConta.gravarCpfDaConta).not.toHaveBeenCalled();
      expect(rpc.mock.calls.some(([nome]) => nome === "set_my_cpf")).toBe(
        false,
      );
      esperarSemContinuacao();
    },
  );

  it("continua gravando os mesmos dados quando a conta não muda", async () => {
    await montar();
    const envio = adiar<{ error: null }>();
    rpc.mockReturnValueOnce(envio.promessa);
    digitar("full_name", "  Nome novo de A  ");
    digitar("cpf", "52998224725");
    await salvar();
    await act(async () => envio.resolver({ error: null }));

    expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
      p_full_name: "Nome novo de A",
      p_whatsapp: null,
    });
    expect(cpfDaConta.gravarCpfDaConta).toHaveBeenCalledExactlyOnceWith(
      "52998224725",
      CONTA_A.id,
    );
    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "52998224725" });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Perfil atualizado com sucesso");
    expect(campo("full_name").value).toBe("Nome novo de A");
    expect(botaoSalvar().disabled).toBe(false);
  });

  it("tela ainda mostra A mas o SDK já tem B: avisa sem gravar nem descartar a edição", async () => {
    await montar();
    // O perfil ainda pertence a A; a troca só aparece na leitura do CPF.
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: "token-a", user: CONTA_A } },
    });
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: "token-b", user: CONTA_B } },
    });
    digitar("cpf", "12345678909");
    await salvar();

    expect(cpfDaConta.gravarCpfDaConta).toHaveBeenCalledWith(
      "12345678909",
      CONTA_A.id,
    );
    expect(rpc.mock.calls.some(([nome]) => nome === "set_my_cpf")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      cpfDaConta.mensagemFalhaCpf("conta_trocada"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(campo("cpf").value).toBe("123.456.789-09");
  });

  it.each(["conta_trocada", "sem_sessao"])(
    "recusa o próprio perfil antes do RPC (%s), preserva a edição e não continua no CPF",
    async (motivo) => {
      await montar();
      getSession.mockResolvedValueOnce({
        data: {
          session:
            motivo === "sem_sessao"
              ? null
              : { access_token: "token-b", user: CONTA_B },
        },
      });
      rpc.mockClear();
      digitar("full_name", "Nome novo de A");
      digitar("cpf", "12345678909");
      await salvar();

      expect(rpc).not.toHaveBeenCalled();
      expect(cpfDaConta.gravarCpfDaConta).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        motivo === "conta_trocada"
          ? cpfDaConta.mensagemFalhaCpf("conta_trocada")
          : "Erro ao atualizar perfil",
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(fetchProfile).not.toHaveBeenCalled();
      expect(campo("full_name").value).toBe("Nome novo de A");
      expect(campo("cpf").value).toBe("123.456.789-09");
      expect(botaoSalvar().disabled).toBe(false);
    },
  );

  it("conta_trocada fica silenciosa se a tela também já mudou para B", async () => {
    await montar();
    const leitura = adiar<{
      data: { session: { access_token: string; user: typeof CONTA_B } };
    }>();
    getSession.mockReturnValueOnce(leitura.promessa);
    digitar("cpf", "12345678909");
    await salvar();

    await trocarConta();
    await act(async () =>
      leitura.resolver({
        data: { session: { access_token: "token-b", user: CONTA_B } },
      }),
    );

    expect(rpc.mock.calls.some(([nome]) => nome === "set_my_cpf")).toBe(false);
    esperarSemContinuacao();
  });

  it.each(["", "52998224725"])(
    "não grava CPF inalterado, inclusive vazio (%s)",
    async (cpfInicial) => {
      autenticacao.cpfInicial = cpfInicial;
      await montar();
      digitar("full_name", "Nome novo de A");
      await salvar();

      expect(cpfDaConta.gravarCpfDaConta).not.toHaveBeenCalled();
      expect(rpc.mock.calls.some(([nome]) => nome === "set_my_cpf")).toBe(
        false,
      );
      expect(toast.success).toHaveBeenCalledTimes(1);
    },
  );

  it("continua limpando o CPF preenchido quando a conta é a mesma", async () => {
    autenticacao.cpfInicial = "52998224725";
    await montar();
    digitar("cpf", "");
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it.each([null, { code: "CPF02" }])(
    "ignora a resposta do CPF se a conta muda durante o envio (%s)",
    async (error) => {
      await montar();
      const envioCpf = adiar<{ error: typeof error }>();
      rpc.mockResolvedValueOnce({ error: null });
      rpc.mockReturnValueOnce(envioCpf.promessa);
      digitar("cpf", "52998224725");
      await salvar();
      expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "52998224725" });

      await trocarConta();
      await act(async () => envioCpf.resolver({ error }));

      esperarSemContinuacao();
    },
  );

  it("não avisa sucesso se a conta muda durante a atualização do contexto", async () => {
    await montar();
    const atualizacao = adiar<void>();
    fetchProfile.mockReturnValueOnce(atualizacao.promessa);
    digitar("cpf", "52998224725");
    await salvar();
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    await trocarConta();
    await act(async () => atualizacao.resolver());

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(campo("full_name").value).toBe("Rascunho de B");
    expect(campo("cpf").value).toBe("111.444.777-35");
  });

  it("ignora também a falha do perfil depois da troca de conta", async () => {
    await montar();
    const envio = adiar<{ error: { code: string } }>();
    rpc.mockReturnValueOnce(envio.promessa);
    digitar("cpf", "52998224725");
    await salvar();

    await trocarConta();
    await act(async () =>
      envio.resolver({ error: { code: "falha-de-teste" } }),
    );

    expect(cpfDaConta.gravarCpfDaConta).not.toHaveBeenCalled();
    esperarSemContinuacao();
  });
});
