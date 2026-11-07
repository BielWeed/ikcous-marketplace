// @vitest-environment jsdom
//
// WhatsApp velho regravado por cima do de outro aparelho: o código só manda o WhatsApp à gravação quando a pessoa o
// EDITOU (`whatsappEditado`), justamente para não desfazer o que outro aparelho gravou. Mas a marca só voltava a "não
// editado" ao recarregar a tela — depois de um salvamento com sucesso ela ficava ligada, e o salvamento seguinte (só do
// nome, por exemplo) mandava de novo o número que a tela ainda mostrava, já velho.
//
// Este teste prende: (1) depois de salvar o WhatsApp com sucesso, salvar só o nome manda `p_whatsapp: null`; (2) se
// a pessoa digitou OUTRO número enquanto o primeiro salvava, a marca continua ligada e o número novo vai no salvamento
// seguinte; (3) se a gravação falhou, a marca continua ligada (o número ainda não está no banco).
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
  const botaoSalvar = localizarBotaoPorTexto("Salvar alterações")!;
  await act(async () => {
    botaoSalvar.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gravacoes = () =>
  rpc.mock.calls.filter((chamada) => chamada[0] === "update_my_profile_secure");

describe("AccountSettingsView — WhatsApp salvo não é regravado no salvamento seguinte", () => {
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

  async function montarComPerfilCarregado() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === "Fulano de Tal";
    });
  }

  it("salvou o WhatsApp e depois só o nome: o segundo salvamento não manda o número", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "34999991111");
    await salvar();
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_whatsapp: "(34) 99999-1111" });

    digitar("full_name", "Fulano de Tal Jr");
    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(gravacoes()[1][1]).toMatchObject({
      p_full_name: "Fulano de Tal Jr",
      p_whatsapp: null,
    });
    // O que a tela mostra continua sendo o que a pessoa salvou.
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe(
      "(34) 99999-1111",
    );
  });

  it("mexer no WhatsApp de novo depois de salvar volta a mandar o número", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "34999991111");
    await salvar();
    digitar("phone", "34988882222");
    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(gravacoes()[1][1]).toMatchObject({ p_whatsapp: "(34) 98888-2222" });
  });

  it("outro número digitado enquanto o primeiro salva: a marca continua e o número novo vai no próximo salvamento", async () => {
    await montarComPerfilCarregado();
    let concluir: (valor: unknown) => void = () => {};
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      if (rpc.mock.calls.filter((c) => c[0] === nome).length === 1) {
        return new Promise((resolve) => {
          concluir = resolve;
        });
      }
      return Promise.resolve({ error: null });
    });

    digitar("phone", "34999991111");
    await act(async () => {
      localizarBotaoPorTexto("Salvar alterações")!.click();
    });
    await esperarAte(() => gravacoes().length === 1);
    // A primeira gravação segue no ar; a pessoa digita outro número.
    digitar("phone", "34988882222");
    await act(async () => {
      concluir({ error: null });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await esperarAte(
      () => !localizarBotaoPorTexto("Salvar alterações")?.disabled,
    );

    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(gravacoes()[1][1]).toMatchObject({ p_whatsapp: "(34) 98888-2222" });
  });

  it("a gravação do WhatsApp falhou: a marca continua e o próximo salvamento tenta o número de novo", async () => {
    await montarComPerfilCarregado();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let tentativa = 0;
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      tentativa += 1;
      return Promise.resolve({
        error: tentativa === 1 ? { message: "falhou", code: "XX000" } : null,
      });
    });

    digitar("phone", "34999991111");
    await salvar();
    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(gravacoes()[0][1]).toMatchObject({ p_whatsapp: "(34) 99999-1111" });
    expect(gravacoes()[1][1]).toMatchObject({ p_whatsapp: "(34) 99999-1111" });
  });
});
