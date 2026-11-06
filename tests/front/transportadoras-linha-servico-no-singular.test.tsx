// @vitest-environment jsdom
//
// A linha de uma transportadora ligada com um único serviço escolhido dizia
// "Ligada · 1 serviços". No singular é "Ligada · 1 serviço". Chave e e-mail
// abaixo são FICTÍCIOS.
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

function resposta(servicos: string[]) {
  return {
    success: true,
    modo: "multi",
    ligados: ["melhor_envio"],
    provedores: {
      melhor_envio: {
        tem_chave: true,
        sandbox: false,
        servicos,
        contato_email: "tecnico@loja-ficticia.com.br",
      },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    },
  };
}

describe("Transportadoras — 'serviço' concorda com a quantidade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function linhaDoMelhorEnvio(servicos: string[]) {
    invoke.mockImplementation(async (_: string, opcoes: any) => ({
      data:
        opcoes.body.action === "ler_configuracao_frete"
          ? resposta(servicos)
          : { success: true },
    }));
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => raiz.render(<TransportadorasSection />));
    const nome = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Melhor Envio"]',
    );
    if (!nome) throw new Error("Linha do Melhor Envio não encontrada");
    return nome.textContent ?? "";
  }

  it("um serviço: 'Ligada · 1 serviço'", async () => {
    const texto = await linhaDoMelhorEnvio(["PAC"]);
    expect(texto).toContain("Ligada · 1 serviço");
    expect(texto).not.toContain("1 serviços");
  });

  it("dois serviços: plural", async () => {
    const texto = await linhaDoMelhorEnvio(["PAC", "SEDEX"]);
    expect(texto).toContain("Ligada · 2 serviços");
  });
});
