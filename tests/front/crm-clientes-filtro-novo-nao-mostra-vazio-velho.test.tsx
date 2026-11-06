// @vitest-environment jsdom
//
// Aba Clientes do CRM: depois de uma consulta SEM resultado, o hook guarda a
// lista vazia até a nova chegar. Ao trocar o filtro, a tela dizia "Ainda não
// há nenhum cliente" (ou "Nenhum cliente em …") com a lista nova ainda a
// caminho. A lista vazia que pertence ao filtro anterior conta como
// "carregando": esqueleto, nunca o aviso de vazio.
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { ClienteDoCrm } from "@/types/crm";
import type { SegmentoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

it("loja sem clientes: lista vazia da própria consulta diz que ainda não há ninguém (controle)", async () => {
  h.lista = { total: 0, clientes: [] };
  await montar(null);
  expect(host.textContent).toContain("Ainda não há nenhum cliente");
});

it("trocou o filtro e a lista vazia é a ANTIGA: mostra carregando, não 'Ainda não há nenhum cliente'", async () => {
  h.lista = { total: 0, clientes: [] };
  await montar(null);
  expect(host.textContent).toContain("Ainda não há nenhum cliente");

  // O hook ainda não terminou: segue com a lista vazia anterior.
  h.carregando = true;
  await montar("campeoes");
  expect(host.textContent).not.toContain("Ainda não há nenhum cliente");
  expect(host.textContent).not.toContain("Nenhum cliente em");
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
});

it("mesmo antes de o hook marcar 'carregando', a lista vazia antiga não vira aviso de vazio", async () => {
  h.lista = { total: 0, clientes: [] };
  await montar(null);

  h.carregando = false;
  await montar("campeoes");
  expect(host.textContent).not.toContain("Ainda não há nenhum cliente");
  expect(host.textContent).not.toContain("Nenhum cliente em");
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
});

it("chegou a lista nova e vazia do filtro novo: aí sim o aviso de vazio aparece", async () => {
  h.lista = { total: 0, clientes: [] };
  await montar(null);
  h.carregando = true;
  await montar("campeoes");

  h.carregando = false;
  h.lista = { total: 0, clientes: [] };
  await montar("campeoes");
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  expect(host.textContent).toContain("Nenhum cliente em");
});

it("falha ao trocar o filtro com lista vazia antiga: só o alerta, sem esqueleto", async () => {
  h.lista = { total: 0, clientes: [] };
  await montar(null);
  h.carregando = false;
  h.erro = "Falha de rede";
  await montar("campeoes");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
});

it("busca nova sobre lista vazia: enquanto a lista nova carrega, nenhum aviso de vazio", async () => {
  vi.useFakeTimers();
  try {
    h.lista = { total: 0, clientes: [] };
    await montar(null);
    const campo = host.querySelector<HTMLInputElement>("#crm-busca-cliente")!;
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    h.carregando = true;
    await act(async () => {
      atribuir?.call(campo, "zzz");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(host.textContent).not.toContain("Ainda não há nenhum cliente");
    expect(host.textContent).not.toContain("Nenhum cliente encontrado");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
