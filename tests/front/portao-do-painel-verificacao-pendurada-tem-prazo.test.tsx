// @vitest-environment jsdom
//
// O portão do painel pergunta ao servidor "esta pessoa é administradora?"
// (`is_admin`) a cada vez que o painel monta. Rede que conecta e não responde:
// a pergunta saía e não voltava, e a tela ficava em "Verificando permissões..."
// sem botão e sem saída — a tela "Não foi possível confirmar seu acesso" (com
// "Tentar de novo" e "Voltar à loja") só aparecia se a chamada FALHASSE, nunca
// se ficasse pendurada.
//
// Agora a pergunta tem prazo (15 s). Estourou = "o servidor não respondeu", NÃO
// "o servidor disse que não": mostra a tela com saída. E o portão continua
// FECHADO (fail-closed): nunca abre o painel por demora, nem com resposta
// tardia — quem decide é o servidor, numa pergunta que voltou a tempo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

// Cada chamada de `is_admin` entra em `pendentes`; o teste decide se e quando
// o servidor responde (nunca = rede pendurada).
const { servidor } = vi.hoisted(() => ({
  servidor: {
    pendentes: [] as Array<(resposta: unknown) => void>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome !== "is_admin")
        return Promise.resolve({ data: null, error: null });
      return new Promise((resolve) => {
        servidor.pendentes.push(resolve);
      });
    },
  },
}));

vi.mock("@/components/layouts/AdminArea", () => ({
  AdminArea: () => <div data-testid="painel-de-verdade">PAINEL ABERTO</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_MS = 15_000;

describe("Portão do painel — verificação pendurada tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    toastError.mockClear();
    onNavigate.mockClear();
    servidor.pendentes.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
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
  }

  const passar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  const painelAberto = () =>
    hospedeiro.querySelector('[data-testid="painel-de-verdade"]');
  const carregando = () =>
    hospedeiro.querySelector('[data-testid="carregando"]');
  const botao = (texto: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      texto.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;

  it("pergunta que nunca volta: antes do prazo segue verificando; no prazo mostra 'Tentar de novo', sem expulsar e sem abrir o painel", async () => {
    await abrirPortao();
    expect(servidor.pendentes).toHaveLength(1);

    await passar(PRAZO_MS - 1000);
    expect(carregando()).not.toBeNull();
    expect(botao(/tentar de novo/i)).toBeUndefined();

    await passar(1500);

    expect(carregando()).toBeNull();
    expect(hospedeiro.textContent).toMatch(/não foi possível confirmar/i);
    expect(botao(/tentar de novo/i)).toBeDefined();
    expect(botao(/voltar à loja/i)).toBeDefined();
    // Não é veredito: ninguém foi acusado nem mandado embora.
    expect(onNavigate).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toMatch(/acesso restrito/i);
    // E o painel NÃO abriu por demora.
    expect(painelAberto()).toBeNull();
  });

  it("fail-closed: resposta 'é admin' que chega DEPOIS do prazo não abre o painel", async () => {
    await abrirPortao();
    await passar(PRAZO_MS + 500);
    expect(botao(/tentar de novo/i)).toBeDefined();

    await act(async () => {
      servidor.pendentes[0]({ data: true, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(painelAberto()).toBeNull();
    expect(botao(/tentar de novo/i)).toBeDefined();
  });

  it("'Tentar de novo' depois do prazo pergunta outra vez, e a resposta que volta a tempo abre o painel", async () => {
    await abrirPortao();
    await passar(PRAZO_MS + 500);

    await act(async () => {
      botao(/tentar de novo/i)?.click();
    });
    expect(servidor.pendentes).toHaveLength(2);
    expect(carregando()).not.toBeNull();

    await act(async () => {
      servidor.pendentes[1]({ data: true, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(painelAberto()).not.toBeNull();

    // O relógio da segunda tentativa foi desarmado: passar o prazo não derruba o painel.
    await passar(PRAZO_MS * 2);
    expect(painelAberto()).not.toBeNull();
  });

  it("a resposta tardia da primeira pergunta não pisa na segunda (que ainda aguarda)", async () => {
    await abrirPortao();
    await passar(PRAZO_MS + 500);
    await act(async () => {
      botao(/tentar de novo/i)?.click();
    });
    expect(carregando()).not.toBeNull();

    await act(async () => {
      servidor.pendentes[0]({ data: false, error: null }); // velha, "não é admin"
      await vi.advanceTimersByTimeAsync(0);
    });

    // Ainda verificando a segunda; nem expulsou, nem avisou acesso restrito.
    expect(carregando()).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("controle: veredito real de 'não é admin' dentro do prazo continua expulsando", async () => {
    await abrirPortao();
    await act(async () => {
      servidor.pendentes[0]({ data: false, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onNavigate).toHaveBeenCalledWith("home");
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/acesso restrito/i);
    expect(painelAberto()).toBeNull();
  });

  it("controle: 'é admin' dentro do prazo abre o painel e o relógio não derruba depois", async () => {
    await abrirPortao();
    await passar(2000);
    await act(async () => {
      servidor.pendentes[0]({ data: true, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(painelAberto()).not.toBeNull();

    await passar(PRAZO_MS * 2);
    expect(painelAberto()).not.toBeNull();
    expect(botao(/tentar de novo/i)).toBeUndefined();
  });
});
