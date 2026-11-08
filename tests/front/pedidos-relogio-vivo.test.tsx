// @vitest-environment jsdom
import { FunilEPedidosDoCrm } from "@/components/admin/crm/FunilEPedidosDoCrm";
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { useAgoraDoPainel } from "@/hooks/useAgoraDoPainel";
import { lerVisaoDoCrm } from "@/lib/crm";
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
  vi.restoreAllMocks();
});

it("o primeiro quadro já lê a hora certa antes de assinar, inclusive sem consumidor anterior", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const quadros = vi.fn();
  function Sonda() {
    const agora = useAgoraDoPainel();
    quadros(agora);
    return <p>{agora}</p>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  limpar = () => {
    act(() => root.unmount());
    host.remove();
  };
  act(() => root.render(<Sonda />));
  expect(quadros.mock.calls[0][0]).toBe(Date.now());
});

it("o cartão memorizado acompanha os minutos sem interação", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  limpar = () => {
    act(() => root.unmount());
    host.remove();
  };
  const order = {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    customer: { name: "Pessoa fictícia", whatsapp: "" },
    subtotal: 10,
    shipping: 0,
    discount: 0,
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    items: [],
    total: 10,
    status: "pending",
    paymentMethod: "cash",
    createdAt: new Date().toISOString(),
  } as Order;
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
  expect(host.textContent).toContain("agora mesmo");
  act(() => vi.advanceTimersByTime(40 * 60_000));
  expect(host.textContent).toContain("há 40 min");
});

it.each([
  {
    inicio: "2026-11-07T23:59:00",
    criado: "2026-11-07T20:00:00",
    antes: "hoje",
    depois: "ontem",
  },
  {
    inicio: "2026-11-07T12:00:00",
    criado: "2026-11-04T12:01:00",
    antes: null,
    depois: "Este pedido espera você há 3 dias.",
  },
])(
  "o relógio atualiza a virada do dia e o aviso de espera: $depois",
  ({ inicio, criado, antes, depois }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(inicio));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    limpar = () => {
      act(() => root.unmount());
      host.remove();
    };
    const order = {
      id: "p-ficticio",
      status: "pending",
      items: [],
      createdAt: new Date(criado).toISOString(),
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
    if (antes) expect(host.textContent).toContain(antes);
    else expect(host.textContent).not.toContain(depois);
    act(() => vi.advanceTimersByTime(60_000));
    expect(host.textContent).toContain(depois);
  },
);

it("fila do CRM recalcula a idade ao voltar mesmo sem resposta nova", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  limpar = () => {
    act(() => root.unmount());
    host.remove();
  };
  const visao = lerVisaoDoCrm({
    kpis: {},
    pipeline: [
      {
        status: "pending",
        quantidade: 1,
        mais_antigo_em: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  });
  act(() =>
    root.render(
      <FunilEPedidosDoCrm
        visao={visao}
        carregando={false}
        onNavigate={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("mais antigo há 1 minuto");
  vi.setSystemTime(new Date(Date.now() + 39 * 60_000));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(host.textContent).toContain("mais antigo há 40 minutos");
});

it("dois consumidores compartilham o pulso; escondida não redesenha e voltar acerta na hora", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  let visivel = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visivel ? "visible" : "hidden",
  );
  const renders = vi.fn();
  function Sonda() {
    const agora = useAgoraDoPainel();
    renders();
    return <p>{agora}</p>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  limpar = () => {
    act(() => root.unmount());
    host.remove();
  };
  act(() =>
    root.render(
      <>
        <Sonda />
        <Sonda />
      </>,
    ),
  );
  renders.mockClear();
  act(() => vi.advanceTimersByTime(60_000));
  expect(renders).toHaveBeenCalledTimes(2);
  expect([...host.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
    String(Date.now()),
    String(Date.now()),
  ]);
  visivel = false;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  renders.mockClear();
  act(() => vi.advanceTimersByTime(10 * 60_000));
  expect(renders).not.toHaveBeenCalled();
  visivel = true;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect([...host.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
    String(Date.now()),
    String(Date.now()),
  ]);
});
