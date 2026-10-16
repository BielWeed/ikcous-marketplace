// @vitest-environment jsdom
// A atualização espera a edição da conta, e uma resposta lenta não apaga o texto novo.
import { decidirMomentoSeguro } from "@/lib/atualizacao/momento-seguro";
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
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

async function salvar() {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Salvar Alterações"),
  )!;
  await act(async () => {
    botao.click();
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

describe("Conta — preserva a edição", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Nome salvo", whatsapp: "" }],
          error: null,
        });
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

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
    expect(campo("full_name").disabled).toBe(false);
    expect(campo("full_name").value).toBe("Nome salvo");
  }

  it.each([
    ["full_name", "Nome novo", "Nome salvo"],
    ["phone", "34999998888", ""],
    ["cpf", "52998224725", ""],
  ])(
    "veta a recarga com %s pendente e libera ao desfazer",
    async (id, novo, salvo) => {
      await montar();
      expect(podeAtualizarEmSegundoPlano()).toBe(true);
      digitar(id, novo);
      expect(podeAtualizarEmSegundoPlano()).toBe(false);
      digitar(id, salvo);
      expect(podeAtualizarEmSegundoPlano()).toBe(true);
    },
  );

  it("também protege os campos de senha enquanto estão preenchidos", async () => {
    await montar();
    const seguranca = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Segurança"),
    )!;
    await act(async () => seguranca.click());
    // A troca de aba espera a animação de saída do perfil.
    const inicio = Date.now();
    while (!document.getElementById("new_password")) {
      if (Date.now() - inicio > 2000)
        throw new Error("A aba Segurança não abriu");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    digitar("new_password", "senha-de-teste");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    digitar("new_password", "");
    digitar("confirm_password", "senha-de-teste");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    digitar("confirm_password", "");
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("libera depois de salvar, inclusive nome aparado, WhatsApp e CPF", async () => {
    await montar();
    digitar("full_name", "  Nome novo  ");
    digitar("phone", "34999998888");
    digitar("cpf", "52998224725");
    await salvar();

    expect(campo("full_name").value).toBe("Nome novo");
    expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
      p_full_name: "Nome novo",
      p_whatsapp: "(34) 99999-8888",
    });
    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "52998224725" });
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("veta durante o envio mesmo sem edição pendente", async () => {
    await montar();
    const envio = adiar<{ error: null }>();
    rpc.mockReturnValueOnce(envio.promessa);
    await salvar();
    expect(podeAtualizarEmSegundoPlano()).toBe(false);

    await act(async () => envio.resolver({ error: null }));
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("resposta lenta preserva o nome novo e usa o primeiro envio como referência", async () => {
    await montar();
    const envio = adiar<{ error: null }>();
    rpc.mockReturnValueOnce(envio.promessa);
    digitar("full_name", "Primeira edição");
    await salvar();
    digitar("full_name", "Segunda edição");
    await act(async () => envio.resolver({ error: null }));

    expect(campo("full_name").value).toBe("Segunda edição");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    digitar("full_name", "Primeira edição");
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
    digitar("full_name", "Segunda edição");
    await salvar();
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("voltar ao nome antigo durante o envio ainda deixa uma edição pendente", async () => {
    await montar();
    const envio = adiar<{ error: null }>();
    rpc.mockReturnValueOnce(envio.promessa);
    digitar("full_name", "Primeira edição");
    await salvar();
    digitar("full_name", "Nome salvo");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    await act(async () => envio.resolver({ error: null }));

    expect(campo("full_name").value).toBe("Nome salvo");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
  });

  it("WhatsApp e CPF editados durante o envio continuam pendentes", async () => {
    await montar();
    const envio = adiar<{ error: null }>();
    rpc.mockReturnValueOnce(envio.promessa);
    await salvar();
    digitar("phone", "34999998888");
    digitar("cpf", "52998224725");
    await act(async () => envio.resolver({ error: null }));

    expect(campo("phone").value).toBe("(34) 99999-8888");
    expect(campo("cpf").value).toBe("529.982.247-25");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    await salvar();
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("falha de envio mantém o rascunho e não deixa marca ao desfazer", async () => {
    await montar();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ error: { message: "Falha de teste" } });
    digitar("full_name", "Nome novo");
    await salvar();

    expect(campo("full_name").value).toBe("Nome novo");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    digitar("full_name", "Nome salvo");
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("falha só do CPF mantém a pendência sem desfazer o nome já salvo", async () => {
    await montar();
    rpc.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ error: { code: "CPF02" } });
    digitar("full_name", "Nome novo");
    digitar("cpf", "52998224725");
    await salvar();

    expect(campo("full_name").value).toBe("Nome novo");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    digitar("cpf", "");
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });

  it("desmontar a tela descarta a edição e libera a recarga", async () => {
    await montar();
    digitar("full_name", "Nome novo");
    expect(podeAtualizarEmSegundoPlano()).toBe(false);
    await act(async () => raiz.render(null));
    expect(podeAtualizarEmSegundoPlano()).toBe(true);
  });
});
