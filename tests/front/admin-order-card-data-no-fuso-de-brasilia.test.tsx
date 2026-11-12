// @vitest-environment jsdom
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let limpar = () => {};
afterEach(() => {
  limpar();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// 02:30 UTC ainda é 23:30 do dia anterior em Brasília: o dia de lá (11) difere
// do dia UTC (12), então o fuso do aparelho muda o texto se a lista o usar.
const CRIADO_EM = "2026-11-12T02:30:00.000Z";

it.each(["UTC", "Asia/Tokyo", "America/Sao_Paulo"])(
  "a data do cartão é a de Brasília com o aparelho em %s, a mesma da ficha",
  (fusoDoAparelho) => {
    vi.stubEnv("TZ", fusoDoAparelho);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T05:30:00.000Z"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    limpar = () => {
      act(() => root.unmount());
      host.remove();
    };
    const order = {
      id: "p-ficticio-fuso",
      status: "pending",
      items: [],
      createdAt: CRIADO_EM,
    } as unknown as Order;
    act(() =>
      root.render(
        <AdminOrderCard
          order={order}
          viewMode="compact"
          onSelect={() => {}}
          onWhatsApp={() => {}}
          onRegistrarPagamento={() => {}}
          registrandoPagamento={false}
        />,
      ),
    );
    // Mesmas opções da ficha (OrderDetail), no calendário de Brasília.
    const dataDeBrasilia = new Date(CRIADO_EM).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(dataDeBrasilia).toContain("11/11");
    expect(host.textContent).toContain(` · ${dataDeBrasilia}`);
    expect(host.textContent).not.toContain("12/11");
  },
);
