// @vitest-environment jsdom
//
// Caça de leitor de tela (TalkBack/VoiceOver) no balcão:
//  · venda registrada: o botão "Registrar venda" some junto com a cobrança e o
//    foco caía no body — o leitor ficava calado, a lojista achava que falhou e
//    registrava de novo. O recibo agora leva o foco ao título "Venda registrada".
//  · +/− do cupom: a quantidade nova não era falada, e o "Remover" (quantidade
//    1) sumia com o foco junto. Agora uma região aria-live fixa anuncia a
//    mudança e a remoção leva o foco a um lugar que existe.
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import {
  type AcaoDaVenda,
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";
import { act, useEffect, useReducer } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function botao(texto: string): HTMLButtonElement {
  const encontrado = [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.includes(texto) || b.getAttribute("aria-label") === texto,
  );
  expect(encontrado, `botão "${texto}"`).toBeTruthy();
  return encontrado!;
}

function recibo(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "pedido-abcdef123456",
    numero: "123456",
    criadoEm: "2026-10-20T15:00:00Z",
    itens: [
      {
        chave: "p1::",
        productId: "p1",
        variantId: null,
        nome: "Camiseta Lisa",
        variacao: null,
        preco: 39.9,
        quantidade: 1,
        estoque: 5,
        imagem: "",
      },
    ],
    subtotal: 39.9,
    desconto: 0,
    total: 39.9,
    pagamento: "card",
    cliente: { tipo: "sem_cliente" },
    jaExistia: false,
    ...parcial,
  };
}

describe("recibo do balcão — o leitor de tela ouve que a venda entrou", () => {
  it("ao aparecer, o foco vai ao título 'Venda registrada'", async () => {
    // Foco de partida FORA do recibo (o "Registrar venda" que sumiu).
    const fora = document.createElement("button");
    document.body.append(fora);
    fora.focus();
    onTestFinished(() => fora.remove());
    await act(async () =>
      root.render(
        <ReciboDaVenda
          recibo={recibo()}
          despachar={() => {}}
          limparCupom={() => {}}
        />,
      ),
    );
    const titulo = host.querySelector("h2")!;
    expect(titulo.textContent).toBe("Venda registrada");
    expect(titulo.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(titulo);
  });

  it("com a pergunta 'Nova venda' aberta, um recibo novo não rouba o foco do Voltar", async () => {
    const divergente = recibo({
      divergenciaComATela: {
        totalDaTela: 79.8,
        unidadesDaTela: 2,
        pagamentoDaTela: "card",
      },
    });
    await act(async () =>
      root.render(
        <ReciboDaVenda
          recibo={divergente}
          despachar={() => {}}
          limparCupom={() => {}}
        />,
      ),
    );
    act(() => botao("Nova venda").click());
    const voltar = botao("Voltar");
    expect(document.activeElement).toBe(voltar);
    await act(async () =>
      root.render(
        <ReciboDaVenda
          recibo={{ ...divergente, orderId: "pedido-outro-999" }}
          despachar={() => {}}
          limparCupom={() => {}}
        />,
      ),
    );
    expect(document.activeElement).toBe(voltar);
  });
});

function item(parcial: Partial<ItemDoCupom>): ItemDoCupom {
  return {
    chave: "p1::",
    productId: "p1",
    variantId: null,
    nome: "Caneca",
    variacao: null,
    preco: 20,
    quantidade: 1,
    estoque: 4,
    imagem: "",
    ...parcial,
  };
}

function comItens(itens: ItemDoCupom[]): EstadoDaVenda {
  return { ...estadoInicialDaVenda(() => "teste"), itens };
}

function CupomComEstado({ inicial }: { inicial: EstadoDaVenda }) {
  const [estado, despachar] = useReducer(reducerDaVenda, inicial);
  return (
    <>
      <input id="busca-manual-de-produto" aria-label="Buscar produto" />
      <CupomDaVenda
        estado={estado}
        despachar={despachar}
        subtotal={0}
        onNavigate={() => {}}
        feedback={null}
      />
    </>
  );
}

function regiaoFalada(): HTMLElement {
  const regioes = host.querySelectorAll<HTMLElement>('[aria-live="polite"]');
  expect(regioes).toHaveLength(1);
  return regioes[0]!;
}

describe("cupom do balcão — +/− fala a quantidade e remover não perde o foco", () => {
  it("a região falada já existe, vazia, antes de qualquer mudança", async () => {
    await act(async () =>
      root.render(<CupomComEstado inicial={comItens([item({})])} />),
    );
    expect(regiaoFalada().textContent).toBe("");
  });

  it("'+' anuncia a quantidade nova e o total da linha", async () => {
    await act(async () =>
      root.render(<CupomComEstado inicial={comItens([item({})])} />),
    );
    act(() => botao("Aumentar quantidade de Caneca").click());
    expect(regiaoFalada().textContent).toBe("Caneca: 2 unidades, R$ 40,00");
  });

  it("'−' anuncia a quantidade nova, no singular quando sobra uma", async () => {
    await act(async () =>
      root.render(
        <CupomComEstado inicial={comItens([item({ quantidade: 2 })])} />,
      ),
    );
    act(() => botao("Diminuir quantidade de Caneca").click());
    expect(regiaoFalada().textContent).toBe("Caneca: 1 unidade, R$ 20,00");
  });

  it("'+' recusado pelo estoque não anuncia nada", async () => {
    await act(async () =>
      root.render(
        <CupomComEstado
          inicial={comItens([item({ quantidade: 4, estoque: 4 })])}
        />,
      ),
    );
    // O botão fica desligado no limite; o clique não muda nada.
    act(() => botao("Aumentar quantidade de Caneca").click());
    expect(regiaoFalada().textContent).toBe("");
  });

  it("remover anuncia e leva o foco ao PRÓXIMO item", async () => {
    await act(async () =>
      root.render(
        <CupomComEstado
          inicial={comItens([
            item({}),
            item({ chave: "p2::", productId: "p2", nome: "Camiseta" }),
          ])}
        />,
      ),
    );
    act(() => botao("Remover Caneca da venda").click());
    expect(regiaoFalada().textContent).toBe("Caneca removido da venda");
    const foco = document.activeElement as HTMLElement;
    expect(foco.tagName).toBe("LI");
    expect(foco.textContent).toContain("Camiseta");
  });

  it("remover o ÚLTIMO da lista leva o foco ao item de cima", async () => {
    await act(async () =>
      root.render(
        <CupomComEstado
          inicial={comItens([
            item({}),
            item({ chave: "p2::", productId: "p2", nome: "Camiseta" }),
          ])}
        />,
      ),
    );
    act(() => botao("Remover Camiseta da venda").click());
    expect(regiaoFalada().textContent).toBe("Camiseta removido da venda");
    const foco = document.activeElement as HTMLElement;
    expect(foco.tagName).toBe("LI");
    expect(foco.textContent).toContain("Caneca");
  });

  it("remover o único item leva o foco ao campo de busca", async () => {
    await act(async () =>
      root.render(<CupomComEstado inicial={comItens([item({})])} />),
    );
    act(() => botao("Remover Caneca da venda").click());
    expect(regiaoFalada().textContent).toBe("Caneca removido da venda");
    expect(document.activeElement).toBe(
      document.getElementById("busca-manual-de-produto"),
    );
  });

  it("no modo câmera (busca escondida), o foco vai à aba aberta, sem trocar de modo", async () => {
    const aoRetomarBusca = vi.fn();
    const inicial = comItens([item({})]);
    function Tela() {
      const [atual, mudar] = useReducer(reducerDaVenda, inicial);
      return (
        <>
          <div role="tablist" aria-label="Adicionar produto à venda">
            <button type="button" role="tab" aria-selected="true">
              Câmera
            </button>
            <button type="button" role="tab" aria-selected="false">
              Buscar
            </button>
          </div>
          <div hidden>
            <input id="busca-manual-de-produto" aria-label="Buscar produto" />
          </div>
          <CupomDaVenda
            estado={atual}
            despachar={mudar}
            subtotal={0}
            onNavigate={() => {}}
            aoRetomarBusca={aoRetomarBusca}
            feedback={null}
          />
        </>
      );
    }
    await act(async () => root.render(<Tela />));
    act(() => botao("Remover Caneca da venda").click());
    expect(host.querySelectorAll("li")).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe("Câmera");
    expect(aoRetomarBusca).not.toHaveBeenCalled();
  });
});

// O leitor de tela fala o que MUDA no DOM da região viva. Frase igual à
// anterior não mudava nada (o React não regrava texto igual) e o toque ficava
// mudo. Aqui se observa o que o leitor observa: nó acrescentado ou texto
// trocado dentro da região.
function observarFala(): { falas: () => string[] } {
  const observador = new MutationObserver(() => {});
  observador.observe(regiaoFalada(), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  onTestFinished(() => observador.disconnect());
  return {
    falas: () =>
      observador
        .takeRecords()
        .flatMap((r) =>
          r.type === "characterData"
            ? [r.target.textContent ?? ""]
            : [...r.addedNodes].map((n) => n.textContent ?? ""),
        )
        .filter((t) => t !== ""),
  };
}

// Quem está fora do cupom (o bipe, a busca) também mexe na venda.
const deFora: { despachar: (acao: AcaoDaVenda) => void } = {
  despachar: () => {},
};

function CupomComBipe({
  inicial,
  reducer = reducerDaVenda,
}: {
  inicial: EstadoDaVenda;
  reducer?: (estado: EstadoDaVenda, acao: AcaoDaVenda) => EstadoDaVenda;
}) {
  const [estado, despachar] = useReducer(reducer, inicial);
  useEffect(() => {
    deFora.despachar = despachar;
  }, []);
  return (
    <>
      <input id="busca-manual-de-produto" aria-label="Buscar produto" />
      <CupomDaVenda
        estado={estado}
        despachar={despachar}
        subtotal={0}
        onNavigate={() => {}}
        feedback={null}
      />
    </>
  );
}

function bipar(parcial: Partial<ItemDoCupom>) {
  act(() =>
    deFora.despachar({
      tipo: "item_adicionado_manualmente",
      item: item(parcial),
      em: 1,
    }),
  );
}

describe("cupom do balcão — a fala se repete quando a frase se repete", () => {
  it("'+', bipe da mesma peça e '−' de volta: o '−' fala de novo '2 unidades'", async () => {
    await act(async () =>
      root.render(<CupomComBipe inicial={comItens([item({})])} />),
    );
    act(() => botao("Aumentar quantidade de Caneca").click());
    expect(regiaoFalada().textContent).toBe("Caneca: 2 unidades, R$ 40,00");
    bipar({});
    expect(host.querySelector("li")?.textContent).toContain("3");
    const ouvido = observarFala();
    act(() => botao("Diminuir quantidade de Caneca").click());
    expect(ouvido.falas()).toContain("Caneca: 2 unidades, R$ 40,00");
    expect(regiaoFalada().textContent).toBe("Caneca: 2 unidades, R$ 40,00");
  });

  it("remover, bipar de novo e remover outra vez: a segunda remoção também fala", async () => {
    await act(async () =>
      root.render(<CupomComBipe inicial={comItens([item({})])} />),
    );
    act(() => botao("Remover Caneca da venda").click());
    expect(regiaoFalada().textContent).toBe("Caneca removido da venda");
    bipar({});
    const ouvido = observarFala();
    act(() => botao("Remover Caneca da venda").click());
    expect(ouvido.falas()).toContain("Caneca removido da venda");
    expect(regiaoFalada().textContent).toBe("Caneca removido da venda");
  });

  it("toque que a venda recusa não fala depois, quando a lista muda por outro motivo", async () => {
    // A venda recusa o "+" sem mexer na lista (o botão estava ligado). A
    // lista só muda no bipe seguinte, de OUTRA peça: a Caneca ficou com a
    // mesma quantidade e não pode ser anunciada como se tivesse mudado.
    const recusaQuantidade = (estado: EstadoDaVenda, acao: AcaoDaVenda) =>
      acao.tipo === "quantidade_alterada"
        ? estado
        : reducerDaVenda(estado, acao);
    await act(async () =>
      root.render(
        <CupomComBipe
          inicial={comItens([item({})])}
          reducer={recusaQuantidade}
        />,
      ),
    );
    const ouvido = observarFala();
    act(() => botao("Aumentar quantidade de Caneca").click());
    bipar({ chave: "p2::", productId: "p2", nome: "Camiseta" });
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(ouvido.falas()).toEqual([]);
    expect(regiaoFalada().textContent).toBe("");
  });
});
