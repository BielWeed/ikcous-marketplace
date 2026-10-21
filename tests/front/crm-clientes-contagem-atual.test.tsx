// @vitest-environment jsdom
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { SegmentoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lista: { total: 3, clientes: [] },
  carregando: false,
  erro: null as string | null,
  atualizar: vi.fn(),
}));
vi.mock("@/hooks/useCrm", () => ({ useCrmClientes: () => h }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  h.lista = { total: 3, clientes: [] };
  h.carregando = false;
  h.erro = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function montar(segmento: SegmentoCrm | null) {
  await act(async () =>
    root.render(
      <ClientesDoCrm
        segmentos={[]}
        carregandoSegmentos={false}
        segmento={segmento}
        aoMudarSegmento={vi.fn()}
        active
        onNavigate={vi.fn()}
        sinalDeAtualizacao={0}
      />,
    ),
  );
}
function todos() {
  return host
    .querySelector('[aria-label="Filtrar por grupo"] button')
    ?.textContent?.trim();
}
function contagem(rotulo: string) {
  return host.querySelector(
    `[role="group"][aria-label="${rotulo}"] .tabular-nums`,
  )?.textContent;
}

it.each(["antes da consulta", "pendente", "falhou"])(
  "filtro → Todos: não reaproveita o total do grupo (%s)",
  async (estado) => {
    await montar("em_risco");
    expect(contagem("Na lista filtrada")).toBe("3");
    h.carregando = estado === "pendente";
    h.erro = estado === "falhou" ? "Falha de rede" : null;
    await montar(null);
    expect(todos()).toBe("Todos —");
    expect(contagem("Na sua lista")).toBe("—");

    h.lista = { total: 23, clientes: [] };
    h.carregando = false;
    h.erro = null;
    await montar(null);
    expect(todos()).toBe("Todos 23");
    expect(contagem("Na sua lista")).toBe("23");
  },
);

it("geral → grupo: falha não apresenta total geral como filtrado", async () => {
  h.lista = { total: 23, clientes: [] };
  await montar(null);
  expect(contagem("Na sua lista")).toBe("23");
  h.erro = "Falha de rede";
  await montar("novos");
  expect(todos()).toBe("Todos");
  expect(contagem("Na lista filtrada")).toBe("—");
});

it("geral → busca: falha não apresenta total geral como filtrado", async () => {
  vi.useFakeTimers();
  h.lista = { total: 23, clientes: [] };
  await montar(null);
  expect(contagem("Na sua lista")).toBe("23");
  h.erro = "Falha de rede";
  const campo = host.querySelector("#crm-busca-cliente") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, "ana");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(400));
  expect(todos()).toBe("Todos");
  expect(contagem("Na lista filtrada")).toBe("—");
});
