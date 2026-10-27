// @vitest-environment jsdom
//
// Lote 221, tela de Conta: o Voltar do celular fecha SÓ a janela de foto, a de
// capa ou a seção "Privacidade" (a Conta fica, o que foi digitado fica) e não
// sobra entrada de histórico órfã: fechar pelo botão da própria tela consome a
// entrada que o Voltar usaria. Molde de montagem:
// conta-privacidade-abre-secao-e-volta-sem-perder-o-digitado.test.tsx.
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

describe("Conta — o Voltar do celular fecha só a janela ou a seção aberta", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let navegacoesDoApp: string[];
  const ouvintes: Array<() => void> = [];

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    globalThis.history.replaceState({ view: "profile" }, "", "/profile");
    globalThis.history.pushState(
      { view: "account-settings" },
      "",
      "/account-settings",
    );
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
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
    document.body.innerHTML = "";
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
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

  async function tocar(el: HTMLElement | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      el!.click();
      await espera(120);
    });
    await act(async () => {
      await espera(120);
    });
  }

  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await espera(60);
    });
    await act(async () => {
      await espera(120);
    });
  }

  const janela = () => document.body.querySelector('[role="dialog"]');
  const TELA = { view: "account-settings" };

  it("Voltar com a janela de foto aberta: fecha só ela, o digitado fica", async () => {
    await montar();
    digitar("full_name", "Nome Mudado Sem Salvar");
    await tocar(botaoComTexto("Alterar foto"));
    expect(janela()).not.toBeNull();
    await apertarVoltar();
    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(
      (document.getElementById("full_name") as HTMLInputElement).value,
    ).toBe("Nome Mudado Sem Salvar");
    expect(globalThis.history.state).toEqual(TELA);
  });

  it("Voltar com a janela de capa aberta: fecha só ela", async () => {
    await montar();
    await tocar(botaoComTexto("Alterar capa"));
    expect(janela()).not.toBeNull();
    await apertarVoltar();
    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
  });

  it("Voltar com a seção Privacidade aberta: volta para a Conta, sem sair da tela", async () => {
    await montar();
    digitar("full_name", "Nome Mudado Sem Salvar");
    await tocar(botaoComTexto("Privacidade e meus dados"));
    expect(
      document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
    ).not.toBeNull();
    await apertarVoltar();
    expect(
      document.querySelector('[data-testid="privacidade-e-meus-dados"]'),
    ).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(
      (document.getElementById("full_name") as HTMLInputElement).value,
    ).toBe("Nome Mudado Sem Salvar");
    expect(globalThis.history.state).toEqual(TELA);
    // O Voltar seguinte já é do roteador.
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["profile|/profile"]);
  });

  it("sair da Privacidade pelo botão da tela consome a entrada: não sobra órfã", async () => {
    await montar();
    await tocar(botaoComTexto("Privacidade e meus dados"));
    await tocar(
      document.body.querySelector<HTMLElement>(
        '[aria-label="Voltar para Conta"]',
      ) ?? undefined,
    );
    expect(globalThis.history.state).toEqual(TELA);
    expect(navegacoesDoApp).toEqual([]);
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["profile|/profile"]);
  });
});
