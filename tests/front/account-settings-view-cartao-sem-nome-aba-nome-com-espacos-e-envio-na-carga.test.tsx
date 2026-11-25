// @vitest-environment jsdom
//
// CONFIGURAÇÕES DA CONTA — quatro bordas que a caça por mutação achou soltas.
//
//  1. Cadastro SEM nome (ou só com espaços): o cartão do topo mostra o e-mail
//     da conta, não um cartão em branco.
//  2. O rótulo pequeno do cabeçalho acompanha a aba aberta ("Conta · Perfil" e
//     "Conta · Segurança").
//  3. Nome que já veio do banco COM espaços nas pontas: quem só troca o WhatsApp
//     não reenvia o nome (os espaços não contam como edição).
//  4. Envio do formulário durante a carga (ou depois de a carga falhar): a
//     própria tela se recusa e diz "Aguarde os dados carregarem" — não cai no
//     "Informe seu nome" (que seria o aviso errado) e nada é gravado.
//
// Mutantes equivalentes (nenhum comportamento observável difere), registrados
// aqui para ninguém gastar tempo de novo:
//  - `whatsappMudou` sem a exigência de `whatsappEditado`: o telefone do
//    formulário só difere do original depois de a pessoa digitar, e digitar já
//    liga `whatsappEditado` — as duas condições nunca divergem.
//  - `cpfMudou` sem comparar com o CPF original: ao devolver o campo ao CPF
//    original, o próprio `onChange` do campo já zera o rascunho, então a
//    comparação repete o que o rascunho já diz.
//
// Sem rede, sem relógio solto, dados inventados; o banco é um dublê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  )?.set;
  act(() => {
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botaoSalvar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Salvar alterações"),
  ) as HTMLButtonElement;
}

async function salvar() {
  await act(async () => {
    botaoSalvar().click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gravacoes = () =>
  rpc.mock.calls.filter((chamada) => chamada[0] === "update_my_profile_secure");

const banco = { nome: "Maria S.", whatsapp: "" };

describe("AccountSettingsView — cartão sem nome, aba, nome com espaços e envio na carga", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/AccountSettingsView");
  }, 60_000);

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

  async function renderizar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
  }

  async function abrirATela() {
    await renderizar();
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === banco.nome;
    });
  }

  const nomeDoCartao = () =>
    document.body.querySelector("p.truncate.text-lg")?.textContent;
  const rotuloDoCabecalho = () =>
    document.body.querySelector("header p")?.textContent;

  describe("cartão do topo", () => {
    it("cadastro sem nome: o cartão mostra o e-mail da conta", async () => {
      banco.nome = "";
      await abrirATela();

      expect(nomeDoCartao()).toBe("cliente@example.com");
    });

    it("nome só de espaços conta como sem nome: mostra o e-mail", async () => {
      banco.nome = "   ";
      await abrirATela();

      expect(nomeDoCartao()).toBe("cliente@example.com");
    });

    it("CONTROLE: com nome salvo, o cartão mostra o nome (aparado), não o e-mail", async () => {
      banco.nome = "  Maria Souza ";
      await abrirATela();

      expect(nomeDoCartao()).toBe("Maria Souza");
    });
  });

  describe("rótulo do cabeçalho", () => {
    it("diz a aba aberta: Perfil ao entrar e Segurança depois de trocar", async () => {
      await abrirATela();
      expect(rotuloDoCabecalho()).toBe("Conta · Perfil");

      const abaSeguranca = document.getElementById("aba-conta-security");
      await act(async () => {
        abaSeguranca?.click();
      });
      expect(rotuloDoCabecalho()).toBe("Conta · Segurança");

      const abaPerfil = document.getElementById("aba-conta-profile");
      await act(async () => {
        abaPerfil?.click();
      });
      expect(rotuloDoCabecalho()).toBe("Conta · Perfil");
    });
  });

  describe("nome que veio do banco com espaços nas pontas", () => {
    it("trocar só o WhatsApp não reenvia o nome", async () => {
      banco.nome = "  Maria S.  ";
      await abrirATela();

      digitar("phone", "34999998888");
      await salvar();

      expect(gravacoes()).toHaveLength(1);
      expect(gravacoes()[0]?.[1]).toEqual({
        p_full_name: null,
        p_whatsapp: "(34) 99999-8888",
      });
    });

    it("CONTROLE: trocar o nome de verdade manda o nome aparado", async () => {
      banco.nome = "  Maria S.  ";
      await abrirATela();

      digitar("full_name", "  Maria Souza ");
      await salvar();

      expect(gravacoes()[0]?.[1]).toEqual({
        p_full_name: "Maria Souza",
        p_whatsapp: null,
      });
    });
  });

  describe("envio do formulário sem os dados carregados", () => {
    const enviarOFormulario = async () => {
      const formulario = document.getElementById("form-perfil");
      await act(async () => {
        formulario?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    it("carga que FALHOU: avisa para aguardar os dados e não grava (nem fala de nome)", async () => {
      rpc.mockImplementation((nome: string) =>
        nome === "get_my_complete_profile"
          ? Promise.resolve({ data: null, error: { message: "falhou" } })
          : Promise.resolve({ error: null }),
      );
      await renderizar();
      await esperarAte(() => botaoSalvar().disabled);
      await esperarAte(
        () => !document.body.textContent?.includes("Carregando"),
      );

      await enviarOFormulario();

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        "Aguarde os dados carregarem antes de salvar.",
        { description: "Ainda não conseguimos confirmar seus dados atuais." },
      );
      expect(toast.error).not.toHaveBeenCalledWith("Informe seu nome");
      expect(gravacoes()).toHaveLength(0);
    });

    it("carga que ainda NÃO terminou: o mesmo aviso, sem gravar", async () => {
      rpc.mockImplementation((nome: string) =>
        nome === "get_my_complete_profile"
          ? new Promise(() => {})
          : Promise.resolve({ error: null }),
      );
      await renderizar();

      await enviarOFormulario();

      expect(toast.error).toHaveBeenCalledWith(
        "Aguarde os dados carregarem antes de salvar.",
        { description: "Ainda não conseguimos confirmar seus dados atuais." },
      );
      expect(toast.error).not.toHaveBeenCalledWith("Informe seu nome");
      expect(gravacoes()).toHaveLength(0);
    });

    it("CONTROLE: com os dados carregados, o mesmo envio grava e não manda aguardar", async () => {
      await abrirATela();
      digitar("full_name", "Maria Souza");

      await enviarOFormulario();

      expect(gravacoes()).toHaveLength(1);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
