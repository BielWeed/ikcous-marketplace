// @vitest-environment jsdom
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { ClienteDoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cliente = {
  chave: "u1",
  userId: "u1",
  nome: "Cliente fictícia",
  whatsapp: "11999990000",
  email: null,
  pedidos: 2,
  receita: 100,
  ticketMedio: 50,
  primeiraCompra: "2026-10-01T12:00:00Z",
  ultimaCompra: "2026-11-01T12:00:00Z",
  diasSemComprar: 10,
  r: 4,
  f: 3,
  m: 3,
  segmento: "leais",
  canalPreferido: "online",
  emAberto: null,
  cadastradoEm: "2026-09-01T12:00:00Z",
} as unknown as ClienteDoCrm;

const h = vi.hoisted(() => ({
  lista: { total: 1, clientes: [] as unknown[] },
  carregando: false,
  erro: null as string | null,
  atualizar: vi.fn(),
  pagina: 0,
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: ({ pagina }: { pagina: number }) => {
    h.pagina = pagina;
    return h;
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
  h.carregando = false;
  h.lista = { total: 1, clientes: [cliente] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar(segmento: "leais" | null) {
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

const proximo = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((botao) =>
    botao.textContent?.trim().startsWith("Próximo"),
  );

it("as duas ações ficam bloqueadas até chegar a lista do filtro novo", async () => {
  h.lista = {
    total: 65,
    clientes: Array.from({ length: 20 }, (_, i) => ({
      ...cliente,
      chave: `cliente-${i}`,
    })),
  };
  await montar(null);
  expect(proximo()?.disabled).toBe(false);
  expect(host.querySelector('a[href*="wa.me"]')).not.toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>('[title^="Ver cliente"]')?.disabled,
  ).toBe(false);

  const anuncio = () => host.querySelector('[aria-live="polite"]');
  const regiao = anuncio();
  expect(regiao?.textContent).toBe("");

  await montar("leais"); // Mesmo antes de o hook marcar carregando.
  expect(anuncio()).toBe(regiao);
  expect(regiao?.textContent).toBe("Atualizando a lista…");
  expect(proximo() === undefined || proximo()?.disabled).toBe(true);
  expect(
    host.querySelector('[data-testid="paginacao-admin"]')?.textContent ?? "",
  ).not.toContain("65");
  for (const titulo of ["WhatsApp", "Ver cliente"]) {
    const acao = host.querySelector<HTMLButtonElement>(
      `button[title^="${titulo}"]`,
    );
    expect(acao?.disabled).toBe(true);
    expect(acao?.getAttribute("aria-disabled")).toBe("true");
  }
  expect(host.querySelector('a[href*="wa.me"]')).toBeNull();

  h.lista = { total: 1, clientes: [cliente] };
  await montar("leais");
  expect(anuncio()).toBe(regiao);
  expect(regiao?.textContent).toBe("");
  expect(host.querySelector('a[href*="wa.me"]')).not.toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>('[title^="Ver cliente"]')?.disabled,
  ).toBe(false);
});

it("Próximo mantém o foco ao ler outra página do mesmo filtro", async () => {
  h.lista = { total: 65, clientes: [cliente] };
  await montar(null);
  const origem = proximo();
  expect(origem?.disabled).toBe(false);
  origem?.focus();
  // Clique nativo que o navegador produz ao apertar Enter sobre o botão.
  await act(async () => origem?.click());
  expect(h.pagina).toBe(1);

  h.carregando = true;
  await montar(null);
  const durante = proximo();
  const bloqueado = durante?.getAttribute("aria-disabled");
  await act(async () => durante?.click());
  expect(h.pagina).toBe(1);

  h.carregando = false;
  h.lista = { total: 65, clientes: [{ ...cliente, chave: "pagina-2" }] };
  await montar(null);
  expect(proximo()?.disabled).toBe(false);
  expect(document.activeElement === proximo()).toBe(true);
  expect(proximo()).toBe(durante);
  expect(bloqueado).toBe("true");
});
