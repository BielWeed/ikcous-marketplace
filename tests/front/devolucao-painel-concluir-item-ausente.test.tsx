// @vitest-environment jsdom
//
// Conclusão da devolução no painel (AcoesDaDevolucao): o valor SUGERIDO do
// reembolso não pode contar, em silêncio, o item que a lojista marcou como
// "Não veio" (a caixa chegou sem ele) nem esconder o "Danificada".
//
// - "Não veio": a ficha traz o preço de cada item (`valor_unitario`, já com o
//   cupom rateado), então o sugerido desconta esse item e a tela explica.
// - "Danificada": reembolsar o valor cheio pode ser legítimo (decisão da
//   lojista), então o valor NÃO muda — só aparece o aviso.
// Nada muda no que é gravado/cobrado: o campo segue editável e o front manda
// ao servidor o valor que estiver no campo.
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

function detalheDe(over: Partial<DevolucaoDetalhe> = {}): DevolucaoDetalhe {
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
    },
    ...over,
  } as DevolucaoDetalhe;
}

const concluir = vi.fn();
const recusar = vi.fn();
const reprovar = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  concluir.mockResolvedValue(null);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
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

async function montar(detalhe: DevolucaoDetalhe) {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  const ficha = {
    emVoo: null,
    concluir,
    recusar,
    reprovar,
  } as unknown as FichaDaDevolucao;
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={ficha}
        detalhe={detalhe}
        onSujoMudou={vi.fn()}
      />,
    );
  });
  await drenar();
}

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

function condicaoDe(produto: string, texto: string) {
  const botoes = hospedeiro.querySelectorAll(
    `[role="group"][aria-label="Condição de ${produto}"] button`,
  );
  return Array.from(botoes).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

// Retornar ao trim() permite gravar uma decisão sem justificativa legível.
describe.each([
  [
    "recusar",
    "solicitada",
    "Recusar",
    "Recusar devolução",
    recusar,
    "Explique ao cliente o motivo da recusa.",
  ],
  [
    "reprovar",
    "recebida",
    "Reprovar",
    "Reprovar na inspeção",
    reprovar,
    "Explique ao cliente por que o produto não foi aceito.",
  ],
] as const)(
  "motivo visível para %s",
  (modo, status, abrir, confirmar, enviar, erro) => {
    async function preencher(texto: string) {
      await montar(detalheDe({ status }));
      await clicar(botao(abrir));
      const campo = hospedeiro.querySelector<HTMLTextAreaElement>(
        modo === "recusar" ? "#devolucao-recusa" : "#devolucao-reprovar",
      );
      expect(campo).toBeTruthy();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(campo, texto);
        campo?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      await clicar(botao(confirmar));
    }

    it.each([0x200b, 0x200e, 0x2800, 0x3164])(
      "não envia justificativa só com invisível %j",
      async (invisivel) => {
        await preencher(String.fromCodePoint(invisivel));
        expect(
          hospedeiro.querySelector('[role="alert"]')?.textContent,
        ).toContain(erro);
        expect(enviar).not.toHaveBeenCalled();
      },
    );

    it("envia justificativa legível sem alterar o texto", async () => {
      await preencher("Produto voltou sem etiqueta.");
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
      expect(enviar).toHaveBeenCalledExactlyOnceWith(
        "Produto voltou sem etiqueta.",
      );
    });
  },
);

const campoValor = () =>
  hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");
const aviso = () =>
  hospedeiro.querySelector('[data-testid="aviso-item-fora-do-valor"]');

async function abrirConclusao(detalhe: DevolucaoDetalhe) {
  await montar(detalhe);
  await clicar(botao("Concluir"));
  expect(campoValor()).not.toBeNull();
}

describe("AcoesDaDevolucao — valor sugerido e itens que não voltaram", () => {
  it("sem item problemático: valor cheio e nenhum aviso (comportamento de antes)", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Nova, sem uso"));

    expect(campoValor()?.value).toBe("200,00");
    expect(aviso()).toBeNull();
  });

  it("item 'Não veio': o sugerido desconta o item e a tela diz qual e quanto", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Não veio"));

    expect(campoValor()?.value).toBe("100,00");
    const texto = aviso()?.textContent ?? "";
    expect(texto).toContain("Calça preta");
    expect(texto).toContain("Não veio");
    expect(texto).toContain("100,00");
  });

  it("quantidade maior que um: desconta quantidade x preço do item", async () => {
    await abrirConclusao(
      detalheDe({
        valor_itens: 230,
        itens: [item("a", "Meia", 3, 10), item("b", "Calça preta", 2, 100)],
      }),
    );
    await clicar(condicaoDe("Meia", "Não veio"));
    await clicar(condicaoDe("Calça preta", "Nova, sem uso"));

    // 230 - (3 x 10) = 200
    expect(campoValor()?.value).toBe("200,00");
  });

  it("o frete de ida continua na sugestão (decisão da lojista) e o aviso manda conferir", async () => {
    await abrirConclusao(detalheDe({ valor_frete_ida: 20 }));
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Não veio"));

    expect(campoValor()?.value).toBe("120,00");
    expect(aviso()?.textContent).toContain("frete");
    // Com item que não veio, a tela não afirma que o pedido voltou inteiro.
    expect(document.body.textContent).not.toContain("o pedido voltou inteiro");
  });

  it("com todos os itens recebidos, a linha do frete diz que o pedido voltou inteiro", async () => {
    await abrirConclusao(detalheDe({ valor_frete_ida: 20 }));
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Nova, sem uso"));

    expect(document.body.textContent).toContain("o pedido voltou inteiro");
  });

  it("item 'Danificada': o valor NÃO muda, mas o aviso aparece", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Danificada"));

    expect(campoValor()?.value).toBe("200,00");
    const texto = aviso()?.textContent ?? "";
    expect(texto).toContain("Calça preta");
    expect(texto).toContain("Danificada");
  });

  it("voltou a marcar o item como recebido: o valor cheio e o aviso somem", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Calça preta", "Não veio"));
    expect(campoValor()?.value).toBe("100,00");

    await clicar(condicaoDe("Calça preta", "Usada"));
    expect(campoValor()?.value).toBe("200,00");
    expect(aviso()).toBeNull();
  });

  it("borda: tudo 'Não veio' e sem frete zera o sugerido e a conclusão pede o valor", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Não veio"));
    await clicar(condicaoDe("Calça preta", "Não veio"));

    expect(campoValor()?.value).toBe("0,00");
    await clicar(botao("Concluir devolução"));

    expect(concluir).not.toHaveBeenCalled();
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Informe o valor do reembolso.");
  });

  it("borda: soma dos itens arredondada acima de valor_itens nunca vira valor negativo", async () => {
    await abrirConclusao(
      detalheDe({
        valor_itens: 99.99,
        itens: [item("a", "Camiseta azul", 1, 100)],
      }),
    );
    await clicar(condicaoDe("Camiseta azul", "Não veio"));

    expect(campoValor()?.value).toBe("0,00");
  });

  it("o servidor recebe o valor que está no campo (100,00), nunca o cheio", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Não veio"));
    await clicar(botao("Concluir devolução"));

    expect(globalThis.confirm).toHaveBeenCalledWith(
      expect.stringContaining("100,00"),
    );
    expect(concluir).toHaveBeenCalledTimes(1);
    expect(concluir).toHaveBeenCalledWith(
      expect.objectContaining({
        resolucao: "reembolso",
        valorReembolso: 100,
        itens: [
          { item_id: "a", condicao: "nova", reestocar: true },
          { item_id: "b", condicao: "ausente", reestocar: false },
        ],
      }),
    );
  });

  it("troca ou vale: não há campo de valor, então não há aviso de reembolso", async () => {
    await abrirConclusao(detalheDe());
    await clicar(condicaoDe("Calça preta", "Não veio"));
    await clicar(botao("Troca"));

    expect(campoValor()).toBeNull();
    expect(aviso()).toBeNull();
  });
});
