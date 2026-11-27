// @vitest-environment jsdom
//
// Folha de pedir devolução (SolicitarDevolucaoSheet) num pedido COM CUPOM:
// ali o servidor ainda não fez a conta, e a folha só sabe quantidade x preço
// de uma unidade já com o desconto e arredondado. O valor que o servidor grava
// pode ficar alguns centavos diferente (30 x R$ 3,33 com 10%: a folha somava
// R$ 90,00 e o servidor grava R$ 89,91). Com desconto no pedido, o valor da
// revisão é dito "estimado" e a folha explica por quê; sem desconto, nada muda.
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

vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOTA =
  "Com o cupom, o valor final é calculado com o desconto proporcional e pode variar alguns centavos.";

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
      product_name: "Caneta",
      image_url: null,
      quantidade: 30,
      ja_devolvida: 0,
      disponivel: 30,
      valor_unitario: 3,
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

afterEach(async () => {
  act(() => raiz.unmount());
  // O FocusScope do Radix devolve o foco num setTimeout(0) ao desmontar.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(pedidoComDesconto?: boolean) {
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
        horarioDaLoja={null}
        pedidoComDesconto={pedidoComDesconto}
        solicitar={vi.fn()}
        enviarFoto={vi.fn()}
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

async function ateARevisao(pedidoComDesconto?: boolean) {
  await montar(pedidoComDesconto);
  await clicar(botao("Aumentar Caneta"));
  await clicar(botao("Continuar"));
  await clicar(radio("tamanho_pequeno"));
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
  const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
  expect(revisao).toBeTruthy();
  return revisao;
}

function rotulosDaRevisao(revisao: Element | null | undefined) {
  return [...(revisao?.querySelectorAll("span") ?? [])].map(
    (el) => el.textContent,
  );
}

describe("folha da devolução: valor estimado só quando o pedido teve cupom", () => {
  it("com cupom, o valor vira 'Valor estimado dos itens' e a folha explica os centavos", async () => {
    const revisao = await ateARevisao(true);
    const rotulos = rotulosDaRevisao(revisao);
    expect(rotulos).toContain("Valor estimado dos itens");
    expect(rotulos).not.toContain("Valor dos itens");
    expect(revisao?.textContent).toContain(NOTA);
  });

  it("sem cupom, continua 'Valor dos itens' e sem a explicação", async () => {
    const revisao = await ateARevisao(false);
    const rotulos = rotulosDaRevisao(revisao);
    expect(rotulos).toContain("Valor dos itens");
    expect(rotulos).not.toContain("Valor estimado dos itens");
    expect(revisao?.textContent).not.toContain(NOTA);
  });

  it("quem não informa o cupom (padrão) vê a folha como sempre", async () => {
    const revisao = await ateARevisao();
    expect(rotulosDaRevisao(revisao)).toContain("Valor dos itens");
    expect(revisao?.textContent).not.toContain(NOTA);
  });
});
