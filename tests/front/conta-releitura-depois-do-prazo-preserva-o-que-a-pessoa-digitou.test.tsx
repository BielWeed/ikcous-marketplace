// @vitest-environment jsdom
//
// Salvar estoura o prazo; a tela solta a trava e RELÊ o cadastro. Se a pessoa
// seguiu digitando (os campos continuam editáveis enquanto o envio espera), a
// releitura não pode apagar o que ela digitou DEPOIS do clique: só o que ela
// não mexeu recebe o valor do banco. O caminho de sucesso já fazia assim.
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const digitos = (texto: string) => texto.replace(/\D/g, "");

describe("Conta: a releitura depois do prazo não apaga o que a pessoa digitou depois do clique", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let nomeNoBanco: string;
  let concluirEnvio!: (valor: unknown) => void;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    nomeNoBanco = "Pessoa Inventada";
    getSession.mockResolvedValue({
      data: { session: { user: usuario, access_token: "token-inventado" } },
    });
    fetchProfile.mockResolvedValue(undefined);
    const envio = new Promise((resolve) => {
      concluirEnvio = resolve;
    });
    rpc.mockImplementation((nome: string) => {
      if (nome === "update_my_profile_secure") return envio;
      return Promise.resolve({
        data:
          nome === "get_my_complete_profile"
            ? [{ full_name: nomeNoBanco, whatsapp: "" }]
            : nome === "get_my_cpf"
              ? ""
              : null,
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
  async function salvar() {
    await act(async () => botao("Salvar alterações").click());
  }

  it("nome digitado depois do clique sobrevive à releitura e continua como edição pendente", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    digitar("full_name", "Segunda edição do nome");
    const antes = leiturasDoPerfil();
    await passar(20001);
    expect(leiturasDoPerfil()).toBeGreaterThan(antes);
    expect(campo("full_name").disabled).toBe(false);
    expect(campo("full_name").value).toBe("Segunda edição do nome");
    // Continua rascunho: a atualização do app segue esperando a pessoa.
    expect(haOperacaoSensivel()).toBe(true);
  });

  it("WhatsApp digitado depois do clique sobrevive e ainda vai no próximo salvamento", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    digitar("phone", "34999998888");
    await passar(20001);
    expect(digitos(campo("phone").value)).toBe("34999998888");
    await salvar();
    const envios = rpc.mock.calls.filter(
      (c) => c[0] === "update_my_profile_secure",
    );
    expect(envios).toHaveLength(2);
    expect(digitos(String(envios[1][1].p_whatsapp))).toBe("34999998888");
    // O segundo envio também fica sem resposta: espera o prazo para soltar a
    // marca de operação sensível antes de o teste seguinte começar.
    await passar(20001);
  });

  it("CPF digitado depois do clique sobrevive à releitura", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    digitar("cpf", "52998224725");
    await passar(20001);
    expect(digitos(campo("cpf").value)).toBe("52998224725");
  });

  it("o que a pessoa NÃO mexeu depois do clique recebe o valor real do banco", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    // Outro aparelho gravou um nome diferente nesse meio tempo.
    nomeNoBanco = "Nome vindo do banco";
    await passar(20001);
    expect(campo("full_name").value).toBe("Nome vindo do banco");
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("a resposta tardia do envio relê de novo e o que a pessoa não tocou desde a releitura recebe o banco", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    await passar(20001);
    expect(campo("full_name").value).toBe("Pessoa Inventada");
    // O valor mostrado veio do banco, não de digitação: a próxima releitura
    // sem digitação nova troca por ele, não o confunde com um rascunho.
    nomeNoBanco = "Nome gravado em outro aparelho";
    await act(async () => concluirEnvio({ error: null }));
    expect(campo("full_name").value).toBe("Nome gravado em outro aparelho");
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("a resposta tardia do envio relê de novo sem apagar o que foi digitado depois da primeira releitura", async () => {
    await montar();
    digitar("full_name", "Nome do clique");
    await salvar();
    await passar(20001);
    expect(campo("full_name").value).toBe("Pessoa Inventada");
    digitar("full_name", "Digitado depois da releitura");
    const antes = leiturasDoPerfil();
    await act(async () => concluirEnvio({ error: null }));
    expect(leiturasDoPerfil()).toBeGreaterThan(antes);
    expect(campo("full_name").value).toBe("Digitado depois da releitura");
  });
});
