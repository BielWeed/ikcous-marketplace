// @vitest-environment jsdom
//
// A ATUALIZAÇÃO NÃO INTERROMPE A COMPRA NEM A VENDA (decisão do dono, 03/09,
// reescrita para o desenho da atualização única e obrigatória, 16/10/2026).
//
// Antes, a proteção era "esconder o aviso nas telas de compra". Agora a
// atualização é obrigatória e não há aviso para esconder: a proteção é NÃO
// INSTALAR (não recarregar) enquanto há compra, pagamento, venda ou formulário
// sujo em andamento. O combinado se mantém: os momentos sensíveis acabam
// sozinhos e a instalação acontece no ponto de parada seguinte.
//
// Controles negativos decidem o teste: um gate que nunca instala passaria em
// todos os "não instala" — por isso cada bloqueio tem o caso irmão em que,
// liberado, ELE INSTALA.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

const useUpdateCheckMock = vi.fn();
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => useUpdateCheckMock(),
}));

// O canal realtime só importa no app de verdade; aqui ele seria peso morto
// (supabase) sem efeito no comportamento sob teste.
vi.mock("@/hooks/useRealtimeUpdate", () => ({
  useRealtimeUpdate: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O `define` do Vite (`__APP_VERSION__`) mora no vite.config.ts, que o runner
// de teste usa de propósito NÃO usar. O gate lê a versão UMA vez, no nível do
// módulo: o valor precisa existir ANTES do import (vi.hoisted).
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "1.0.0-teste";
});

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import { JANELA_DE_CONSULTA_MS } from "@/lib/atualizacao/coordenacao-entre-abas";
import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import { GRACA_DE_INICIALIZACAO_MS } from "@/lib/atualizacao/instalador";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { guardarPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";
import type { View } from "@/types";

const local = new Map<string, string>();
const sessao = new Map<string, string>();
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, String(v));
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
  get length() {
    return m.size;
  },
  key: (i: number) => Array.from(m.keys()).at(i) ?? null,
});

describe("a atualização não interrompe a compra nem a venda", () => {
  let container: HTMLDivElement;
  let root: Root;
  let aplicar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    local.clear();
    sessao.clear();
    vi.stubGlobal("localStorage", stub(local));
    vi.stubGlobal("sessionStorage", stub(sessao));
    // sem canal entre abas: só esta aba (o veto local é o que se prova aqui)
    vi.stubGlobal("BroadcastChannel", undefined);
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    aplicar = vi.fn();
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion: "1.0.1-teste",
      isMandatory: false,
      performNuclearPurge: aplicar,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function montar(currentView: string, adminDirty = false) {
    act(() => {
      root.render(
        <PWAUpdateManager
          currentView={currentView as View}
          adminDirty={adminDirty}
        />,
      );
    });
  }

  async function esperar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** Passa a graça de inicialização do gate (o app ainda estava subindo). */
  const passarAGraca = () => esperar(GRACA_DE_INICIALIZACAO_MS + 100);
  const passarAConsulta = () => esperar(JANELA_DE_CONSULTA_MS + 50);

  /** A pessoa navega para `tela` (ponto de parada) e o gate decide. */
  async function navegarPara(tela: string, adminDirty = false) {
    montar(tela, adminDirty);
    await passarAConsulta();
  }

  // O gate não desenha nada: nem cartão, nem faixa, nem botão de recusar.
  it("não renderiza NADA (sem cartão, sem faixa, sem 'Depois')", async () => {
    montar("home");
    await passarAGraca();
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent).not.toMatch(
      /Nova Versão|versão nova|Atualizar|Depois/i,
    );
  });

  // (a) update disponível DURANTE o checkout: não instala.
  it("no CHECKOUT com update disponível, NÃO instala — nem com o app indo para segundo plano", async () => {
    montar("home");
    await passarAGraca();
    await navegarPara("checkout");
    expect(aplicar).not.toHaveBeenCalled();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 50);
    });
    expect(aplicar).not.toHaveBeenCalled();
  });

  // (b) a compra termina e a loja chega em tela segura: a atualização que
  // estava esperando é instalada (não se perde pelo caminho).
  it("update que chegou no checkout INSTALA quando a loja volta pra home (o apply é chamado uma vez)", async () => {
    montar("home");
    await passarAGraca();
    await navegarPara("checkout");
    expect(aplicar).not.toHaveBeenCalled();

    await navegarPara("home");
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(aplicar).toHaveBeenCalledWith(true);
  });

  // (c) fora da compra, trocando de tela: instala (o gate não é um muro geral).
  it("controle: em tela segura, ao trocar de tela, instala como esperado", async () => {
    montar("home");
    await passarAGraca();
    await navegarPara("favorites");
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  it("controle: parado numa tela segura, sem trocar de tela nem ir para segundo plano, NÃO instala (nunca no meio de uma tela parada)", async () => {
    montar("home");
    await passarAGraca();
    await esperar(10 * 60 * 1000);
    expect(aplicar).not.toHaveBeenCalled();
  });

  // As outras telas do caminho do dinheiro: mesma proteção.
  for (const tela of [
    "cart",
    "address-form",
    "order-success",
    "auth",
    "login",
  ]) {
    it(`na tela '${tela}' com update disponível, NÃO instala`, async () => {
      montar("home");
      await passarAGraca();
      await navegarPara(tela);
      expect(aplicar).not.toHaveBeenCalled();
    });
  }

  // O PDV com a venda montada é o equivalente do checkout no painel.
  it("PDV com venda montada (adminDirty): NÃO instala ao trocar de tela; sem trabalho sujo, instala (controle)", async () => {
    montar("admin-pdv", true);
    await passarAGraca();
    await navegarPara("admin-orders", true);
    expect(aplicar).not.toHaveBeenCalled();

    await navegarPara("admin-dashboard", false);
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  it("PIX PENDENTE guardado na aba: NÃO instala fora do checkout, e instala depois que o pedido sai de pendente", async () => {
    guardarPedidoPendenteDoCheckout(
      "usuario-1",
      "123e4567-e89b-12d3-a456-426614174000",
    );
    montar("profile");
    await passarAGraca();
    await navegarPara("orders");
    expect(aplicar).not.toHaveBeenCalled();

    sessao.clear();
    await navegarPara("profile");
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  it("operação sensível em andamento (upload, fila offline, venda sendo gravada): NÃO instala", async () => {
    const desmarcar = marcarOperacaoSensivel("pdv-gravando-venda");
    montar("home");
    await passarAGraca();
    await navegarPara("favorites");
    expect(aplicar).not.toHaveBeenCalled();
    desmarcar();
    await navegarPara("home");
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  it("NADA se instala nos primeiros segundos depois de montar (o PDV restaura o rascunho depois do boot)", async () => {
    montar("home");
    await navegarPara("favorites");
    expect(aplicar).not.toHaveBeenCalled();
    // passada a graça, a troca de tela que ficou pendente instala sozinha
    await passarAGraca();
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  // Sem update disponível o gate nunca instala — nem em tela segura.
  it("controle: sem update disponível, nada acontece nem trocando de tela", async () => {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: false,
      newVersion: null,
      isMandatory: false,
      performNuclearPurge: aplicar,
    });
    montar("home");
    await passarAGraca();
    await navegarPara("favorites");
    expect(aplicar).not.toHaveBeenCalled();
  });
});
