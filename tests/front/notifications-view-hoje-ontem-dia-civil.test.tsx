// @vitest-environment jsdom
//
// "Hoje" e "Ontem" são dias de calendário, não janelas de 24 horas.
//
// Até 25/08/2026 formatNotificationTime media a diferença em MILISSEGUNDOS
// com Math.floor (e Math.abs): um aviso criado às 23:50 de ontem, lido às
// 00:10 de hoje, tinha diffDays = 0 e aparecia como "Hoje às 23:50" — data
// mentirosa na tela. O Math.abs ainda mascarava created_at no futuro (clock
// skew) como "Hoje". Este teste prende a comparação por DIA CIVIL: ontem é
// ontem mesmo com 20 minutos de distância; data no futuro cai no formato
// completo em vez de "Hoje".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "@/types";

const agoraFixo = new Date(2026, 7, 25, 0, 10, 0); // 25/08/2026 00:10 local

function notificacaoCriadaEm(data: Date): Notification {
  return {
    id: `notif-${data.getTime()}`,
    title: "Aviso da loja",
    message: "Mensagem de teste.",
    type: "system",
    read: false,
    created_at: data.toISOString(),
  };
}

// Declarada ANTES do vi.mock (na ordem do fonte) porque a fábrica a lê —
// ela só roda no import, dentro de cada teste, quando o valor corrente é o
// reatribuído pelo caso da vez.
let notificacaoDaVez: Notification = notificacaoCriadaEm(agoraFixo);

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: [notificacaoDaVez],
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — 'Hoje'/'Ontem' por dia civil, não por 24h", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Só o Date é falso: o resto dos timers do React continua real.
    vi.useFakeTimers({ now: agoraFixo.getTime(), toFake: ["Date"] });
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

  async function renderizar() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("criada ontem às 23:50, lida hoje às 00:10: é ONTEM", async () => {
    notificacaoDaVez = notificacaoCriadaEm(new Date(2026, 7, 24, 23, 50, 0));
    const texto = await renderizar();

    // Âncora: a notificação renderizou de verdade.
    expect(texto).toContain("Aviso da loja");
    expect(texto).toContain("Ontem às 23:50");
    expect(texto).not.toContain("Hoje às");
  });

  it("criada hoje às 09:00, lida hoje às 21:00: é HOJE", async () => {
    vi.setSystemTime(new Date(2026, 7, 25, 21, 0, 0).getTime());
    notificacaoDaVez = notificacaoCriadaEm(new Date(2026, 7, 25, 9, 0, 0));
    const texto = await renderizar();

    expect(texto).toContain("Hoje às 09:00");
  });

  it("criada há dois dias: formato completo, sem 'Hoje' nem 'Ontem'", async () => {
    notificacaoDaVez = notificacaoCriadaEm(new Date(2026, 7, 23, 12, 0, 0));
    const texto = await renderizar();

    expect(texto).toContain("Aviso da loja");
    expect(texto).not.toContain("Hoje às");
    expect(texto).not.toContain("Ontem às");
  });
});
