// @vitest-environment jsdom
//
// Rede "pendurada" conecta e nunca responde. A leitura da lista de Devoluções
// (`admin_devolucoes_listar`) e a da ficha (`devolucao_detalhe`) ficavam sem
// prazo: a lista parava em "Carregando..." (com "Mostrar mais" apagado) e a
// ficha em "Carregando devolução..." sem o erro com "Tentar de novo". Aqui o
// estouro do prazo cai no erro que a tela já sabe mostrar.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useDevolucaoAdmin,
  useDevolucoesAdmin,
} from "@/hooks/useDevolucoesAdmin";
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

const { rpc, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ createSignedUrl }) } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const LISTA = {
  total: 1,
  contagem: { recebida: 1 },
  itens: [
    {
      id: "dev-1",
      protocolo: "DV-1",
      order_id: "pedido-1",
      cliente_nome: "Maria Teste",
      cliente_whatsapp: "34999999999",
      tipo: "arrependimento",
      motivo: "tamanho_pequeno",
      status: "recebida",
      resolucao_desejada: "reembolso",
      metodo_retorno: "envio_proprio",
      modalidade: "nacional",
      valor_itens: 10,
      prazo_ate: "2026-10-01",
      created_at: "2026-09-26T10:00:00Z",
    },
  ],
};

const FICHA = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "recebida",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: null,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-10-16T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let lista: ReturnType<typeof useDevolucoesAdmin>;
let ficha: ReturnType<typeof useDevolucaoAdmin>;

function SondaDaLista() {
  const lida = useDevolucoesAdmin({ status: null, busca: "" });
  useEffect(() => {
    lista = lida;
  });
  return null;
}

function SondaDaFicha() {
  const lida = useDevolucaoAdmin("dev-a");
  useEffect(() => {
    ficha = lida;
  });
  return null;
}

async function montar(tela: "lista" | "ficha") {
  await act(async () => {
    raiz.render(tela === "lista" ? <SondaDaLista /> : <SondaDaFicha />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  createSignedUrl.mockResolvedValue({ data: null, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("lista de devoluções: consulta que nunca responde", () => {
  it("vira erro e solta o carregando depois do prazo, e dá para tentar de novo", async () => {
    rpc.mockReturnValueOnce(pendente().promessa);
    await montar("lista");
    expect(lista.carregando).toBe(true);
    expect(lista.erro).toBe(false);

    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);
    expect(lista.carregando).toBe(true);
    expect(lista.erro).toBe(false);

    await passar(1);
    expect(lista.erro).toBe(true);
    expect(lista.carregando).toBe(false);

    rpc.mockResolvedValueOnce({ data: LISTA, error: null });
    await act(async () => lista.recarregar());
    expect(lista.erro).toBe(false);
    expect(lista.carregando).toBe(false);
    expect(lista.itens.map((i) => i.id)).toEqual(["dev-1"]);
  });

  it("resposta tardia, depois do erro, não mexe na lista", async () => {
    const lenta = pendente();
    rpc.mockReturnValueOnce(lenta.promessa);
    await montar("lista");
    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(lista.erro).toBe(true);

    await act(async () => {
      lenta.resolver({ data: LISTA, error: null });
      await Promise.resolve();
    });
    expect(lista.erro).toBe(true);
    expect(lista.itens).toEqual([]);
    expect(lista.carregando).toBe(false);
  });

  it("responde cedo: sem erro e sem relógio pendente", async () => {
    rpc.mockResolvedValueOnce({ data: LISTA, error: null });
    await montar("lista");
    expect(lista.erro).toBe(false);
    expect(lista.carregando).toBe(false);
    expect(lista.itens).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erro explícito do servidor segue virando erro", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
    await montar("lista");
    expect(lista.erro).toBe(true);
    expect(lista.carregando).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ficha da devolução: consulta que nunca responde", () => {
  it("vira erro e solta o carregando depois do prazo, e dá para tentar de novo", async () => {
    rpc.mockReturnValueOnce(pendente().promessa);
    await montar("ficha");
    expect(ficha.carregando).toBe(true);
    expect(ficha.erro).toBe(false);

    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);
    expect(ficha.carregando).toBe(true);
    expect(ficha.erro).toBe(false);

    await passar(1);
    expect(ficha.erro).toBe(true);
    expect(ficha.carregando).toBe(false);
    expect(ficha.detalhe).toBeNull();

    rpc.mockResolvedValueOnce({ data: FICHA, error: null });
    await act(async () => ficha.recarregar());
    expect(ficha.erro).toBe(false);
    expect(ficha.carregando).toBe(false);
    expect(ficha.detalhe?.protocolo).toBe("DV-A");
  });

  it("resposta tardia, depois do erro, não mexe na ficha", async () => {
    const lenta = pendente();
    rpc.mockReturnValueOnce(lenta.promessa);
    await montar("ficha");
    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(ficha.erro).toBe(true);

    await act(async () => {
      lenta.resolver({ data: FICHA, error: null });
      await Promise.resolve();
    });
    expect(ficha.erro).toBe(true);
    expect(ficha.detalhe).toBeNull();
    expect(ficha.carregando).toBe(false);
  });

  it("responde cedo: sem erro e sem relógio pendente", async () => {
    rpc.mockResolvedValueOnce({ data: FICHA, error: null });
    await montar("ficha");
    expect(ficha.erro).toBe(false);
    expect(ficha.carregando).toBe(false);
    expect(ficha.detalhe?.protocolo).toBe("DV-A");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erro explícito do servidor segue virando erro", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
    await montar("ficha");
    expect(ficha.erro).toBe(true);
    expect(ficha.carregando).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
