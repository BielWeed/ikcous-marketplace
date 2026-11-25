// @vitest-environment jsdom
//
// Caça por mutação na tela "Sua conta": o cartão de identidade (nome grande e
// iniciais da foto) mostra o nome JÁ SALVO, não o que a pessoa está digitando
// no campo "Nome completo". Enquanto ela digita, o cartão não pode mudar de
// nome a cada tecla (e nem virar vazio se ela apagar o campo); só depois de
// salvar com sucesso é que o cartão passa a mostrar o nome novo, sem espaços
// nas pontas. Nenhum teste prendia isso.
//
// RENDER DE VERDADE da tela; só a sessão, o banco e o aviso (toast) são dublês
// (mesmo molde de account-settings-view-whatsapp-mascara-e-valida).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
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
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AccountSettingsView — o cartão de identidade mostra o nome salvo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/AccountSettingsView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProfile.mockReset().mockResolvedValue(true);
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Maria da Silva", whatsapp: "" }],
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
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(
      () =>
        (document.getElementById("full_name") as HTMLInputElement).value ===
        "Maria da Silva",
    );
  }

  const nomeDoCartao = () =>
    hospedeiro.querySelector("p.truncate")?.textContent ?? null;
  const iniciaisDoCartao = () =>
    hospedeiro.querySelector('span[aria-hidden="true"].text-xl')?.textContent ??
    null;

  it("ao abrir: o cartão mostra o nome do cadastro e as iniciais (primeira e última palavra)", async () => {
    await montar();

    expect(nomeDoCartao()).toBe("Maria da Silva");
    expect(iniciaisDoCartao()).toBe("MS");
  });

  it("digitar outro nome no campo NÃO muda o cartão antes de salvar", async () => {
    await montar();

    await act(async () => digitar("full_name", "Joana Souza"));

    expect(
      (document.getElementById("full_name") as HTMLInputElement).value,
    ).toBe("Joana Souza");
    expect(nomeDoCartao()).toBe("Maria da Silva");
    expect(iniciaisDoCartao()).toBe("MS");
  });

  it("apagar o campo do nome também não esvazia o cartão", async () => {
    await montar();

    await act(async () => digitar("full_name", ""));

    expect(nomeDoCartao()).toBe("Maria da Silva");
    expect(iniciaisDoCartao()).toBe("MS");
  });

  it("depois de salvar, o cartão passa a mostrar o nome novo, sem espaços nas pontas", async () => {
    await montar();
    await act(async () => digitar("full_name", "  Joana Souza  "));

    const salvar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar alterações"),
    ) as HTMLButtonElement;
    await act(async () => salvar.click());
    await esperarAte(() => nomeDoCartao() === "Joana Souza");

    expect(nomeDoCartao()).toBe("Joana Souza");
    expect(iniciaisDoCartao()).toBe("JS");
    const gravacao = rpc.mock.calls.find(
      ([nome]) => nome === "update_my_profile_secure",
    );
    expect(gravacao?.[1]).toMatchObject({ p_full_name: "Joana Souza" });
  });
});
