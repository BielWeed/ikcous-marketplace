// @vitest-environment jsdom
//
// Caça por mutação na Conta, três buracos ao redor do campo CPF e da carga do
// cadastro:
//   1. CPF inválido: o aviso "CPF inválido" aparece no campo ao salvar e SOME
//      quando a cliente volta a digitar (senão ela corrige o número e continua
//      vendo o vermelho).
//   2. Texto sem nenhum número no CPF ("abc") é um rascunho que a releitura do
//      cadastro não pode apagar: a cliente digita DEPOIS do clique em Salvar e a
//      releitura chega; o campo continua com o que ela escreveu.
//   3. A carga do cadastro espera 15 s antes de desistir e mostrar "Não
//      conseguimos carregar seus dados de perfil": nem antes (15 ms seria
//      desistir de uma rede lenta), nem depois.
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

const { rpc, getSession, fetchProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  fetchProfile: vi.fn(),
}));
const usuario = { id: "conta-inventada", email: "pessoa@example.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
    profile: { avatar_url: null, cover_url: null },
    fetchProfile,
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return ["set_my_cpf", "update_my_profile_secure"].includes(
        String(args[0]),
      )
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
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Observador);
vi.stubGlobal("IntersectionObserver", Observador);

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
function digitar(id: string, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo(id), texto);
    campo(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botao = (texto: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  )!;

describe("Conta — CPF: aviso que some, texto que fica, e prazo da carga", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let cargaDoCadastro: () => Promise<unknown>;

  beforeAll(async () => {
    await import("@/views/customer/AccountSettingsView");
  }, 60_000);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    getSession.mockResolvedValue({
      data: { session: { user: usuario, access_token: "token-inventado" } },
    });
    fetchProfile.mockResolvedValue(undefined);
    cargaDoCadastro = () =>
      Promise.resolve({
        data: [{ full_name: "Pessoa Inventada", whatsapp: "" }],
        error: null,
      });
    const envioSemResposta = new Promise(() => {});
    rpc.mockImplementation((nome: string) => {
      if (nome === "update_my_profile_secure") return envioSemResposta;
      if (nome === "get_my_complete_profile") return cargaDoCadastro();
      return Promise.resolve({
        data: nome === "get_my_cpf" ? "" : null,
        error: null,
      });
    });
    host = document.createElement("div");
    document.body.append(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
  }
  const passar = (ms: number) =>
    act(async () => vi.advanceTimersByTimeAsync(ms));
  const leiturasDoPerfil = () =>
    rpc.mock.calls.filter((c) => c[0] === "get_my_complete_profile").length;

  it("CPF inválido ao salvar: avisa no campo e não chama a gravação; ao digitar de novo, o aviso some", async () => {
    await montar();
    digitar("cpf", "11111111111");

    await act(async () => botao("Salvar alterações").click());

    expect(campo("cpf").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("cpf-erro")?.textContent).toContain(
      "CPF inválido",
    );
    expect(
      rpc.mock.calls.filter((c) =>
        ["update_my_profile_secure", "set_my_cpf"].includes(String(c[0])),
      ),
    ).toHaveLength(0);

    digitar("cpf", "1111111111");

    expect(document.getElementById("cpf-erro")).toBeNull();
    expect(campo("cpf").getAttribute("aria-invalid")).toBe("false");
  });

  it("texto sem número no CPF, digitado depois do clique em Salvar, sobrevive à releitura", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await act(async () => botao("Salvar alterações").click());

    digitar("cpf", "abc");
    const antes = leiturasDoPerfil();
    await passar(20001);

    expect(leiturasDoPerfil()).toBeGreaterThan(antes);
    expect(campo("cpf").value).toBe("abc");
  });

  it("a carga do cadastro que não responde só vira erro aos 15 s, nunca antes", async () => {
    cargaDoCadastro = () => new Promise(() => {});

    await montar();
    await passar(14_999);

    expect(document.body.textContent).toContain("Carregando seus dados...");
    expect(document.body.textContent).not.toContain(
      "Não conseguimos carregar seus dados de perfil.",
    );

    await passar(1);

    expect(document.body.textContent).toContain(
      "Não conseguimos carregar seus dados de perfil.",
    );
    expect(document.body.textContent).not.toContain("Carregando seus dados...");
  });
});
