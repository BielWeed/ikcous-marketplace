// @vitest-environment jsdom
//
// Frete: lojista que perdeu o cargo (login ainda vivo por cerca de 1 hora)
// salvava e lia "Não foi possível falar com o servidor. Tente de novo em
// instantes." — o servidor tinha dito 403 (ou o gateway 401) e "tentar de novo"
// nunca funcionaria. Agora o cartão de transportadoras diz que a sessão acabou
// ou que falta permissão. O tradutor é testado em
// `mensagens-erro-sessao-ou-permissao-opt-in.test.ts`; aqui se prova a LIGAÇÃO:
// o fluxo real de "Salvar provedores" e os cinco pontos do cartão.

import { readFileSync } from "node:fs";
import { MENSAGEM_SESSAO_OU_PERMISSAO } from "@/lib/erro-de-sessao-do-painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => {},
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

const CONFIG = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

function erroHttp(status: number) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response("{}", { status }),
  };
}

describe("TransportadorasSection — sessão ou permissão negada ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function salvarLigadosComRespostaDoServidor(erro: unknown) {
    invoke.mockImplementation((_nome: string, opcoes: any) =>
      opcoes?.body?.action === "ler_configuracao_frete"
        ? Promise.resolve({ data: CONFIG, error: null })
        : Promise.resolve({ data: null, error: erro }),
    );
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperar();
    });
    await act(async () => {
      await esperar();
    });
    const caixa = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Ligar Melhor Envio"]',
    );
    await act(async () => {
      caixa?.click();
    });
    const salvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Salvar provedores/.test(b.textContent ?? ""),
    );
    expect(salvar?.disabled).toBe(false);
    await act(async () => {
      salvar?.click();
    });
    await act(async () => {
      await esperar();
    });
    return (await import("sonner")).toast.error as ReturnType<typeof vi.fn>;
  }

  it.each([401, 403])(
    "Salvar provedores com HTTP %i: o aviso diz sessão/permissão, não 'falar com o servidor'",
    async (status) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const toastError = await salvarLigadosComRespostaDoServidor(
        erroHttp(status),
      );

      expect(toastError).toHaveBeenCalledWith(
        "Erro ao salvar os provedores ligados.",
        { description: MENSAGEM_SESSAO_OU_PERMISSAO },
      );
      expect(hospedeiro.textContent).toContain(MENSAGEM_SESSAO_OU_PERMISSAO);
      expect(hospedeiro.textContent).not.toContain("falar com o servidor");
    },
  );

  it("Salvar provedores com HTTP 500: segue a frase de sempre", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = await salvarLigadosComRespostaDoServidor(erroHttp(500));

    expect(toastError).toHaveBeenCalledWith(
      "Erro ao salvar os provedores ligados.",
      {
        description:
          "Não foi possível falar com o servidor. Tente de novo em instantes.",
      },
    );
  });

  it("os cinco pontos do cartão que traduzem erro de edge function pedem a frase de sessão/permissão", () => {
    const fonte = readFileSync(
      "src/components/admin/settings/TransportadorasCard.tsx",
      "utf8",
    );
    const chamadas = fonte.split("mensagemAmigavelErroEdgeFunction(").slice(1);
    expect(chamadas).toHaveLength(5);
    for (const trecho of chamadas) {
      // Cada chamada fecha em `})`; a opção tem de estar dentro dela.
      const corpo = trecho.slice(0, trecho.indexOf("})"));
      expect(corpo).toContain("mensagemSessaoOuPermissao: true");
    }
  });
});
