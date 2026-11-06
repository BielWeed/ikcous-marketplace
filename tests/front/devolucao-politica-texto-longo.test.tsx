// @vitest-environment jsdom
//
// O texto da política que a lojista escreveu (com link ou palavra longa, sem
// espaços) aparece na revisão do pedido de devolução. Ele precisa quebrar a
// palavra, senão a folha ganha rolagem lateral ou corta o texto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINK_LONGO = `https://${"regras-da-loja-".repeat(10)}exemplo.com.br`;

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
      quantidade: 2,
      ja_devolvida: 0,
      disponivel: 2,
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
    texto_politica: `Veja tudo em ${LINK_LONGO}`,
    endereco_devolucao: null,
    updated_at: null,
  },
};

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
  document.body.innerHTML = "";
});

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(folha()?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("SolicitarDevolucaoSheet: texto da política da lojista", () => {
  it("o parágrafo da política quebra a palavra longa", async () => {
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
        />,
      );
    });
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="tamanho_pequeno"]',
      ),
    );
    await clicar(botao("Continuar"));
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="reembolso"]',
      ),
    );
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="envio_proprio"]',
      ),
    );
    await clicar(botao("Continuar"));

    const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
    const paragrafo = [...(revisao?.querySelectorAll("details p") ?? [])].find(
      (p) => p.textContent?.includes(LINK_LONGO),
    );
    expect(paragrafo, "parágrafo da política na revisão").toBeDefined();
    expect(paragrafo?.classList.contains("break-words")).toBe(true);
  });
});
