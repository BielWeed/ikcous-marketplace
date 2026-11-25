// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território pwa: o convite flutuante para
// receber avisos no celular ("Quero Receber!") tem as telas onde NÃO aparece
// cobertas por outros testes, mas três comportamentos passavam com o defeito
// plantado:
//  - o convite que já subiu tem de SAIR quando o navegador deixa de dar
//    suporte (o toque cairia num "ligar" que não faz nada);
//  - quem monta o convite é avisado quando ele sai (ao desmontar diz
//    "não estou à mostra", senão o lembrete do carrinho nunca volta);
//  - enquanto o pedido de permissão está em andamento o botão diz
//    "Ativando...", fica travado, e depois de uma recusa volta a funcionar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));

const hook = vi.hoisted(() => ({
  estado: {
    isSupported: true,
    permission: "default" as NotificationPermission,
    subscription: null as unknown,
    semConta: false,
    subscribe: vi.fn(),
  },
}));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => hook.estado,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";
import { CHAVE_DO_ADIAMENTO_DO_CONVITE } from "@/lib/avisos-do-aparelho";

const DIA_MS = 24 * 60 * 60 * 1000;

describe("convite de avisos: sai sem suporte, avisa a saída e trava enquanto ativa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    hook.estado = {
      isSupported: true,
      permission: "default",
      subscription: null,
      semConta: false,
      subscribe: vi.fn(),
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const texto = () => document.body.textContent ?? "";
  const botao = (nome: string) =>
    Array.from(document.body.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(nome),
    );

  function desenhar(
    onVisibleChange?: (visivel: boolean) => void,
    tela = "home",
  ) {
    act(() => {
      raiz.render(
        <PushNotificationBanner
          currentView={tela}
          onVisibleChange={onVisibleChange}
        />,
      );
    });
  }
  /** Passa os 2,5 s do convite surgir. */
  const surgir = () =>
    act(() => {
      vi.advanceTimersByTime(2500);
    });

  it("sem tocar em nada, o convite nasce depois de 2,5 s (controle)", () => {
    desenhar();
    expect(texto()).not.toContain("Quero Receber!");
    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(texto()).not.toContain("Quero Receber!");
    surgir();
    expect(texto()).toContain("Quero Receber!");
  });

  it("convite já na tela e o navegador deixa de dar suporte: o convite sai", () => {
    const avisos: boolean[] = [];
    desenhar((v) => avisos.push(v));
    surgir();
    expect(texto()).toContain("Quero Receber!");
    expect(avisos.at(-1)).toBe(true);

    hook.estado = { ...hook.estado, isSupported: false };
    desenhar((v) => avisos.push(v));
    expect(texto()).not.toContain("Quero Receber!");
    expect(avisos.at(-1)).toBe(false);
  });

  it.each([
    "admin",
    "admin-orders",
    "order-success",
    "cart",
    "checkout",
    "product-detail",
    "address-form",
    "order-details",
    "notifications",
  ])(
    "convite na vitrine e a cliente vai para '%s': o convite sai na hora",
    (tela) => {
      const avisos: boolean[] = [];
      desenhar((v) => avisos.push(v), "home");
      surgir();
      expect(texto()).toContain("Quero Receber!");

      desenhar((v) => avisos.push(v), tela);
      expect(texto()).not.toContain("Quero Receber!");
      expect(avisos.at(-1)).toBe(false);
      // e nem volta sozinho depois dos 2,5 s
      surgir();
      expect(texto()).not.toContain("Quero Receber!");
    },
  );

  describe("quem já está inscrita ou bloqueou não recebe o convite", () => {
    it("inscrita (com permissão): nunca vê o convite", () => {
      hook.estado = {
        ...hook.estado,
        permission: "granted",
        subscription: { endpoint: "https://push.exemplo.invalid/1" },
      };
      desenhar();
      surgir();
      expect(texto()).not.toContain("Quero Receber!");
    });

    it("permissão bloqueada (sem inscrição): nunca vê o convite", () => {
      hook.estado = { ...hook.estado, permission: "denied" };
      desenhar();
      surgir();
      expect(texto()).not.toContain("Quero Receber!");
    });

    it("permissão dada mas a inscrição não foi gravada: o convite continua sendo a única porta", () => {
      hook.estado = { ...hook.estado, permission: "granted" };
      desenhar();
      surgir();
      expect(texto()).toContain("Quero Receber!");
    });
  });

  describe("'Agora Não' adia o convite por 7 dias", () => {
    const guardar = (valor: string) =>
      localStorage.setItem(CHAVE_DO_ADIAMENTO_DO_CONVITE, valor);

    it("adiamento vigente (vence amanhã): o convite não aparece, nem de imediato nem depois", () => {
      guardar(String(Date.now() + DIA_MS));
      desenhar();
      expect(texto()).not.toContain("Quero Receber!");
      surgir();
      expect(texto()).not.toContain("Quero Receber!");
    });

    it("adiamento vencido (venceu ontem): o convite volta", () => {
      guardar(String(Date.now() - DIA_MS));
      desenhar();
      surgir();
      expect(texto()).toContain("Quero Receber!");
    });

    it("adiamento absurdo (daqui a 30 dias, relógio errado) e lixo no armazenamento: não vale", () => {
      guardar(String(Date.now() + 30 * DIA_MS));
      desenhar();
      surgir();
      expect(texto()).toContain("Quero Receber!");

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      guardar("isso-nao-e-uma-data");
      desenhar();
      surgir();
      expect(texto()).toContain("Quero Receber!");
    });

    it("tocar em 'Agora Não' esconde o convite e grava o adiamento de 7 dias", () => {
      desenhar();
      surgir();
      act(() => botao("Agora Não")?.click());
      expect(texto()).not.toContain("Quero Receber!");
      const gravado = Number(
        localStorage.getItem(CHAVE_DO_ADIAMENTO_DO_CONVITE),
      );
      expect(gravado).toBe(Date.now() + 7 * DIA_MS);

      // E ao voltar à loja (tela montada de novo) ele continua adiado.
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      desenhar();
      surgir();
      expect(texto()).not.toContain("Quero Receber!");
    });
  });

  it("ao desmontar, quem montou o convite é avisado de que ele NÃO está mais à mostra", () => {
    const avisos: boolean[] = [];
    desenhar((v) => avisos.push(v));
    surgir();
    expect(avisos.at(-1)).toBe(true);

    act(() => raiz.unmount());
    expect(avisos.at(-1)).toBe(false);
    // o afterEach desmonta de novo: recria a raiz.
    raiz = createRoot(hospedeiro);
  });

  describe("tocar em 'Quero Receber!'", () => {
    it("em andamento: 'Ativando...', botão travado, toque duplo não pede de novo", async () => {
      let concluir: (v: unknown) => void = () => {};
      hook.estado.subscribe.mockImplementation(
        () =>
          new Promise((resolver) => {
            concluir = resolver;
          }),
      );
      desenhar();
      surgir();
      expect(botao("Quero Receber!")?.disabled).toBe(false);

      await act(async () => {
        botao("Quero Receber!")?.click();
      });
      const ocupado = botao("Ativando...");
      expect(ocupado).toBeDefined();
      expect(ocupado?.disabled).toBe(true);
      expect(botao("Quero Receber!")).toBeUndefined();

      await act(async () => {
        ocupado?.click();
      });
      expect(hook.estado.subscribe).toHaveBeenCalledTimes(1);

      // Deu certo: o convite sai.
      await act(async () => {
        concluir({ endpoint: "https://push.exemplo.invalid/1" });
      });
      expect(texto()).not.toContain("Quero Receber!");
      expect(texto()).not.toContain("Ativando...");
    });

    it("não inscreveu (permissão recusada): o botão VOLTA a funcionar e o convite fica", async () => {
      hook.estado.subscribe.mockResolvedValue(null);
      desenhar();
      surgir();

      await act(async () => {
        botao("Quero Receber!")?.click();
      });
      expect(texto()).toContain("Quero Receber!");
      expect(botao("Quero Receber!")?.disabled).toBe(false);
      expect(botao("Ativando...")).toBeUndefined();

      // E dá para tentar outra vez.
      await act(async () => {
        botao("Quero Receber!")?.click();
      });
      expect(hook.estado.subscribe).toHaveBeenCalledTimes(2);
    });

    it("o pedido falhou com erro: o botão volta e o convite fica", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      hook.estado.subscribe.mockRejectedValue(new Error("falhou"));
      desenhar();
      surgir();

      await act(async () => {
        botao("Quero Receber!")?.click();
      });
      expect(botao("Quero Receber!")?.disabled).toBe(false);
      expect(texto()).toContain("Quero Receber!");
    });
  });
});
