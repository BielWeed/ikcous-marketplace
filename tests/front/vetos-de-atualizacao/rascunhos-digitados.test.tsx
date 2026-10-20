// @vitest-environment jsdom
//
// O QUE FOI DIGITADO NÃO SE PERDE NA ATUALIZAÇÃO (revisão da 1.5.33,
// 16/10/2026).
//
// A atualização é obrigatória e recarrega o app quando ele vai para segundo
// plano numa tela que não é de compra. A anotação interna do pedido e o código
// de rastreio (painel), o comentário de avaliação e o formulário de devolução
// (com motivo, texto e fotos) só existem em estado local: a lojista escrevia,
// trocava de app, voltava, e o texto tinha sumido. Os quatro agora marcam uma
// operação sensível enquanto houver texto/foto não salvo.
//
// Cada caso prova o EFEITO, não só a marca: `reloadaria()` pergunta ao mesmo
// `decidirMomentoSeguro` que o instalador consulta, com o app indo para
// segundo plano numa tela segura. Sem o registro, a resposta é "sim, recarrega".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decidirMomentoSeguro } from "@/lib/atualizacao/momento-seguro";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import type { Order } from "@/types";
import type { ElegibilidadeDevolucao } from "@/types/devolucao";

const h = vi.hoisted(() => ({ enviarAvaliacao: vi.fn() }));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: h.enviarAvaliacao }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: vi.fn() }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** O app foi para segundo plano numa tela segura (a vitrine): o ponto de
 * parada em que a atualização recarrega sozinha. */
function reloadaria(): boolean {
  return decidirMomentoSeguro({
    view: "home",
    adminDirty: false,
    pedidoPendenteDoCheckout: false,
    documentoOculto: true,
    trocouDeTela: false,
  }).instalarAgora;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  // Nada pode vazar de um caso para o outro.
  expect(haOperacaoSensivel()).toBe(false);
});

async function digitar(
  campo: HTMLInputElement | HTMLTextAreaElement,
  valor: string,
) {
  const prototipo =
    campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
      campo,
      valor,
    );
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

function botaoPorTexto(texto: string, dentro: ParentNode = document) {
  return Array.from(dentro.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

describe("comentário da avaliação", () => {
  it("enquanto há texto digitado a atualização espera; apagado, libera", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={5} />);
    });
    const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;

    // Controle: só com as estrelas (nada digitado) o app recarregaria.
    expect(reloadaria()).toBe(true);

    await digitar(area, "Chegou rápido e é lindo");
    expect(motivosDeOperacaoSensivel()).toEqual(["avaliacao-em-digitacao"]);
    expect(reloadaria()).toBe(false);

    await digitar(area, "   ");
    expect(haOperacaoSensivel()).toBe(false);
    expect(reloadaria()).toBe(true);
  });

  it("sair da tela com o texto escrito solta a marca", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" />);
    });
    await digitar(
      hospedeiro.querySelector("textarea") as HTMLTextAreaElement,
      "rascunho",
    );
    expect(reloadaria()).toBe(false);
    await act(async () => {
      raiz.render(<div />);
    });
    expect(reloadaria()).toBe(true);
  });
});

function pedido(notes: string, trackingCode: string): Order {
  return {
    id: "pedido-1",
    notes,
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-10-16T10:00:00Z",
    updatedAt: "2026-10-16T10:00:00Z",
    cancelledAfterShipping: false,
  } as Order;
}

describe("anotação interna e código de rastreio do pedido", () => {
  async function abrir(notes: string, trackingCode: string) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={pedido(notes, trackingCode)}
          onStatusChange={vi.fn()}
        />,
      );
    });
  }

  it("anotação digitada e ainda não salva segura a atualização; cancelar libera", async () => {
    await abrir("", "");
    // Controle: o painel aberto sem edição não segura nada.
    expect(reloadaria()).toBe(true);

    await clicar(botaoPorTexto("Adicionar anotação"));
    const campo = hospedeiro.querySelector("#notes-textarea");
    expect(campo).toBeTruthy();
    // Abrir o campo sem escrever nada ainda não é trabalho a perder.
    expect(reloadaria()).toBe(true);

    await digitar(campo as HTMLTextAreaElement, "Entregar depois das 18h");
    expect(motivosDeOperacaoSensivel()).toEqual(["anotacao-do-pedido"]);
    expect(reloadaria()).toBe(false);

    await clicar(botaoPorTexto("Cancelar edição das anotações", hospedeiro));
    expect(haOperacaoSensivel()).toBe(false);
    expect(reloadaria()).toBe(true);
  });

  it("código de rastreio alterado e não salvo segura a atualização", async () => {
    await abrir("", "BR111");
    await clicar(
      hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Editar Código"]',
      ),
    );
    expect(reloadaria()).toBe(true);

    await digitar(
      hospedeiro.querySelector("#tracking-input") as HTMLInputElement,
      "BR222",
    );
    expect(motivosDeOperacaoSensivel()).toEqual(["anotacao-do-pedido"]);
    expect(reloadaria()).toBe(false);

    await digitar(
      hospedeiro.querySelector("#tracking-input") as HTMLInputElement,
      "BR111",
    );
    expect(reloadaria()).toBe(true);
  });
});

const ELEGIBILIDADE: ElegibilidadeDevolucao = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-09-24T15:00:00Z",
  dias_desde_entrega: 2,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-10-01",
    troca_ate: "2026-10-24",
    vicio_ate: "2026-12-23",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [
    {
      order_item_id: "oi-1",
      product_id: "p-1",
      product_name: "Tênis",
      image_url: null,
      quantidade: 1,
      ja_devolvida: 0,
      disponivel: 1,
      valor_unitario: 100,
    },
  ],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: true,
    exige_fotos_vicio: true,
    metodos_locais: ["entrega_na_loja", "coleta"],
    metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: "Trocas em até 30 dias, com etiqueta.",
    endereco_devolucao: null,
    updated_at: null,
  },
};

describe("formulário de devolução (motivo, texto e fotos)", () => {
  it("motivo e foto escolhidos seguram a atualização até a folha fechar", async () => {
    const { SolicitarDevolucaoSheet } = await import(
      "@/components/devolucao/SolicitarDevolucaoSheet"
    );
    await act(async () => {
      raiz.render(
        <SolicitarDevolucaoSheet
          aberto
          onAbertoMudou={vi.fn()}
          elegibilidade={ELEGIBILIDADE}
          userId="u-1"
          enderecoDaLoja="Rua A, 10"
          horarioDaLoja="Seg a Sex, 9h às 18h"
          solicitar={vi.fn()}
          enviarFoto={vi.fn()}
          descartarFotos={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });
    const folha = () =>
      document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');

    // Controle: folha aberta, item único já marcado, nada escolhido — nada a
    // perder, o app recarregaria.
    expect(reloadaria()).toBe(true);

    await clicar(botaoPorTexto("Continuar", folha() ?? document));
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="defeito"]',
      ),
    );
    expect(motivosDeOperacaoSensivel()).toEqual(["rascunho-de-devolucao"]);
    expect(reloadaria()).toBe(false);

    const entrada = folha()?.querySelector<HTMLInputElement>(
      '[data-testid="entrada-fotos-devolucao"]',
    ) as HTMLInputElement;
    Object.defineProperty(entrada, "files", {
      configurable: true,
      value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(reloadaria()).toBe(false);

    // Fechar a folha (a pessoa descarta) solta a marca.
    await act(async () => {
      raiz.render(<div />);
    });
    expect(reloadaria()).toBe(true);
  });
});
