// @vitest-environment jsdom
//
// Decisão de produto (sócio, 12/11/2026): na tela Fechar venda, com Dinheiro, a
// lojista pode digitar "Quanto a cliente deu?" e ver o TROCO na hora. É só
// conta na tela: nada é gravado e o botão Registrar não muda (o payload do
// servidor tem teste próprio em `admin-pdv-troco-nao-muda-o-registro.test.tsx`).
//
// Montado como `admin-pdv-conferi-o-pagamento.test.tsx`: a máquina REAL de
// `useVendaPresencial`, sem `@testing-library/react`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { isOfflineRef } = vi.hoisted(() => ({
  isOfflineRef: { atual: false },
}));

// `useOnlineStatus` devolve `true` quando está OFFLINE (armadilha de nome).
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => isOfflineRef.atual,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type {
  AcaoDaVenda,
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

const ROTULO = "Quanto a cliente deu?";
const ID_DO_CAMPO = "dinheiro-recebido";

// 2 × R$ 39,90 = R$ 79,80.
const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

const OUTRA_PECA: ItemDoCupom = {
  chave: "produto-2::",
  productId: "produto-2",
  variantId: null,
  nome: "Meia",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

function botaoPorTexto(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado as HTMLButtonElement;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const despacharRef: { atual: ((acao: AcaoDaVenda) => void) | null } = {
  atual: null,
};

function Hospedeiro({
  pagamentoInicial,
  aoRegistrarVenda,
}: {
  pagamentoInicial: FormaDePagamentoDoBalcao;
  aoRegistrarVenda: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  despacharRef.atual = despachar;
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    despachar({
      tipo: "item_adicionado_manualmente",
      item: ITEM,
      em: Date.now(),
    });
    despachar({ tipo: "pagamento_escolhido", pagamento: pagamentoInicial });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={limparCupom}
    />
  );
}

describe("FechamentoDaVenda — troco na tela quando o pagamento é em dinheiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    isOfflineRef.atual = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar(
    pagamentoInicial: FormaDePagamentoDoBalcao,
    aoRegistrarVenda: () => Promise<void> = vi
      .fn()
      .mockResolvedValue(undefined),
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro
          pagamentoInicial={pagamentoInicial}
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();
  }

  async function digitar(texto: string): Promise<void> {
    await act(async () => {
      digitarInput(ID_DO_CAMPO, texto);
    });
    await avancar();
  }

  async function tocarNota(rotulo: string): Promise<void> {
    await act(async () => {
      botaoPorTexto(hospedeiro, rotulo).click();
    });
    await avancar();
  }

  async function escolherForma(rotulo: string): Promise<void> {
    await act(async () => {
      botaoPorTexto(hospedeiro, rotulo).click();
    });
    await avancar();
  }

  function resultado(): string | null {
    const texto = hospedeiro
      .querySelector(".pdv-change-result")
      ?.textContent?.trim();
    return texto ? texto : null;
  }

  function botoesDeNota(): string[] {
    return [...hospedeiro.querySelectorAll(".pdv-change-notes button")].map(
      (b) => b.textContent?.trim() ?? "",
    );
  }

  it("Dinheiro: aparece 'Quanto a cliente deu?' com até 3 valores redondos acima do total", async () => {
    await montar("cash");

    const rotulo = [...hospedeiro.querySelectorAll("label")].find((l) =>
      l.textContent?.includes(ROTULO),
    );
    expect(rotulo).toBeTruthy();
    expect((rotulo?.control as HTMLInputElement | null)?.id).toBe(ID_DO_CAMPO);
    // Total R$ 79,80: o próximo redondo é 80, depois 100 e 200.
    expect(botoesDeNota()).toEqual(["R$ 80", "R$ 100", "R$ 200"]);
    // Campo vazio: nenhum troco, nenhuma frase de falta.
    expect(resultado()).toBeNull();
  });

  it.each(["pix", "card"] as const)(
    "%s: nada disso aparece (nem o campo, nem os valores, nem o troco)",
    async (forma) => {
      await montar(forma);

      expect(hospedeiro.textContent).not.toContain(ROTULO);
      expect(document.getElementById(ID_DO_CAMPO)).toBeNull();
      expect(hospedeiro.querySelector(".pdv-change-notes")).toBeNull();
      expect(hospedeiro.textContent).not.toContain("Troco");
    },
  );

  it("trocar para PIX esconde o bloco (mesmo com valor já digitado) e voltar ao Dinheiro mostra de novo", async () => {
    await montar("cash");
    await digitar("10000");
    expect(resultado()).toBe("Troco: R$ 20,20");

    await escolherForma("PIX na hora");
    expect(hospedeiro.textContent).not.toContain("Troco");
    expect(hospedeiro.textContent).not.toContain(ROTULO);

    await escolherForma("Dinheiro");
    expect(hospedeiro.textContent).toContain(ROTULO);
    expect(resultado()).toBe("Troco: R$ 20,20");
  });

  it("tocar num valor mostra o troco na hora: R$ 100 para R$ 79,80 = R$ 20,20", async () => {
    await montar("cash");
    await tocarNota("R$ 100");

    expect(resultado()).toBe("Troco: R$ 20,20");
    const campo = document.getElementById(ID_DO_CAMPO) as HTMLInputElement;
    expect(campo.value).toBe("100,00");
  });

  it("digitar mostra o troco a cada número, sem sair do campo", async () => {
    await montar("cash");

    // O campo de dinheiro digita pelos CENTAVOS: "1" é R$ 0,01.
    await digitar("1");
    expect(resultado()).toBe("Faltam R$ 79,79");
    await digitar("10");
    expect(resultado()).toBe("Faltam R$ 79,70");
    await digitar("100");
    expect(resultado()).toBe("Faltam R$ 78,80");
    await digitar("1000");
    expect(resultado()).toBe("Faltam R$ 69,80");
    await digitar("10000");
    expect(resultado()).toBe("Troco: R$ 20,20");
  });

  it("valor igual ao total: Troco R$ 0,00 (pagou certinho)", async () => {
    await montar("cash");
    await digitar("7980");
    expect(resultado()).toBe("Troco: R$ 0,00");
  });

  it("valor menor que o total: 'Faltam R$ X' em vermelho, com texto, e o Registrar continua funcionando", async () => {
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await montar("cash", aoRegistrarVenda);
    await digitar("5000");

    const linha = hospedeiro.querySelector(".pdv-change-result");
    expect(linha?.textContent?.trim()).toBe("Faltam R$ 29,80");
    // Texto E cor: a cor sozinha não basta.
    expect(linha?.classList.contains("pdv-red")).toBe(true);

    const registrar = botaoPorTexto(hospedeiro, "Registrar venda");
    expect(registrar.disabled).toBe(false);
    await act(async () => {
      registrar.click();
    });
    await avancar();
    expect(aoRegistrarVenda).toHaveBeenCalledTimes(1);
  });

  it("troco não é vermelho (só a falta é)", async () => {
    await montar("cash");
    await digitar("10000");
    const linha = hospedeiro.querySelector(".pdv-change-result");
    expect(linha?.classList.contains("pdv-red")).toBe(false);
  });

  it("mudar o desconto depois de digitar: o troco se refaz sozinho", async () => {
    await montar("cash");
    await tocarNota("R$ 100");
    expect(resultado()).toBe("Troco: R$ 20,20");

    await act(async () => {
      digitarInput("desconto-da-venda", "500"); // R$ 5,00 -> total R$ 74,80
    });
    await avancar(300);
    await act(async () => {
      digitarInput("motivo-do-desconto", "cliente fidelidade");
    });
    await avancar(300);

    expect(resultado()).toBe("Troco: R$ 25,20");
    // Os valores sugeridos também seguem o total novo (74,80 -> 75, 80, 100).
    expect(botoesDeNota()).toEqual(["R$ 75", "R$ 80", "R$ 100"]);
  });

  it("acrescentar uma peça enquanto a tela está aberta: o troco (e a falta) se refazem sozinhos", async () => {
    await montar("cash");
    await tocarNota("R$ 100");
    expect(resultado()).toBe("Troco: R$ 20,20");

    await act(async () => {
      despacharRef.atual?.({
        tipo: "item_adicionado_manualmente",
        item: OUTRA_PECA,
        em: Date.now(),
      });
    });
    await avancar();
    // Total R$ 89,80.
    expect(resultado()).toBe("Troco: R$ 10,20");

    await act(async () => {
      despacharRef.atual?.({
        tipo: "item_adicionado_manualmente",
        item: { ...OUTRA_PECA, chave: "produto-3::", productId: "produto-3" },
        em: Date.now(),
      });
    });
    await avancar();
    // Total R$ 99,80 -> R$ 100 ainda cobre; mais uma peça e passa.
    expect(resultado()).toBe("Troco: R$ 0,20");
    await act(async () => {
      despacharRef.atual?.({
        tipo: "item_adicionado_manualmente",
        item: { ...OUTRA_PECA, chave: "produto-4::", productId: "produto-4" },
        em: Date.now(),
      });
    });
    await avancar();
    expect(resultado()).toBe("Faltam R$ 9,80");
  });

  it("conta em centavos inteiros: R$ 29,95 pagos com R$ 50,00 dão R$ 20,05", async () => {
    await montar("cash");
    // Troca a peça do cupom por uma de R$ 29,95 (quantidade 1).
    await act(async () => {
      despacharRef.atual?.({
        tipo: "item_removido",
        chave: ITEM.chave,
      });
      despacharRef.atual?.({
        tipo: "item_adicionado_manualmente",
        item: {
          ...OUTRA_PECA,
          chave: "produto-9::",
          productId: "produto-9",
          preco: 29.95,
        },
        em: Date.now(),
      });
    });
    await avancar();
    await digitar("5000");
    expect(resultado()).toBe("Troco: R$ 20,05");
  });

  it("zero digitado é campo vazio: some o troco, não vira 'Faltam' o total inteiro", async () => {
    await montar("cash");
    await digitar("10000");
    expect(resultado()).toBe("Troco: R$ 20,20");
    await digitar("0");
    expect(resultado()).toBeNull();
  });

  it("depois de digitar, tocar num valor com o campo ainda em foco troca o texto do campo", async () => {
    await montar("cash");
    const campo = () =>
      document.getElementById(ID_DO_CAMPO) as HTMLInputElement;
    await act(async () => {
      campo().focus();
    });
    await digitar("1");
    expect(campo().value).toBe("0,01");

    await tocarNota("R$ 200");
    expect(campo().value).toBe("200,00");
    expect(resultado()).toBe("Troco: R$ 120,20");
  });

  it("venda de R$ 0,00 (desconto integral): não há o que receber, então não aparece o bloco", async () => {
    await montar("cash");
    await act(async () => {
      digitarInput("desconto-da-venda", "7980");
    });
    await avancar(300);
    await act(async () => {
      digitarInput("motivo-do-desconto", "brinde");
    });
    await avancar(300);

    expect(hospedeiro.textContent).toContain("R$ 0,00");
    expect(hospedeiro.textContent).not.toContain(ROTULO);
    expect(hospedeiro.querySelector(".pdv-change-notes")).toBeNull();
  });

  it("sem internet funciona igual (é só conta na tela); o Registrar segue travado pelo offline", async () => {
    isOfflineRef.atual = true;
    await montar("cash");
    await digitar("10000");

    expect(resultado()).toBe("Troco: R$ 20,20");
    expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
  });

  it("acessível: o resultado é uma região viva e o campo aponta para ele", async () => {
    await montar("cash");
    await digitar("5000");

    const linha = hospedeiro.querySelector(".pdv-change-result") as HTMLElement;
    expect(linha.getAttribute("aria-live")).toBe("polite");
    const campo = document.getElementById(ID_DO_CAMPO) as HTMLInputElement;
    expect(campo.getAttribute("aria-describedby") ?? "").toContain(linha.id);
  });
});
