// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026) no fechamento do balcão: o que a lojista LÊ na
// tela de cobrança (resumo da venda, linha de desconto, valor sugerido para o
// troco) e que nenhum teste prendia — trocar `subtotal` por `total`, mostrar
// "Desconto - R$ 0,00" numa venda sem desconto ou escrever "R$ 1000" em vez de
// "R$ 1.000" passava com a suíte toda verde.
//
// Montado como `admin-pdv-troco-no-dinheiro.test.tsx`: a máquina REAL de
// `useVendaPresencial`, sem `@testing-library/react`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type {
  ClienteDaVenda,
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

function peca(
  numero: number,
  nome: string,
  preco: number,
  quantidade = 1,
): ItemDoCupom {
  return {
    chave: `produto-${numero}::`,
    productId: `produto-${numero}`,
    variantId: null,
    nome,
    variacao: null,
    preco,
    quantidade,
    estoque: 50,
    imagem: "",
  };
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

/** Texto como a lojista lê: cada pedaço de texto separado por espaço. */
function textoLegivel(el: Element): string {
  const pedacos: string[] = [];
  const andador = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = andador.nextNode(); n; n = andador.nextNode()) {
    pedacos.push(n.textContent ?? "");
  }
  return pedacos.join(" ").replace(/\s+/g, " ").trim();
}

function Hospedeiro({
  itens,
  pagamento,
  cliente,
}: {
  itens: readonly ItemDoCupom[];
  pagamento: FormaDePagamentoDoBalcao;
  cliente?: ClienteDaVenda;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    for (const item of itens) {
      despachar({ tipo: "item_adicionado_manualmente", item, em: Date.now() });
    }
    despachar({ tipo: "pagamento_escolhido", pagamento });
    if (cliente) despachar({ tipo: "cliente_definido", cliente });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={vi.fn().mockResolvedValue(undefined)}
      limparCupom={limparCupom}
    />
  );
}

describe("FechamentoDaVenda — o que a lojista lê na cobrança", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
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
    itens: readonly ItemDoCupom[],
    pagamento: FormaDePagamentoDoBalcao = "cash",
    cliente?: ClienteDaVenda,
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro itens={itens} pagamento={pagamento} cliente={cliente} />,
      );
    });
    await avancar();
  }

  async function digitar(id: string, texto: string): Promise<void> {
    await act(async () => {
      digitarInput(id, texto);
    });
    await avancar(300);
  }

  function resumo(): HTMLElement {
    return hospedeiro.querySelector('[data-resumo="true"]') as HTMLElement;
  }

  function linhasDoRodape(): string[] {
    return [
      ...hospedeiro.querySelectorAll(".pdv-checkout-breakdown, .pdv-total"),
    ]
      .map((l) => textoLegivel(l))
      .filter((t, i, todas) => todas.indexOf(t) === i);
  }

  it("venda sem desconto: o rodapé tem Subtotal e Total, e NENHUMA linha de Desconto", async () => {
    await montar([peca(1, "Camiseta Lisa", 39.9, 2)]);

    const linhas = linhasDoRodape();
    expect(linhas).toContain("Subtotal R$ 79,80");
    expect(linhas).toContain("Total R$ 79,80");
    expect(linhas.some((l) => l.startsWith("Desconto"))).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Total com desconto");
  });

  it("venda com desconto: mostra a linha de Desconto, o Total com desconto e o resumo/limite no SUBTOTAL (não no total)", async () => {
    await montar([peca(1, "Camiseta Lisa", 39.9, 2)]);
    await digitar("desconto-da-venda", "1000"); // R$ 10,00

    const linhas = linhasDoRodape();
    expect(linhas).toContain("Subtotal R$ 79,80");
    expect(linhas).toContain("Desconto - R$ 10,00");
    expect(linhas).toContain("Total com desconto R$ 69,80");
    // O resumo "Venda atual" soma as peças; só o rodapé desconta.
    expect(resumo().textContent).toContain("R$ 79,80");
    expect(resumo().textContent).not.toContain("69,80");
    // O teto do desconto é o subtotal, não o que sobrou depois do desconto.
    expect(hospedeiro.textContent).toContain("Até R$ 79,80");
    expect(hospedeiro.textContent).not.toContain("Até R$ 69,80");
  });

  it("sem cliente a linha 'Cliente:' não existe; com cliente avulso ela traz o nome", async () => {
    await montar([peca(1, "Camiseta Lisa", 39.9)]);
    expect(resumo().textContent).not.toContain("Cliente:");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar([peca(1, "Camiseta Lisa", 39.9)], "cash", {
      tipo: "avulso",
      nome: "Maria da Silva",
      whatsapp: "",
    });
    expect(resumo().textContent).toContain("Cliente: Maria da Silva");
  });

  it("resumo: '1 item' no singular, '2 itens' no plural; só os 2 primeiros nomes aparecem", async () => {
    await montar([peca(1, "Camiseta Lisa", 10)]);
    expect(resumo().textContent).toContain("1 item");
    expect(resumo().textContent).not.toContain("1 itens");
    expect(resumo().querySelector('[role="img"]')).toBeNull();

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar([peca(1, "Camiseta Lisa", 10), peca(2, "Meia", 5)]);
    expect(resumo().textContent).toContain("2 itens");
    // Exatamente 2 itens: nada de "+N".
    expect(resumo().querySelector('[role="img"]')).toBeNull();
  });

  it("3 itens: o terceiro vira '+1' (Mais 1 produto, no singular); 4 itens: '+2' (Mais 2 produtos)", async () => {
    await montar([
      peca(1, "Camiseta Lisa", 10),
      peca(2, "Meia", 5),
      peca(3, "Boné", 20),
    ]);
    const nomes = resumo().querySelector(".pdv-summary-names") as HTMLElement;
    expect(nomes.textContent).toContain("Camiseta Lisa, Meia");
    expect(nomes.textContent).not.toContain("Boné");
    const mais = nomes.querySelector('[role="img"]') as HTMLElement;
    expect(mais.textContent).toBe("+1");
    expect(mais.getAttribute("aria-label")).toBe("Mais 1 produto na venda");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar([
      peca(1, "Camiseta Lisa", 10),
      peca(2, "Meia", 5),
      peca(3, "Boné", 20),
      peca(4, "Cinto", 30),
    ]);
    const nomes4 = resumo().querySelector(".pdv-summary-names") as HTMLElement;
    const mais4 = nomes4.querySelector('[role="img"]') as HTMLElement;
    expect(mais4.textContent).toBe("+2");
    expect(mais4.getAttribute("aria-label")).toBe("Mais 2 produtos na venda");
  });

  it("valor sugerido acima de R$ 1.000 leva o ponto de milhar e o troco sai exato ao tocar", async () => {
    // Total R$ 990,00: os valores redondos acima são R$ 995 e R$ 1.000.
    await montar([peca(1, "Bicicleta", 990)]);

    const botoes = [
      ...hospedeiro.querySelectorAll(".pdv-change-notes button"),
    ] as HTMLButtonElement[];
    expect(botoes.map((b) => b.textContent?.trim())).toEqual([
      "R$ 995",
      "R$ 1.000",
    ]);
    expect(botoes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "A cliente deu R$ 995",
      "A cliente deu R$ 1.000",
    ]);

    await act(async () => {
      botoes[1]?.click();
    });
    await avancar();
    expect(
      hospedeiro.querySelector(".pdv-change-result")?.textContent?.trim(),
    ).toBe("Troco: R$ 10,00");
    const campo = document.getElementById(
      "dinheiro-recebido",
    ) as HTMLInputElement;
    expect(campo.value).toBe("1.000,00");
  });

  it("tocar o valor R$ 995 numa venda de R$ 990 mostra o troco de R$ 5,00", async () => {
    await montar([peca(1, "Bicicleta", 990)]);
    const botao = [
      ...hospedeiro.querySelectorAll(".pdv-change-notes button"),
    ].find((b) => b.textContent?.includes("995")) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await avancar();
    expect(
      hospedeiro.querySelector(".pdv-change-result")?.textContent?.trim(),
    ).toBe("Troco: R$ 5,00");
  });
});
