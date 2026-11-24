// @vitest-environment jsdom
//
// O que este teste protege na tela "Sua conta" (AccountSettingsView), em três
// pontos que os testes vizinhos não pegam:
//
// 1. Carga do CPF falhou DEPOIS de o nome chegar. A tela fica travada (campos e
//    botão desligados), mas o nome já está nos campos. Se alguém contornar o
//    botão desligado e enviar o formulário, a função de salvar tem de recusar
//    e avisar — não gravar com um cadastro que ela não conseguiu confirmar. O
//    teste vizinho ("defesa em profundidade") só prova isso com o nome ainda
//    VAZIO, caso em que a recusa do nome em branco esconde a falta da trava.
// 2. CPF digitado só com letras ("abc") não vira dígito nenhum, mas continua
//    sendo uma edição não salva: a atualização do app em segundo plano espera.
// 3. WhatsApp "+5" / "+55" digitado com espaço antes continua preservando o
//    "+" (a pessoa está colando um número com código do país).
//
// Mesmo padrão de `conta-nao-perde-edicao.test.tsx`: render de verdade, só
// `useAuth` e o supabase são dublês, com dados inventados.
import { decidirMomentoSeguro } from "@/lib/atualizacao/momento-seguro";
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, fetchProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchProfile: vi.fn(),
}));
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
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
          data: { session: { access_token: "token-cliente-1", user: USUARIO } },
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
  )?.set;
  act(() => {
    setter?.call(campo(id), valor);
    campo(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function podeAtualizarEmSegundoPlano() {
  return decidirMomentoSeguro({
    view: "account-settings",
    adminDirty: false,
    pedidoPendenteDoCheckout: false,
    documentoOculto: true,
    trocouDeTela: false,
  }).instalarAgora;
}

describe("Conta — salvar com a carga do CPF falhada e CPF só com letras", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function respostasDoServidor(
    cpf: "ok" | "falha",
    nomeCadastrado = "Nome salvo",
  ) {
    rpc.mockImplementation((funcao: string) => {
      if (funcao === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: nomeCadastrado, whatsapp: "" }],
          error: null,
        });
      }
      if (funcao === "get_my_cpf") {
        return Promise.resolve(
          cpf === "ok"
            ? { data: null, error: null }
            : { data: null, error: { code: "XXYYY" } },
        );
      }
      return Promise.resolve({ data: null, error: null });
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
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

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
  }

  it("carga do CPF falhou com o nome já na tela: o envio forçado do formulário não grava nada e avisa", async () => {
    respostasDoServidor("falha");
    await montar();

    // Precondição: nome chegou, mas a tela ficou travada por causa do CPF.
    expect(campo("full_name").value).toBe("Nome salvo");
    expect(campo("full_name").disabled).toBe(true);
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar seus dados de perfil.",
    );

    const formulario = document.getElementById(
      "form-perfil",
    ) as HTMLFormElement;
    await act(async () => {
      formulario.requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const gravacoes = rpc.mock.calls.filter(
      (chamada) =>
        chamada[0] === "update_my_profile_secure" ||
        chamada[0] === "set_my_cpf",
    );
    expect(gravacoes).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      "Aguarde os dados carregarem antes de salvar.",
      expect.anything(),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("com a carga completa, o mesmo envio do formulário (sem mexer em nada) grava normalmente", async () => {
    respostasDoServidor("ok");
    await montar();
    expect(campo("full_name").disabled).toBe(false);

    const formulario = document.getElementById(
      "form-perfil",
    ) as HTMLFormElement;
    await act(async () => {
      formulario.requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "Aguarde os dados carregarem antes de salvar.",
      expect.anything(),
    );
    expect(
      rpc.mock.calls.filter(
        (chamada) => chamada[0] === "update_my_profile_secure",
      ),
    ).toHaveLength(1);
  });

  it("CPF digitado só com letras segura a atualização em segundo plano até ser apagado", async () => {
    respostasDoServidor("ok");
    await montar();
    expect(podeAtualizarEmSegundoPlano()).toBe(true);

    digitar("cpf", "abc");
    expect(campo("cpf").value).toBe("abc");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);

    digitar("cpf", "");
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("texto sem nenhum dígito no WhatsApp é recusado ao salvar, não ignorado em silêncio", async () => {
    respostasDoServidor("ok");
    await montar();

    digitar("phone", "abc");
    expect(campo("phone").value).toBe("abc");
    await act(async () => {
      (
        document.getElementById("form-perfil") as HTMLFormElement
      ).requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.anything(),
    );
    expect(
      rpc.mock.calls.filter(
        (chamada) => chamada[0] === "update_my_profile_secure",
      ),
    ).toHaveLength(0);
    expect(campo("phone").getAttribute("aria-invalid")).toBe("true");
  });

  it("nome antigo com espaço no fim, que a pessoa não mexeu, NÃO é reenviado ao salvar só o WhatsApp", async () => {
    respostasDoServidor("ok", "Maria Silva  ");
    await montar();
    expect(campo("full_name").value).toBe("Maria Silva  ");

    digitar("phone", "34999998888");
    await act(async () => {
      (
        document.getElementById("form-perfil") as HTMLFormElement
      ).requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const gravacoes = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]?.[1]).toEqual({
      p_full_name: null,
      p_whatsapp: "(34) 99999-8888",
    });
  });

  it("CPF salvo em Minha conta apaga o CPF pendente do cadastro desta conta (ele não volta por cima)", async () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => guardado.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        guardado.set(chave, valor);
      },
      removeItem: (chave: string) => {
        guardado.delete(chave);
      },
    });
    const { salvarPendente, lerPendente } = await import(
      "@/lib/cpf-pendente-do-cadastro"
    );
    expect(
      salvarPendente({
        userId: USUARIO.id,
        email: USUARIO.email,
        cpf: "52998224725",
      }),
    ).toBe(true);
    respostasDoServidor("ok");
    await montar();

    digitar("cpf", "11144477735");
    await act(async () => {
      (
        document.getElementById("form-perfil") as HTMLFormElement
      ).requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "11144477735" });
    expect(lerPendente()).toBeNull();
    expect(guardado.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it.each([
    [" +5", "+5"],
    [" +55 ", "+55"],
  ])(
    "WhatsApp digitado como %j mantém o '+' aparado (%j)",
    async (digitado, esperado) => {
      respostasDoServidor("ok");
      await montar();

      digitar("phone", digitado);

      expect(campo("phone").value).toBe(esperado);
    },
  );
});
