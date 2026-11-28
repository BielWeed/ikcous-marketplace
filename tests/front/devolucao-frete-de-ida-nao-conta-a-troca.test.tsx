// @vitest-environment jsdom
//
// Frete de ida e troca (migration 20261658000000, decisão do sócio): troca e vale-troca não devolvem dinheiro, então não fazem o
// pedido "voltar inteiro". Pedido de A + B com frete: A concluída como TROCA e depois o reembolso de B — o servidor não devolve o
// frete de ida, e a revisão do pedido não pode prometer "o frete que você pagou também é devolvido". A tela conta
// `ja_reembolsada` (só o que voltou em dinheiro) e, se o banco ainda não manda o campo (banco sem a 20261658000000), cai em
// `ja_devolvida` (a regra antiga, a mesma do servidor antigo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devolveFreteDeIda, lerElegibilidade } from "@/lib/devolucao";
import type { ElegibilidadeDevolucao, ItemElegivel } from "@/types/devolucao";

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

/** A já saiu do pedido (devolvida antes); B ainda está com a cliente. `reembolsada` = quanto de A voltou em dinheiro. */
function itensComAJaDevolvida(reembolsada: number | undefined): ItemElegivel[] {
  const a: ItemElegivel = {
    order_item_id: "oi-a",
    product_id: "p-a",
    product_name: "Peça A",
    image_url: null,
    quantidade: 1,
    ja_devolvida: 1,
    disponivel: 0,
    valor_unitario: 100,
  };
  return [
    reembolsada === undefined ? a : { ...a, ja_reembolsada: reembolsada },
    {
      order_item_id: "oi-b",
      product_id: "p-b",
      product_name: "Peça B",
      image_url: null,
      quantidade: 1,
      ja_devolvida: 0,
      ja_reembolsada: 0,
      disponivel: 1,
      valor_unitario: 100,
    },
  ];
}

const BASE: Omit<ElegibilidadeDevolucao, "itens"> = {
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

describe("devolveFreteDeIda — só o que voltou em dinheiro conta", () => {
  const soB = new Map([["oi-b", 1]]);

  it("A trocada (ja_reembolsada 0) + B reembolsada agora: sem frete de ida", () => {
    expect(devolveFreteDeIda("vicio", itensComAJaDevolvida(0), soB)).toBe(
      false,
    );
    expect(
      devolveFreteDeIda("arrependimento", itensComAJaDevolvida(0), soB),
    ).toBe(false);
  });

  it("A reembolsada (ja_reembolsada 1) + B agora: o pedido voltou inteiro, o frete volta", () => {
    expect(devolveFreteDeIda("vicio", itensComAJaDevolvida(1), soB)).toBe(true);
  });

  it("banco sem o campo (antes da 20261658000000): cai em ja_devolvida, a regra antiga", () => {
    expect(
      devolveFreteDeIda("vicio", itensComAJaDevolvida(undefined), soB),
    ).toBe(true);
  });

  it("o pedido inteiro numa devolução só segue levando o frete; troca de prazo nunca", () => {
    const nada = itensComAJaDevolvida(0).map((i) => ({
      ...i,
      ja_devolvida: 0,
      ja_reembolsada: 0,
      disponivel: 1,
    }));
    const tudo = new Map([
      ["oi-a", 1],
      ["oi-b", 1],
    ]);
    expect(devolveFreteDeIda("vicio", nada, tudo)).toBe(true);
    expect(devolveFreteDeIda("troca", nada, tudo)).toBe(false);
  });
});

describe("lerElegibilidade — o campo ja_reembolsada", () => {
  const cru = (extra: Record<string, unknown>) => ({
    ...BASE,
    itens: [
      {
        order_item_id: "oi-a",
        product_id: "p-a",
        product_name: "Peça A",
        image_url: null,
        quantidade: 1,
        ja_devolvida: 1,
        disponivel: 0,
        valor_unitario: 100,
        ...extra,
      },
    ],
  });

  it("lê ja_reembolsada quando o banco manda", () => {
    expect(lerElegibilidade(cru({ ja_reembolsada: 0 }))?.itens[0]).toEqual(
      expect.objectContaining({ ja_devolvida: 1, ja_reembolsada: 0 }),
    );
  });

  it("sem o campo (ou com lixo), não inventa zero: fica ausente e a conta cai em ja_devolvida", () => {
    for (const extra of [
      {},
      { ja_reembolsada: "x" },
      { ja_reembolsada: null },
    ]) {
      const item = lerElegibilidade(cru(extra))?.itens[0];
      expect(item).toBeTruthy();
      expect(item && "ja_reembolsada" in item).toBe(false);
    }
  });
});

// A tela de verdade: a revisão do pedido (passo 4) só promete o frete quando o servidor o devolve.
// O pedido teve frete pago (> 0): sem o valor a folha nunca promete o frete (#2108), e o caso da
// trocada passaria sem provar nada sobre `ja_reembolsada`.
const FRETE_PAGO = 20;
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

/** Defeito na Peça B com reembolso, até a revisão. */
async function revisaoDoReembolsoDeB(itens: ItemElegivel[]) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={{ ...BASE, itens }}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        freteDoPedido={FRETE_PAGO}
        solicitar={vi.fn()}
        enviarFoto={vi.fn()}
      />,
    );
  });
  await clicar(botao("Aumentar Peça B"));
  await clicar(botao("Continuar"));
  await clicar(radio("defeito"));
  await escolherFoto();
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("etiqueta_reversa"));
  await clicar(botao("Continuar"));
  const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
  expect(revisao).toBeTruthy();
  expect(revisao?.textContent).toContain("Peça B");
  return revisao?.textContent ?? "";
}

describe("SolicitarDevolucaoSheet — A trocada não faz o reembolso de B levar o frete", () => {
  it("A trocada antes + reembolso de B: não promete o frete de ida", async () => {
    const texto = await revisaoDoReembolsoDeB(itensComAJaDevolvida(0));
    expect(texto).not.toContain(FRASE_DO_FRETE);
  });

  it("A reembolsada antes + reembolso de B: promete o frete de ida", async () => {
    const texto = await revisaoDoReembolsoDeB(itensComAJaDevolvida(1));
    expect(texto).toContain(FRASE_DO_FRETE);
  });
});
