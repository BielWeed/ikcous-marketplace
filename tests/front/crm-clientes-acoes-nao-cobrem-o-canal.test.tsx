// @vitest-environment jsdom
//
// Relatórios › Clientes no computador: a coluna "Ações" é estreita (~165px a
// 1280px, com o menu lateral aberto) e, de `xl` em diante, os dois botões
// voltam com texto (~260px). Em linha única eles transbordavam para a
// ESQUERDA (`justify-end`) e o botão do WhatsApp cobria o "App (online)" da
// coluna Canal. Medido no Chromium com o CSS real: a 1280px e a 1366px o
// WhatsApp começava antes do fim do texto do canal. Com `xl:flex-wrap` o
// segundo botão desce para a linha de baixo e nada passa da coluna. O jsdom
// não faz layout: o teste garante a classe que impede o transbordo.
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
  h.lista = { total: 1, clientes: [cliente] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("os botões da linha quebram em duas linhas em vez de cobrir o Canal", async () => {
  await act(async () =>
    root.render(
      <ClientesDoCrm
        segmentos={[]}
        carregandoSegmentos={false}
        segmento={null}
        aoMudarSegmento={vi.fn()}
        active
        onNavigate={vi.fn()}
        sinalDeAtualizacao={0}
      />,
    ),
  );
  const whatsapp = host.querySelector('a[href*="wa.me"]');
  expect(whatsapp).not.toBeNull();
  const acoes = whatsapp?.parentElement as HTMLElement;
  expect(acoes.className).toMatch(/(^|\s)xl:flex-wrap(\s|$)/);
});
