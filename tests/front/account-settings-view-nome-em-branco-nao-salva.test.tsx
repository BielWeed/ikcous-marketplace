// @vitest-environment jsdom
//
// Nome em branco na Conta (caçada de 14/10/2026): a cliente apagava o nome, tocava em "Salvar Alterações" e via
// "Perfil atualizado com sucesso" — mas o banco gravava o texto vazio (`COALESCE(p_full_name, full_name)` só protege
// contra NULL, e '' não é NULL). O cabeçalho passava a mostrar o começo do e-mail e o nome público dela (avaliações,
// perguntas) ficava vazio. Só espaços passava igual, porque o texto nunca era aparado.
//
// Este teste prende: (1) nome vazio ou só com espaços é RECUSADO com a frase "Informe seu nome" junto do campo, a
// gravação nunca é chamada e o aviso de sucesso nunca aparece; (2) o aviso some quando ela volta a digitar; (3) nome
// válido com espaços nas pontas é gravado já aparado; (4) nome válido sem mexer continua gravando como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updatePassword = vi.fn();
const rpc = vi.fn();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "token-cliente-1", user: USUARIO } },
        }),
    },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "update_my_profile_secure"
        ? pedidoCpfComCabecalho(resposta)
        : resposta;
    },
  },
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

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function salvar() {
  const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
  await act(async () => {
    botaoSalvar.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gravacoes = () =>
  rpc.mock.calls.filter((chamada) => chamada[0] === "update_my_profile_secure");

describe("AccountSettingsView — nome em branco não salva", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });
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

  async function montarComPerfilCarregado(nomeCarregado = "Fulano de Tal") {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === nomeCarregado;
    });
  }

  it("nome apagado: mostra 'Informe seu nome' no campo, não grava e não diz que deu certo", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("full_name", "");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(fetchProfile).not.toHaveBeenCalled();

    const campo = document.getElementById("full_name") as HTMLInputElement;
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    const erro = document.getElementById("full_name-erro");
    expect(erro?.textContent).toBe("Informe seu nome");
    expect(erro?.getAttribute("role")).toBe("alert");
    expect(campo.getAttribute("aria-describedby")).toBe("full_name-erro");
  });

  it("nome apagado: além da mensagem no campo, aparece o aviso e o foco vai para o nome", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("full_name", "");
    expect(document.activeElement).not.toBe(
      document.getElementById("full_name"),
    );
    await salvar();

    expect(toast.error).toHaveBeenCalledWith("Informe seu nome");
    expect(document.activeElement).toBe(document.getElementById("full_name"));
  });

  it("nome válido e só o telefone mudou: grava o nome aparado junto com o telefone", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "  Fulano de Tal ");
    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({
      p_full_name: "Fulano de Tal",
      p_whatsapp: "(34) 99999-8888",
    });
  });

  it("perfil antigo com nome vazio que só quer trocar o telefone: não grava, avisa e põe o foco no nome", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "", whatsapp: "" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });
    await montarComPerfilCarregado("");
    const { toast } = await import("sonner");

    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Informe seu nome");
    expect(document.activeElement).toBe(document.getElementById("full_name"));
    expect(document.getElementById("full_name-erro")?.textContent).toBe(
      "Informe seu nome",
    );
  });

  it("depois do sucesso o campo do nome mostra o valor aparado", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "   Maria Souza  ");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    const campo = document.getElementById("full_name") as HTMLInputElement;
    expect(campo.value).toBe("Maria Souza");
  });

  it("nome só com espaços também é recusado", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("full_name", "     ");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(document.getElementById("full_name-erro")?.textContent).toBe(
      "Informe seu nome",
    );
  });

  it("o aviso some assim que ela volta a digitar no campo", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "");
    await salvar();
    expect(document.getElementById("full_name-erro")).not.toBeNull();

    digitar("full_name", "M");

    expect(document.getElementById("full_name-erro")).toBeNull();
    const campo = document.getElementById("full_name") as HTMLInputElement;
    expect(campo.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("depois do aviso, corrigir o nome e salvar grava normalmente", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "");
    await salvar();
    digitar("full_name", "Maria Souza");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_full_name: "Maria Souza" });
    expect(document.getElementById("full_name-erro")).toBeNull();
  });

  it("nome com espaços nas pontas é gravado aparado", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "   Maria Souza  ");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_full_name: "Maria Souza" });
  });

  it("nome válido sem mexer no campo continua gravando como antes", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_full_name: "Fulano de Tal" });
    expect(toast.success).toHaveBeenCalledWith("Perfil atualizado com sucesso");
    expect(document.getElementById("full_name-erro")).toBeNull();
  });
});
