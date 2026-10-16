// @vitest-environment jsdom
// A imagem pertence à conta que começou a operação, como o CPF.
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { compressImage } from "@/utils/avatars";
import { compressCoverImage } from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, fetchProfile, updateProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
const CONTA_A = { id: "conta-a", email: "conta-a@example.com" };
const CONTA_B = { id: "conta-b", email: "conta-b@example.com" };
const PERFIL_A = { avatar_url: "/avatar-a.png", cover_url: "/capa-a.png" };
const PERFIL_B = { avatar_url: "/avatar-b.png", cover_url: "/capa-b.png" };
const autenticacao: {
  user: typeof CONTA_A | null;
  profile: typeof PERFIL_A;
} = { user: CONTA_A, profile: PERFIL_A };
const BASE64 = "data:image/png;base64,Zm90by1vcmlnaW5hbA==";
const COMPRIMIDA = "data:image/jpeg;base64,Zm90by1jb21wcmltaWRh";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: autenticacao.user,
    profile: autenticacao.profile,
    fetchProfile,
    updateProfile,
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/utils/avatars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/avatars")>()),
  compressImage: vi.fn(),
}));
vi.mock("@/utils/covers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/covers")>()),
  compressCoverImage: vi.fn(),
}));
// A troca de aba não precisa esperar a animação de saída no jsdom.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
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

function adiar<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

const imagens = [
  {
    nome: "foto",
    campo: "avatar_url",
    inputId: "account-avatar-upload-icon",
    aba: "Foto Própria",
    remover: "Remover Foto",
    comprimir: vi.mocked(compressImage),
    sucesso: "Foto de perfil atualizada!",
    sucessoRemocao: "Foto de perfil removida.",
  },
  {
    nome: "capa",
    campo: "cover_url",
    inputId: "cover_file_input",
    aba: "Enviar Foto",
    remover: "Remover",
    comprimir: vi.mocked(compressCoverImage),
    sucesso: "Capa de perfil personalizada atualizada!",
    sucessoRemocao: "Capa de perfil removida.",
  },
] as const;
type Leitor = {
  onload:
    | ((evento: { target: { result: string | null } }) => Promise<void>)
    | null;
  onerror: (() => void) | null;
  readAsDataURL: ReturnType<typeof vi.fn>;
};
const pausas = (["leitura", "compressao", "gravacao"] as const).flatMap(
  (fase) => [true, false].map((remontar) => ({ fase, remontar })),
);

function campo(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function botao(texto: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
  ].find((elemento) => elemento.textContent?.trim() === texto)!;
}

describe.each(imagens)(
  "Conta — $nome pertence à conta que iniciou",
  (imagem) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let leitores: Leitor[];

    beforeEach(() => {
      vi.resetAllMocks();
      autenticacao.user = CONTA_A;
      autenticacao.profile = PERFIL_A;
      leitores = [];
      // biome-ignore lint/complexity/useArrowFunction: o vitest 4 só aceita function ou class num dublê chamado com new.
      vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
        const leitor: Leitor = {
          onload: null,
          onerror: null,
          readAsDataURL: vi.fn(),
        };
        leitores.push(leitor);
        return leitor as unknown as FileReader;
      });
      rpc.mockImplementation((nome: string) =>
        Promise.resolve({
          data:
            nome === "get_my_complete_profile"
              ? [{ full_name: `Nome ${autenticacao.user?.id}`, whatsapp: "" }]
              : "",
          error: null,
        }),
      );
      updateProfile.mockResolvedValue(true);
      vi.mocked(compressImage).mockResolvedValue(COMPRIMIDA);
      vi.mocked(compressCoverImage).mockResolvedValue(COMPRIMIDA);
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.restoreAllMocks();
      expect(haOperacaoSensivel()).toBe(false);
    });

    async function montar(remontar = false) {
      const { AccountSettingsView } = await import(
        "@/views/customer/AccountSettingsView"
      );
      await act(async () => {
        raiz.render(
          <AccountSettingsView
            key={remontar ? autenticacao.user?.id : "mesma-tela"}
          />,
        );
      });
      if (autenticacao.user) expect(campo("full_name").disabled).toBe(false);
    }

    async function abrirEditor(comAba = true) {
      if (!document.querySelector("[role=dialog]")) {
        await act(async () => {
          const abrir =
            imagem.nome === "foto"
              ? document.querySelector<HTMLElement>(
                  "[role=button][tabindex='0']",
                )!
              : document.querySelector<HTMLElement>(
                  "[title='Alterar capa de fundo']",
                )!;
          abrir.click();
        });
      }
      if (comAba) await act(async () => botao(imagem.aba).click());
    }

    function primeiroPronto() {
      return document.querySelector<HTMLButtonElement>(
        imagem.nome === "foto"
          ? "[role=dialog] .grid-cols-4 button"
          : '[role=dialog] button[class*="aspect-[16/10]"]',
      )!;
    }

    async function selecionarArquivo() {
      await abrirEditor();
      expect(campo(imagem.inputId).disabled).toBe(false);
      await act(async () => {
        Object.defineProperty(campo(imagem.inputId), "files", {
          configurable: true,
          value: [new File(["foto"], "foto.png", { type: "image/png" })],
        });
        campo(imagem.inputId).dispatchEvent(
          new Event("change", { bubbles: true }),
        );
      });
    }

    async function terminarLeitura() {
      await act(async () => {
        // Não aguarda a compressão/gravação adiada; só drena as microtarefas.
        void leitores[leitores.length - 1].onload!({
          target: { result: BASE64 },
        }).catch(() => {});
      });
    }

    async function trocarConta(remontar = false, sair = false) {
      act(() => {
        autenticacao.user = sair ? null : CONTA_B;
        autenticacao.profile = PERFIL_B;
      });
      await montar(remontar);
      if (!sair) await abrirEditor();
    }

    function esperarSemAviso() {
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    }

    function esperarContaBIntocada() {
      esperarSemAviso();
      expect(campo("full_name").value).toBe("Nome conta-b");
      expect(
        document
          .querySelector<HTMLImageElement>("img[alt='Capa de Perfil']")!
          .getAttribute("src"),
      ).toBe(PERFIL_B.cover_url);
      if (imagem.nome === "foto") {
        expect(
          document
            .querySelector<HTMLImageElement>("img[alt='Foto customizada']")!
            .getAttribute("src"),
        ).toBe(PERFIL_B.avatar_url);
      }
      expect(document.querySelector("[role=dialog]")).not.toBeNull();
    }

    it.each(pausas)(
      "descarta envio de A durante $fase (remonta: $remontar)",
      async ({ fase, remontar }) => {
        await montar(remontar);
        const compressao = adiar<string>();
        const gravacao = adiar<boolean>();
        if (fase === "compressao") {
          imagem.comprimir.mockReturnValueOnce(compressao.promessa);
        }
        if (fase === "gravacao")
          updateProfile.mockReturnValueOnce(gravacao.promessa);
        await selecionarArquivo();
        if (fase !== "leitura") await terminarLeitura();

        await trocarConta(remontar);
        if (fase === "leitura") await terminarLeitura();
        if (fase === "compressao") {
          await act(async () => compressao.resolver(COMPRIMIDA));
        }
        if (fase === "gravacao") await act(async () => gravacao.resolver(true));

        expect(updateProfile).toHaveBeenCalledTimes(
          fase === "gravacao" ? 1 : 0,
        );
        if (fase === "leitura") expect(imagem.comprimir).not.toHaveBeenCalled();
        esperarContaBIntocada();
        expect(campo(imagem.inputId).disabled).toBe(false);
      },
    );

    it("não grava nem avisa depois de sair durante a compressão", async () => {
      await montar();
      const compressao = adiar<string>();
      imagem.comprimir.mockReturnValueOnce(compressao.promessa);
      await selecionarArquivo();
      await terminarLeitura();
      await trocarConta(false, true);
      await act(async () => compressao.resolver(COMPRIMIDA));
      expect(updateProfile).not.toHaveBeenCalled();
      esperarSemAviso();
    });

    it.each(["compressao", "gravacao"])(
      "ignora rejeição antiga em %s",
      async (fase) => {
        await montar();
        const compressao = adiar<string>();
        const gravacao = adiar<boolean>();
        if (fase === "compressao") {
          imagem.comprimir.mockReturnValueOnce(compressao.promessa);
        } else {
          updateProfile.mockReturnValueOnce(gravacao.promessa);
        }
        await selecionarArquivo();
        await terminarLeitura();
        await trocarConta();
        const erroNoConsole = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        await act(async () => {
          const erro = new Error("falha de teste");
          if (fase === "compressao") compressao.rejeitar(erro);
          else gravacao.rejeitar(erro);
        });
        esperarContaBIntocada();
        expect(erroNoConsole).not.toHaveBeenCalled();
        expect(campo(imagem.inputId).disabled).toBe(false);
      },
    );

    it.each([true, false])(
      "ignora retorno do pronto escolhido por A (sucesso: %s)",
      async (sucesso) => {
        await montar();
        await abrirEditor(false);
        const pronto = adiar<boolean>();
        updateProfile.mockReturnValueOnce(pronto.promessa);
        await act(async () => primeiroPronto().click());
        expect(updateProfile).toHaveBeenCalledTimes(1);
        await trocarConta();
        await act(async () => pronto.resolver(sucesso));
        esperarContaBIntocada();
        expect(campo(imagem.inputId).disabled).toBe(false);
      },
    );

    it("ignora rejeição do pronto escolhido por A", async () => {
      await montar();
      await abrirEditor(false);
      const pronto = adiar<boolean>();
      updateProfile.mockReturnValueOnce(pronto.promessa);
      await act(async () => primeiroPronto().click());
      await trocarConta();
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await act(async () => pronto.rejeitar(new Error("falha de teste")));
      esperarContaBIntocada();
      expect(erroNoConsole).not.toHaveBeenCalled();
      expect(campo(imagem.inputId).disabled).toBe(false);
    });

    it("ignora erro de leitura da conta anterior", async () => {
      await montar();
      await selecionarArquivo();
      await trocarConta();
      act(() => leitores[0].onerror!());
      expect(updateProfile).not.toHaveBeenCalled();
      esperarContaBIntocada();
      expect(campo(imagem.inputId).disabled).toBe(false);
    });

    it.each([true, false])(
      "ignora retorno da remoção de A (sucesso: %s)",
      async (sucesso) => {
        await montar();
        await abrirEditor();
        const remocao = adiar<boolean>();
        updateProfile.mockReturnValueOnce(remocao.promessa);
        await act(async () => botao(imagem.remover).click());
        expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
          [imagem.campo]: "REMOVE",
        });
        await trocarConta();
        await act(async () => remocao.resolver(sucesso));
        esperarContaBIntocada();
        expect(campo(imagem.inputId).disabled).toBe(false);
      },
    );

    it("ignora rejeição da remoção de A", async () => {
      await montar();
      await abrirEditor();
      const remocao = adiar<boolean>();
      updateProfile.mockReturnValueOnce(remocao.promessa);
      await act(async () => botao(imagem.remover).click());
      await trocarConta();
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await act(async () => remocao.rejeitar(new Error("falha de teste")));
      esperarContaBIntocada();
      expect(erroNoConsole).not.toHaveBeenCalled();
    });

    it.each(["envio", "remocao"])(
      "o fim de %s de A não libera o envio de B",
      async (operacao) => {
        await montar();
        const antiga = adiar<boolean>();
        updateProfile.mockReturnValueOnce(antiga.promessa);
        if (operacao === "envio") {
          await selecionarArquivo();
          await terminarLeitura();
        } else {
          await abrirEditor();
          await act(async () => botao(imagem.remover).click());
        }
        await trocarConta();
        const nova = adiar<string>();
        imagem.comprimir.mockReturnValueOnce(nova.promessa);
        await selecionarArquivo();
        await terminarLeitura();
        await act(async () => antiga.resolver(true));
        esperarContaBIntocada();
        expect(campo(imagem.inputId).disabled).toBe(true);
        await act(async () => nova.resolver(COMPRIMIDA));
        expect(updateProfile).toHaveBeenCalledTimes(2);
        expect(toast.success).toHaveBeenCalledExactlyOnceWith(imagem.sucesso);
      },
    );

    it("mantém os argumentos e o aviso do envio na mesma conta", async () => {
      await montar();
      await selecionarArquivo();
      await terminarLeitura();
      if (imagem.nome === "foto") {
        expect(compressImage).toHaveBeenCalledExactlyOnceWith(BASE64, 200, 200);
      } else {
        expect(compressCoverImage).toHaveBeenCalledExactlyOnceWith(BASE64);
      }
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
        [imagem.campo]: COMPRIMIDA,
      });
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(imagem.sucesso);
      expect(toast.error).not.toHaveBeenCalled();
      expect(document.querySelector("[role=dialog]")).toBeNull();
      await abrirEditor();
      expect(campo(imagem.inputId).disabled).toBe(false);
    });

    it("mantém os argumentos e o aviso da remoção na mesma conta", async () => {
      await montar();
      await abrirEditor();
      await act(async () => botao(imagem.remover).click());
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
        [imagem.campo]: "REMOVE",
      });
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(
        imagem.sucessoRemocao,
      );
      expect(toast.error).not.toHaveBeenCalled();
      expect(document.querySelector("[role=dialog]")).toBeNull();
      await abrirEditor();
      expect(campo(imagem.inputId).disabled).toBe(false);
    });

    it.each(["leitura", "compressao", "gravacao", "remocao"])(
      "não continua após desmontar durante %s",
      async (fase) => {
        await montar();
        const compressao = adiar<string>();
        const gravacao = adiar<boolean>();
        if (fase === "compressao") {
          imagem.comprimir.mockReturnValueOnce(compressao.promessa);
        }
        if (fase === "gravacao" || fase === "remocao") {
          updateProfile.mockReturnValueOnce(gravacao.promessa);
        }
        if (fase === "remocao") {
          await abrirEditor();
          await act(async () => botao(imagem.remover).click());
        } else {
          await selecionarArquivo();
          if (fase !== "leitura") await terminarLeitura();
        }
        // Remove a tela mantendo a raiz, como uma navegação para outra view.
        await act(async () => raiz.render(null));
        const erroNoConsole = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        if (fase === "leitura") await terminarLeitura();
        if (fase === "compressao") {
          await act(async () => compressao.resolver(COMPRIMIDA));
        }
        if (fase === "gravacao" || fase === "remocao") {
          await act(async () => gravacao.resolver(true));
        }
        expect(updateProfile).toHaveBeenCalledTimes(
          fase === "gravacao" || fase === "remocao" ? 1 : 0,
        );
        esperarSemAviso();
        expect(erroNoConsole).not.toHaveBeenCalled();
        expect(hospedeiro.innerHTML).toBe("");
      },
    );
  },
);
