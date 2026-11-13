// @vitest-environment jsdom
//
// A CLIENTE NÃO VÊ "CANCELAR DEVOLUÇÃO" QUE O SERVIDOR VAI RECUSAR (r367-a).
//
// `cancelar_devolucao` (20261179000000, a definição vigente — nenhuma
// migration mais nova a redefine) recusa com "A loja está gerando o código de
// postagem desta devolução. Se precisar cancelar, fale com a loja." quando
//     me_reverse_id IS NOT NULL
//     AND me_reverse_id NOT LIKE 'reservando:%'
//     AND codigo_postagem IS NULL
// (status solicitada ou aprovada). O cartão ignorava isso: oferecia o botão,
// pedia a confirmação ("Sim, cancelar") e só então o servidor negava. Agora a
// ação some nesse caso e a cliente lê a orientação para falar com a loja. A
// fase de RESERVA ('reservando:…') e o vínculo com código já emitido continuam
// podendo cancelar — a condição é a do servidor, nem mais nem menos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acoesDoCliente, cancelamentoDependeDaLoja } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_REAL = "me-rev-real-123";
const RESERVA = "reservando:1789000000:9f1c2d3e";

describe("acoesDoCliente espelha o guard de cancelar_devolucao", () => {
  it("vínculo REAL sem código de postagem: sem cancelar (e sem informar envio, que exige o código)", () => {
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        me_reverse_id: ID_REAL,
        codigo_postagem: null,
      }),
    ).toEqual([]);
    expect(
      cancelamentoDependeDaLoja({
        status: "aprovada",
        me_reverse_id: ID_REAL,
        codigo_postagem: null,
      }),
    ).toBe(true);
  });

  it("vínculo real COM código já emitido: cancelar continua (o servidor deixa)", () => {
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        me_reverse_id: ID_REAL,
        codigo_postagem: "AB123456789BR",
      }),
    ).toEqual(["informar_envio", "cancelar"]);
  });

  it("fase de RESERVA ('reservando:') sem código: cancelar continua (a edge desfaz sozinha)", () => {
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        me_reverse_id: RESERVA,
        codigo_postagem: null,
      }),
    ).toEqual(["cancelar"]);
    expect(
      cancelamentoDependeDaLoja({
        status: "aprovada",
        me_reverse_id: RESERVA,
        codigo_postagem: null,
      }),
    ).toBe(false);
  });

  it("sem vínculo nenhum: tudo como antes", () => {
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        me_reverse_id: null,
      }),
    ).toEqual(["cancelar"]);
    expect(
      acoesDoCliente({ status: "aprovada", metodo_retorno: "coleta" }),
    ).toEqual(["cancelar"]);
  });

  it("o guard do servidor não olha o método: envio próprio com vínculo real preso também perde o cancelar, mas segue informando o envio", () => {
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "envio_proprio",
        me_reverse_id: ID_REAL,
        codigo_postagem: null,
      }),
    ).toEqual(["informar_envio"]);
  });

  it("o guard vale para 'solicitada' também (o servidor checa os dois status)", () => {
    expect(
      acoesDoCliente({
        status: "solicitada",
        metodo_retorno: "etiqueta_reversa",
        me_reverse_id: ID_REAL,
        codigo_postagem: null,
      }),
    ).toEqual([]);
  });

  it("fora de solicitada/aprovada o servidor nem chega no guard: nada muda (sem cancelar de qualquer jeito)", () => {
    for (const status of ["em_transito", "recebida", "concluida"] as const) {
      expect(
        acoesDoCliente({
          status,
          metodo_retorno: "etiqueta_reversa",
          me_reverse_id: ID_REAL,
          codigo_postagem: null,
        }),
      ).toEqual([]);
      expect(
        cancelamentoDependeDaLoja({
          status,
          me_reverse_id: ID_REAL,
          codigo_postagem: null,
        }),
      ).toBe(false);
    }
  });
});

function detalheDe(over: Partial<DevolucaoDetalhe>): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261113-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "etiqueta_reversa",
    status: "aprovada",
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
    prazo_ate: "2026-11-20",
    politica: null,
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: "2026-11-02T12:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [
      { id: "i-1", quantidade: 1, valor_unitario: 100, product_name: "Tênis" },
    ],
    eventos: [],
    pedido: null,
    ...over,
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onCancelar = vi.fn(async (_id: string) => ({ ok: true as const }));

beforeEach(() => {
  onCancelar.mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(atual: DevolucaoDetalhe) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoVivo={null}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={onCancelar as never}
        onInformarEnvio={vi.fn()}
      />,
    );
  });
}

const botaoCancelar = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Cancelar devolução",
  );

const orientacao = () =>
  hospedeiro.querySelector(
    '[data-testid="cancelar-devolucao-fale-com-a-loja"]',
  );

describe("cartão da cliente: o cancelar só aparece quando o servidor deixa", () => {
  it("vínculo real preso: sem botão, com a orientação de falar com a loja, sem mostrar o id", async () => {
    await montar(detalheDe({ me_reverse_id: ID_REAL, codigo_postagem: null }));
    expect(botaoCancelar()).toBeUndefined();
    expect(orientacao()?.textContent).toContain(
      "Se precisar cancelar, fale com a loja.",
    );
    expect(hospedeiro.textContent).not.toContain(ID_REAL);
  });

  it("reserva em andamento: o botão continua e não há orientação", async () => {
    await montar(detalheDe({ me_reverse_id: RESERVA, codigo_postagem: null }));
    expect(botaoCancelar()).toBeTruthy();
    expect(orientacao()).toBeNull();
  });

  it("código já emitido: o botão continua e não há orientação", async () => {
    await montar(
      detalheDe({ me_reverse_id: ID_REAL, codigo_postagem: "AB123456789BR" }),
    );
    expect(botaoCancelar()).toBeTruthy();
    expect(orientacao()).toBeNull();
  });

  it("sem vínculo: o botão continua e não há orientação", async () => {
    await montar(detalheDe({ me_reverse_id: null }));
    expect(botaoCancelar()).toBeTruthy();
    expect(orientacao()).toBeNull();
  });

  it("confirmação já aberta e a ficha relê com o vínculo preso: 'Sim, cancelar' não chama o servidor", async () => {
    await montar(detalheDe({ me_reverse_id: RESERVA, codigo_postagem: null }));
    await act(async () => {
      botaoCancelar()?.click();
    });
    const sim = () =>
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Sim, cancelar",
      );
    expect(sim()).toBeTruthy();

    // O vínculo da reserva vira um id real preso por baixo da confirmação.
    await montar(detalheDe({ me_reverse_id: ID_REAL, codigo_postagem: null }));
    await act(async () => {
      sim()?.click();
    });
    expect(onCancelar).not.toHaveBeenCalled();
  });

  it("controle: sem vínculo preso, 'Sim, cancelar' chama o servidor", async () => {
    await montar(detalheDe({ me_reverse_id: null }));
    await act(async () => {
      botaoCancelar()?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === "Sim, cancelar")
        ?.click();
    });
    expect(onCancelar).toHaveBeenCalledWith("d-1");
  });

  it("devolução encerrada com vínculo velho preso não ganha orientação nenhuma", async () => {
    await montar(
      detalheDe({
        status: "cancelada",
        me_reverse_id: ID_REAL,
        codigo_postagem: null,
      }),
    );
    expect(botaoCancelar()).toBeUndefined();
    expect(orientacao()).toBeNull();
  });
});
