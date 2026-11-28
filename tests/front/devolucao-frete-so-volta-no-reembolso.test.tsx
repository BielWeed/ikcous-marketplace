// @vitest-environment jsdom
//
// Revisão do pedido de devolução (SolicitarDevolucaoSheet, passo 4): a frase
// "o frete que você pagou também é devolvido" é uma promessa de DINHEIRO, e o
// servidor só gera dinheiro quando a solução é o reembolso
// (`admin_devolucao_concluir`: troca e vale não têm `order_refunds`). Com troca
// ou vale-troca, mesmo com o pedido voltando inteiro, a frase não pode aparecer.
// E só se promete o frete que EXISTIU: pedido de retirada na loja ou de frete
// grátis (frete R$ 0) não tem frete a devolver, e sem o valor do frete a folha
// também não promete.
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

// O jsdom não decodifica imagem (o <img> nunca carrega nem falha): a conferência
// "a foto abre?" é dublada aqui. A de verdade tem teste próprio.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_DO_FRETE = "o frete que você pagou também é devolvido";
const PROMESSA_DO_FRETE =
  "Como o pedido inteiro é reembolsado, o frete que você pagou também é devolvido.";
const REGRA_DO_FRETE =
  "O frete de ida só é devolvido quando o pedido inteiro é reembolsado; peça trocada ou que virou vale-troca não entra nessa conta.";

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
    texto_politica: null,
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

async function montar(freteDoPedido?: number) {
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
        freteDoPedido={freteDoPedido}
      />,
    );
  });
}

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

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

async function escolherFoto() {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Devolução por defeito, até a revisão, com a quantidade e a solução dadas. */
async function ateARevisaoComDefeito(
  resolucao: "reembolso" | "troca" | "vale",
  quantidade = 2,
  frete: number | "desconhecido" = 19.9,
) {
  await montar(frete === "desconhecido" ? undefined : frete);
  for (let i = 0; i < quantidade; i++) {
    await clicar(botao("Aumentar Tênis"));
  }
  await clicar(botao("Continuar"));
  await clicar(radio("defeito"));
  await escolherFoto();
  await clicar(botao("Continuar"));
  await clicar(radio(resolucao));
  await clicar(radio("etiqueta_reversa"));
  await clicar(botao("Continuar"));
  const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
  expect(revisao).toBeTruthy();
  expect(revisao?.textContent).toContain("Tênis");
  return revisao?.textContent ?? "";
}

describe("SolicitarDevolucaoSheet — o frete só volta no reembolso", () => {
  it("defeito, pedido inteiro, REEMBOLSO: promete o frete de volta", async () => {
    const texto = await ateARevisaoComDefeito("reembolso");
    expect(texto).toContain(PROMESSA_DO_FRETE);
  });

  it("defeito, uma de duas unidades, REEMBOLSO: não promete frete de volta", async () => {
    const texto = await ateARevisaoComDefeito("reembolso", 1);
    expect(texto).not.toContain(FRASE_DO_FRETE);
  });

  it("defeito, pedido inteiro, TROCA: não promete frete de volta e explica a regra", async () => {
    const texto = await ateARevisaoComDefeito("troca");
    expect(texto).not.toContain(FRASE_DO_FRETE);
    expect(texto).toContain(REGRA_DO_FRETE);
  });

  it("defeito, pedido inteiro, VALE-TROCA: não promete frete de volta", async () => {
    const texto = await ateARevisaoComDefeito("vale");
    expect(texto).not.toContain(FRASE_DO_FRETE);
    expect(texto).toContain(REGRA_DO_FRETE);
  });

  it("defeito, pedido inteiro, REEMBOLSO, frete R$ 0 (retirada ou grátis): não fala de frete", async () => {
    const texto = await ateARevisaoComDefeito("reembolso", 2, 0);
    expect(texto).not.toContain(FRASE_DO_FRETE);
    expect(texto).not.toContain("frete de ida");
  });

  it("defeito, pedido inteiro, REEMBOLSO, frete desconhecido: não promete frete de volta", async () => {
    const texto = await ateARevisaoComDefeito("reembolso", 2, "desconhecido");
    expect(texto).not.toContain(FRASE_DO_FRETE);
  });
});
