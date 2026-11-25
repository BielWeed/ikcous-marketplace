// @vitest-environment jsdom
//
// Provas fortes das ações da ficha da devolução (AcoesDaDevolucao): o que a
// lojista decide e o que SAI para o servidor. Cada caso aqui existe porque um
// defeito de uma linha na tela (reembolso gravado numa troca, vínculo liberado
// com a caixa de outro vínculo marcada, conclusão sem conferir todos os itens,
// resolução inicial trocada, texto do reembolso fora do app) passava nos
// testes anteriores. Valores escritos à mão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function item(
  id: string,
  nome: string,
  quantidade: number,
  valor_unitario: number,
) {
  return {
    id,
    order_item_id: `o-${id}`,
    product_id: `p-${id}`,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade,
    valor_unitario,
    condicao: null,
    reestocar: null,
    reestocado_em: null,
  };
}

function detalheDe(
  over: Partial<DevolucaoDetalhe> = {},
  pedido: Partial<NonNullable<DevolucaoDetalhe["pedido"]>> = {},
): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261103-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "recebida",
    valor_itens: 200,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos: [],
    codigo_rastreio: "AB123456789BR",
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-11-01T15:00:00Z",
    prazo_ate: "2026-11-08",
    politica: null,
    created_at: "2026-11-02T10:00:00Z",
    aprovada_em: "2026-11-02T11:00:00Z",
    postada_em: "2026-11-02T12:00:00Z",
    recebida_em: "2026-11-03T12:00:00Z",
    concluida_em: null,
    encerrada_em: null,
    itens: [
      item("a", "Camiseta azul", 1, 100),
      item("b", "Calça preta", 1, 100),
    ],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 200,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "Maria Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
      ...pedido,
    },
    ...over,
  } as DevolucaoDetalhe;
}

const ficha = {
  emVoo: null,
  concluir: vi.fn(),
  recusar: vi.fn(),
  reprovar: vi.fn(),
  aprovar: vi.fn(),
  marcarEmTransito: vi.fn(),
  marcarRecebida: vi.fn(),
  gerarEtiquetaReversa: vi.fn(),
  liberarVinculoReverso: vi.fn(),
};
let fichaAtual: FichaDaDevolucao;
const confirmar = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  confirmar.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmar);
  fichaAtual = { ...ficha, emVoo: null } as unknown as FichaDaDevolucao;
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

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function renderizar(detalhe: DevolucaoDetalhe) {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={fichaAtual}
        detalhe={detalhe}
        onSujoMudou={vi.fn()}
      />,
    );
  });
  await drenar();
}

const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const condicaoDe = (produto: string, texto: string) =>
  Array.from(
    hospedeiro.querySelectorAll(
      `[role="group"][aria-label="Condição de ${produto}"] button`,
    ),
  ).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

const campoValor = () =>
  hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");
const alerta = () =>
  hospedeiro.querySelector('[role="alert"]')?.textContent ?? null;

async function abrirConclusao(detalhe: DevolucaoDetalhe) {
  await renderizar(detalhe);
  await clicar(botao("Concluir"));
}

describe("Concluir devolução — o que sai para o servidor", () => {
  it("reembolso: manda a resolução, o valor, e item a item a condição e o estoque", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Usada"));
    await clicar(botao("Concluir devolução"));

    expect(fichaAtual.concluir).toHaveBeenCalledTimes(1);
    expect(fichaAtual.concluir).toHaveBeenCalledWith({
      resolucao: "reembolso",
      itens: [
        { item_id: "a", condicao: "nova", reestocar: true },
        { item_id: "b", condicao: "usada", reestocar: false },
      ],
      valorReembolso: 200,
      observacao: "",
    });
  });

  it.each([
    ["Troca", "troca"],
    ["Vale-troca", "vale"],
  ] as const)(
    "resolução %s NÃO manda valor de reembolso (nenhum dinheiro sai) e não pergunta do Mercado Pago",
    async (rotulo, resolucao) => {
      await abrirConclusao(detalheDe());
      await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
      await clicar(condicaoDe("Calça preta", "Nova, sem uso"));
      await clicar(botao(rotulo));
      expect(campoValor()).toBeNull();
      await clicar(botao("Concluir devolução"));

      expect(confirmar).not.toHaveBeenCalled();
      expect(fichaAtual.concluir).toHaveBeenCalledTimes(1);
      const enviado = (fichaAtual.concluir as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(enviado.resolucao).toBe(resolucao);
      expect(enviado.valorReembolso).toBeNull();
    },
  );

  it("com UM item sem condição marcada, não conclui: pede a conferência de cada item", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    // a Calça preta ficou sem condição
    await clicar(botao("Concluir devolução"));

    expect(alerta()).toBe("Informe a condição de cada item recebido.");
    expect(fichaAtual.concluir).not.toHaveBeenCalled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("valor do reembolso zerado não conclui", async () => {
    await abrirConclusao(
      detalheDe({
        valor_itens: 100,
        itens: [item("a", "Camiseta azul", 1, 100)],
      }),
    );
    await clicar(condicaoDe("Camiseta azul", "Não veio"));
    // tudo ausente: o sugerido cai a zero
    expect(campoValor()?.value).toBe("0,00");
    await clicar(botao("Concluir devolução"));

    expect(alerta()).toBe("Informe o valor do reembolso.");
    expect(fichaAtual.concluir).not.toHaveBeenCalled();
  });
});

describe("Resolução inicial da conclusão", () => {
  it("começa na resolução que o cliente pediu quando ela é permitida para o tipo", async () => {
    await abrirConclusao(detalheDe({ resolucao_desejada: "vale" }));
    const marcado = Array.from(hospedeiro.querySelectorAll("fieldset button"))
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
    expect(marcado).toEqual(["Vale-troca"]);
    expect(campoValor()).toBeNull();
  });

  it("numa troca o reembolso nem é oferecido: começa em 'Troca' mesmo que o cliente tenha pedido reembolso", async () => {
    await abrirConclusao(
      detalheDe({ tipo: "troca", resolucao_desejada: "reembolso" }),
    );
    const botoes = Array.from(hospedeiro.querySelectorAll("fieldset button"));
    expect(botoes.map((b) => b.textContent)).toEqual(["Troca", "Vale-troca"]);
    expect(
      botoes
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent),
    ).toEqual(["Troca"]);
    expect(campoValor()).toBeNull();
  });
});

describe("Pergunta antes de devolver dinheiro", () => {
  it("pedido pago fora do app: o texto manda devolver em mãos ou por PIX, com o valor digitado", async () => {
    await abrirConclusao(
      detalheDe(
        {},
        { payment_method: "entrega", payment_status: "aguardando" },
      ),
    );
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toMatch(
      /^Registrar o reembolso de R\$\s200,00\? Este pedido não foi pago pelo app: você devolve o dinheiro ao cliente em mãos ou por PIX\.$/,
    );
    expect(fichaAtual.concluir).toHaveBeenCalledTimes(1);
  });

  it("pedido pago pelo app: o texto fala do Mercado Pago, do valor e dos 180 dias", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Não veio"));
    await clicar(botao("Concluir devolução"));

    expect(confirmar.mock.calls[0][0]).toMatch(
      /^Devolver R\$\s100,00 ao cliente pelo Mercado Pago\? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer\. Se o pagamento tiver mais de 180 dias/,
    );
  });

  it("se a lojista recusar a pergunta, nada é enviado", async () => {
    confirmar.mockReturnValue(false);
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Nova, sem uso"));
    await clicar(botao("Concluir devolução"));

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(fichaAtual.concluir).not.toHaveBeenCalled();
  });
});

describe("Liberar vínculo preso — a caixa vale só para o vínculo que foi conferido", () => {
  const preso = (meReverseId: string) =>
    detalheDe({
      status: "aprovada",
      metodo_retorno: "etiqueta_reversa",
      me_reverse_id: meReverseId,
      codigo_postagem: null,
    });
  const caixa = () =>
    hospedeiro.querySelector<HTMLInputElement>(
      '[data-testid="liberar-vinculo-reverso"] input[type="checkbox"]',
    );
  const liberar = () => botao("Liberar vínculo preso");

  it("marcar a caixa para o vínculo A e a ficha trocar para o vínculo B: a caixa volta desmarcada e o botão trava", async () => {
    await renderizar(preso("me-A"));
    expect(liberar()?.disabled).toBe(true);
    await clicar(caixa());
    expect(caixa()?.checked).toBe(true);
    expect(liberar()?.disabled).toBe(false);

    // a mesma ficha (mesmo id e status, sem remontar) ganha OUTRO vínculo
    await renderizar(preso("me-B"));
    expect(caixa()?.checked).toBe(false);
    expect(liberar()?.disabled).toBe(true);
  });

  it("desmarcar a caixa trava o botão de novo", async () => {
    await renderizar(preso("me-A"));
    await clicar(caixa());
    expect(liberar()?.disabled).toBe(false);
    await clicar(caixa());
    expect(liberar()?.disabled).toBe(true);
  });
});

describe("Etiqueta reversa, rastreio e recebimento — o primeiro toque só pergunta", () => {
  const aprovadaComEtiqueta = (extra: Partial<DevolucaoDetalhe> = {}) =>
    detalheDe({
      status: "aprovada",
      metodo_retorno: "etiqueta_reversa",
      codigo_postagem: null,
      etiqueta_url: null,
      me_reverse_id: null,
      ...extra,
    });

  it("sem código gerado, 'Gerar código de postagem' abre a confirmação e só 'Confirmar e gerar' compra", async () => {
    await renderizar(aprovadaComEtiqueta());
    await clicar(botao("Gerar código de postagem"));
    expect(fichaAtual.gerarEtiquetaReversa).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).not.toBeNull();

    await clicar(botao("Cancelar"));
    expect(fichaAtual.gerarEtiquetaReversa).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).toBeNull();

    await clicar(botao("Gerar código de postagem"));
    await clicar(botao("Confirmar e gerar"));
    expect(fichaAtual.gerarEtiquetaReversa).toHaveBeenCalledTimes(1);
  });

  it("com o código já gravado (falta só a DC-e), o botão busca direto, sem pedir confirmação de compra", async () => {
    await renderizar(aprovadaComEtiqueta({ codigo_postagem: "AB123456789BR" }));
    await clicar(botao("Buscar DC-e / conferir código"));
    expect(fichaAtual.gerarEtiquetaReversa).toHaveBeenCalledTimes(1);
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-etiqueta-reversa"]'),
    ).toBeNull();
  });

  it("'Marcar como recebida' só confirma depois do segundo toque", async () => {
    await renderizar(detalheDe({ status: "em_transito" }));
    await clicar(botao("Marcar como recebida"));
    expect(fichaAtual.marcarRecebida).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="confirmar-recebida"]'),
    ).not.toBeNull();

    await clicar(botao("Confirmar recebimento"));
    expect(fichaAtual.marcarRecebida).toHaveBeenCalledTimes(1);
  });

  it("'Marcar a caminho' manda o código digitado em maiúsculas, ou o código de postagem quando ela não digita", async () => {
    await renderizar(
      aprovadaComEtiqueta({
        codigo_postagem: "PS999999999BR",
        etiqueta_url: "https://x/etq.pdf",
      }),
    );
    await clicar(botao("Marcar a caminho"));
    expect(fichaAtual.marcarEmTransito).toHaveBeenLastCalledWith(
      "PS999999999BR",
    );

    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#devolucao-rastreio",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "ab123456789br");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await drenar();
    await clicar(botao("Marcar a caminho"));
    expect(fichaAtual.marcarEmTransito).toHaveBeenLastCalledWith(
      "AB123456789BR",
    );
  });
});

describe("Enquanto uma ação está em andamento, os botões travam", () => {
  it("emVoo preenchido desabilita Aprovar-confirmar e Recusar-confirmar (um toque a mais não repete o pedido)", async () => {
    fichaAtual = {
      ...ficha,
      emVoo: "decidir",
    } as unknown as FichaDaDevolucao;
    await renderizar(detalheDe({ status: "solicitada" }));
    await clicar(botao("Aprovar"));
    expect(botao("Confirmar aprovação")?.disabled).toBe(true);
    await clicar(botao("Recusar"));
    expect(botao("Recusar devolução")?.disabled).toBe(true);
  });

  it("sem ação em andamento, os mesmos botões estão habilitados", async () => {
    await renderizar(detalheDe({ status: "solicitada" }));
    await clicar(botao("Aprovar"));
    expect(botao("Confirmar aprovação")?.disabled).toBe(false);
  });
});
