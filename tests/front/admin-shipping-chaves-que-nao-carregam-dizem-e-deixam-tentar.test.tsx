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
// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2): a leitura deixou de ser
// `store_shipping_credentials` por PostgREST — é UMA ação da edge
// (`ler_configuracao_frete`). O mecanismo provado aqui é o MESMO (falha vira
// mensagem, nunca fica preso em "Recarregando…", "Tentar de novo" refaz a
// busca e destrava a tela), só a fonte da falha mudou de tabela para edge.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, estadoDoBanco } = vi.hoisted(() => ({
  invoke: vi.fn(),
  // `credenciaisFalham` é lido a CADA chamada de `ler_configuracao_frete`,
  // não no import: é isso que permite o terceiro teste falhar primeiro e ter
  // sucesso na retentativa.
  estadoDoBanco: { credenciaisFalham: true, chamadasDeConfig: 0 },
}));

const RESPOSTA_OK = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          estadoDoBanco.chamadasDeConfig++;
          if (estadoDoBanco.credenciaisFalham) {
            return Promise.resolve({
              data: null,
              error: { message: "network error" },
            });
          }
          return Promise.resolve({ data: RESPOSTA_OK, error: null });
        }
        return invoke(nome, opcoes);
      },
    },
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
    estadoDoBanco.credenciaisFalham = true;
    estadoDoBanco.chamadasDeConfig = 0;
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
    expect(hospedeiro.textContent).not.toMatch(/recarregando/i);
  });

  it("o botão de tentar de novo existe e realmente refaz a busca", async () => {
    await abrirSecao();
    const chamadasDepoisDaAbertura = estadoDoBanco.chamadasDeConfig;

    const botao = botaoDeTentarDeNovo();
    expect(botao).toBeDefined();

    // Agora a edge responde. O clique tem de nos tirar do estado morto.
    estadoDoBanco.credenciaisFalham = false;
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(estadoDoBanco.chamadasDeConfig).toBeGreaterThan(
      chamadasDepoisDaAbertura,
    );
    expect(hospedeiro.textContent).not.toMatch(
      /não foi possível carregar as chaves/i,
    );

    // E a seção volta a funcionar de verdade: o campo do token destrava e a
    // tela diz que há chave salva (a chave em si não volta ao campo — só
    // escrita). Sem esta asserção, o teste aceitaria uma tela que só esconde
    // a mensagem de erro e continua morta.
    const campoToken = [...hospedeiro.querySelectorAll("input")].find(
      (i) => i.type === "password",
    ) as HTMLInputElement | undefined;
    expect(campoToken).toBeDefined();
    expect(campoToken?.disabled).toBe(false);
    expect(campoToken?.value).toBe("");
    expect(hospedeiro.textContent).toMatch(/chave salva/i);
  });
});
