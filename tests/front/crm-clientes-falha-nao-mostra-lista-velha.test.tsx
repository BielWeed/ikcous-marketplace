// @vitest-environment jsdom
//
// Aba Clientes do CRM: quando a busca ou o filtro FALHA, o hook mantém a lista
// da consulta anterior no estado. A tela mostrava o alerta de erro e, logo
// abaixo, os clientes de antes sob o rótulo do filtro novo (com WhatsApp
// ativo) — a lojista lia como resultado do grupo. Em falha só o alerta fica.
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { ClienteDoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cliente = (sobrepor: Partial<ClienteDoCrm>): ClienteDoCrm => ({
  chave: "c-1",
  userId: null,
  nome: "Bruna Ferreira",
  whatsapp: null,
  email: null,
  pedidos: 1,
  receita: 0,
  ticketMedio: null,
  primeiraCompra: null,
  ultimaCompra: null,
  diasSemComprar: null,
  r: null,
  f: null,
  m: null,
  segmento: null,
  canalPreferido: null,
  valorEmAberto: null,
  cadastradoEm: null,
  ...sobrepor,
});

const h = vi.hoisted(() => ({
  lista: null as { total: number; clientes: ClienteDoCrm[] } | null,
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
  h.lista = null;
  h.carregando = false;
  h.erro = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar() {
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
}

it("falha com lista velha cheia: só o alerta, sem as linhas da consulta anterior", async () => {
  h.lista = { total: 340, clientes: [cliente({ nome: "Bruna Ferreira" })] };
  h.erro = "Falha de rede";
  await montar();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Não foi possível carregar os clientes",
  );
  expect(host.textContent).not.toContain("Bruna Ferreira");
  expect(host.textContent).not.toContain("de 340");
});

it("falha com lista velha vazia: não junta o alerta com 'Nenhum cliente encontrado'", async () => {
  h.lista = { total: 0, clientes: [] };
  h.erro = "Falha de rede";
  await montar();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Ainda não há nenhum cliente");
});

it("sem erro: a lista aparece normalmente (controle)", async () => {
  h.lista = { total: 1, clientes: [cliente({ nome: "Bruna Ferreira" })] };
  await montar();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Bruna Ferreira");
});

it("recarregando depois do erro: a lista velha segue esmaecida, sem alerta (stale-while-revalidate)", async () => {
  h.lista = { total: 1, clientes: [cliente({ nome: "Bruna Ferreira" })] };
  h.erro = "Falha de rede";
  h.carregando = true;
  await montar();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Bruna Ferreira");
});
