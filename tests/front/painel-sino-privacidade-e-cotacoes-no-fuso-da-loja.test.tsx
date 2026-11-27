// @vitest-environment jsdom
//
// O cartão e a ficha do pedido mostram a hora de Brasília (`OrderDetail`,
// `horario-relativo.ts`), e o sino, a privacidade e o histórico de cotações
// mostravam a hora do APARELHO. Lojista com o aparelho em Manaus: o pedido
// dizia "00:30" e o sino, para o mesmo pedido, "26/11 23:30".
//
// 00:30 de Brasília de 27/11/2026 = 03:30 UTC = 23:30 de Manaus de 26/11.
// O fuso do processo é trocado por `process.env.TZ` (o Node relê na hora) e
// volta ao que era depois de cada teste — mesmo padrão de
// `painel-hora-e-validade-no-fuso-da-loja.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatarDataDoPedido } from "@/lib/pedidos-de-privacidade";
import type { Aviso } from "@/utils/avisos-do-lojista";

const PEDIDO_00H30_BRT = "2026-11-27T03:30:00.000Z";

const { estado } = vi.hoisted(() => ({
  estado: {
    avisos: [] as Aviso[],
    logs: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/hooks/useAvisosDoLojista", () => ({
  useAvisosDoLojista: () => ({
    avisos: estado.avisos,
    quantidadeNoCracha: estado.avisos.length,
    carregando: false,
    fontesComFalha: [],
    listasCortadas: [],
    recarregar: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "shipping_calculation_logs") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: estado.logs, error: null }),
            }),
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    functions: {
      invoke: () =>
        Promise.resolve({
          data: {
            success: true,
            modo: "multi",
            ligados: ["melhor_envio"],
            provedores: {},
          },
          error: null,
        }),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const FUSOS = ["America/Manaus", "UTC", "America/Sao_Paulo"];

describe("painel — sino, privacidade e cotações no fuso da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    estado.avisos = [];
    estado.logs = [];
    process.env.TZ = fusoDaMaquina;
  });

  it.each(FUSOS)(
    "sino: aparelho em %s mostra o pedido às 00:30 de 27/11 (Brasília)",
    async (fuso) => {
      process.env.TZ = fuso;
      estado.avisos = [
        {
          id: "pedido-ped-1",
          tipo: "pedido",
          titulo: "Pedido de Maria esperando você",
          detalhe: "R$ 90,00",
          quando: PEDIDO_00H30_BRT,
          destino: { view: "admin-orders", id: "ped-1" },
          contaNoCracha: true,
        },
      ];
      const { AdminNotificationsView } = await import(
        "@/views/admin/AdminNotificationsView"
      );
      await act(async () => {
        raiz.render(<AdminNotificationsView onNavigate={vi.fn()} />);
      });
      const quando =
        hospedeiro.querySelector(`time[datetime="${PEDIDO_00H30_BRT}"]`)
          ?.textContent ?? "";
      expect(quando).toContain("27/11");
      expect(quando).toContain("00:30");
      expect(quando).not.toContain("23:30");
    },
  );

  it.each(FUSOS)(
    "privacidade: aparelho em %s mostra o dia 27/11/2026 (Brasília)",
    (fuso) => {
      process.env.TZ = fuso;
      expect(formatarDataDoPedido(PEDIDO_00H30_BRT)).toBe("27/11/2026");
    },
  );

  it.each(FUSOS)(
    "histórico de cotações: aparelho em %s mostra 27/11 às 00:30 (Brasília)",
    async (fuso) => {
      process.env.TZ = fuso;
      estado.logs = [
        {
          id: "l1",
          created_at: PEDIDO_00H30_BRT,
          destination_cep: "38400001",
          provider: "melhor_envio",
          response_time_ms: 300,
          status: "success",
          error_message: null,
        },
      ];
      const { HistoricoCotacoesSection } = await import(
        "@/components/admin/settings/HistoricoCotacoesCard"
      );
      await act(async () => {
        raiz.render(<HistoricoCotacoesSection />);
      });
      await act(async () => {
        await esperar();
      });
      await act(async () => {
        await esperar();
      });
      const quando =
        hospedeiro.querySelector("tbody tr td")?.textContent?.trim() ?? "";
      expect(quando).toContain("27/11");
      expect(quando).toContain("00:30");
      expect(quando).not.toContain("23:30");
    },
  );
});
