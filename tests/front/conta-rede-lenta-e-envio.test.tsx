// @vitest-environment jsdom
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, getSession, fetchProfile, updateProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
const usuario = { id: "conta-inventada", email: "pessoa@example.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
    profile: { avatar_url: "/foto.png", cover_url: "/capa.png" },
    fetchProfile,
    updateProfile,
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
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: import("react").ReactNode }) =>
    children,
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("@/utils/avatars", async (original) => ({
  ...(await original<typeof import("@/utils/avatars")>()),
  compressImage: async () => "data:image/png;base64,AAAA",
}));
vi.mock("@/utils/covers", async (original) => ({
  ...(await original<typeof import("@/utils/covers")>()),
  compressCoverImage: async () => "data:image/png;base64,AAAA",
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
const pendente = () => new Promise<never>(() => {});
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
function enviar() {
  const form = campo("full_name").form;
  expect(
    form,
    "Nome pertence ao formulário de salvar, não ao de exclusão",
  ).not.toBeNull();
  act(() => form!.requestSubmit());
}
describe("Conta: rede lenta e envio pelo formulário", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    getSession.mockResolvedValue({
      data: { session: { user: usuario, access_token: "token-inventado" } },
    });
    fetchProfile.mockResolvedValue(undefined);
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "get_my_complete_profile"
            ? [{ full_name: "Pessoa Inventada", whatsapp: "" }]
            : null,
        error: null,
      }),
    );
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
  async function passar(ms: number) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  }
  it.each(["get_my_complete_profile", "get_my_cpf"])(
    "libera nova tentativa quando %s fica sem resposta",
    async (leitura) => {
      const normal = rpc.getMockImplementation()!;
      rpc.mockImplementation((nome: string) =>
        nome === leitura ? pendente() : normal(nome),
      );
      await montar();
      await passar(15001);
      expect(host.textContent).not.toContain("Carregando seus dados");
      expect(botao("Tentar de novo")).toBeDefined();
      expect(campo("full_name").disabled).toBe(true);
      rpc.mockImplementation(normal);
      await act(async () => botao("Tentar de novo").click());
      expect(campo("full_name").disabled).toBe(false);
    },
  );
  it("Enter usa o mesmo envio do botão fixo e não dispara outra ação", async () => {
    await montar();
    digitar("full_name", "Nome Alterado");
    const salvar = botao("Salvar alterações");
    expect(salvar.type).toBe("submit");
    expect(salvar.form).toBe(campo("full_name").form);
    enviar();
    await passar(0);
    expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
      p_full_name: "Nome Alterado",
      p_whatsapp: null,
    });
    expect(
      rpc.mock.calls.filter((c) => c[0] === "update_my_profile_secure"),
    ).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith("Perfil atualizado com sucesso");
  });
  it("salvamento pendente libera o botão, avisa a incerteza e relê até a resposta tardia, sem gravar CPF", async () => {
    let concluir!: (valor: unknown) => void;
    const escrita = new Promise((resolve) => {
      concluir = resolve;
    });
    await montar();
    digitar("full_name", "Nome Alterado");
    digitar("cpf", "52998224725");
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation((nome: string) =>
      nome === "update_my_profile_secure" ? escrita : normal(nome),
    );
    await act(async () => botao("Salvar alterações").click());
    await passar(20001);
    expect(botao("Salvar alterações")).toBeDefined();
    expect(haOperacaoSensivel()).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("pode ter sido salvo"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.filter((c) => c[0] === "get_my_complete_profile").length,
    ).toBeGreaterThan(1);
    expect(rpc.mock.calls.some((c) => c[0] === "set_my_cpf")).toBe(false);
    const leituras = rpc.mock.calls.filter(
      (c) => c[0] === "get_my_complete_profile",
    ).length;
    await act(async () => concluir({ error: null }));
    expect(
      rpc.mock.calls.filter((c) => c[0] === "get_my_complete_profile").length,
    ).toBeGreaterThan(leituras);
    expect(toast.success).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some((c) => c[0] === "set_my_cpf")).toBe(false);
  });
  it("resposta atrasada do primeiro salvamento espera o segundo CPF e não o devolve ao antigo", async () => {
    const cpfAntigo = "12345678909";
    const cpfNovo = "52998224725";
    let cpfNoBanco = cpfAntigo;
    let concluirPrimeiro!: (resposta: { error: null }) => void;
    let concluirCpf!: (resposta: { error: null }) => void;
    const primeiro = new Promise<{ error: null }>((resolve) => {
      concluirPrimeiro = resolve;
    });
    const segundoCpf = new Promise<{ error: null }>((resolve) => {
      concluirCpf = resolve;
    });
    let perfisEnviados = 0;
    rpc.mockImplementation((nome: string, args?: { p_cpf: string }) => {
      if (nome === "get_my_cpf")
        return Promise.resolve({ data: cpfNoBanco, error: null });
      if (nome === "get_my_complete_profile")
        return Promise.resolve({
          data: [{ full_name: "Pessoa Inventada", whatsapp: "" }],
          error: null,
        });
      if (nome === "update_my_profile_secure" && ++perfisEnviados === 1)
        return primeiro;
      if (nome === "set_my_cpf") {
        return segundoCpf.then((resposta) => {
          cpfNoBanco = args!.p_cpf;
          return resposta;
        });
      }
      return Promise.resolve({ error: null });
    });
    await montar();
    digitar("full_name", "Nome da primeira tentativa");
    await act(async () => botao("Salvar alterações").click());
    await passar(20001);
    digitar("full_name", "Nome da segunda tentativa");
    digitar("cpf", cpfNovo);
    await act(async () => botao("Salvar alterações").click());
    expect(rpc.mock.calls.filter((c) => c[0] === "set_my_cpf")).toHaveLength(1);
    const leiturasAntes = rpc.mock.calls.filter(
      (c) => c[0] === "get_my_complete_profile",
    ).length;
    // A resposta antiga chega enquanto o SEGUNDO CPF ainda não foi confirmado.
    await act(async () => concluirPrimeiro({ error: null }));
    const leiturasDurante = rpc.mock.calls.filter(
      (c) => c[0] === "get_my_complete_profile",
    ).length;
    expect(cpfNoBanco).toBe(cpfAntigo);
    await act(async () => concluirCpf({ error: null }));
    expect(cpfNoBanco).toBe(cpfNovo);
    expect(campo("cpf").value.replace(/\D/g, "")).toBe(cpfNovo);
    expect(leiturasDurante).toBe(leiturasAntes);
    expect(
      rpc.mock.calls.filter((c) => c[0] === "get_my_complete_profile"),
    ).toHaveLength(leiturasAntes + 1);
    expect(toast.success).toHaveBeenCalledWith("Perfil atualizado com sucesso");
    // Sem acesso ao estado interno: não reenviar o CPF prova que o "original"
    // também é o novo, em vez de só acertar a aparência do campo.
    digitar("full_name", "Só o nome muda agora");
    await act(async () => botao("Salvar alterações").click());
    expect(rpc.mock.calls.filter((c) => c[0] === "set_my_cpf")).toHaveLength(1);
    expect(cpfNoBanco).toBe(cpfNovo);
    expect(campo("cpf").value.replace(/\D/g, "")).toBe(cpfNovo);
  });
  it("dois envios no mesmo instante fazem uma única gravação do perfil", async () => {
    await montar();
    digitar("full_name", "Nome Alterado");
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation((nome: string) =>
      nome === "update_my_profile_secure" ? pendente() : normal(nome),
    );
    const form = campo("full_name").form!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(
      rpc.mock.calls.filter((c) => c[0] === "update_my_profile_secure"),
    ).toHaveLength(1);
  });
  it.each([
    ["foto", "pronta"],
    ["foto", "remover"],
    ["capa", "pronta"],
    ["capa", "remover"],
    ["foto", "enviar"],
    ["capa", "enviar"],
  ])(
    "%s: %s sem resposta libera os controles e não celebra resposta tardia",
    async (imagem, acao) => {
      let concluir!: (valor: boolean) => void;
      updateProfile.mockReturnValue(
        new Promise<boolean>((resolve) => {
          concluir = resolve;
        }),
      );
      await montar();
      digitar("full_name", "Rascunho Inventado");
      await act(async () =>
        (imagem === "foto"
          ? document.querySelector<HTMLElement>("[role=button][tabindex='0']")
          : document.querySelector<HTMLElement>(
              "[title='Alterar capa de fundo']",
            ))!.click(),
      );
      const escolher = () =>
        document.querySelector<HTMLButtonElement>(
          imagem === "foto"
            ? "[role=dialog] .grid-cols-4 button"
            : '[role=dialog] button[class*="aspect-[16/10]"]',
        )!;
      if ((imagem === "foto" && acao === "remover") || acao === "enviar") {
        await act(async () =>
          botao(imagem === "foto" ? "Foto Própria" : "Enviar Foto").click(),
        );
        await passar(300);
      }
      if (acao === "enviar") {
        // biome-ignore lint/complexity/useArrowFunction: construtor do FileReader.
        vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
          const leitor = {
            onload: null as null | ((evento: unknown) => void),
            readAsDataURL: () =>
              leitor.onload?.({
                target: { result: "data:image/png;base64,AAAA" },
              }),
          };
          return leitor as unknown as FileReader;
        });
        const arquivo = campo(
          imagem === "foto" ? "account-avatar-upload-icon" : "cover_file_input",
        );
        Object.defineProperty(arquivo, "files", {
          configurable: true,
          value: [new File(["foto"], "foto.png", { type: "image/png" })],
        });
        await act(async () =>
          arquivo.dispatchEvent(new Event("change", { bubbles: true })),
        );
      } else {
        const alvo =
          acao === "remover"
            ? botao(imagem === "foto" ? "Remover Foto" : "Remover")
            : escolher();
        await act(async () => alvo.click());
      }
      expect(updateProfile).toHaveBeenCalledTimes(1);
      await passar(20001);
      expect(document.body.textContent).not.toContain("Atualizando...");
      expect(campo("full_name").value).toBe("Rascunho Inventado");
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("pode ter sido salvo"),
      );
      expect(toast.success).not.toHaveBeenCalled();
      await act(async () => concluir(true));
      expect(toast.success).not.toHaveBeenCalled();
    },
  );
  it("CPF sem resposta avisa que pode ter salvo e não anuncia sucesso", async () => {
    await montar();
    digitar("cpf", "52998224725");
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation((nome: string) =>
      nome === "set_my_cpf" ? pendente() : normal(nome),
    );
    await act(async () => botao("Salvar alterações").click());
    await passar(20001);
    expect(botao("Salvar alterações")).toBeDefined();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("pode ter sido salvo"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("atualização do cabeçalho sem resposta também libera o Salvar", async () => {
    await montar();
    digitar("full_name", "Nome Alterado");
    fetchProfile.mockReturnValue(pendente());
    await act(async () => botao("Salvar alterações").click());
    await passar(15001);
    expect(botao("Salvar alterações")).toBeDefined();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("pode ter sido salvo"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("sessão pendente tem prazo e nunca começa a escrita quando chega tarde", async () => {
    let concluir!: (valor: unknown) => void;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await montar();
    digitar("full_name", "Nome Alterado");
    await act(async () => botao("Salvar alterações").click());
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(botao("Salvar alterações")).toBeUndefined();
    await passar(20001);
    expect(botao("Salvar alterações")).toBeDefined();
    await act(async () =>
      concluir({
        data: { session: { user: usuario, access_token: "token-inventado" } },
      }),
    );
    expect(
      rpc.mock.calls.some((c) => c[0] === "update_my_profile_secure"),
    ).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
