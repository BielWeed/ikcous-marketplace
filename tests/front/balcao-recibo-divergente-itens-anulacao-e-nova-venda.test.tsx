// @vitest-environment jsdom
//
// Lote 245 — Balcão: o recibo vermelho ("Entrou uma venda diferente da que
// estava na tela") não pode fazer a caixa perder a venda.
//
// Caminho: venda com 3 peças → "Não sabemos se a venda foi registrada" → a
// caixa acrescenta uma 4ª peça (MESMA chave de idempotência, regra do reenvio
// que NÃO muda) → tenta de novo → o banco devolve a venda ANTIGA
// (`ja_existia`). Este arquivo prende quatro coisas:
//  (d) depois de anular, o alerta "Anule esta venda" some;
//  (a) o alerta diz QUAIS peças diferem, em palavras simples;
//  (b) "Nova venda" depois de uma divergência não apaga o cupom da tela sem
//      aviso, e depois da anulação há "Registrar de novo com os itens da tela"
//      (chave nova só nesse clique, e só com a venda antiga anulada);
//  e que a chave segue estável na retentativa de rede.
import { act, useEffect, useReducer } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

function item(
  id: string,
  nome: string,
  variacao: string | null,
  quantidade = 1,
  preco = 50,
): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom(id, null),
    productId: id,
    variantId: null,
    nome,
    variacao,
    preco,
    quantidade,
    estoque: 99,
    imagem: "",
  };
}

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const OUTRO_ORDER_ID = "22222222-2222-2222-2222-222222222222";

const CAMISETA = item("p1", "Camiseta", "M");
const CALCA = item("p2", "Calça", "42");
const BONE = item("p3", "Boné", null);
const MEIA = item("p4", "Meia", null);

function reciboDoBanco(
  itens: readonly ItemDoCupom[],
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  return {
    orderId: ORDER_ID,
    numero: "111111",
    criadoEm: "2026-10-27T12:00:00.000Z",
    total,
    subtotal: total,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens,
    jaExistia: true,
    ...parcial,
  };
}

/** A tela da caixa (enviando) com a chave que já tinha ido ao banco. */
function telaCom(itens: readonly ItemDoCupom[]): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-antiga"),
    itens,
    pagamento: "cash",
    enviando: true,
  };
}

function registradaComDivergencia(
  telaItens: readonly ItemDoCupom[],
  bancoItens: readonly ItemDoCupom[],
): EstadoDaVenda {
  return reducerDaVenda(telaCom(telaItens), {
    tipo: "venda_registrada",
    recibo: reciboDoBanco(bancoItens),
  });
}

// ----------------------------------------------------------------------------
// (a) o que difere, calculado pelo cérebro (reducer) — dado da divergência
// ----------------------------------------------------------------------------

describe("(a) divergência carrega QUAIS peças diferem", () => {
  it("a tela tem uma peça a mais do que a venda gravada: lista a peça", () => {
    const depois = registradaComDivergencia(
      [CAMISETA, CALCA, BONE, MEIA],
      [CAMISETA, CALCA, BONE],
    );
    expect(depois.recibo?.divergenciaComATela).toMatchObject({
      aMaisNaTela: [{ nome: "Meia", variacao: null, quantidade: 1 }],
    });
    expect(depois.recibo?.divergenciaComATela?.aMenosNaTela).toBeUndefined();
  });

  it("a venda gravada tem peça que a tela não tem mais: lista como a menos na tela", () => {
    const depois = registradaComDivergencia(
      [CAMISETA],
      [CAMISETA, item("p2", "Calça", "42", 2)],
    );
    expect(depois.recibo?.divergenciaComATela).toMatchObject({
      aMenosNaTela: [{ nome: "Calça", variacao: "42", quantidade: 2 }],
    });
    expect(depois.recibo?.divergenciaComATela?.aMaisNaTela).toBeUndefined();
  });

  it("mesma peça com quantidade diferente: a diferença é a de quantidade", () => {
    const depois = registradaComDivergencia(
      [item("p1", "Camiseta", "M", 3)],
      [item("p1", "Camiseta", "M", 1)],
    );
    expect(depois.recibo?.divergenciaComATela).toMatchObject({
      aMaisNaTela: [{ nome: "Camiseta", variacao: "M", quantidade: 2 }],
    });
  });

  it("mesmas peças, só a forma de pagamento mudou: sem listas (o aviso de forma/total continua)", () => {
    const depois = reducerDaVenda(
      { ...telaCom([CAMISETA]), pagamento: "pix" },
      { tipo: "venda_registrada", recibo: reciboDoBanco([CAMISETA]) },
    );
    expect(depois.recibo?.divergenciaComATela).toBeDefined();
    expect(depois.recibo?.divergenciaComATela?.aMaisNaTela).toBeUndefined();
    expect(depois.recibo?.divergenciaComATela?.aMenosNaTela).toBeUndefined();
  });

  it("a venda gravada não traz itens: não inventa lista (fica a diferença de peças e de total)", () => {
    const depois = registradaComDivergencia([CAMISETA, CALCA], []);
    expect(depois.recibo?.divergenciaComATela).toMatchObject({
      unidadesDaTela: 2,
    });
    expect(depois.recibo?.divergenciaComATela?.aMaisNaTela).toBeUndefined();
    expect(depois.recibo?.divergenciaComATela?.aMenosNaTela).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// (b) registrar de novo com os itens da tela — só com a venda antiga anulada
// ----------------------------------------------------------------------------

describe("(b) cupom_refeito_com_a_tela", () => {
  const novaChave = "chave-nova-so-nesse-clique";

  it("com a venda divergente ANULADA: volta ao cupom com os itens da tela, chave nova e recibo limpo", () => {
    const registrada = registradaComDivergencia(
      [CAMISETA, CALCA, BONE, MEIA],
      [CAMISETA, CALCA, BONE],
    );
    const anulada = reducerDaVenda(registrada, {
      tipo: "recibo_anulado",
      orderId: ORDER_ID,
    });
    expect(anulada.recibo?.anulada).toBe(true);
    // A anulação sozinha NÃO gira a chave nem mexe na tela.
    expect(anulada.chaveDeIdempotencia).toBe("chave-antiga");
    expect(anulada.itens).toHaveLength(4);

    const refeito = reducerDaVenda(anulada, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave,
    });
    expect(refeito.etapa).toBe("cupom");
    expect(refeito.recibo).toBeNull();
    expect(refeito.itens).toEqual([CAMISETA, CALCA, BONE, MEIA]);
    expect(refeito.pagamento).toBe("cash");
    expect(refeito.chaveDeIdempotencia).toBe(novaChave);
    expect(refeito.enviando).toBe(false);
    expect(refeito.erro).toBeNull();
  });

  it("com a venda antiga AINDA ATIVA (não anulada): recusa — registrar de novo duplicaria a venda e o dinheiro", () => {
    const registrada = registradaComDivergencia(
      [CAMISETA, CALCA, BONE, MEIA],
      [CAMISETA, CALCA, BONE],
    );
    const depois = reducerDaVenda(registrada, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave,
    });
    expect(depois).toBe(registrada);
    expect(depois.chaveDeIdempotencia).toBe("chave-antiga");
  });

  it("anulação de OUTRA venda (resposta atrasada da venda A chegando no recibo da venda B): estado intacto e 'registrar de novo' segue recusado", () => {
    const registrada = registradaComDivergencia(
      [CAMISETA, CALCA, BONE, MEIA],
      [CAMISETA, CALCA, BONE],
    );
    const depois = reducerDaVenda(registrada, {
      tipo: "recibo_anulado",
      orderId: OUTRO_ORDER_ID,
    });
    expect(depois).toBe(registrada);
    expect(depois.recibo?.anulada).toBeUndefined();
    const refeito = reducerDaVenda(depois, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave,
    });
    expect(refeito).toBe(registrada);
    expect(refeito.chaveDeIdempotencia).toBe("chave-antiga");
  });

  it("recibo SEM divergência (venda normal): a ação não faz nada", () => {
    const normal = reducerDaVenda(telaCom([CAMISETA]), {
      tipo: "venda_registrada",
      recibo: reciboDoBanco([CAMISETA], { jaExistia: false }),
    });
    const anulado = reducerDaVenda(normal, {
      tipo: "recibo_anulado",
      orderId: ORDER_ID,
    });
    const depois = reducerDaVenda(anulado, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave,
    });
    expect(depois).toBe(anulado);
  });

  it("duplo clique: a segunda ação cai num estado sem recibo e não gira a chave de novo", () => {
    const anulada = reducerDaVenda(
      registradaComDivergencia([CAMISETA, MEIA], [CAMISETA]),
      { tipo: "recibo_anulado", orderId: ORDER_ID },
    );
    const uma = reducerDaVenda(anulada, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave: "primeira",
    });
    const duas = reducerDaVenda(uma, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave: "segunda",
    });
    expect(duas).toBe(uma);
    expect(duas.chaveDeIdempotencia).toBe("primeira");
  });

  it("a retentativa de REDE continua com a chave estável: erro de envio e peça nova não giram a chave", () => {
    let estado = telaCom([CAMISETA, CALCA, BONE]);
    estado = { ...estado, enviando: false };
    estado = reducerDaVenda(estado, {
      tipo: "envio_falhou",
      mensagem: "Não sabemos se a venda foi registrada",
    });
    estado = reducerDaVenda(estado, {
      tipo: "item_adicionado_manualmente",
      item: MEIA,
      em: 1,
    });
    estado = reducerDaVenda(estado, { tipo: "envio_iniciado" });
    expect(estado.chaveDeIdempotencia).toBe("chave-antiga");
    expect(estado.itens).toHaveLength(4);
  });
});

// ----------------------------------------------------------------------------
// A tela do recibo
// ----------------------------------------------------------------------------

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const DIVERGENTE: ReciboDaVendaRegistrada = reciboDoBanco(
  [CAMISETA, CALCA, BONE],
  {
    divergenciaComATela: {
      totalDaTela: 200,
      unidadesDaTela: 4,
      pagamentoDaTela: "cash",
      aMaisNaTela: [{ nome: "Meia", variacao: null, quantidade: 1 }],
    },
  },
);

describe("recibo vermelho — texto, anulação e Nova venda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  // Hospedeiro com o reducer de VERDADE (o recibo não guarda "anulada" sozinho:
  // quem sabe é a máquina). `espiao` vê cada ação despachada; `estadoRef`
  // deixa o teste olhar o estado da máquina.
  let estadoRef: EstadoDaVenda;
  function Hospedeiro({
    recibo,
    espiao,
    limparCupom,
    aoAnular,
  }: {
    recibo: ReciboDaVendaRegistrada;
    espiao: (a: unknown) => void;
    limparCupom: () => void;
    aoAnular: () => Promise<{ orderId: string; jaAnulada: boolean }>;
  }) {
    const [estado, despachar] = useReducer(
      reducerDaVenda,
      undefined,
      (): EstadoDaVenda => ({
        ...estadoInicialDaVenda(() => "chave-antiga"),
        etapa: "recibo",
        itens: [CAMISETA, CALCA, BONE, MEIA],
        pagamento: "cash",
        recibo,
      }),
    );
    useEffect(() => {
      estadoRef = estado;
    });
    if (!estado.recibo) return <p>cupom com {estado.itens.length} itens</p>;
    return (
      <ReciboDaVenda
        recibo={estado.recibo}
        despachar={(a) => {
          espiao(a);
          despachar(a);
        }}
        limparCupom={limparCupom}
        storeName="Loja Teste"
        aoAnular={aoAnular}
      />
    );
  }

  async function montar(
    recibo: ReciboDaVendaRegistrada,
    extras: {
      despachar?: (a: unknown) => void;
      limparCupom?: () => void;
      aoAnular?: () => Promise<{ orderId: string; jaAnulada: boolean }>;
    } = {},
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro
          recibo={recibo}
          espiao={extras.despachar ?? (() => undefined)}
          limparCupom={extras.limparCupom ?? vi.fn()}
          aoAnular={
            extras.aoAnular ??
            (async () => ({ orderId: recibo.orderId, jaAnulada: false }))
          }
        />,
      );
    });
  }

  async function anularEstaVenda(): Promise<void> {
    await act(async () => {
      botao(hospedeiro, "Anular venda")!.click();
    });
    await act(async () => digitarMotivo("peça a mais"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")!.click();
    });
  }

  it("(a) o alerta diz que a tela tem 1 peça a mais e QUAL é", async () => {
    await montar(DIVERGENTE);
    const alerta = hospedeiro.querySelector('[role="alert"]')!;
    expect(alerta).not.toBeNull();
    const texto = alerta.textContent ?? "";
    expect(texto).toContain("No cupom da tela há 1 peça a mais");
    expect(texto).toContain("Meia");
    expect(texto).toContain("Anule esta venda");
  });

  it("(a) o alerta diz o que a venda gravada tem a mais que a tela, com variação e quantidade", async () => {
    await montar(
      reciboDoBanco([CAMISETA, item("p2", "Calça", "42", 2)], {
        divergenciaComATela: {
          totalDaTela: 50,
          unidadesDaTela: 1,
          pagamentoDaTela: "cash",
          aMenosNaTela: [{ nome: "Calça", variacao: "42", quantidade: 2 }],
        },
      }),
    );
    const texto = hospedeiro.querySelector('[role="alert"]')!.textContent ?? "";
    expect(texto).toContain("A venda gravada tem 2 peças a mais do que a tela");
    expect(texto).toContain("2 × Calça 42");
  });

  it("(a) sem lista (venda antiga sem itens): ainda mostra peças e total das duas pontas", async () => {
    await montar(
      reciboDoBanco([], {
        total: 100,
        divergenciaComATela: {
          totalDaTela: 50,
          unidadesDaTela: 2,
          pagamentoDaTela: "cash",
        },
      }),
    );
    const texto = hospedeiro.querySelector('[role="alert"]')!.textContent ?? "";
    expect(texto).toContain("R$ 100,00");
    expect(texto).toContain("R$ 50,00");
    expect(texto).toContain("2 un.");
    expect(texto).not.toContain("a mais");
  });

  it("(d) depois de anular, o alerta vermelho e o 'Anule esta venda' somem; fica o texto neutro", async () => {
    await montar(DIVERGENTE);
    expect(hospedeiro.textContent).toContain(
      "Anule esta venda e registre de novo",
    );
    await anularEstaVenda();

    expect(hospedeiro.textContent).toContain(
      "Venda anulada. Registre a venda certa.",
    );
    expect(hospedeiro.textContent).not.toContain("Anule esta venda");
    expect(hospedeiro.textContent).not.toContain("Entrou uma venda diferente");
    expect(hospedeiro.querySelector(".pdv-notice-red")).toBeNull();
    // Nenhum alerta vermelho de divergência sobrou (role="alert" só aparece em erro).
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("(d) a anulação avisa a máquina (recibo_anulado) para a guarda do 'registrar de novo'", async () => {
    const despachar = vi.fn();
    await montar(DIVERGENTE, { despachar });
    await anularEstaVenda();
    expect(despachar).toHaveBeenCalledWith({
      tipo: "recibo_anulado",
      orderId: ORDER_ID,
    });
  });

  it("(b) 'Nova venda' depois de divergência pede confirmação dizendo que o cupom da tela será perdido", async () => {
    const limparCupom = vi.fn();
    await montar(DIVERGENTE, { limparCupom });

    await act(async () => {
      botao(hospedeiro, "Nova venda")!.click();
    });
    expect(limparCupom).not.toHaveBeenCalled();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(
      "O cupom que estava na tela (4 peças) será perdido",
    );

    // Voltar desiste: nada é apagado.
    await act(async () => {
      botao(hospedeiro, "Voltar")!.click();
    });
    expect(limparCupom).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("será perdido");

    // Confirmando, aí sim limpa.
    await act(async () => {
      botao(hospedeiro, "Nova venda")!.click();
    });
    await act(async () => {
      botao(hospedeiro, "Sim, nova venda")!.click();
    });
    expect(limparCupom).toHaveBeenCalledTimes(1);
  });

  it("(b) venda SEM divergência: 'Nova venda' limpa direto, como sempre", async () => {
    const limparCupom = vi.fn();
    await montar(reciboDoBanco([CAMISETA], { jaExistia: false }), {
      limparCupom,
    });
    await act(async () => {
      botao(hospedeiro, "Nova venda")!.click();
    });
    expect(limparCupom).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("será perdido");
  });

  it("(b) 'Registrar de novo com os itens da tela' só aparece DEPOIS de anular", async () => {
    await montar(DIVERGENTE);
    expect(
      botao(hospedeiro, "Registrar de novo com os itens da tela"),
    ).toBeUndefined();
    await anularEstaVenda();
    expect(
      botao(hospedeiro, "Registrar de novo com os itens da tela"),
    ).toBeDefined();
  });

  it("(b) o botão despacha a ação com uma chave NOVA (diferente de toda chave de antes)", async () => {
    const despachar = vi.fn();
    await montar(DIVERGENTE, { despachar });
    await anularEstaVenda();
    despachar.mockClear();
    await act(async () => {
      botao(hospedeiro, "Registrar de novo com os itens da tela")!.click();
    });
    expect(despachar).toHaveBeenCalledTimes(1);
    const acao = despachar.mock.calls[0][0] as {
      tipo: string;
      novaChave: string;
    };
    expect(acao.tipo).toBe("cupom_refeito_com_a_tela");
    // UUID v4 de verdade, diferente da chave que já tinha ido ao banco.
    expect(acao.novaChave).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(acao.novaChave).not.toBe("chave-antiga");
    expect(estadoRef.chaveDeIdempotencia).toBe(acao.novaChave);
  });

  it("(b) anulação que FALHOU: nenhum recibo_anulado, nenhum 'Registrar de novo', o alerta vermelho continua", async () => {
    const despachar = vi.fn();
    await montar(DIVERGENTE, {
      despachar,
      aoAnular: async () => {
        throw new Error("sem rede");
      },
    });
    await anularEstaVenda();
    expect(despachar).not.toHaveBeenCalled();
    expect(
      botao(hospedeiro, "Registrar de novo com os itens da tela"),
    ).toBeUndefined();
    expect(estadoRef.recibo?.anulada).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Anule esta venda e registre de novo",
    );
  });

  it("(b) venda JÁ anulada antes (duplo toque na anulação) também libera o botão", async () => {
    await montar(DIVERGENTE, {
      aoAnular: async () => ({ orderId: DIVERGENTE.orderId, jaAnulada: true }),
    });
    await anularEstaVenda();
    expect(
      botao(hospedeiro, "Registrar de novo com os itens da tela"),
    ).toBeDefined();
  });

  it("os botões novos têm alvo de toque de 44px (classes pdv-*, que fixam min-height) e nenhuma cor fixa", async () => {
    await montar(DIVERGENTE);
    await act(async () => {
      botao(hospedeiro, "Nova venda")!.click();
    });
    for (const nome of ["Voltar", "Sim, nova venda"]) {
      const b = botao(hospedeiro, nome)!;
      expect(b.className).toMatch(/pdv-(secondary|danger|primary)/);
    }
    // Só o painel novo (o papel impresso do OrderReceipt tem branco/cinza de
    // propósito e já era assim).
    const painel = hospedeiro.querySelector('[aria-label="Nova venda"]')!;
    expect(painel.innerHTML).not.toMatch(
      /\b(?:bg|text|border)-(?:white|black|gray|zinc|slate)/,
    );
  });
});

// ----------------------------------------------------------------------------
// De ponta a ponta com o hook de verdade: o cupom da tela volta inteiro
// ----------------------------------------------------------------------------

describe("de ponta a ponta com o hook", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimo: ReturnType<typeof useVendaPresencial>;
  const armazenamento = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  function Caixa({ anular }: { anular: () => Promise<never> }) {
    const venda = useVendaPresencial({
      armazenamento,
      gerarChave: () => "chave-antiga",
    });
    useEffect(() => {
      ultimo = venda;
    });
    if (venda.estado.etapa === "recibo" && venda.estado.recibo) {
      return (
        <ReciboDaVenda
          recibo={venda.estado.recibo}
          despachar={venda.despachar}
          limparCupom={venda.limparCupom}
          aoAnular={anular as never}
        />
      );
    }
    return (
      <p data-testid="cupom">cupom com {venda.estado.itens.length} itens</p>
    );
  }

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("3 peças gravadas, 4ª acrescentada, anula e 'registrar de novo': a caixa volta ao cupom com as 4 peças e chave nova", async () => {
    const anular = vi.fn(async () => ({
      orderId: DIVERGENTE.orderId,
      jaAnulada: false,
    }));
    await act(async () => {
      raiz.render(<Caixa anular={anular as never} />);
    });
    for (const i of [CAMISETA, CALCA, BONE, MEIA]) {
      await act(async () => {
        ultimo.despachar({
          tipo: "item_adicionado_manualmente",
          item: i,
          em: 1,
        });
      });
    }
    await act(async () => {
      ultimo.despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
    });
    // O banco devolve a venda ANTIGA (3 peças) com a mesma chave.
    await act(async () => {
      ultimo.despachar({
        tipo: "venda_registrada",
        recibo: reciboDoBanco([CAMISETA, CALCA, BONE]),
      });
    });
    expect(hospedeiro.textContent).toContain("Meia");
    expect(ultimo.estado.chaveDeIdempotencia).toBe("chave-antiga");

    await act(async () => {
      botao(hospedeiro, "Anular venda")!.click();
    });
    await act(async () => digitarMotivo("peça a mais"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")!.click();
    });
    await act(async () => {
      botao(hospedeiro, "Registrar de novo com os itens da tela")!.click();
    });

    expect(ultimo.estado.etapa).toBe("cupom");
    expect(ultimo.estado.recibo).toBeNull();
    expect(ultimo.estado.itens.map((i) => i.nome)).toEqual([
      "Camiseta",
      "Calça",
      "Boné",
      "Meia",
    ]);
    expect(ultimo.estado.chaveDeIdempotencia).not.toBe("chave-antiga");
    expect(hospedeiro.textContent).toContain("cupom com 4 itens");
  });

  it("anulação da venda A que responde DEPOIS de a caixa registrar a venda B: o recibo de B não vira 'anulado' e não libera 'registrar de novo' (venda duplicada)", async () => {
    let responder!: (r: { orderId: string; jaAnulada: boolean }) => void;
    const pendente = new Promise<{ orderId: string; jaAnulada: boolean }>(
      (res) => {
        responder = res;
      },
    );
    await act(async () => {
      raiz.render(<Caixa anular={(() => pendente) as never} />);
    });
    async function montarVendaDivergente(orderId: string) {
      for (const i of [CAMISETA, CALCA, BONE, MEIA]) {
        await act(async () => {
          ultimo.despachar({
            tipo: "item_adicionado_manualmente",
            item: i,
            em: 1,
          });
        });
      }
      await act(async () => {
        ultimo.despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
      });
      await act(async () => {
        ultimo.despachar({
          tipo: "venda_registrada",
          recibo: reciboDoBanco([CAMISETA, CALCA, BONE], { orderId }),
        });
      });
    }

    // Venda A divergente; a anulação dela fica pendurada na rede.
    await montarVendaDivergente(ORDER_ID);
    await act(async () => {
      botao(hospedeiro, "Anular venda")!.click();
    });
    await act(async () => digitarMotivo("peça a mais"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")!.click();
    });
    expect(hospedeiro.textContent).toContain("Anulando");

    // A caixa não espera: Nova venda (com a pergunta), e registra a venda B.
    await act(async () => {
      botao(hospedeiro, "Nova venda")!.click();
    });
    await act(async () => {
      botao(hospedeiro, "Sim, nova venda")!.click();
    });
    expect(hospedeiro.textContent).toContain("cupom com 0 itens");
    await montarVendaDivergente(OUTRO_ORDER_ID);
    expect(ultimo.estado.recibo?.orderId).toBe(OUTRO_ORDER_ID);

    // Só agora a resposta da anulação de A chega.
    await act(async () => {
      responder({ orderId: ORDER_ID, jaAnulada: false });
    });

    expect(ultimo.estado.recibo?.orderId).toBe(OUTRO_ORDER_ID);
    expect(ultimo.estado.recibo?.anulada).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Venda anulada");
    expect(botao(hospedeiro, "Enviar por WhatsApp")).toBeDefined();
    expect(botao(hospedeiro, "Imprimir")).toBeDefined();
    expect(
      botao(hospedeiro, "Registrar de novo com os itens da tela"),
    ).toBeUndefined();
    // E a máquina continua recusando, mesmo que alguém despache direto.
    const chaveDeB = ultimo.estado.chaveDeIdempotencia;
    await act(async () => {
      ultimo.despachar({ tipo: "cupom_refeito_com_a_tela", novaChave: "x" });
    });
    expect(ultimo.estado.recibo?.orderId).toBe(OUTRO_ORDER_ID);
    expect(ultimo.estado.chaveDeIdempotencia).toBe(chaveDeB);
  });
});
