// @vitest-environment jsdom
//
// Nome feito só de caracteres invisíveis na Conta: o `trim()` do JavaScript só tira espaços comuns, então colar um
// espaço de largura zero (U+200B), o espaço Braille em branco (U+2800) ou o preenchimento Hangul (U+3164) no campo
// "Nome completo" passava como nome válido: o app salvava com "Perfil atualizado com sucesso" e o título do Perfil, as
// avaliações públicas e as iniciais do avatar ficavam em branco.
//
// Este teste prende: nome só de invisíveis é RECUSADO com o mesmo aviso "Informe seu nome" (no campo, em toast e com o
// foco no campo), a gravação nunca é chamada e o aviso de sucesso nunca aparece; nome com letra visível continua
// gravando (inclusive com invisível no meio ou nas pontas).
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

describe("AccountSettingsView — nome só de caracteres invisíveis não salva", () => {
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

  it.each([
    ["espaço de largura zero (U+200B)", "\u200B"],
    ["espaço Braille em branco (U+2800)", "\u2800"],
    ["preenchimento Hangul (U+3164)", "\u3164"],
    ["mistura de invisíveis e espaços", "  \u200B\u2800\u3164 \u200D "],
  ])(
    "%s: mostra 'Informe seu nome', foca o campo, não grava e não diz que deu certo",
    async (_descricao, texto) => {
      await montarComPerfilCarregado();
      const { toast } = await import("sonner");

      digitar("full_name", texto);
      await salvar();

      expect(gravacoes()).toHaveLength(0);
      expect(toast.success).not.toHaveBeenCalled();
      expect(fetchProfile).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Informe seu nome");
      expect(document.activeElement).toBe(document.getElementById("full_name"));
      const campo = document.getElementById("full_name") as HTMLInputElement;
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById("full_name-erro")?.textContent).toBe(
        "Informe seu nome",
      );
    },
  );

  it("nome com letra visível e invisível no meio ainda grava", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "\u200BMa\u200Bria\u3164");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({
      p_full_name: "\u200BMa\u200Bria\u3164",
    });
    expect(document.getElementById("full_name-erro")).toBeNull();
  });
});
