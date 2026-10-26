// @vitest-environment jsdom
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  total: 45,
  paginasPedidas: [] as number[],
  atualizar: vi.fn(),
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: (args: { pagina: number }) => {
    h.paginasPedidas.push(args.pagina);
    return {
      lista: { total: h.total, clientes: [] },
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
  h.total = 45;
  h.paginasPedidas = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar(sinal: number) {
  await act(async () =>
    root.render(
      <ClientesDoCrm
        segmentos={[]}
        carregandoSegmentos={false}
        segmento={null}
        aoMudarSegmento={vi.fn()}
        active
        onNavigate={vi.fn()}
        sinalDeAtualizacao={sinal}
      />,
    ),
  );
}

function tocar(texto: string) {
  const botao = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`botão ${texto} ausente`);
  return act(async () => botao.click());
}

it("grupo que encolhe depois de Sincronizar volta para a última página que existe", async () => {
  await montar(0);
  await tocar("Próximo");
  await tocar("Próximo");
  expect(h.paginasPedidas.at(-1)).toBe(2);

  // Sincronizar: o grupo caiu para 20 clientes (só a página 1 existe).
  h.total = 20;
  await montar(1);
  expect(h.paginasPedidas.at(-1)).toBe(0);
});
