// @vitest-environment jsdom
//
// Folha de devolução (SolicitarDevolucaoSheet): a lista só mostra item com
// `disponivel > 0`, mas a seleção nasce num useState e a disponibilidade pode
// mudar depois (a loja aceitou outra devolução do mesmo pedido, a folha foi
// reaberta com dado novo). O item que já não aparece continuava na seleção:
// a cliente não via nem conseguia desmarcar, e o envio o mandava junto — o
// servidor recusava "Quantidade indisponível" sem a cliente entender por quê.
// Agora a seleção é reconciliada com a disponibilidade ATUAL: item sem
// disponibilidade sai, e a quantidade nunca passa do que ainda pode voltar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DadosDaSolicitacao, Desfecho } from "@/hooks/useDevolucaoCliente";
import type {
  ElegibilidadeDevolucao,
  ResultadoSolicitacao,
} from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// O jsdom não decodifica imagem: a conferência "a foto abre?" é dublada.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Item = ElegibilidadeDevolucao["itens"][number];

const TENIS: Item = {
  order_item_id: "oi-1",
  product_id: "p-1",
  product_name: "Tênis",
  image_url: null,
  quantidade: 3,
  ja_devolvida: 0,
  disponivel: 3,
  valor_unitario: 100,
};
const MEIA: Item = {
  order_item_id: "oi-2",
  product_id: "p-2",
  product_name: "Meia",
  image_url: null,
  quantidade: 1,
  ja_devolvida: 0,
  disponivel: 1,
  valor_unitario: 10,
};

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
  itens: [TENIS, MEIA],
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

/** A mesma elegibilidade, depois de o servidor mudar a disponibilidade. */
function elegibilidadeCom(itens: Item[]): ElegibilidadeDevolucao {
  return { ...ELEGIBILIDADE, itens };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const solicitar =
  vi.fn<
    (dados: DadosDaSolicitacao) => Promise<Desfecho<ResultadoSolicitacao>>
  >();

beforeEach(() => {
  solicitar.mockReset();
  solicitar.mockResolvedValue({
    ok: true,
    valor: {
      id: "d-1",
      protocolo: "DEV-1",
      tipo: "arrependimento",
      status: "solicitada",
    },
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function desenhar(elegibilidade: ElegibilidadeDevolucao) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={elegibilidade}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
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

const alerta = () =>
  folha()?.querySelector('[role="alert"]')?.textContent ?? "";

/** Do passo 2 até a revisão (passo 4), com motivo sem foto obrigatória. */
async function doMotivoAteARevisao() {
  await clicar(botao("Continuar"));
  await clicar(radio("tamanho_pequeno"));
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
  expect(
    folha()?.querySelector('[data-testid="passo-revisao"]'),
  ).not.toBeNull();
}

describe("SolicitarDevolucaoSheet — a seleção acompanha a disponibilidade atual", () => {
  it("item marcado que perdeu a disponibilidade NÃO vai no envio nem aparece na revisão", async () => {
    await desenhar(ELEGIBILIDADE);
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Meia"));
    // Outra devolução do mesmo pedido consumiu a meia: ela some da lista.
    await desenhar(elegibilidadeCom([TENIS, { ...MEIA, disponivel: 0 }]));
    expect(folha()?.textContent).not.toContain("Meia");

    await doMotivoAteARevisao();
    const revisao = folha()?.querySelector(
      '[data-testid="passo-revisao"]',
    )?.textContent;
    expect(revisao).toContain("1× Tênis");
    expect(revisao).not.toContain("Meia");

    await clicar(botao("Confirmar devolução"));

    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(solicitar.mock.calls[0]?.[0].itens).toEqual([
      { order_item_id: "oi-1", quantidade: 1 },
    ]);
  });

  it("borda: a quantidade marcada é limitada ao que ainda pode voltar (3 marcados, sobrou 1)", async () => {
    await desenhar(ELEGIBILIDADE);
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Tênis"));
    await desenhar(
      elegibilidadeCom([{ ...TENIS, ja_devolvida: 2, disponivel: 1 }, MEIA]),
    );
    // A tela mostra o que será enviado, não o 3 velho.
    expect(
      folha()?.querySelector('[data-testid="passo-itens"]')?.textContent,
    ).toContain("pode devolver 1");

    await doMotivoAteARevisao();
    await clicar(botao("Confirmar devolução"));

    expect(solicitar.mock.calls[0]?.[0].itens).toEqual([
      { order_item_id: "oi-1", quantidade: 1 },
    ]);
  });

  it("borda: se SÓ restava o item que sumiu, o passo 1 pede para escolher de novo (nada preso e invisível)", async () => {
    await desenhar(ELEGIBILIDADE);
    await clicar(botao("Aumentar Meia"));
    await desenhar(
      elegibilidadeCom([TENIS, { ...MEIA, ja_devolvida: 1, disponivel: 0 }]),
    );

    await clicar(botao("Continuar"));

    expect(alerta()).toContain("Escolha ao menos um item");
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("controle: nada mudou na disponibilidade — o envio leva exatamente o que foi marcado", async () => {
    await desenhar(ELEGIBILIDADE);
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Meia"));

    await doMotivoAteARevisao();
    await clicar(botao("Confirmar devolução"));

    expect(solicitar.mock.calls[0]?.[0].itens).toEqual([
      { order_item_id: "oi-1", quantidade: 2 },
      { order_item_id: "oi-2", quantidade: 1 },
    ]);
  });
});

describe("selecaoPossivel — a conta pura da conferência", () => {
  it("devolve a MESMA referência quando nada precisa mudar", async () => {
    const { selecaoPossivel } = await import("@/lib/devolucao");
    const marcados = new Map([["oi-1", 2]]);
    expect(selecaoPossivel([TENIS, MEIA], marcados)).toBe(marcados);
  });

  it("tira o que não está mais na lista, o que zerou e limita ao disponível", async () => {
    const { selecaoPossivel } = await import("@/lib/devolucao");
    const marcados = new Map([
      ["oi-1", 3],
      ["oi-2", 1],
      ["oi-fantasma", 1],
    ]);
    const conferida = selecaoPossivel(
      [
        { ...TENIS, disponivel: 2 },
        { ...MEIA, disponivel: 0 },
      ],
      marcados,
    );
    expect(Array.from(conferida)).toEqual([["oi-1", 2]]);
    // E a seleção original não é mexida.
    expect(Array.from(marcados)).toEqual([
      ["oi-1", 3],
      ["oi-2", 1],
      ["oi-fantasma", 1],
    ]);
  });

  it("borda: seleção vazia e lista vazia", async () => {
    const { selecaoPossivel } = await import("@/lib/devolucao");
    expect(selecaoPossivel([], new Map()).size).toBe(0);
    expect(selecaoPossivel([TENIS], new Map([["oi-1", 1]])).size).toBe(1);
    expect(selecaoPossivel([], new Map([["oi-1", 1]])).size).toBe(0);
  });
});
