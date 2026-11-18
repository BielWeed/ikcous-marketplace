// @vitest-environment jsdom
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { SegmentoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paginasPedidas: [] as number[],
  atualizar: vi.fn(),
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: (args: { pagina: number }) => {
    h.paginasPedidas.push(args.pagina);
    return {
      lista: { total: 65, clientes: [] },
      carregando: false,
      erro: null,
      atualizar: h.atualizar,
    };
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  h.paginasPedidas = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function montar(segmento: SegmentoCrm | null = null, sinal = 0) {
  await act(async () =>
    root.render(
      <ClientesDoCrm
        segmentos={[]}
        carregandoSegmentos={false}
        segmento={segmento}
        aoMudarSegmento={vi.fn()}
        active
        onNavigate={vi.fn()}
        sinalDeAtualizacao={sinal}
      />,
    ),
  );
}

async function irParaPagina3() {
  const proximo = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Próximo"),
  );
  if (!proximo) throw new Error("botão Próximo ausente");
  await act(async () => proximo.click());
  await act(async () => proximo.click());
  expect(h.paginasPedidas.at(-1)).toBe(2);
}

async function buscar(texto: string) {
  const campo = host.querySelector<HTMLInputElement>("#crm-busca-cliente")!;
  const atribuir = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    atribuir?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
}

it("apagar a busca mantém a página 1, sem ressuscitar a página 3 de Todos", async () => {
  await montar();
  await irParaPagina3();
  await buscar("Ana");
  expect(h.paginasPedidas.at(-1)).toBe(0);
  await buscar("");
  expect(h.paginasPedidas.at(-1)).toBe(0);
});

it("voltar ao filtro Todos mantém a página 1", async () => {
  await montar();
  await irParaPagina3();
  await montar("campeoes");
  expect(h.paginasPedidas.at(-1)).toBe(0);
  await montar();
  expect(h.paginasPedidas.at(-1)).toBe(0);
});

it("atualizar os dados sem trocar o filtro preserva a página 3", async () => {
  await montar();
  expect(h.paginasPedidas).toEqual([0]);
  await irParaPagina3();
  await montar(null, 1);
  expect(h.paginasPedidas.at(-1)).toBe(2);
});
