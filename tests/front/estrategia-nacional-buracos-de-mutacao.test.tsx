// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em EstrategiaNacionalBloco (os testes
// antigos passavam mesmo com o defeito de uma linha plantado):
//  - "Grátis acima de um valor" com mínimo zero é inválido (grátis para todo
//    pedido não é "acima de"); no desconto, mínimo zero é válido (sem mínimo);
//  - desconto fixo de zero não é erro (campo vazio), negativo e NaN são;
//  - prévia do desconto com os dois exemplos em reais e só com valor > 0;
//  - o campo do desconto só liga depois de escolher o tipo;
//  - mínimo só aparece nas estratégias que o usam; alcance só nas de grátis.
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof EstrategiaNacionalBloco>[0];

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(p: Partial<Props>) {
  act(() =>
    raiz.render(
      <EstrategiaNacionalBloco
        estrategia="acima_de_valor"
        minimo={100}
        tipoDesconto={null}
        valorDesconto={0}
        alcance="mais_barata"
        onEscolherEstrategia={vi.fn()}
        onMinimo={vi.fn()}
        onTipoDesconto={vi.fn()}
        onValorDesconto={vi.fn()}
        onAlcance={vi.fn()}
        {...p}
      />,
    ),
  );
}

const campo = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`);
const texto = () => host.textContent ?? "";
const alertas = () =>
  Array.from(host.querySelectorAll('[role="alert"]')).map(
    (a) => a.textContent ?? "",
  );

function escrever(el: HTMLInputElement | null, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, valor);
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const AVISO_ACIMA = "Escreva o valor em reais, como 199 ou 1.234,50.";
const AVISO_MINIMO_DESCONTO =
  "Informe um pedido mínimo válido, de R$ 0 ou mais, para o desconto.";
const AVISO_DESCONTO = "Escreva o valor do desconto em reais, como 5 ou 12,50.";

describe("mínimo do 'Grátis acima de um valor'", () => {
  it.each([
    [0, "true"],
    [100, "false"],
    [0.01, "false"],
  ])("mínimo %s: aria-invalid=%s", (minimo, esperado) => {
    montar({ estrategia: "acima_de_valor", minimo });
    expect(campo("frete-nacional-minimo")?.getAttribute("aria-invalid")).toBe(
      esperado,
    );
  });

  it("mínimo zero é inválido mas NÃO ganha o aviso de 'não é dinheiro' (a tela mãe explica o zero)", () => {
    montar({ estrategia: "acima_de_valor", minimo: 0 });
    expect(alertas()).toEqual([]);
  });

  it.each([Number.NaN, -5])(
    "mínimo %s (não é dinheiro) mostra o aviso próprio",
    (minimo) => {
      montar({ estrategia: "acima_de_valor", minimo });
      expect(alertas()).toEqual([AVISO_ACIMA]);
    },
  );
});

describe("digitação do mínimo", () => {
  it("só espaços valem como campo vazio (zero), nunca como texto que não é dinheiro", () => {
    const onMinimo = vi.fn();
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 10,
      minimo: 50,
      onMinimo,
    });
    escrever(campo("frete-nacional-minimo"), "   ");
    expect(onMinimo).toHaveBeenLastCalledWith(0);
  });

  it("texto que não é dinheiro chega como NaN (o Salvar recusa em vez de gravar zero)", () => {
    const onMinimo = vi.fn();
    montar({ estrategia: "acima_de_valor", minimo: 100, onMinimo });
    escrever(campo("frete-nacional-minimo"), "abc");
    expect(onMinimo).toHaveBeenLastCalledWith(Number.NaN);
  });

  it("vírgula e milhar viram o número certo", () => {
    const onMinimo = vi.fn();
    montar({ estrategia: "acima_de_valor", minimo: 100, onMinimo });
    escrever(campo("frete-nacional-minimo"), "1.234,50");
    expect(onMinimo).toHaveBeenLastCalledWith(1234.5);
  });
});

describe("mínimo do 'Desconto no frete'", () => {
  it("zero é válido (sem mínimo): sem aviso e sem aria-invalid", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 10,
      minimo: 0,
    });
    expect(alertas()).toEqual([]);
    expect(campo("frete-nacional-minimo")?.getAttribute("aria-invalid")).toBe(
      "false",
    );
  });

  it.each([Number.NaN, -1])(
    "mínimo %s mostra o aviso do desconto",
    (minimo) => {
      montar({
        estrategia: "desconto_na_mais_barata",
        tipoDesconto: "percentual",
        valorDesconto: 10,
        minimo,
      });
      expect(alertas()).toEqual([AVISO_MINIMO_DESCONTO]);
      expect(campo("frete-nacional-minimo")?.getAttribute("aria-invalid")).toBe(
        "true",
      );
    },
  );
});

describe("valor do desconto", () => {
  it("fixo de zero é campo vazio e não é erro", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "fixo",
      valorDesconto: 0,
      minimo: 0,
    });
    expect(alertas()).toEqual([]);
    expect(
      campo("frete-nacional-valor-desconto")?.getAttribute("aria-invalid"),
    ).toBe("false");
  });

  it.each([Number.NaN, -3])(
    "fixo %s acusa o erro em reais",
    (valorDesconto) => {
      montar({
        estrategia: "desconto_na_mais_barata",
        tipoDesconto: "fixo",
        valorDesconto,
        minimo: 0,
      });
      expect(alertas()).toEqual([AVISO_DESCONTO]);
    },
  );

  it("percentual: zero é campo vazio e digitar 15 manda 15", () => {
    const onValorDesconto = vi.fn();
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 0,
      minimo: 0,
      onValorDesconto,
    });
    const el = campo("frete-nacional-valor-desconto");
    expect(el?.value).toBe("");
    escrever(el, "15");
    expect(onValorDesconto).toHaveBeenLastCalledWith(15);
  });

  it("percentual: apagar o campo manda 0 (sem desconto), nunca NaN", () => {
    const onValorDesconto = vi.fn();
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 15,
      minimo: 0,
      onValorDesconto,
    });
    const el = campo("frete-nacional-valor-desconto");
    expect(el?.value).toBe("15");
    escrever(el, "");
    expect(onValorDesconto).toHaveBeenLastCalledWith(0);
  });

  it("sem o tipo escolhido o campo fica travado e o cabeçalho pede o tipo", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: null,
      valorDesconto: 0,
      minimo: 0,
    });
    expect(campo("frete-nacional-valor-desconto")?.disabled).toBe(true);
    expect(texto()).toContain("desconto — escolha o tipo");
  });

  it("com o tipo escolhido o campo liga", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 0,
      minimo: 0,
    });
    expect(campo("frete-nacional-valor-desconto")?.disabled).toBe(false);
  });

  it("'desabilitado' trava o campo do desconto e o do mínimo", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 10,
      minimo: 50,
      desabilitado: true,
    });
    expect(campo("frete-nacional-valor-desconto")?.disabled).toBe(true);
    expect(campo("frete-nacional-minimo")?.disabled).toBe(true);
  });
});

describe("prévia do desconto em reais", () => {
  it("10% sobre os dois exemplos da tela", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 10,
      minimo: 0,
    });
    expect(texto()).toContain("Prévia (exemplo)");
    expect(texto()).toContain("R$ 24,90");
    expect(texto()).toContain("R$ 22,41");
    expect(texto()).toContain("R$ 41,30");
    expect(texto()).toContain("R$ 37,17");
  });

  it("R$ 5 fixo sobre os dois exemplos", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "fixo",
      valorDesconto: 5,
      minimo: 0,
    });
    expect(texto()).toContain("R$ 19,90");
    expect(texto()).toContain("R$ 36,30");
  });

  it("sem valor de desconto (zero) não há prévia", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: "percentual",
      valorDesconto: 0,
      minimo: 0,
    });
    expect(texto()).not.toContain("Prévia (exemplo)");
  });

  it("sem o tipo escolhido não há prévia, mesmo com valor", () => {
    montar({
      estrategia: "desconto_na_mais_barata",
      tipoDesconto: null,
      valorDesconto: 10,
      minimo: 0,
    });
    expect(texto()).not.toContain("Prévia (exemplo)");
  });
});

describe("quais campos cada estratégia mostra", () => {
  it.each([
    ["desligado", false, false],
    ["acima_de_valor", true, true],
    ["sempre", false, true],
    ["por_produto", false, false],
    ["desconto_na_mais_barata", true, false],
  ] as const)(
    "%s: mínimo=%s, alcance=%s",
    (estrategia, comMinimo, comAlcance) => {
      montar({ estrategia, tipoDesconto: "percentual", valorDesconto: 10 });
      expect(campo("frete-nacional-minimo") !== null).toBe(comMinimo);
      expect(texto().includes("Qual entrega fica grátis?")).toBe(comAlcance);
    },
  );
});

describe("alcance 'Qualquer uma'", () => {
  it("avisa que a entrega expressa fica por conta da loja e oferece voltar para a mais barata", () => {
    const onAlcance = vi.fn();
    montar({ estrategia: "sempre", alcance: "todas", onAlcance });
    expect(texto()).toContain("o frete dela fica por sua conta");
    const voltar = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Limitar à mais barata",
    );
    act(() => voltar?.click());
    expect(onAlcance).toHaveBeenCalledExactlyOnceWith("mais_barata");
  });

  it("com 'Só a mais barata' o aviso não aparece", () => {
    montar({ estrategia: "sempre", alcance: "mais_barata" });
    expect(texto()).not.toContain("o frete dela fica por sua conta");
  });
});
