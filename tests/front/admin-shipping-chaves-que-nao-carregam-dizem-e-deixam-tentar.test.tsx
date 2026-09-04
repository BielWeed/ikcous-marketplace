// @vitest-environment jsdom
//
// Seção de chaves de frete que não carrega precisa DIZER, e deixar tentar de novo.
//
// Achado 2 da auditoria rodada 2 (26/08/2026). `fetchShippingCreds` só faz
// `setCredsLoaded(true)` quando o fetch volta bem; no ramo de erro ele apenas
// escrevia no console e não guardava estado nenhum. Como `credsLoaded` ficava
// `false` para sempre e nada tentava de novo, os dois `disabled` que a
// correção C4/B1 da madrugada acrescentou travavam a seção INTEIRA: campo do
// token apagado, e no lugar do botão de Sandbox a palavra "Recarregando…"
// eternamente — sem mensagem, sem explicação, sem botão de recuperar.
//
// MUDOU DE TELA (frente glm-visual-admin-0209, pedido do Gabriel 02/09): as
// chaves das transportadoras saíram da tela de Frete e agora são a seção
// "Transportadoras e cotação de frete" da tela de Ajustes
// (`TransportadorasSection`). As travas vieram junto, e ESTE arquivo continua
// sendo a prova — agora contra o componente novo.
//
// Contra o HEAD (843ca0a) os dois primeiros testes reprovam: não existe
// mensagem de erro nenhuma no DOM, e não existe botão de tentar de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();

// A loja usa Melhor Envio — é o que faz a caixa de credenciais renderizar.
const { estadoDaLoja, estadoDoBanco } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"] as string[],
    },
  },
  // `credenciaisFalham` é lido a CADA chamada de fetch, não no import: é isso
  // que permite o terceiro teste falhar primeiro e ter sucesso na retentativa.
  estadoDoBanco: { credenciaisFalham: true, chamadasDeCredenciais: 0 },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        estadoDoBanco.chamadasDeCredenciais++;
        const falha = estadoDoBanco.credenciaisFalham;
        return {
          select: () =>
            Promise.resolve(
              falha
                ? { data: null, error: { message: "network error" } }
                : {
                    data: [
                      {
                        provider: "melhor_envio",
                        credentials: { token: "tok-salvo", sandbox: false },
                      },
                    ],
                    error: null,
                  },
            ),
        };
      }
      // shipping_calculation_logs e o resto
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TransportadorasSection — chaves que não carregam dizem, e deixam tentar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"],
    };
    estadoDoBanco.credenciaisFalham = true;
    estadoDoBanco.chamadasDeCredenciais = 0;
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

  async function abrirSecao() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function botaoDeTentarDeNovo(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /tentar de novo/i.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
  }

  it("a falha vira mensagem na tela, não só linha no console", async () => {
    await abrirSecao();

    expect(hospedeiro.textContent).toMatch(
      /não foi possível carregar as chaves/i,
    );
  });

  it("a tela não afirma mais que está 'Recarregando' quando nada recarrega", async () => {
    await abrirSecao();

    // A palavra prometia um movimento que não existia: nada tenta de novo
    // sozinho. Ela só pode aparecer enquanto a busca está mesmo em curso.
    // ("Carregando…" não casa com /recarregando/i — o rótulo só aparece
    // enquanto o fetch de verdade está em curso, nunca depois de falhar.)
    expect(hospedeiro.textContent).not.toMatch(/recarregando/i);
  });

  it("o botão de tentar de novo existe e realmente refaz a busca", async () => {
    await abrirSecao();
    const chamadasDepoisDaAbertura = estadoDoBanco.chamadasDeCredenciais;

    const botao = botaoDeTentarDeNovo();
    expect(botao).toBeDefined();

    // Agora o banco responde. O clique tem de nos tirar do estado morto.
    estadoDoBanco.credenciaisFalham = false;
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(estadoDoBanco.chamadasDeCredenciais).toBeGreaterThan(
      chamadasDepoisDaAbertura,
    );
    expect(hospedeiro.textContent).not.toMatch(
      /não foi possível carregar as chaves/i,
    );

    // E a seção volta a funcionar de verdade: o campo do token destrava e traz
    // o valor salvo. Sem esta asserção, o teste aceitaria uma tela que só
    // esconde a mensagem de erro e continua morta.
    const campoToken = [...hospedeiro.querySelectorAll("input")].find(
      (i) => i.type === "password",
    ) as HTMLInputElement | undefined;
    expect(campoToken).toBeDefined();
    expect(campoToken?.disabled).toBe(false);
    expect(campoToken?.value).toBe("tok-salvo");
  });
});
