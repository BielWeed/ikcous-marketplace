// @vitest-environment jsdom
//
// Minha conta > Salvar alterações: WhatsApp inválido só aparecia num aviso que
// some (toast), enquanto o Nome inválido já ganhava marca e foco. Agora o
// WhatsApp segue o mesmo padrão: além do toast (que fica), o campo ganha
// aria-invalid, uma mensagem logo abaixo e o foco; digitar de novo limpa.
//
// Só aviso/foco: a régua (celular completo) e o que vai à RPC não mudaram.
//
// Mesmo padrão de account-settings-view-whatsapp-mascara-e-valida.test.tsx.
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

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const invalido = (id: string) => campo(id).getAttribute("aria-invalid");
const idsDescritos = (id: string) =>
  (campo(id).getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((x) => x !== "");

describe("AccountSettingsView — WhatsApp inválido marca e foca o campo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let whatsappSalvo = "";

  beforeEach(() => {
    vi.clearAllMocks();
    whatsappSalvo = "";
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: whatsappSalvo }],
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
    await esperarAte(() => campo("full_name").value === "Fulano de Tal");
  }

  async function salvar() {
    const botao = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar alterações"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const gravacoes = () =>
    rpc.mock.calls.filter((c) => c[0] === "update_my_profile_secure");

  it("WhatsApp incompleto: marca o campo, mostra a mensagem junto dele, foca nele e mantém o toast", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("phone", "349999988");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(invalido("phone")).toBe("true");
    expect(document.activeElement).toBe(campo("phone"));

    const ids = idsDescritos("phone");
    expect(ids).toHaveLength(1);
    const mensagem = document.getElementById(ids[0]);
    expect(mensagem?.textContent).toMatch(/DDD \+ 9 \+ 8 dígitos/);
    expect(mensagem?.parentElement?.contains(campo("phone"))).toBe(true);

    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.objectContaining({
        description: expect.stringContaining("DDD + 9 + 8 dígitos"),
      }),
    );
  });

  it("voltar a digitar no WhatsApp limpa a marca e a mensagem", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "349999988");
    await salvar();
    expect(invalido("phone")).toBe("true");

    digitar("phone", "3499999888");

    expect(invalido("phone")).not.toBe("true");
    expect(idsDescritos("phone")).toEqual([]);
  });

  it("corrigir o número e salvar de novo grava, sem marca nenhuma (o erro não 'gruda')", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "349999988");
    await salvar();
    expect(invalido("phone")).toBe("true");

    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0]?.[1]).toMatchObject({
      p_whatsapp: "(34) 99999-8888",
    });
    expect(invalido("phone")).not.toBe("true");
  });

  it("limite: Nome vazio E WhatsApp inválido — o foco fica no Nome (primeiro da tela)", async () => {
    await montarComPerfilCarregado();

    digitar("full_name", "");
    digitar("phone", "349999988");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(invalido("full_name")).toBe("true");
    expect(document.activeElement).toBe(campo("full_name"));
  });

  it("limite: WhatsApp vazio continua opcional — nada marcado, e salva", async () => {
    await montarComPerfilCarregado();

    await salvar();

    expect(invalido("phone")).not.toBe("true");
    expect(gravacoes()).toHaveLength(1);
  });

  it("limite: WhatsApp legado inválido que a pessoa NÃO editou não é marcado nem trava o salvamento", async () => {
    whatsappSalvo = "5534999998888";
    await montarComPerfilCarregado();
    digitar("full_name", "Fulano Editado");

    await salvar();

    expect(invalido("phone")).not.toBe("true");
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0]?.[1]).toMatchObject({ p_whatsapp: null });
  });
});
