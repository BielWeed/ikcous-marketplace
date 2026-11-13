// @vitest-environment jsdom
//
// A cliente deixa o pedido aberto com a devolução "solicitada"; a loja aprova
// em outro aparelho e o aviso "devolução aprovada" chega ao sino. Antes: a
// tela seguia dizendo "a loja vai analisar" (a devolução só era relida ao
// reabrir ou ao voltar ao app) e a tela do pedido marcava o aviso como lido
// NA HORA — a única pista de que algo mudou sumia antes de a tela mudar.
//
// Agora: aviso novo, não lido, DESTE pedido faz o hook da devolução reler, e a
// marcação como lido espera a leitura terminar.
//
// Controles: sem aviso novo nada é relido; aviso de OUTRO pedido não relê; o
// mesmo aviso reaparecendo não relê de novo.
import { NotificationContext } from "@/contexts/NotificationContextCore";
import {
  type DevolucaoDoCliente,
  useDevolucaoCliente,
} from "@/hooks/useDevolucaoCliente";
import { useMarcarAvisosDoPedidoComoLidos } from "@/hooks/useMarcarAvisosDoPedidoComoLidos";
import type { Notification } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({}) } },
}));

type Resposta = { data: unknown; error: unknown };
const ELEGIBILIDADE = {
  pode: true,
  modalidade: "nacional",
  janelas: {},
  itens: [],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
  },
};
const devolucaoCom = (status: string) => ({
  id: "d-1",
  protocolo: "DV1",
  order_id: "o-1",
  tipo: "arrependimento",
  motivo: "desisti",
  resolucao_desejada: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status,
  itens: [],
});
const aviso = (id: string, orderId: string): Notification => ({
  id,
  title: "Devolução",
  message: "x",
  type: "order",
  read: false,
  created_at: "2026-11-13T10:00:00Z",
  order_id: orderId,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: DevolucaoDoCliente;
let statusNoServidor: string;
let detalheEmEspera: Promise<Resposta> | null;
let ordem: string[];
const marcar = vi.fn();

function Tela() {
  const lida = useDevolucaoCliente("o-1", true);
  // Antes do hook de marcar: o efeito dele já lê a tela de agora.
  useEffect(() => {
    leitura = lida;
  });
  useMarcarAvisosDoPedidoComoLidos("o-1", lida.aguardandoAviso);
  return null;
}

async function renderizar(avisos: Notification[]) {
  await act(async () =>
    raiz.render(
      <NotificationContext.Provider
        value={
          {
            notifications: avisos,
            unreadCount: avisos.length,
            loading: false,
            erro: null,
            markOrderAsRead: marcar,
          } as never
        }
      >
        <Tela />
      </NotificationContext.Provider>,
    ),
  );
}
const leituras = () =>
  rpc.mock.calls.filter(([n]) => n === "devolucao_detalhe").length;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  statusNoServidor = "solicitada";
  detalheEmEspera = null;
  ordem = [];
  marcar.mockImplementation(async () => {
    ordem.push(`marcou com a tela em ${leitura.atual?.status}`);
  });
  rpc.mockImplementation((nome: string) => {
    if (nome === "devolucao_detalhe") {
      if (detalheEmEspera) return detalheEmEspera;
      return Promise.resolve({
        data: devolucaoCom(statusNoServidor),
        error: null,
      });
    }
    return Promise.resolve({
      data:
        nome === "devolucao_elegibilidade"
          ? ELEGIBILIDADE
          : [devolucaoCom(statusNoServidor)],
      error: null,
    });
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("aviso novo do pedido com a tela da devolução aberta", () => {
  it("relê a devolução e só então marca o aviso como lido", async () => {
    await renderizar([]);
    expect(leitura.atual?.status).toBe("solicitada");
    expect(leituras()).toBe(1);

    statusNoServidor = "aprovada";
    await renderizar([aviso("n-1", "o-1")]);

    expect(leituras()).toBe(2);
    expect(leitura.atual?.status).toBe("aprovada");
    expect(ordem).toEqual(["marcou com a tela em aprovada"]);
  });

  it("não marca enquanto a releitura ainda não voltou", async () => {
    await renderizar([]);
    let liberar!: (r: Resposta) => void;
    detalheEmEspera = new Promise<Resposta>((r) => {
      liberar = r;
    });
    statusNoServidor = "aprovada";
    await renderizar([aviso("n-1", "o-1")]);
    expect(marcar).not.toHaveBeenCalled();

    await act(async () =>
      liberar({ data: devolucaoCom("aprovada"), error: null }),
    );
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(leitura.atual?.status).toBe("aprovada");
  });

  it("sem aviso novo nada é relido", async () => {
    await renderizar([]);
    await renderizar([]);
    expect(leituras()).toBe(1);
    expect(marcar).not.toHaveBeenCalled();
  });

  it("aviso de outro pedido não relê a devolução deste", async () => {
    await renderizar([]);
    await renderizar([aviso("n-9", "o-2")]);
    expect(leituras()).toBe(1);
  });

  it("aviso já lido deste pedido não relê a devolução", async () => {
    await renderizar([]);
    await renderizar([{ ...aviso("n-1", "o-1"), read: true }]);
    expect(leituras()).toBe(1);
  });

  it("abrir a tela já com aviso não lido lê uma vez só e depois marca", async () => {
    await renderizar([aviso("n-1", "o-1")]);
    expect(leituras()).toBe(1);
    expect(marcar).toHaveBeenCalledTimes(1);
  });

  it("o mesmo aviso reaparecendo não relê de novo", async () => {
    await renderizar([]);
    await renderizar([aviso("n-1", "o-1")]);
    expect(leituras()).toBe(2);
    await renderizar([aviso("n-1", "o-1")]);
    expect(leituras()).toBe(2);
  });
});
