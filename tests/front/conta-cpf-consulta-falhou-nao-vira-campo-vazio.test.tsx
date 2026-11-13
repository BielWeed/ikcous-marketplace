// @vitest-environment jsdom
//
// A consulta do CPF falhar NÃO é "a conta não tem CPF". Antes, qualquer erro
// que não fosse o prazo esgotado virava campo vazio e liberado: a cliente
// via o CPF em branco, salvava o nome com "Perfil atualizado com sucesso" sem
// CPF nenhum, ou digitava um número por cima do real sem saber. Agora a falha
// trava o formulário como o prazo esgotado: aviso, "Tentar de novo", e nada
// de CPF é comparado nem gravado a partir de um valor que não foi lido.
import * as cpfDaConta from "@/lib/cpf-da-conta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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
const botao = (texto: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
const CPF_REAL = "52998224725";

describe("Conta: consulta do CPF que falha não vira campo vazio", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let respostaDoCpf: () => unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({
      data: { session: { user: usuario, access_token: "token-inventado" } },
    });
    fetchProfile.mockResolvedValue(undefined);
    respostaDoCpf = () => Promise.resolve({ data: CPF_REAL, error: null });
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_cpf") return respostaDoCpf();
      return Promise.resolve({
        data:
          nome === "get_my_complete_profile"
            ? [{ full_name: "Pessoa Inventada", whatsapp: "" }]
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
    vi.restoreAllMocks();
  });
  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => raiz.render(<AccountSettingsView />));
  }
  const gravacoes = () =>
    rpc.mock.calls.filter((c) =>
      ["set_my_cpf", "update_my_profile_secure"].includes(String(c[0])),
    );

  it.each([
    [
      "o banco recusa (erro desconhecido)",
      () => Promise.resolve({ data: null, error: { code: "XX000" } }),
    ],
    ["a rede cai", () => Promise.reject(new Error("Failed to fetch"))],
    ["a resposta vem sem o formato esperado", () => Promise.resolve(undefined)],
  ])(
    "quando %s: trava o formulário com 'Tentar de novo', não mostra CPF em branco liberado e nada é gravado",
    async (_caso, falha) => {
      respostaDoCpf = falha;
      await montar();
      expect(botao("Tentar de novo")).toBeDefined();
      expect(host.textContent).not.toContain("Carregando seus dados");
      expect(campo("cpf").disabled).toBe(true);
      expect(campo("full_name").disabled).toBe(true);
      expect(campo("phone").disabled).toBe(true);
      // Mesmo forçando o envio, o formulário recusa: nada é gravado.
      await act(async () => botao("Salvar alterações")?.click());
      expect(gravacoes()).toHaveLength(0);
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("leitura que LANÇA (fora do contrato) também trava, em vez de virar CPF em branco", async () => {
    vi.spyOn(cpfDaConta, "lerCpfDaConta").mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    expect(botao("Tentar de novo")).toBeDefined();
    expect(campo("cpf").disabled).toBe(true);
    expect(campo("full_name").disabled).toBe(true);
  });

  it("'Tentar de novo' lê o CPF de verdade e só então libera o formulário com o número real", async () => {
    respostaDoCpf = () =>
      Promise.resolve({ data: null, error: { code: "XX000" } });
    await montar();
    expect(campo("cpf").disabled).toBe(true);
    respostaDoCpf = () => Promise.resolve({ data: CPF_REAL, error: null });
    await act(async () => botao("Tentar de novo")!.click());
    expect(campo("cpf").disabled).toBe(false);
    expect(campo("cpf").value).toBe("529.982.247-25");
    expect(campo("full_name").disabled).toBe(false);
  });

  it("conta SEM CPF (consulta ok e vazia) continua liberada com o campo em branco", async () => {
    respostaDoCpf = () => Promise.resolve({ data: null, error: null });
    await montar();
    expect(campo("cpf").disabled).toBe(false);
    expect(campo("cpf").value).toBe("");
    expect(botao("Tentar de novo")).toBeUndefined();
  });
});
