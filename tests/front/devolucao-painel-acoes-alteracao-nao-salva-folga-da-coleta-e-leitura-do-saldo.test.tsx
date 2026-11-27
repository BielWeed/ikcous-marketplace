// @vitest-environment jsdom
//
// Caça por mutação em AcoesDaDevolucao: três bordas que nenhum teste percebia.
// 1) O aviso "tem alteração não salva" (onSujoMudou) que protege a lojista de
//    fechar a ficha perdendo o que digitou: espaço sozinho NÃO é alteração;
//    texto de verdade é; e o valor do reembolso digitado também é.
// 2) A folga de 5 minutos da coleta: 6 minutos atrás é passado, 5 exatos ainda vale.
// 3) A leitura do saldo (RPC) só existe com a devolução já "recebida".
// 4) Na conclusão: o texto do saldo que limita o valor sugerido, o aviso de item
//    "Não veio" (singular/plural e a frase do frete) e o "(já voltou)" do estoque.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import { campoDoBannerDoInstante } from "@/lib/datas-do-banner";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function item(id: string, nome: string, valor: number) {
  return {
    id,
    order_item_id: `o-${id}`,
    product_id: `p-${id}`,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade: 1,
    valor_unitario: valor,
    condicao: null,
    reestocar: null,
    reestocado_em: null,
  };
}

function detalheDe(over: Partial<DevolucaoDetalhe> = {}): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261112-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
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
    entregue_em: "2026-11-10T15:00:00Z",
    prazo_ate: "2026-11-17",
    politica: null,
    created_at: "2026-11-12T10:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [item("a", "Camiseta azul", 100)],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 100,
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
  } as unknown as DevolucaoDetalhe;
}

const aprovar = vi.fn();
const sujoMudou = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;
const AGORA = new Date(2026, 10, 12, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  rpc.mockResolvedValue({ data: null, error: null });
  aprovar.mockResolvedValue(null);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
async function mostrar(detalhe: DevolucaoDetalhe) {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  const ficha = { emVoo: null, aprovar } as unknown as FichaDaDevolucao;
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={ficha}
        detalhe={detalhe}
        onSujoMudou={sujoMudou}
      />,
    );
  });
  await drenar();
}
const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}
/** Digita no campo e sai dele (o campo só entrega o texto ao sair). */
async function digitar(seletor: string, texto: string) {
  const campo = hospedeiro.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >(seletor);
  expect(campo, seletor).toBeTruthy();
  const alvo = campo as HTMLInputElement | HTMLTextAreaElement;
  const prototipo =
    alvo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    alvo.focus();
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(alvo, texto);
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => alvo.blur());
  await drenar();
}
const ultimoSujo = () => sujoMudou.mock.calls.at(-1)?.[0];
const algumaVezSujo = () => sujoMudou.mock.calls.some(([sujo]) => sujo);

describe("aviso de alteração não salva", () => {
  it("só espaços na mensagem de aprovação não são alteração; texto de verdade é; apagar volta ao limpo", async () => {
    await mostrar(detalheDe());
    await clicar(botao("Aprovar"));
    expect(ultimoSujo()).toBe(false);

    await digitar("#devolucao-mensagem", "   ");
    expect(algumaVezSujo()).toBe(false);

    await digitar("#devolucao-mensagem", "Traga a nota fiscal");
    expect(ultimoSujo()).toBe(true);

    await digitar("#devolucao-mensagem", "");
    expect(ultimoSujo()).toBe(false);
  });

  it("só espaços no motivo da recusa não são alteração; texto de verdade é", async () => {
    await mostrar(detalheDe());
    await clicar(botao("Recusar"));
    await digitar("#devolucao-recusa", "    ");
    expect(algumaVezSujo()).toBe(false);
    await digitar("#devolucao-recusa", "Produto personalizado");
    expect(ultimoSujo()).toBe(true);
  });

  it("espaço sobrando depois do código de postagem não conta como mudança no rastreio", async () => {
    await mostrar(
      detalheDe({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        codigo_postagem: "AB123456789BR",
      }),
    );
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#devolucao-rastreio")?.value,
    ).toBe("AB123456789BR");
    expect(ultimoSujo()).toBe(false);

    await digitar("#devolucao-rastreio", "AB123456789BR ");
    expect(algumaVezSujo()).toBe(false);

    await digitar("#devolucao-rastreio", "ZZ999999999BR");
    expect(ultimoSujo()).toBe(true);
  });

  it("digitar só o valor do reembolso já é alteração; entrar e sair do campo sem mexer não é", async () => {
    await mostrar(detalheDe({ status: "recebida" }));
    await clicar(botao("Concluir"));
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");
    expect(campo?.value).toBe("100,00");
    await act(async () => campo?.focus());
    await act(async () => campo?.blur());
    expect(algumaVezSujo()).toBe(false);

    await digitar("#devolucao-valor", "7500");
    expect(campo?.value).toBe("75,00");
    expect(ultimoSujo()).toBe(true);
  });

  it("escolher o dia da coleta já é alteração", async () => {
    await mostrar(detalheDe({ metodo_retorno: "coleta" }));
    await clicar(botao("Aprovar"));
    expect(ultimoSujo()).toBe(false);
    await digitar("#devolucao-coleta", "2026-11-20T10:00");
    expect(ultimoSujo()).toBe(true);
  });

  it("marcar a condição de um item é alteração", async () => {
    await mostrar(detalheDe({ status: "recebida" }));
    await clicar(botao("Concluir"));
    expect(algumaVezSujo()).toBe(false);
    await clicar(botao("Usada"));
    expect(ultimoSujo()).toBe(true);
  });

  it("ao sair da ficha o aviso é desligado, mesmo com alteração pendente", async () => {
    await mostrar(detalheDe());
    await clicar(botao("Aprovar"));
    await digitar("#devolucao-mensagem", "Traga a nota fiscal");
    expect(ultimoSujo()).toBe(true);
    act(() => raiz.render(<div />));
    expect(ultimoSujo()).toBe(false);
  });
});

describe("folga de 5 minutos da coleta", () => {
  // O campo é lido como horário de Brasília, então é nele que se escreve.
  const paraCampo = (d: Date) => campoDoBannerDoInstante(d.toISOString());
  const coletaHa = (minutos: number) =>
    new Date(AGORA.getTime() - minutos * 60_000);

  async function aprovarComColeta(coleta: Date) {
    await mostrar(detalheDe({ metodo_retorno: "coleta" }));
    await clicar(botao("Aprovar"));
    await digitar("#devolucao-coleta", paraCampo(coleta));
    await clicar(botao("Confirmar aprovação"));
  }
  const alerta = () =>
    hospedeiro.querySelector('[role="alert"]')?.textContent ?? null;

  it("6 minutos atrás já é passado: avisa e não aprova", async () => {
    await aprovarComColeta(coletaHa(6));
    expect(alerta()).toBe(
      "Escolha um dia e hora da coleta que ainda não passaram.",
    );
    expect(aprovar).not.toHaveBeenCalled();
  });

  it("10 minutos atrás também é passado", async () => {
    await aprovarComColeta(coletaHa(10));
    expect(alerta()).toContain("que ainda não passaram");
    expect(aprovar).not.toHaveBeenCalled();
  });

  it("exatamente 5 minutos atrás ainda vale (folga do relógio do aparelho)", async () => {
    await aprovarComColeta(coletaHa(5));
    expect(alerta()).toBeNull();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: coletaHa(5).toISOString(),
    });
  });
});

describe("leitura do saldo do reembolso", () => {
  it.each(["solicitada", "aprovada", "em_transito"] as const)(
    "com a devolução %s nenhuma consulta de saldo é feita",
    async (status) => {
      await mostrar(detalheDe({ status }));
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("com a devolução recebida o saldo do pedido é consultado uma vez", async () => {
    await mostrar(detalheDe({ status: "recebida" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_order_id: "o-1" });
  });
});

describe("limite de tamanho dos campos de texto", () => {
  const limite = (seletor: string) =>
    hospedeiro.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)
      ?.maxLength;

  it("mensagem de aprovação e motivo da recusa aceitam até 1000 caracteres", async () => {
    await mostrar(detalheDe());
    await clicar(botao("Aprovar"));
    expect(limite("#devolucao-mensagem")).toBe(1000);
    await clicar(botao("Recusar"));
    expect(limite("#devolucao-recusa")).toBe(1000);
  });

  it("código de rastreio aceita até 40 caracteres", async () => {
    await mostrar(
      detalheDe({ status: "aprovada", metodo_retorno: "envio_proprio" }),
    );
    expect(limite("#devolucao-rastreio")).toBe(40);
  });

  it("observação da inspeção e motivo da reprovação aceitam até 1000 caracteres", async () => {
    await mostrar(detalheDe({ status: "recebida" }));
    await clicar(botao("Concluir"));
    expect(limite("#devolucao-observacao")).toBe(1000);
    await clicar(botao("Reprovar"));
    expect(limite("#devolucao-reprovar")).toBe(1000);
  });
});

const condicaoDe = (produto: string, texto: string) =>
  Array.from(
    hospedeiro.querySelectorAll(
      `[role="group"][aria-label="Condição de ${produto}"] button`,
    ),
  ).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
const textoDoAviso = () =>
  hospedeiro
    .querySelector('[data-testid="aviso-item-fora-do-valor"]')
    ?.textContent?.replace(/\s+/g, " ")
    .replace(/\p{Zs}/gu, " ");
const campoValor = () =>
  hospedeiro.querySelector<HTMLInputElement>("#devolucao-valor");

function saldoDoServidor(disponivel: number) {
  return {
    total: 300,
    valor_estornado: 0,
    em_voo: 0,
    em_duvida: 0,
    manual: 0,
    disponivel,
    reservado_por_fora: 0,
    linhas: [],
  };
}
const TRES_ITENS = [
  item("a", "Camiseta azul", 100),
  item("b", "Calça preta", 100),
  item("c", "Boné verde", 100),
];

describe("conclusão: avisos de item que não veio, saldo e estoque", () => {
  it("dois itens 'Não veio' falam 'desses itens' e somam o desconto; um só fala 'desse item'", async () => {
    await mostrar(
      detalheDe({ status: "recebida", valor_itens: 300, itens: TRES_ITENS }),
    );
    await clicar(botao("Concluir"));
    await clicar(condicaoDe("Camiseta azul", "Não veio"));
    expect(textoDoAviso()).toContain(
      'Você marcou Camiseta azul como "Não veio": o valor sugerido já desconta R$ 100,00 desse item.',
    );
    await clicar(condicaoDe("Calça preta", "Não veio"));
    expect(textoDoAviso()).toContain(
      'Você marcou Camiseta azul, Calça preta como "Não veio": o valor sugerido já desconta R$ 200,00 desses itens.',
    );
    expect(campoValor()?.value).toBe("100,00");
  });

  it("a frase do frete só aparece quando o pedido tinha frete de ida", async () => {
    await mostrar(
      detalheDe({
        status: "recebida",
        valor_itens: 300,
        itens: TRES_ITENS,
        valor_frete_ida: 0,
      }),
    );
    await clicar(botao("Concluir"));
    await clicar(condicaoDe("Camiseta azul", "Não veio"));
    expect(textoDoAviso()).not.toContain("Frete não incluído");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await mostrar(
      detalheDe({
        status: "recebida",
        valor_itens: 300,
        itens: TRES_ITENS,
        valor_frete_ida: 15,
      }),
    );
    await clicar(botao("Concluir"));
    await clicar(condicaoDe("Camiseta azul", "Não veio"));
    expect(textoDoAviso()).toContain(
      "Frete não incluído: nem todos os itens voltaram.",
    );
  });

  it("saldo do servidor menor que o sugerido limita o valor e explica por quê", async () => {
    rpc.mockResolvedValue({ data: saldoDoServidor(40), error: null });
    await mostrar(
      detalheDe({ status: "recebida", valor_itens: 300, itens: TRES_ITENS }),
    );
    await clicar(botao("Concluir"));
    expect(campoValor()?.value).toBe("40,00");
    const nota = hospedeiro.textContent?.replace(/\p{Zs}/gu, " ") ?? "";
    expect(nota).toContain(
      "O valor sugerido é o que ainda pode ser devolvido deste pedido (R$ 40,00).",
    );
  });

  it("saldo folgado não limita nem aparece nota nenhuma sobre saldo", async () => {
    rpc.mockResolvedValue({ data: saldoDoServidor(500), error: null });
    await mostrar(
      detalheDe({ status: "recebida", valor_itens: 300, itens: TRES_ITENS }),
    );
    await clicar(botao("Concluir"));
    expect(campoValor()?.value).toBe("300,00");
    expect(hospedeiro.textContent).not.toContain("ainda pode ser devolvido");
  });

  it("item que já voltou ao estoque avisa '(já voltou)'; o outro não", async () => {
    await mostrar(
      detalheDe({
        status: "recebida",
        valor_itens: 200,
        itens: [
          {
            ...item("a", "Camiseta azul", 100),
            reestocado_em: "2026-11-05T10:00:00Z",
          },
          item("b", "Calça preta", 100),
        ],
      }),
    );
    await clicar(botao("Concluir"));
    const rotulos = Array.from(hospedeiro.querySelectorAll("span"))
      .map((e) => e.textContent?.trim())
      .filter((t) => t?.startsWith("Voltar ao estoque"));
    expect(rotulos).toEqual([
      "Voltar ao estoque (já voltou)",
      "Voltar ao estoque",
    ]);
  });
});
