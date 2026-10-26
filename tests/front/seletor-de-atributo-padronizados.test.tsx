// @vitest-environment jsdom
//
// Pedido do dono: os atributos que todo lojista usa (Tamanho, Voltagem,
// Capacidade, Material) têm que ser tão fáceis de configurar quanto a Cor.
// Aqui se prova o que o lojista vê e toca: as ABAS do sistema de medida
// (Roupas | Números | Calçados | Outro), os botões grandes com ✓, "Marcar todos"
// e "Limpar", o "Outro" que abre o campo de digitar, e a regra de que o valor
// continua sendo TEXTO e nada que já estava gravado some.
import { SeletorDeAtributo } from "@/components/admin/products/SeletorDeAtributo";
import { useState } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const texto = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const botoes = () => [...hospedeiro.querySelectorAll("button")];
const peca = (rotulo: string) =>
  [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      '[role="group"] > button',
    ),
  ].find((b) => texto(b) === rotulo);
const abas = () => [
  ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];
const nomesDasAbas = () => abas().map((a) => texto(a));
const abaAtiva = () =>
  texto(abas().find((a) => a.getAttribute("aria-selected") === "true"));
const aba = (rotulo: string) => abas().find((a) => texto(a) === rotulo);
const valores = () =>
  [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      '[data-testid="valores-do-atributo"] button',
    ),
  ].map((b) => texto(b));
const valor = (rotulo: string) =>
  [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      '[data-testid="valores-do-atributo"] button',
    ),
  ].find((b) => texto(b) === rotulo);
const marcados = () =>
  [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      '[data-testid="valores-do-atributo"] button[aria-pressed="true"]',
    ),
  ].map((b) => texto(b));
const porRotulo = (rotulo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`);
const acao = (rotulo: string) => botoes().find((b) => texto(b) === rotulo);
const contagem = () =>
  texto(hospedeiro.querySelector('[data-testid="contagem-do-atributo"]'));
const campo = (id: string) =>
  hospedeiro.querySelector<HTMLInputElement>(`#${id}`);

async function clicar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function digitarEEsperar(id: string, texto: string) {
  const el = campo(id);
  if (!el) throw new Error(`campo ${id} não está na tela`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, texto);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}

/** Variação ÚNICA com estado, como o modal de uma variação só. */
function Unico({
  nomeInicial = "",
  valorInicial = "",
  aoMudar,
  sugestoes,
}: {
  nomeInicial?: string;
  valorInicial?: string;
  aoMudar?: (nome: string, valor: string) => void;
  sugestoes?: string[];
}) {
  const [par, setPar] = useState({ nome: nomeInicial, valor: valorInicial });
  const mudar = (mudanca: Partial<typeof par>) =>
    setPar((anterior) => {
      const novo = { ...anterior, ...mudanca };
      aoMudar?.(novo.nome, novo.valor);
      return novo;
    });
  return (
    <SeletorDeAtributo
      modo="unico"
      numero={1}
      idDoNome="variant-name"
      idDoValor="variant-value"
      nome={par.nome}
      onNome={(n) => mudar({ nome: n })}
      valor={par.valor}
      onValor={(v) => mudar({ valor: v })}
      sugestoes={sugestoes}
    />
  );
}

/** Grade (vários valores) com estado, como o passo 1 do modal. */
function Grade({
  nomeInicial = "Tamanho",
  selecionadosIniciais = [] as string[],
  chipsIniciais = [] as { valor: string; usado: boolean }[],
  comDefinir = true,
  aoDefinir,
}: {
  nomeInicial?: string;
  selecionadosIniciais?: string[];
  chipsIniciais?: { valor: string; usado: boolean }[];
  comDefinir?: boolean;
  aoDefinir?: (valores: string[]) => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [selecionados, setSelecionados] = useState(selecionadosIniciais);
  const [chips, setChips] = useState(chipsIniciais);
  const [rascunho, setRascunho] = useState("");
  const igual = (a: string, b: string) =>
    a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
  return (
    <SeletorDeAtributo
      modo="multiplo"
      numero={1}
      idDoNome="grade-nome-0"
      idDoValor="grade-valor-0"
      nome={nome}
      onNome={setNome}
      selecionados={selecionados}
      chips={chips}
      onAlternar={(v) =>
        setSelecionados((prev) =>
          prev.some((s) => igual(s, v))
            ? prev.filter((s) => !igual(s, v))
            : [...prev, v],
        )
      }
      rascunho={rascunho}
      onRascunho={setRascunho}
      onAdicionar={() => {
        const v = rascunho.trim();
        if (v === "") return;
        setChips((prev) =>
          prev.some((c) => igual(c.valor, v))
            ? prev
            : [...prev, { valor: v, usado: false }],
        );
        setSelecionados((prev) =>
          prev.some((s) => igual(s, v)) ? prev : [...prev, v],
        );
        setRascunho("");
      }}
      onLimpar={() => {
        setSelecionados([]);
        setChips([]);
      }}
      onDefinir={
        comDefinir
          ? (novos) => {
              aoDefinir?.(novos);
              setSelecionados(novos);
            }
          : undefined
      }
    />
  );
}

const ROUPAS = ["PP", "P", "M", "G", "GG", "XG", "Único"];
const NUMEROS = Array.from({ length: 12 }, (_, i) => String(34 + 2 * i));
const CALCADOS = Array.from({ length: 12 }, (_, i) => String(33 + i));

describe("Tamanho — as abas do sistema de medida", () => {
  it("quatro abas: Roupas, Números, Calçados e Outro; sem valor nenhum abre em Roupas", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    expect(nomesDasAbas()).toEqual(["Roupas", "Números", "Calçados", "Outro"]);
    expect(abaAtiva()).toBe("Roupas");
    expect(valores()).toEqual(ROUPAS);
  });

  it("Números tem 34 a 56 de dois em dois; Calçados tem 33 a 44 todos", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    await clicar(aba("Números"));
    expect(abaAtiva()).toBe("Números");
    expect(valores()).toEqual(NUMEROS);
    await clicar(aba("Calçados"));
    expect(valores()).toEqual(CALCADOS);
  });

  it("a aba é derivada do que já está gravado: 38 abre em Números, P em Roupas, 41 em Calçados", async () => {
    for (const [gravado, esperada] of [
      ["38", "Números"],
      ["P", "Roupas"],
      ["p", "Roupas"],
      ["41", "Calçados"],
      ["33", "Calçados"],
      ["56", "Números"],
    ] as const) {
      await act(async () => {
        raiz.render(
          <Unico key={gravado} nomeInicial="Tamanho" valorInicial={gravado} />,
        );
      });
      expect(abaAtiva(), gravado).toBe(esperada);
      expect(marcados(), gravado).toHaveLength(1);
    }
  });

  it("44 existe nas duas listas e abre em Números (a primeira que o tem)", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="44" />);
    });
    expect(abaAtiva()).toBe("Números");
    expect(marcados()).toEqual(["44"]);
  });

  it("valor que nenhuma lista tem ('2 anos', '45', '57') abre em Outro e fica no campo, intacto", async () => {
    for (const gravado of ["2 anos", "45", "57"]) {
      await act(async () => {
        raiz.render(
          <Unico key={gravado} nomeInicial="Tamanho" valorInicial={gravado} />,
        );
      });
      expect(abaAtiva(), gravado).toBe("Outro");
      expect(campo("variant-value")?.value, gravado).toBe(gravado);
      expect(valores(), gravado).toEqual([]);
    }
  });

  it("trocar de aba não apaga o valor gravado (a escolha só muda quando ele toca um botão)", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico nomeInicial="Tamanho" valorInicial="2 anos" aoMudar={aoMudar} />,
      );
    });
    await clicar(aba("Roupas"));
    await clicar(aba("Calçados"));
    await clicar(aba("Outro"));
    expect(aoMudar).not.toHaveBeenCalled();
    expect(campo("variant-value")?.value).toBe("2 anos");
  });

  it("tocar um número grava o texto do número", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" aoMudar={aoMudar} />);
    });
    await clicar(aba("Números"));
    await clicar(valor("42"));
    expect(aoMudar).toHaveBeenLastCalledWith("Tamanho", "42");
    expect(marcados()).toEqual(["42"]);
  });
});

describe("Tamanho — vários valores: a troca de aba preserva o que já está marcado", () => {
  it("marca P, vai para Números, marca 38, volta para Roupas: P segue marcado e a contagem soma", async () => {
    await act(async () => {
      raiz.render(<Grade />);
    });
    expect(contagem()).toBe("nenhum selecionado");
    await clicar(valor("P"));
    await clicar(aba("Números"));
    expect(marcados()).toEqual([]);
    await clicar(valor("38"));
    expect(contagem()).toBe("2 selecionados");
    await clicar(aba("Roupas"));
    expect(marcados()).toEqual(["P"]);
    // A linha 'Selecionadas:' mostra os dois, qualquer que seja a aba.
    expect(porRotulo("Tirar P")).toBeTruthy();
    expect(porRotulo("Tirar 38")).toBeTruthy();
  });

  it("o 38 de Números e o 38 de Calçados são o mesmo texto: marcado numa aba, marcado na outra", async () => {
    await act(async () => {
      raiz.render(<Grade selecionadosIniciais={["38"]} />);
    });
    expect(abaAtiva()).toBe("Números");
    await clicar(aba("Calçados"));
    expect(marcados()).toEqual(["38"]);
    await clicar(valor("38"));
    expect(contagem()).toBe("nenhum selecionado");
  });

  it("mistura (P, M e '2 anos'): abre na aba da maioria e o desconhecido NÃO some", async () => {
    await act(async () => {
      raiz.render(
        <Grade
          selecionadosIniciais={["P", "M", "2 anos"]}
          chipsIniciais={[
            { valor: "P", usado: true },
            { valor: "M", usado: true },
            { valor: "2 anos", usado: true },
          ]}
        />,
      );
    });
    expect(abaAtiva()).toBe("Roupas");
    // Em qualquer aba o '2 anos' continua marcado, tirável e reaproveitável.
    for (const rotulo of ["Roupas", "Números", "Calçados", "Outro"]) {
      await clicar(aba(rotulo));
      expect(porRotulo("Tirar 2 anos"), rotulo).toBeTruthy();
      expect(
        [...hospedeiro.querySelectorAll('[data-testid="chip-do-produto"]')].map(
          (c) => texto(c),
        ),
        rotulo,
      ).toContain("2 anos");
    }
  });

  it("só valores desconhecidos: abre em Outro e eles aparecem como botões marcados", async () => {
    await act(async () => {
      raiz.render(
        <Grade
          selecionadosIniciais={["2 anos", "3 anos"]}
          chipsIniciais={[
            { valor: "2 anos", usado: true },
            { valor: "3 anos", usado: true },
          ]}
        />,
      );
    });
    expect(abaAtiva()).toBe("Outro");
    const chips = [
      ...hospedeiro.querySelectorAll('[data-testid="chip-do-produto"]'),
    ];
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
    ]);
  });

  it("digitar valores novos NÃO faz a aba pular debaixo dos dedos", async () => {
    await act(async () => {
      raiz.render(<Grade selecionadosIniciais={["P"]} />);
    });
    expect(abaAtiva()).toBe("Roupas");
    for (const digitado of ["2 anos", "3 anos", "4 anos"]) {
      await digitarEEsperar("grade-valor-0", digitado);
      await clicar(porRotulo("Adicionar valor do atributo 1"));
    }
    expect(abaAtiva()).toBe("Roupas");
    expect(contagem()).toBe("4 selecionados");
  });

  it("o digitado que já tem botão na lista não repete como chip; o desconhecido vira botão marcado", async () => {
    await act(async () => {
      raiz.render(<Grade />);
    });
    await digitarEEsperar("grade-valor-0", "M");
    await clicar(porRotulo("Adicionar valor do atributo 1"));
    await digitarEEsperar("grade-valor-0", "2 anos");
    await clicar(porRotulo("Adicionar valor do atributo 1"));
    const chips = [
      ...hospedeiro.querySelectorAll('[data-testid="chip-do-produto"]'),
    ].map((c) => texto(c));
    expect(chips).toEqual(["2 anos"]);
    expect(marcados()).toEqual(["M"]);
  });
});

describe("Marcar todos e Limpar", () => {
  it("Marcar todos marca todos os botões da ABA e soma ao que já estava marcado", async () => {
    const aoDefinir = vi.fn();
    await act(async () => {
      raiz.render(<Grade aoDefinir={aoDefinir} />);
    });
    await clicar(acao("Marcar todos"));
    expect(marcados()).toEqual(ROUPAS);
    expect(contagem()).toBe("7 selecionados");
    // Tudo da aba já está marcado: não há mais o que marcar.
    expect(acao("Marcar todos")).toBeUndefined();

    await clicar(aba("Números"));
    await clicar(valor("38"));
    await clicar(acao("Marcar todos"));
    expect(contagem()).toBe("19 selecionados");
    // Uma chamada só por clique, com a lista inteira (nada de 12 toques em fila).
    expect(aoDefinir).toHaveBeenLastCalledWith([
      ...ROUPAS,
      "38",
      ...NUMEROS.filter((n) => n !== "38"),
    ]);
  });

  it("Limpar tira todas as escolhas, mas os valores digitados continuam à mão como botões", async () => {
    await act(async () => {
      raiz.render(
        <Grade
          selecionadosIniciais={["P", "2 anos"]}
          chipsIniciais={[{ valor: "2 anos", usado: false }]}
        />,
      );
    });
    await clicar(acao("Limpar"));
    expect(contagem()).toBe("nenhum selecionado");
    const chip = hospedeiro.querySelector('[data-testid="chip-do-produto"]');
    expect(texto(chip)).toBe("2 anos");
    expect(chip?.getAttribute("aria-pressed")).toBe("false");
    // Sem nada marcado, não há o que limpar.
    expect(acao("Limpar")).toBeUndefined();
  });

  it("Marcar todos usa a grafia que o produto já grava ('p' gravado não vira um 'P' duplicado)", async () => {
    const aoDefinir = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          chipsIniciais={[{ valor: "p", usado: true }]}
          aoDefinir={aoDefinir}
        />,
      );
    });
    await clicar(acao("Marcar todos"));
    const enviados = aoDefinir.mock.lastCall?.[0] as string[];
    expect(enviados).toContain("p");
    expect(enviados).not.toContain("P");
    expect(enviados).toHaveLength(7);
  });

  it("na variação ÚNICA (um valor só) não existe Marcar todos nem Limpar", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="P" />);
    });
    expect(acao("Marcar todos")).toBeUndefined();
    expect(acao("Limpar")).toBeUndefined();
  });

  it("o pai que não oferece como definir a lista não ganha os dois botões", async () => {
    await act(async () => {
      raiz.render(<Grade comDefinir={false} selecionadosIniciais={["P"]} />);
    });
    expect(acao("Marcar todos")).toBeUndefined();
    expect(acao("Limpar")).toBeUndefined();
  });

  it("na aba Outro não há botões de valor para marcar: só o Limpar, se houver escolha", async () => {
    await act(async () => {
      raiz.render(<Grade selecionadosIniciais={["P"]} />);
    });
    await clicar(aba("Outro"));
    expect(acao("Marcar todos")).toBeUndefined();
    expect(acao("Limpar")).toBeTruthy();
  });
});

describe("Outro — digitar o que a lista não tem", () => {
  it("tocar a aba Outro leva o cursor para o campo e explica o que fazer", async () => {
    await act(async () => {
      raiz.render(<Grade />);
    });
    await clicar(aba("Outro"));
    expect(abaAtiva()).toBe("Outro");
    expect(document.activeElement).toBe(campo("grade-valor-0"));
    expect(texto(hospedeiro)).toContain("2 anos");
  });

  it("'Digitar outro tamanho' faz a mesma coisa de qualquer aba", async () => {
    await act(async () => {
      raiz.render(<Grade />);
    });
    await clicar(acao("Digitar outro tamanho"));
    expect(abaAtiva()).toBe("Outro");
    expect(document.activeElement).toBe(campo("grade-valor-0"));
  });

  it("o digitado vira botão MARCADO e o campo e o + mantêm os ids e rótulos de sempre", async () => {
    await act(async () => {
      raiz.render(<Grade />);
    });
    await clicar(aba("Outro"));
    expect(campo("grade-valor-0")?.getAttribute("aria-label")).toBe(
      "Novo valor do atributo 1",
    );
    expect(campo("grade-valor-0")?.getAttribute("placeholder")).toMatch(
      /Outro tamanho/,
    );
    await digitarEEsperar("grade-valor-0", "2 anos");
    await clicar(porRotulo("Adicionar valor do atributo 1"));
    const chip = hospedeiro.querySelector('[data-testid="chip-do-produto"]');
    expect(texto(chip)).toBe("2 anos");
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(abaAtiva()).toBe("Outro");
  });
});

describe("os botões de valor — grandes, com ✓ e rótulo acessível", () => {
  it("Tamanho: 4 por linha, 52 px de altura, cantos grandes, aria-pressed e rótulo 'Tamanho M'", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="M" />);
    });
    const grade = hospedeiro.querySelector(
      '[data-testid="valores-do-atributo"]',
    );
    expect(grade?.className).toContain("grid-cols-4");
    const m = valor("M");
    expect(m?.className).toContain("min-h-[52px]");
    expect(m?.className).toContain("rounded-2xl");
    expect(m?.getAttribute("aria-pressed")).toBe("true");
    expect(m?.getAttribute("aria-label")).toBe("Tamanho M");
    expect(valor("G")?.getAttribute("aria-pressed")).toBe("false");
    expect(valor("G")?.getAttribute("aria-label")).toBe("Tamanho G");
  });

  it("o ✓ vem ANTES do texto e só no botão marcado (nunca só a cor)", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="M" />);
    });
    const m = valor("M");
    expect(m?.firstElementChild?.getAttribute("data-marca")).toBe(
      "selecionado",
    );
    expect(m?.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(valor("G")?.querySelector("svg")).toBeNull();
    expect(
      hospedeiro.querySelectorAll('svg[data-marca="selecionado"]'),
    ).toHaveLength(1);
  });

  it("a linha de ajuda do Tamanho ensina os três sistemas", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    expect(texto(hospedeiro)).toContain(
      "Roupas: PP a XG e Único · Números: 34 a 56 · Calçados: 33 a 44",
    );
  });

  it("toda aba tem alvo de toque de 44 px e todo botão com contorno tem border-solid", async () => {
    await act(async () => {
      raiz.render(
        <Grade
          selecionadosIniciais={["M"]}
          chipsIniciais={[{ valor: "2 anos", usado: true }]}
        />,
      );
    });
    for (const a of abas()) expect(a.className, texto(a)).toContain("min-h-11");
    const comContorno = botoes().filter((b) => b.classList.contains("border"));
    expect(comContorno.length).toBeGreaterThan(12);
    expect(
      comContorno
        .filter((b) => !b.classList.contains("border-solid"))
        .map((b) => b.getAttribute("aria-label") ?? texto(b)),
    ).toEqual([]);
  });

  it("as abas são anunciadas como abas (tablist) e os botões ficam no painel da aba", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    expect(hospedeiro.querySelector('[role="tablist"]')).toBeTruthy();
    expect(
      hospedeiro.querySelector('[role="tabpanel"] [data-testid]') ??
        hospedeiro.querySelector('[role="tabpanel"]'),
    ).toBeTruthy();
  });
});

describe("Voltagem", () => {
  it("três botões grandes com ícone: 110V, 220V e Bivolt, sem abas", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Voltagem" />);
    });
    expect(valores()).toEqual(["110V", "220V", "Bivolt"]);
    expect(abas()).toHaveLength(0);
    const grade = hospedeiro.querySelector(
      '[data-testid="valores-do-atributo"]',
    );
    expect(grade?.className).toContain("grid-cols-3");
    for (const rotulo of ["110V", "220V", "Bivolt"]) {
      expect(valor(rotulo)?.querySelector("svg"), rotulo).toBeTruthy();
      expect(valor(rotulo)?.className).toContain("min-h-[52px]");
    }
    expect(valor("220V")?.getAttribute("aria-label")).toBe("Voltagem 220V");
  });

  it("tocar grava o texto e marca com ✓ no lugar do ícone", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico nomeInicial="Voltagem" aoMudar={aoMudar} />);
    });
    await clicar(valor("Bivolt"));
    expect(aoMudar).toHaveBeenLastCalledWith("Voltagem", "Bivolt");
    expect(marcados()).toEqual(["Bivolt"]);
    expect(
      valor("Bivolt")?.querySelector('svg[data-marca="selecionado"]'),
    ).toBeTruthy();
  });

  it("explica o Bivolt em uma linha curta", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Voltagem" />);
    });
    expect(texto(hospedeiro)).toContain("Bivolt");
    expect(texto(hospedeiro)).toMatch(/110V e 220V/);
  });

  it("valor antigo fora da lista ('127V') fica no campo, intacto", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Voltagem" valorInicial="127V" />);
    });
    expect(campo("variant-value")?.value).toBe("127V");
    expect(marcados()).toEqual([]);
  });
});

describe("Capacidade", () => {
  it("abas Armazenamento | Volume | Outro, com os valores de cada uma", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Capacidade" />);
    });
    expect(nomesDasAbas()).toEqual(["Armazenamento", "Volume", "Outro"]);
    expect(abaAtiva()).toBe("Armazenamento");
    expect(valores()).toEqual([
      "16 GB",
      "32 GB",
      "64 GB",
      "128 GB",
      "256 GB",
      "512 GB",
      "1 TB",
    ]);
    await clicar(aba("Volume"));
    expect(valores()).toEqual([
      "50 ml",
      "100 ml",
      "250 ml",
      "500 ml",
      "1 L",
      "2 L",
    ]);
    const grade = hospedeiro.querySelector(
      '[data-testid="valores-do-atributo"]',
    );
    expect(grade?.className).toContain("grid-cols-3");
    expect(valor("500 ml")?.getAttribute("aria-label")).toBe(
      "Capacidade 500 ml",
    );
  });

  it("a aba vem do valor gravado: 64 GB em Armazenamento, 500 ml em Volume, 3 L em Outro", async () => {
    for (const [gravado, esperada] of [
      ["64 GB", "Armazenamento"],
      ["1 TB", "Armazenamento"],
      ["500 ml", "Volume"],
      ["2 L", "Volume"],
      ["3 L", "Outro"],
    ] as const) {
      await act(async () => {
        raiz.render(
          <Unico
            key={gravado}
            nomeInicial="Capacidade"
            valorInicial={gravado}
          />,
        );
      });
      expect(abaAtiva(), gravado).toBe(esperada);
    }
  });

  it("os apelidos 'Armazenamento' e 'Memória' abrem a peça Capacidade com o nome gravado intacto", async () => {
    for (const apelido of ["Armazenamento", "Memória", "memoria"]) {
      const aoMudar = vi.fn();
      await act(async () => {
        raiz.render(
          <Unico
            key={apelido}
            nomeInicial={apelido}
            valorInicial="128 GB"
            aoMudar={aoMudar}
          />,
        );
      });
      expect(peca("Capacidade")?.getAttribute("aria-pressed"), apelido).toBe(
        "true",
      );
      expect(marcados(), apelido).toEqual(["128 GB"]);
      await clicar(peca("Capacidade"));
      expect(aoMudar, apelido).not.toHaveBeenCalled();
    }
  });

  it("tocar a peça num produto que já grava 'armazenamento' grava 'armazenamento' (a loja agrupa pelo texto exato)", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico sugestoes={["armazenamento"]} aoMudar={aoMudar} />);
    });
    await clicar(peca("Capacidade"));
    expect(aoMudar).toHaveBeenLastCalledWith("armazenamento", "");
  });

  it("sem nada em uso, tocar a peça grava o nome canônico 'Capacidade'", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico aoMudar={aoMudar} />);
    });
    await clicar(peca("Capacidade"));
    expect(aoMudar).toHaveBeenLastCalledWith("Capacidade", "");
  });

  it("na grade a contagem concorda no feminino e o placeholder fala em capacidade", async () => {
    await act(async () => {
      raiz.render(<Grade nomeInicial="Capacidade" />);
    });
    expect(contagem()).toBe("nenhuma selecionada");
    await clicar(valor("64 GB"));
    expect(contagem()).toBe("1 selecionada");
    await clicar(valor("128 GB"));
    expect(contagem()).toBe("2 selecionadas");
    expect(texto(hospedeiro)).toContain("Escolha as capacidades");
    expect(campo("grade-valor-0")?.getAttribute("placeholder")).toMatch(
      /Outra capacidade/,
    );
  });

  it("trocar Tamanho por Capacidade zera a aba e a lista de valores do tipo antigo", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="38" />);
    });
    expect(abaAtiva()).toBe("Números");
    await clicar(peca("Capacidade"));
    expect(nomesDasAbas()).toEqual(["Armazenamento", "Volume", "Outro"]);
    expect(abaAtiva()).toBe("Armazenamento");
    expect(campo("variant-value")?.value).toBe("");
    await clicar(peca("Tamanho"));
    expect(abaAtiva()).toBe("Roupas");
  });
});

describe("Material", () => {
  it("botões grandes: dez materiais e o 'Outro', sem abas", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Material" />);
    });
    expect(abas()).toHaveLength(0);
    expect(valores()).toEqual([
      "Algodão",
      "Poliéster",
      "Couro",
      "Couro sintético",
      "Linho",
      "Jeans",
      "Plástico",
      "Metal",
      "Madeira",
      "Vidro",
      "Outro",
    ]);
    const grade = hospedeiro.querySelector(
      '[data-testid="valores-do-atributo"]',
    );
    expect(grade?.className).toContain("grid-cols-3");
    expect(valor("Couro sintético")?.getAttribute("aria-label")).toBe(
      "Material Couro sintético",
    );
  });

  it("tocar um material grava o texto; o 'Outro' do grid não é valor: leva ao campo", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico nomeInicial="Material" aoMudar={aoMudar} />);
    });
    await clicar(valor("Linho"));
    expect(aoMudar).toHaveBeenLastCalledWith("Material", "Linho");
    expect(marcados()).toEqual(["Linho"]);
    aoMudar.mockClear();
    await clicar(porRotulo("Outro material"));
    expect(aoMudar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo("variant-value"));
    expect(
      porRotulo("Outro material")?.getAttribute("aria-pressed"),
    ).toBeNull();
  });

  it("produto antigo 'Material' / 'Algodão' abre na peça Material com o botão Algodão marcado", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Material" valorInicial="Algodão" />);
    });
    expect(peca("Material")?.getAttribute("aria-pressed")).toBe("true");
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("false");
    expect(campo("variant-name")).toBeNull();
    expect(marcados()).toEqual(["Algodão"]);
    expect(campo("variant-value")?.value).toBe("Algodão");
  });

  it("material que a lista não tem ('Seda') fica no campo, intacto, e nenhum botão marca", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="material" valorInicial="Seda" />);
    });
    expect(peca("Material")?.getAttribute("aria-pressed")).toBe("true");
    expect(campo("variant-value")?.value).toBe("Seda");
    expect(marcados()).toEqual([]);
  });

  it("a grafia em uso vence: 'algodão' gravado + toque em Algodão grava 'algodão'", async () => {
    const aoDefinir = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          nomeInicial="Material"
          chipsIniciais={[{ valor: "algodão", usado: true }]}
          aoDefinir={aoDefinir}
        />,
      );
    });
    await clicar(acao("Marcar todos"));
    const enviados = aoDefinir.mock.lastCall?.[0] as string[];
    expect(enviados).toContain("algodão");
    expect(enviados).not.toContain("Algodão");
    // 10 materiais; o "Outro" não é valor e não entra.
    expect(enviados).toHaveLength(10);
    expect(enviados).not.toContain("Outro");
  });

  it("contagem no masculino e chamada 'Escolha os materiais'", async () => {
    await act(async () => {
      raiz.render(<Grade nomeInicial="Material" />);
    });
    await clicar(valor("Jeans"));
    await clicar(valor("Metal"));
    expect(contagem()).toBe("2 selecionados");
    expect(texto(hospedeiro)).toContain("Escolha os materiais");
  });
});

describe("as peças de tipo: seis em grade que cabe em 320 px", () => {
  it("sem nada em uso: Tamanho, Cor, Voltagem, Capacidade, Material e Outro, em 3 colunas", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    const grupo = hospedeiro.querySelector('[role="group"]');
    const rotulos = [...(grupo?.querySelectorAll(":scope > button") ?? [])].map(
      (b) => texto(b),
    );
    expect(rotulos).toEqual([
      "Tamanho",
      "Cor",
      "Voltagem",
      "Capacidade",
      "Material",
      "Outro",
    ]);
    expect(grupo?.className).toContain("grid-cols-3");
    for (const b of grupo?.querySelectorAll(":scope > button") ?? []) {
      expect(b.className).toContain("min-h-11");
    }
  });

  it("o texto de ajuda sem tipo escolhido cita os seis caminhos", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    expect(texto(hospedeiro)).toContain(
      "Toque no que muda neste produto: tamanho, cor, voltagem, capacidade, material ou outro.",
    );
  });

  it("produto que já usa Material: sobram só a peça dele e Outro (a trava de um grupo)", async () => {
    await act(async () => {
      raiz.render(<Unico sugestoes={["Material"]} />);
    });
    const grupo = hospedeiro.querySelector('[role="group"]');
    const rotulos = [...(grupo?.querySelectorAll(":scope > button") ?? [])].map(
      (b) => texto(b),
    );
    expect(rotulos).toEqual(["Material", "Outro"]);
  });

  it("Material e Capacidade escolhidos em OUTRO cartão ficam apagados neste", async () => {
    await act(async () => {
      raiz.render(
        <SeletorDeAtributo
          modo="unico"
          numero={2}
          idDoNome="variant-name-1"
          idDoValor="variant-value-1"
          nome=""
          onNome={() => {}}
          valor=""
          onValor={() => {}}
          tiposOcupados={["Material", "Capacidade"]}
        />,
      );
    });
    const grupo = hospedeiro.querySelector('[role="group"]');
    const ocupadas = [...(grupo?.querySelectorAll(":scope > button") ?? [])]
      .filter((b) => b.getAttribute("aria-disabled") === "true")
      .map((b) => texto(b));
    expect(ocupadas).toEqual(["Capacidade", "Material"]);
  });
});
