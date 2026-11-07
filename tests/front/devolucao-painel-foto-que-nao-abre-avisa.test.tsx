// @vitest-environment jsdom
//
// Ficha da devolução no PAINEL: a foto que o cliente mandou e o aparelho da
// lojista não consegue abrir aparecia como o ícone de imagem quebrada do
// navegador, sem uma palavra -- ela não sabia se a foto não veio ou se o
// problema era dela. Agora o quadrado diz "Não foi possível abrir esta foto"
// (o link para o arquivo continua lá, para tentar abrir ou baixar por fora).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

const { estado } = vi.hoisted(() => ({
  estado: {
    detalhe: null as unknown,
    fotos: new Map<string, string>(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock("@/hooks/useDevolucoesAdmin", () => {
  const nada = async () => true;
  return {
    useDevolucaoAdmin: () => ({
      detalhe: estado.detalhe,
      fotos: estado.fotos,
      carregando: false,
      erro: false,
      emVoo: null,
      recarregar: async () => {},
      aprovar: nada,
      recusar: nada,
      marcarEmTransito: nada,
      marcarRecebida: nada,
      gerarEtiquetaReversa: nada,
      liberarVinculoReverso: nada,
      concluir: nada,
      reprovar: nada,
      cancelar: nada,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalheComFotos(fotos: string[]): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261106-AAAAA",
    order_id: "o-1",
    tipo: "vicio",
    motivo: "defeito",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "solicitada",
    valor_itens: 100,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos,
    codigo_rastreio: null,
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-11-01T15:00:00Z",
    prazo_ate: "2026-11-08",
    politica: null,
    created_at: "2026-11-02T10:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 100,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "Maria Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
    },
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  estado.fotos = new Map();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function abrirFicha() {
  const { DetalheDaDevolucao } = await import(
    "@/components/admin/devolucoes/DetalheDaDevolucao"
  );
  await act(async () => {
    raiz.render(
      <DetalheDaDevolucao
        id="d-1"
        onFechar={vi.fn()}
        onMudou={vi.fn()}
        onSujoMudou={vi.fn()}
        onAbrirPedido={vi.fn()}
      />,
    );
  });
}

const imagens = () => Array.from(document.querySelectorAll("img"));

async function falhar(img: HTMLImageElement) {
  await act(async () => {
    img.dispatchEvent(new Event("error"));
  });
}

describe("DetalheDaDevolucao — foto do cliente que não abre", () => {
  it("só a foto que falhou vira aviso 'Não foi possível abrir esta foto'; a outra segue como imagem", async () => {
    estado.detalhe = detalheComFotos(["u/a.jpg", "u/b.jpg"]);
    estado.fotos = new Map([
      ["u/a.jpg", "https://loja.test/a.jpg"],
      ["u/b.jpg", "https://loja.test/b.jpg"],
    ]);
    await abrirFicha();
    expect(imagens()).toHaveLength(2);
    expect(document.body.textContent).not.toContain(
      "Não foi possível abrir esta foto",
    );

    await falhar(imagens()[0]);

    expect(document.body.textContent).toContain(
      "Não foi possível abrir esta foto",
    );
    const restantes = imagens();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].getAttribute("src")).toBe("https://loja.test/b.jpg");
  });

  it("o link para o arquivo continua, para a lojista tentar abrir ou baixar por fora", async () => {
    estado.detalhe = detalheComFotos(["u/a.jpg"]);
    estado.fotos = new Map([["u/a.jpg", "https://loja.test/a.jpg"]]);
    await abrirFicha();

    await falhar(imagens()[0]);

    const link = Array.from(document.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Não foi possível abrir esta foto"),
    );
    expect(link?.getAttribute("href")).toBe("https://loja.test/a.jpg");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("controle: foto que abre não mostra o aviso", async () => {
    estado.detalhe = detalheComFotos(["u/a.jpg"]);
    estado.fotos = new Map([["u/a.jpg", "https://loja.test/a.jpg"]]);
    await abrirFicha();

    expect(imagens()).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Não foi possível abrir");
  });
});
