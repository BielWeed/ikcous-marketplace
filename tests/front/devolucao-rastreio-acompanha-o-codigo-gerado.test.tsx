// @vitest-environment jsdom
//
// "MARCAR A CAMINHO" DEPOIS DE GERAR A ETIQUETA REVERSA (r367-a).
//
// O campo "Código de rastreio" da ficha nascia com o código de postagem que
// JÁ existia na hora de abrir a ficha. Gerar a etiqueta NÃO muda o status (a
// devolução continua "aprovada"), então a ficha não remonta: o código recém-
// -gerado chegava em `detalhe.codigo_postagem` e o campo seguia vazio. A
// lojista tocava em "Marcar a caminho" com o campo vazio, a RPC gravava
// `codigo_rastreio` nulo (ela não copia o código de postagem) e a cliente
// ficava sem o botão "Rastrear devolução", embora o código já existisse.
//
// Aqui: o campo acompanha o código que chega, mas NUNCA pisa no que a lojista
// digitou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
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

function detalheDe(over: Partial<DevolucaoDetalhe> = {}): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261113-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
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
    entregue_em: "2026-11-01T15:00:00Z",
    prazo_ate: "2026-11-20",
    politica: null,
    created_at: "2026-11-02T10:00:00Z",
    aprovada_em: "2026-11-02T11:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [],
    eventos: [],
    pedido: null,
    ...over,
  } as unknown as DevolucaoDetalhe;
}

const marcarEmTransito = vi.fn(async (_codigo: string) => true);

function fichaDe(detalhe: DevolucaoDetalhe): FichaDaDevolucao {
  const nada = async () => true;
  return {
    detalhe,
    fotos: new Map(),
    carregando: false,
    erro: false,
    emVoo: null,
    recarregar: async () => {},
    aprovar: nada,
    recusar: nada,
    marcarEmTransito,
    marcarRecebida: nada,
    gerarEtiquetaReversa: nada,
    liberarVinculoReverso: nada,
    concluir: async () => null,
    reprovar: nada,
  } as unknown as FichaDaDevolucao;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  marcarEmTransito.mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function mostrar(detalhe: DevolucaoDetalhe) {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={fichaDe(detalhe)}
        detalhe={detalhe}
        onSujoMudou={vi.fn()}
      />,
    );
  });
}

const campo = () =>
  document.querySelector<HTMLInputElement>("#devolucao-rastreio");

const botaoACaminho = () =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Marcar a caminho",
  );

async function digitar(el: HTMLInputElement | null, texto: string) {
  expect(el).toBeTruthy();
  const alvo = el as HTMLInputElement;
  await act(async () => {
    alvo.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(alvo, texto);
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    alvo.blur();
  });
}

async function tocarACaminho() {
  await act(async () => {
    botaoACaminho()?.click();
  });
}

describe("Marcar a caminho — o campo acompanha o código de postagem", () => {
  it("o código gerado DEPOIS de abrir a ficha preenche o campo e vai no envio", async () => {
    await mostrar(detalheDe());
    expect(campo()?.value).toBe("");

    // A etiqueta é gerada: a ficha relê, o status segue "aprovada".
    await mostrar(detalheDe({ codigo_postagem: "AB123456789BR" }));
    expect(campo()?.value).toBe("AB123456789BR");

    await tocarACaminho();
    expect(marcarEmTransito).toHaveBeenCalledTimes(1);
    expect(marcarEmTransito).toHaveBeenCalledWith("AB123456789BR");
  });

  it("o que a lojista digitou NÃO é pisado pelo código que chega depois", async () => {
    await mostrar(detalheDe());
    await digitar(campo(), "zz999888777br");
    expect(campo()?.value).toBe("ZZ999888777BR");

    await mostrar(detalheDe({ codigo_postagem: "AB123456789BR" }));
    expect(campo()?.value).toBe("ZZ999888777BR");

    await tocarACaminho();
    expect(marcarEmTransito).toHaveBeenCalledWith("ZZ999888777BR");
  });

  it("tocar no campo vazio e sair (sem digitar) não 'trava' o vazio: o código que chega ainda entra", async () => {
    await mostrar(detalheDe());
    await digitar(campo(), "");

    await mostrar(detalheDe({ codigo_postagem: "AB123456789BR" }));
    expect(campo()?.value).toBe("AB123456789BR");
    await tocarACaminho();
    expect(marcarEmTransito).toHaveBeenCalledWith("AB123456789BR");
  });

  it("controle: ficha que já abre com o código mostra o código", async () => {
    await mostrar(detalheDe({ codigo_postagem: "AB123456789BR" }));
    expect(campo()?.value).toBe("AB123456789BR");
    await tocarACaminho();
    expect(marcarEmTransito).toHaveBeenCalledWith("AB123456789BR");
  });

  it("fora da etiqueta reversa o código de postagem não vira rastreio", async () => {
    await mostrar(
      detalheDe({
        metodo_retorno: "envio_proprio",
        codigo_postagem: "AB123456789BR",
      }),
    );
    expect(campo()?.value).toBe("");
  });
});
