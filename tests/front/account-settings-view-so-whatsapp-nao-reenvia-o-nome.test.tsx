// @vitest-environment jsdom
//
// SALVAR SÓ O WHATSAPP NÃO REENVIA O NOME (dois aparelhos).
//
// No tablet (B) a cliente abre "Configurações da conta": os dados são lidos
// UMA vez ao abrir e a tela fica aberta. No celular (A) ela troca o nome de
// "Maria S." para "Maria Souza" e salva. De volta ao tablet ela muda só o
// WhatsApp e toca em Salvar: a tela mandava o nome com o valor ANTIGO que
// ficou no formulário, e o nome novo voltava a "Maria S." sem ela ter mexido
// nele. O WhatsApp e o CPF já só eram enviados quando editados; agora o nome
// também. Sem nome editado a tela manda `p_full_name: null` e o banco
// (`COALESCE(p_full_name, full_name)`) preserva o que está gravado.
//
// O banco aqui é um dublê com a mesma regra do COALESCE.
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

// Dublê do perfil no banco (a regra do COALESCE de update_my_profile_secure).
const banco = { nome: "Maria S.", whatsapp: "" };

describe("AccountSettingsView — só manda o nome se ela o editou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    banco.nome = "Maria S.";
    banco.whatsapp = "";
    rpc.mockImplementation((nome: string, args: Record<string, unknown>) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: banco.nome, whatsapp: banco.whatsapp }],
          error: null,
        });
      }
      if (nome === "update_my_profile_secure") {
        banco.nome = (args.p_full_name as string | null) ?? banco.nome;
        banco.whatsapp = (args.p_whatsapp as string | null) ?? banco.whatsapp;
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

  async function abrirATela() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === banco.nome;
    });
  }

  const argsDaGravacao = (indice = 0) =>
    gravacoes().at(indice)?.[1] as Record<string, unknown>;

  it("o celular trocou o nome e o tablet salva só o WhatsApp: o nome novo NÃO volta ao antigo", async () => {
    await abrirATela();
    // No celular (A): troca o nome e salva (direto no banco).
    banco.nome = "Maria Souza";

    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(argsDaGravacao()).toEqual({
      p_full_name: null,
      p_whatsapp: "(34) 99999-8888",
    });
    expect(banco.nome).toBe("Maria Souza");
    expect(banco.whatsapp).toBe("(34) 99999-8888");
  });

  it("CONTROLE: editou só o nome: manda o nome e deixa o WhatsApp como está", async () => {
    await abrirATela();

    digitar("full_name", "Maria Souza");
    await salvar();

    expect(argsDaGravacao()).toEqual({
      p_full_name: "Maria Souza",
      p_whatsapp: null,
    });
    expect(banco.nome).toBe("Maria Souza");
  });

  it("CONTROLE: editou o nome e o WhatsApp: manda os dois", async () => {
    await abrirATela();

    digitar("full_name", "Maria Souza");
    digitar("phone", "34999998888");
    await salvar();

    expect(argsDaGravacao()).toEqual({
      p_full_name: "Maria Souza",
      p_whatsapp: "(34) 99999-8888",
    });
  });

  it("espaços nas pontas do MESMO nome não contam como edição", async () => {
    await abrirATela();

    digitar("full_name", "  Maria S. ");
    digitar("phone", "34999998888");
    await salvar();

    expect(argsDaGravacao().p_full_name).toBeNull();
  });

  it("editou o nome e voltou ao que estava: não conta como edição", async () => {
    await abrirATela();
    banco.nome = "Maria Souza";

    digitar("full_name", "Outro Nome");
    digitar("full_name", "Maria S.");
    digitar("phone", "34999998888");
    await salvar();

    expect(argsDaGravacao().p_full_name).toBeNull();
    expect(banco.nome).toBe("Maria Souza");
  });

  it("depois de salvar o nome, um segundo salvar só do WhatsApp já não o reenvia", async () => {
    await abrirATela();

    digitar("full_name", "Maria Souza");
    await salvar();
    expect(argsDaGravacao(0).p_full_name).toBe("Maria Souza");

    // O celular muda o nome de novo; o tablet segue com a tela aberta.
    banco.nome = "Maria S. Souza";
    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(argsDaGravacao(1).p_full_name).toBeNull();
    expect(banco.nome).toBe("Maria S. Souza");
  });

  it("nome apagado continua recusado (e nada é enviado)", async () => {
    await abrirATela();

    digitar("full_name", "");
    digitar("phone", "34999998888");
    await salvar();

    expect(gravacoes()).toHaveLength(0);
    expect(document.getElementById("full_name-erro")?.textContent).toBe(
      "Informe seu nome",
    );
  });
});
