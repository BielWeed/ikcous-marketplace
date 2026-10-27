// @vitest-environment jsdom
//
// Lote 209 — fluxo de devolução do cliente. O jsdom não faz layout: aqui se
// prende o COMPORTAMENTO que deixa o aviso à vista (rolar até ele, foco sem
// roubar o campo de texto), a área rolável voltando ao topo a cada passo, o
// nome do produto em até 2 linhas, a confirmação de cancelar em diálogo do
// app (não a caixa do navegador) e o rótulo "Solicitada em".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DevolucaoDetalhe,
  ElegibilidadeDevolucao,
} from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOME_LONGO =
  "Tênis Esportivo Masculino de Corrida Super Leve Amortecimento Extra Preto 42";

const ELEGIBILIDADE = {
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
      product_name: NOME_LONGO,
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
    aceita_reembolso: true,
    aceita_vale: true,
    aceita_troca: true,
    metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: null,
    endereco_devolucao: null,
    updated_at: null,
  },
} as unknown as ElegibilidadeDevolucao;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const rolagens: Array<{ el: Element; arg: unknown }> = [];

beforeEach(() => {
  rolagens.length = 0;
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    rolagens.push({ el: this, arg });
  };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');

function botao(texto: string, raizDeBusca: ParentNode = document) {
  return Array.from(raizDeBusca.querySelectorAll("button")).find(
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

async function montarFolha() {
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
        solicitar={vi.fn()}
        enviarFoto={vi.fn()}
      />,
    );
  });
}

const areaRolavel = () =>
  folha()?.querySelector<HTMLElement>(".overflow-y-auto") ?? null;

async function ateOAvisoDoPasso2() {
  await montarFolha();
  await clicar(botao(`Aumentar ${NOME_LONGO}`));
  await clicar(botao("Continuar"));
  await clicar(botao("Continuar"));
}

describe("folha de devolução — aviso à vista e rolagem", () => {
  it("passo 2 sem motivo: o aviso aparece e a folha rola até ele", async () => {
    await ateOAvisoDoPasso2();
    const aviso = folha()?.querySelector('[role="alert"]');
    expect(aviso).toBeTruthy();
    expect(rolagens.some((r) => r.el === aviso)).toBe(true);
  });

  it("o foco vai para o aviso quando nenhum campo de texto está em uso", async () => {
    await ateOAvisoDoPasso2();
    const aviso = folha()?.querySelector<HTMLElement>('[role="alert"]');
    expect(document.activeElement).toBe(aviso);
  });

  it("cada passo abre no topo da área rolável", async () => {
    await montarFolha();
    await clicar(botao(`Aumentar ${NOME_LONGO}`));
    const area = areaRolavel();
    expect(area).toBeTruthy();
    if (area) area.scrollTop = 300;
    await clicar(botao("Continuar"));
    expect(areaRolavel()?.scrollTop).toBe(0);

    const area2 = areaRolavel();
    if (area2) area2.scrollTop = 250;
    await clicar(botao("Voltar"));
    expect(areaRolavel()?.scrollTop).toBe(0);
  });

  it("nome do produto longo quebra em até 2 linhas, não é cortado em 1", async () => {
    await montarFolha();
    const nome = Array.from(folha()?.querySelectorAll("p") ?? []).find(
      (p) => p.textContent === NOME_LONGO,
    );
    expect(nome).toBeTruthy();
    expect(nome?.className).toContain("line-clamp-2");
    expect(nome?.className).toContain("break-words");
    expect(nome?.className).not.toContain("truncate");
  });
});

describe("cartão da devolução no pedido", () => {
  const devolucao = {
    id: "d-1",
    protocolo: "DV1",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
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
    fotos: [],
    codigo_rastreio: null,
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: null,
    prazo_ate: "2026-10-30",
    politica: null,
    created_at: "2026-10-20T12:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [
      {
        id: "i-1",
        quantidade: 1,
        valor_unitario: 100,
        product_name: NOME_LONGO,
      },
    ],
    eventos: [],
    pedido: null,
  } as unknown as DevolucaoDetalhe;

  async function montarCartao(
    onCancelar = vi.fn().mockResolvedValue({ ok: true }),
  ) {
    const { DevolucaoDoPedidoCard } = await import(
      "@/components/devolucao/DevolucaoDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <DevolucaoDoPedidoCard
          atual={devolucao}
          anteriores={[]}
          enderecoDaLoja={null}
          horarioDaLoja={null}
          onCancelar={onCancelar}
          onInformarEnvio={vi.fn()}
        />,
      );
    });
    return onCancelar;
  }

  it("o rótulo da data é 'Solicitada em' (a data é da devolução)", async () => {
    await montarCartao();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Solicitada em");
    expect(texto).not.toContain("Pedido em");
  });

  it("nome do produto no cartão quebra em até 2 linhas", async () => {
    await montarCartao();
    const dt = Array.from(hospedeiro.querySelectorAll("dt")).find((d) =>
      d.textContent?.includes(NOME_LONGO),
    );
    expect(dt?.className).toContain("line-clamp-2");
    expect(dt?.className).not.toContain("truncate");
  });

  it("cancelar abre o diálogo do app, não a caixa do navegador, e só cancela ao confirmar", async () => {
    const confirmNativo = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmNativo);
    const onCancelar = await montarCartao();

    await clicar(botao("Cancelar devolução", hospedeiro));
    expect(confirmNativo).not.toHaveBeenCalled();
    expect(onCancelar).not.toHaveBeenCalled();
    const dialogo = document.querySelector('[role="alertdialog"]');
    expect(dialogo).toBeTruthy();
    expect(dialogo?.textContent).toContain("Cancelar esta devolução?");

    const manter = botao("Manter devolução", dialogo as HTMLElement);
    const confirmar = botao("Sim, cancelar", dialogo as HTMLElement);
    expect(manter?.className).toContain("min-h-11");
    expect(confirmar?.className).toContain("min-h-11");
    await clicar(confirmar);
    expect(onCancelar).toHaveBeenCalledWith("d-1");
  });

  it("'Manter devolução' fecha o diálogo sem cancelar", async () => {
    const onCancelar = await montarCartao();
    await clicar(botao("Cancelar devolução", hospedeiro));
    const dialogo = document.querySelector('[role="alertdialog"]');
    await clicar(botao("Manter devolução", dialogo as HTMLElement));
    expect(onCancelar).not.toHaveBeenCalled();
  });
});
