// @vitest-environment jsdom
//
// Onda K (frente vidro-e-pedidos): acabamento de letra e de toque em Pedidos,
// Ajustes, Devoluções, no cartão da assinatura do Início e na faixa de resumo
// do Frete. Só classe e texto: nenhum comportamento muda.
//
//   (a) AdminOrderCard: "Marcar como recebido" e "Desfazer" com 44px (h-11) e o
//       selo "Balcão" em 11px;
//   (b) OrderStatusBadge e PaymentStatusBadge, nos dois tamanhos: o rótulo em
//       11px, nunca 9 ou 10px;
//   (c) estático: "Desfazer" da ficha, as ajudas de Pedidos e Ajustes (padrão A3:
//       envoltório de 44px) e a confirmação de Devoluções com área de 44px;
//       CartaoDaAssinatura e FreteResumoFaixa sem texto < 11px.
//
// O jsdom não aplica CSS: a prova de toque/layout é sobre a classe; a medida
// real é do render do integrador.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   leitura de arquivos-fonte do próprio repositório (caminhos constantes); regex constantes, exercitadas pelos testes abaixo */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/admin/orders/OrderStatusBadge";
import type { Order } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = join(__dirname, "..", "..");
const lerFonte = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => {
      const limpa = linha.trim();
      return limpa.startsWith("//") ||
        limpa.startsWith("/*") ||
        limpa.startsWith("*") ||
        limpa.startsWith("{/*")
        ? ""
        : linha;
    })
    .join("\n");
}

/** A tag JSX que contém a posição `indice` (de `<` até o `>` fora de `{}`). */
function tagQueContem(texto: string, indice: number): string {
  const inicio = texto.lastIndexOf("<", indice);
  if (inicio === -1) return "";
  let profundidade = 0;
  for (let i = inicio + 1; i < texto.length; i++) {
    const c = texto[i];
    if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade <= 0 && texto[i - 1] !== "=") {
      return texto.slice(inicio, i + 1);
    }
  }
  return texto.slice(inicio);
}

const TEXTO_MIUDO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

function pedido(sobre: Partial<Order>): Order {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000eca2d5",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      { productId: "p1", name: "Maleta", price: 100, quantity: 1, image: "" },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "processing",
    paymentStatus: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    ...sobre,
  } as Order;
}

describe("selos, botões e faixas sem letra miúda nem alvo pequeno (onda K)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function botaoComTexto(texto: string): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    );
  }

  function montarCartao(sobre: Partial<Order>) {
    act(() => {
      raiz.render(
        <AdminOrderCard
          order={pedido(sobre)}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
        />,
      );
    });
  }

  describe("(a) AdminOrderCard", () => {
    it("'Marcar como recebido' tem 44px de altura (h-11)", () => {
      montarCartao({});
      const botao = botaoComTexto("Marcar como recebido");
      expect(
        botao,
        "o botão precisa existir no pedido em dinheiro",
      ).toBeDefined();
      expect(botao?.className).toContain("h-11");
      expect(botao?.className).not.toContain("h-10");
    });

    it("'Desfazer' tem 44px de altura (h-11)", () => {
      montarCartao({ pagamentoRecebidoEm: new Date(0).toISOString() });
      const botao = botaoComTexto("Desfazer");
      expect(
        botao,
        "o botão precisa existir no pedido já recebido",
      ).toBeDefined();
      expect(botao?.className).toContain("h-11");
      expect(botao?.className).not.toContain("h-10");
    });

    it("o selo 'Balcão' é de 11px", () => {
      montarCartao({ canal: "presencial" });
      const selo = hospedeiro.querySelector('[data-testid="selo-canal"]');
      expect(selo, "o selo do balcão precisa existir").not.toBeNull();
      expect(selo?.className).toContain("text-[11px]");
      expect(selo?.className).not.toMatch(TEXTO_MIUDO);
    });

    it("o contador sobre a foto não usa texto < 11px", () => {
      const fonte = semComentarios(
        lerFonte("src/components/admin/orders/AdminOrderCard.tsx"),
      );
      expect(fonte.match(TEXTO_MIUDO) ?? []).toEqual([]);
    });
  });

  describe("(b) selos de status", () => {
    function rotulo(): Element | null {
      return hospedeiro.querySelector("span.uppercase");
    }

    it.each(["padrao", "cartao"] as const)(
      "OrderStatusBadge (%s): rótulo em 11px",
      (tamanho) => {
        act(() => {
          raiz.render(
            <OrderStatusBadge status="processing" tamanho={tamanho} />,
          );
        });
        const span = rotulo();
        expect(span).not.toBeNull();
        expect(span?.className).toContain("text-[11px]");
        expect(span?.className).not.toMatch(TEXTO_MIUDO);
      },
    );

    it.each(["padrao", "cartao"] as const)(
      "PaymentStatusBadge (%s): rótulo em 11px",
      (tamanho) => {
        act(() => {
          raiz.render(
            <PaymentStatusBadge
              paymentStatus="pago"
              orderStatus="processing"
              tamanho={tamanho}
            />,
          );
        });
        const span = rotulo();
        expect(span).not.toBeNull();
        expect(span?.className).toContain("text-[11px]");
        expect(span?.className).not.toMatch(TEXTO_MIUDO);
      },
    );

    it("o arquivo dos selos não tem texto < 11px", () => {
      const fonte = semComentarios(
        lerFonte("src/components/admin/orders/OrderStatusBadge.tsx"),
      );
      expect(fonte.match(TEXTO_MIUDO) ?? []).toEqual([]);
    });
  });

  describe("(c) estático", () => {
    /** Tag de abertura do `<button` que envolve cada `<HelpCircle` do arquivo. */
    function botoesDeAjuda(fonte: string): string[] {
      const tags: string[] = [];
      for (const achado of fonte.matchAll(/<HelpCircle\b/g)) {
        const indice = achado.index ?? 0;
        const abertura = fonte.lastIndexOf("<button", indice);
        if (abertura === -1) continue;
        // Se um `</button>` fecha entre a abertura e o ícone, o ícone não é do botão.
        if (fonte.slice(abertura, indice).includes("</button>")) continue;
        tags.push(tagQueContem(fonte, abertura + 1));
      }
      return tags;
    }

    it("'Desfazer' da ficha do pedido tem 44px (h-11)", () => {
      const fonte = semComentarios(
        lerFonte("src/components/admin/orders/OrderDetail.tsx"),
      );
      const texto = /\n\s*Desfazer\s*\n/.exec(fonte);
      expect(texto, "o botão Desfazer precisa existir na ficha").not.toBeNull();
      const abertura = fonte.lastIndexOf("<button", texto?.index ?? 0);
      const tag = tagQueContem(fonte, abertura + 1);
      expect(tag).toContain("h-11");
      expect(tag).not.toContain("h-10");
    });

    it.each([
      "src/views/admin/AdminOrdersView.tsx",
      "src/views/admin/AdminSettingsView.tsx",
    ])("a ajuda de %s tem 44x44 (min-h-11 min-w-11)", (caminho) => {
      const tags = botoesDeAjuda(semComentarios(lerFonte(caminho)));
      expect(
        tags.length,
        "esperava ao menos um botão de ajuda",
      ).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toContain("min-h-11");
        expect(tag).toContain("min-w-11");
      }
    });

    it("a confirmação 'Conferi em Meus envios' de Devoluções tem área de 44px", () => {
      const fonte = semComentarios(
        lerFonte("src/components/admin/devolucoes/AcoesDaDevolucao.tsx"),
      );
      const texto = fonte.indexOf("Conferi em Meus envios");
      expect(texto).toBeGreaterThan(-1);
      const abertura = fonte.lastIndexOf("<label", texto);
      const tag = tagQueContem(fonte, abertura + 1);
      expect(tag).toContain("min-h-11");
    });

    it.each([
      "src/components/admin/inicio/CartaoDaAssinatura.tsx",
      "src/components/admin/shipping/FreteResumoFaixa.tsx",
    ])("%s não tem texto < 11px", (caminho) => {
      expect(
        semComentarios(lerFonte(caminho)).match(TEXTO_MIUDO) ?? [],
      ).toEqual([]);
    });
  });
});
