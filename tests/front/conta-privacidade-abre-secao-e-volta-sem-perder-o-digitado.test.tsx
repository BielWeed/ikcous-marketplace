// @vitest-environment jsdom
//
// Redesenho "Tinta" da Conta (23/10/2026): "Privacidade e meus dados" deixou de
// ficar embaixo do formulário e virou uma linha-link que abre uma SEÇÃO da
// própria tela (estado local, sem rota). Este teste prende o que a linha
// promete: (1) a seção NÃO existe enquanto ninguém abriu; (2) abrir troca abas
// e formulário pela seção e entrega ao componente as props de sempre; (3) o
// "‹ Conta" volta com o que foi digitado (nome, WhatsApp, CPF, aba Segurança
// com a senha) exatamente como estava; (4) nada é gravado no vai-e-volta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updatePassword = vi.fn();
const rpc = vi.fn();
const privacidadeProps = vi.fn();

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

// A tela real tem um <h2 id="privacidade-titulo">; o duble liga/desliga o
// titulo para provar tambem o plano B (foco no conteiner da secao).
const dubleDePrivacidade = vi.hoisted(() => ({ comTitulo: true }));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: (props: { userId: string; emailAtual: string }) => {
    privacidadeProps(props);
    return (
      <div data-testid="privacidade-e-meus-dados">
        {dubleDePrivacidade.comTitulo && (
          <h2 id="privacidade-titulo">Privacidade e meus dados</h2>
        )}
        privacidade
      </div>
    );
  },
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

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorMudo);
vi.stubGlobal("IntersectionObserver", ObservadorMudo);

async function esperarAte(condicao: () => boolean, timeoutMs = 2000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: não ficou verdadeiro em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
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

function botaoComTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function clicar(botao: HTMLElement | undefined) {
  expect(botao).toBeTruthy();
  await act(async () => {
    botao!.click();
  });
}

const gravacoes = () =>
  rpc.mock.calls.filter((chamada) => chamada[0] === "update_my_profile_secure");

describe("Conta — a linha 'Privacidade e meus dados' abre uma seção e o '‹ Conta' volta", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    dubleDePrivacidade.comTitulo = true;
    // O conteiner de rolagem real do app e <main id="conteudo">.
    hospedeiro = document.createElement("main");
    hospedeiro.id = "conteudo";
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !!nome && !nome.disabled && nome.value === "Fulano de Tal";
    });
  }

  it("enquanto ninguém abriu, a seção de privacidade não existe e a linha-link está lá", async () => {
    await montar();
    expect(
      document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
    ).toBeNull();
    expect(privacidadeProps).not.toHaveBeenCalled();
    expect(botaoComTexto("Privacidade e meus dados")).toBeTruthy();
    expect(hospedeiro.textContent).toContain("Sua conta");
    expect(hospedeiro.textContent).not.toContain("Configurações da Conta");
  });

  it("abrir troca abas e formulário pela seção, com as props de sempre", async () => {
    await montar();
    await clicar(botaoComTexto("Privacidade e meus dados"));

    expect(
      document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
    ).not.toBeNull();
    expect(privacidadeProps).toHaveBeenLastCalledWith({
      userId: "cliente-1",
      emailAtual: "cliente@example.com",
    });
    expect(document.getElementById("full_name")).toBeNull();
    expect(botaoComTexto("Segurança")).toBeUndefined();
    expect(botaoComTexto("Salvar alterações")).toBeUndefined();
    expect(botaoComTexto("Conta")).toBeTruthy();
  });

  it("‹ Conta volta com nome, WhatsApp e CPF exatamente como estavam, sem gravar nada", async () => {
    await montar();
    digitar("full_name", "Nome Mudado Sem Salvar");
    digitar("phone", "34999998888");
    digitar("cpf", "52998224725");
    const antes = {
      nome: (document.getElementById("full_name") as HTMLInputElement).value,
      fone: (document.getElementById("phone") as HTMLInputElement).value,
      cpf: (document.getElementById("cpf") as HTMLInputElement).value,
    };
    expect(antes.fone).toBe("(34) 99999-8888");

    await clicar(botaoComTexto("Privacidade e meus dados"));
    await clicar(botaoComTexto("Conta"));

    expect(
      document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
    ).toBeNull();
    await esperarAte(() => !!document.getElementById("full_name"));
    expect(
      (document.getElementById("full_name") as HTMLInputElement).value,
    ).toBe(antes.nome);
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe(
      antes.fone,
    );
    expect((document.getElementById("cpf") as HTMLInputElement).value).toBe(
      antes.cpf,
    );
    expect(gravacoes()).toHaveLength(0);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("a senha digitada na aba Segurança sobrevive à ida e volta pela privacidade", async () => {
    await montar();
    await clicar(botaoComTexto("Segurança"));
    await esperarAte(() => !!document.getElementById("new_password"));
    digitar("new_password", "senhaNovaForte123");
    digitar("confirm_password", "senhaNovaForte123");

    // A linha-link mora na aba Perfil (abaixo dos campos).
    await clicar(botaoComTexto("Perfil"));
    await esperarAte(() => !!document.getElementById("full_name"));
    await clicar(botaoComTexto("Privacidade e meus dados"));
    await clicar(botaoComTexto("Conta"));

    await esperarAte(() => !!document.getElementById("full_name"));
    await clicar(botaoComTexto("Segurança"));
    await esperarAte(() => !!document.getElementById("new_password"));
    expect(
      (document.getElementById("new_password") as HTMLInputElement).value,
    ).toBe("senhaNovaForte123");
    expect(
      (document.getElementById("confirm_password") as HTMLInputElement).value,
    ).toBe("senhaNovaForte123");
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("abrir manda o foco ao titulo da secao; voltar devolve o foco a linha de privacidade", async () => {
    await montar();
    await clicar(botaoComTexto("Privacidade e meus dados"));

    const titulo = document.getElementById("privacidade-titulo")!;
    expect(titulo.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(titulo);

    await clicar(botaoComTexto("Conta"));
    await esperarAte(() => !!botaoComTexto("Privacidade e meus dados"));
    expect(document.activeElement).toBe(
      botaoComTexto("Privacidade e meus dados"),
    );
  });

  it("sem titulo na secao, o foco vai ao conteiner da secao (nunca fica no body)", async () => {
    dubleDePrivacidade.comTitulo = false;
    await montar();
    await clicar(botaoComTexto("Privacidade e meus dados"));
    expect(document.activeElement).not.toBe(document.body);
    expect(
      document.activeElement?.contains(
        document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
      ),
    ).toBe(true);
  });

  it("montar a tela nao rouba o foco (so a troca de secao mexe nele)", async () => {
    await montar();
    expect(document.activeElement).toBe(document.body);
  });

  it("abrir leva o conteiner de rolagem ao topo; voltar restaura a posicao de antes", async () => {
    let topo = 0;
    Object.defineProperty(hospedeiro, "scrollTop", {
      configurable: true,
      get: () => topo,
      set: (v: number) => {
        topo = v;
      },
    });
    await montar();
    topo = 650; // a pessoa rolou ate a linha de privacidade

    await clicar(botaoComTexto("Privacidade e meus dados"));
    expect(topo).toBe(0);

    await clicar(botaoComTexto("Conta"));
    expect(topo).toBe(650);
  });
});
