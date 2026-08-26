// @vitest-environment jsdom
//
// Engasgo de rede não é veredito de permissão.
//
// Achado 1 da auditoria rodada 2 (26/08/2026), e o mais grave da minha metade.
// O portão do painel vivia dentro de um `React.lazy` em `App.tsx:56-99` e fazia
// `if (error || !data)` — ou seja, tratava "o servidor RESPONDEU que você não é
// admin" e "o servidor NÃO RESPONDEU" como a mesma coisa. Os dois expulsavam
// com `window.location.href = "/"`, recarregando a página inteira. Um engasgo
// de rede de um segundo jogava o lojista de volta na loja e derrubava qualquer
// cadastro em andamento.
//
// Três agravantes que este arquivo prende, uma por teste:
//
//  1. O aviso NUNCA chegava a aparecer: o `import("sonner")` era assíncrono e o
//     `window.location.href` da linha seguinte rodava antes, então a navegação
//     começava e o toast morria com a página. O lojista era despejado sem uma
//     palavra.
//  2. `React.lazy` MEMORIZA o resultado do carregador. Uma vez resolvido como
//     "não autorizado", ele ficava assim para sempre naquela instância — e se a
//     navegação fosse cancelada (o `beforeunload` de `App.tsx:546-555` pergunta
//     "quer mesmo sair?" quando há alteração não salva, e o lojista pode clicar
//     em ficar), TODA aba do painel virava "Verificando permissões..." eterno,
//     sem F5 não saía mais.
//  3. Não havia como tentar de novo. Nenhuma.
//
// A lição já estava aplicada 250 linhas abaixo, no MESMO arquivo:
// `AdminAccessDenied` (`App.tsx:309-336`) foi consertado no #123 exatamente
// para separar `adminStatus === "unknown"` de "não é admin". Uma porta foi
// trancada e a outra ficou escancarada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

// `respostaDoServidor` é lida a CADA chamada, não no import — é o que permite
// o teste da retentativa falhar primeiro e ter sucesso depois.
const { servidor } = vi.hoisted(() => ({
  servidor: {
    resposta: "erro" as "erro" | "excecao" | "admin" | "nao-admin",
    chamadas: 0,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (nome: string) => {
      if (nome !== "is_admin") return { data: null, error: null };
      servidor.chamadas++;
      if (servidor.resposta === "excecao") throw new Error("fetch failed");
      if (servidor.resposta === "erro") {
        return { data: null, error: { message: "network error" } };
      }
      return { data: servidor.resposta === "admin", error: null };
    },
  },
}));

// O pacote real do painel é pesado e irrelevante aqui: o que está sob teste é
// o PORTÃO, não o que ele abre.
vi.mock("@/components/layouts/AdminArea", () => ({
  AdminArea: () => <div data-testid="painel-de-verdade">PAINEL ABERTO</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Portão do painel — engasgo de rede não expulsa ninguém", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    toastError.mockClear();
    servidor.resposta = "erro";
    servidor.chamadas = 0;
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

  async function abrirPortao() {
    const { AdminAreaGate } = await import(
      "@/components/layouts/AdminAreaGate"
    );
    await act(async () => {
      raiz.render(
        <AdminAreaGate
          currentView={"admin-dashboard" as never}
          onNavigate={onNavigate}
          selectedProductId={null}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={false}
          fallback={<div data-testid="carregando">Verificando…</div>}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function botaoTentarDeNovo(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /tentar de novo/i.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
  }

  it("servidor sem responder: NÃO expulsa, e explica o que houve", async () => {
    servidor.resposta = "erro";
    await abrirPortao();

    // Não foi despejado.
    expect(onNavigate).not.toHaveBeenCalled();
    // E, principalmente, não foi acusado de não ser admin.
    expect(hospedeiro.textContent).not.toMatch(/acesso restrito/i);
    expect(toastError).not.toHaveBeenCalled();
    // A tela conta o que sabe.
    expect(hospedeiro.textContent).toMatch(/não foi possível confirmar/i);
  });

  it("exceção na chamada é tratada igual a erro: também não expulsa", async () => {
    servidor.resposta = "excecao";
    await abrirPortao();

    expect(onNavigate).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toMatch(/não foi possível confirmar/i);
  });

  it("dá para tentar de novo, e a segunda tentativa abre o painel", async () => {
    servidor.resposta = "erro";
    await abrirPortao();
    expect(servidor.chamadas).toBe(1);

    const botao = botaoTentarDeNovo();
    expect(botao).toBeDefined();

    servidor.resposta = "admin";
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Isto é o que o `React.lazy` memorizado tornava impossível: sair do
    // estado ruim sem recarregar a página na mão.
    expect(servidor.chamadas).toBe(2);
    expect(
      hospedeiro.querySelector('[data-testid="painel-de-verdade"]'),
    ).not.toBeNull();
  });

  it("veredito real de 'não é admin' continua expulsando — por navegação, não por recarregar a página", async () => {
    servidor.resposta = "nao-admin";
    await abrirPortao();

    // O portão continua fechando para quem não é admin: este teste é o
    // controle negativo do primeiro. Sem ele, "nunca expulsa" passaria com um
    // portão que simplesmente deixou de proteger o painel.
    expect(onNavigate).toHaveBeenCalledWith("home");
    // E agora o aviso é entregue de verdade — antes ele morria junto com a
    // página, porque o `window.location.href` corria na frente do toast.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/acesso restrito/i);
    // O painel de verdade NÃO foi montado.
    expect(
      hospedeiro.querySelector('[data-testid="painel-de-verdade"]'),
    ).toBeNull();
  });

  it("admin de verdade entra no painel", async () => {
    servidor.resposta = "admin";
    await abrirPortao();

    expect(
      hospedeiro.querySelector('[data-testid="painel-de-verdade"]'),
    ).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
