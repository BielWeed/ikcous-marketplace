// @vitest-environment jsdom
//
// CONTRATO-1.5.7.md §8 R1-8 — o pacote do teste de credencial é honesto por
// SERVIÇO: chave aceita + serviço com erro da transportadora nunca vira
// "chave recusada"; "indisponível" (rede/timeout/5xx) nunca vira "chave
// recusada"; "chave está certa, mas nenhum serviço cotou" tem frase própria.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const RESPOSTA_FRENET_LIGADA = {
  success: true,
  modo: "multi",
  ligados: ["frenet"],
  provedores: {
    melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: true, sandbox: false, servicos: null },
  },
};

describe("TransportadorasSection — test_credentials honesto por serviço (R1-8)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botao = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      re.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement | undefined;

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function testarFrenet(respostaTeste: unknown) {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_FRENET_LIGADA, error: null });
      }
      if (opcoes?.body?.action === "test_credentials") {
        return Promise.resolve({ data: respostaTeste, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    // Frenet é o terceiro cartão (ME, SF, Frenet).
    const botoesTestar = [...hospedeiro.querySelectorAll("button")].filter(
      (b) => /^Testar$/.test(b.textContent?.trim() ?? ""),
    );
    await clicar(botoesTestar[2]);
  }

  it("chave aceita + serviço com erro da transportadora = erro_do_servico, NUNCA chave_recusada", async () => {
    await testarFrenet({
      success: false,
      motivo: "sem_cotacao_valida",
      servicosTestados: [
        {
          codigo: "1",
          ok: false,
          motivo: "erro_do_servico",
          detalhe: "não atende o trecho",
        },
      ],
    });
    expect(hospedeiro.textContent).toMatch(
      /a chave está certa; estes serviços não cotaram para o pacote de teste/i,
    );
    expect(hospedeiro.textContent).not.toMatch(/recusad/i);
    expect(hospedeiro.textContent).toContain("não atende o trecho");
  });

  it("401/403 ou erro de token = chave_recusada, com a frase própria", async () => {
    await testarFrenet({ success: false, motivo: "chave_recusada" });
    expect(hospedeiro.textContent).toMatch(
      /a chave foi recusada pelo provedor\. confira se copiou certo\./i,
    );
  });

  it("rede/timeout/5xx = indisponível, NUNCA 'chave recusada'", async () => {
    await testarFrenet({ success: false, motivo: "indisponivel" });
    expect(hospedeiro.textContent).toMatch(
      /o provedor não respondeu agora\. tente de novo em instantes\./i,
    );
    expect(hospedeiro.textContent).not.toMatch(/recusad/i);
  });

  it("sucesso mostra os serviços testados individualmente", async () => {
    await testarFrenet({
      success: true,
      servicosTestados: [
        { codigo: "1", ok: true, preco: 25.5, prazo: 3 },
        {
          codigo: "2",
          ok: false,
          motivo: "erro_do_servico",
          detalhe: "dimensões",
        },
      ],
    });
    expect(hospedeiro.textContent).toContain("1: cotou certo");
    expect(hospedeiro.textContent).toContain("2: não cotou (dimensões)");
  });

  it("falha de rede na invocação (exceção) usa a mensagem amigável, não crua", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_FRENET_LIGADA, error: null });
      }
      if (opcoes?.body?.action === "test_credentials") {
        return Promise.reject(new Error("Failed to fetch"));
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    const botoesTestar = [...hospedeiro.querySelectorAll("button")].filter(
      (b) => /^Testar$/.test(b.textContent?.trim() ?? ""),
    );
    await clicar(botoesTestar[2]);
    expect(hospedeiro.textContent).not.toContain("Failed to fetch");
    expect(hospedeiro.textContent).toMatch(/erro de comunicação|instantes/i);
  });

  void botao;
});
