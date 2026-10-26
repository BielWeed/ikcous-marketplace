// @vitest-environment jsdom
//
// Achados da revisão do seletor de atributos:
//   1. produto gravado com DOIS nomes do mesmo tipo ("Memória / Armazenamento",
//      os dois viram Capacidade): o cartão mostra o nome gravado, o nome real
//      vira atalho, e a peça nunca escreve um nome que outro par já usa;
//   2. o × de remover não sai do cartão a 320 px (a contagem quebra de linha);
//   3. "Único" marcado cabe a 320 px (3 colunas) e as abas não vazam;
//   4. tocar um botão reaproveita a grafia gravada mesmo com acento e espaço
//      diferentes ("128gb" gravado, toque em "128 GB" mantém "128gb");
//   5. as abas seguem o padrão tablist (aria-controls, setas, tabindex).
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
const atalhos = () => [
  ...hospedeiro.querySelectorAll<HTMLButtonElement>(
    '[data-testid="atalho-de-atributo"]',
  ),
];
const abas = () => [
  ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];
const valor = (rotulo: string) =>
  [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      '[data-testid="valores-do-atributo"] button',
    ),
  ].find((b) => texto(b) === rotulo);
const titulo = () => texto(hospedeiro.querySelector("p"));

async function clicar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function tecla(el: Element | null | undefined, key: string) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** Uma variação ÚNICA com estado: o par `nome`/`valor` mais o que os outros pares ocupam. */
function Unico({
  nomeInicial = "",
  valorInicial = "",
  sugestoes,
  nomesOcupados,
  valoresEmUso,
  aoMudar,
}: {
  nomeInicial?: string;
  valorInicial?: string;
  sugestoes?: string[];
  nomesOcupados?: string[];
  valoresEmUso?: string[];
  aoMudar?: (nome: string, valor: string) => void;
}) {
  const [par, setPar] = useState({ nome: nomeInicial, valor: valorInicial });
  const mudar = (m: Partial<typeof par>) =>
    setPar((a) => {
      const novo = { ...a, ...m };
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
      nomesOcupados={nomesOcupados}
      valoresEmUso={valoresEmUso}
    />
  );
}

function Grade({
  nomeInicial = "Capacidade",
  sugestoes,
  nomesOcupados,
  chips = [] as { valor: string; usado: boolean }[],
  selecionadosIniciais = [] as string[],
  aoNome,
  aoAlternar,
  aoDefinir,
  comRemover = false,
}: {
  nomeInicial?: string;
  sugestoes?: string[];
  nomesOcupados?: string[];
  chips?: { valor: string; usado: boolean }[];
  selecionadosIniciais?: string[];
  aoNome?: (n: string) => void;
  aoAlternar?: (v: string) => void;
  aoDefinir?: (v: string[]) => void;
  comRemover?: boolean;
}) {
  const [nome, setNome] = useState(nomeInicial);
  return (
    <SeletorDeAtributo
      modo="multiplo"
      numero={1}
      idDoNome="grade-nome-0"
      idDoValor="grade-valor-0"
      nome={nome}
      onNome={(n) => {
        setNome(n);
        aoNome?.(n);
      }}
      sugestoes={sugestoes}
      nomesOcupados={nomesOcupados}
      selecionados={selecionadosIniciais}
      chips={chips}
      onAlternar={(v) => aoAlternar?.(v)}
      rascunho=""
      onRascunho={() => {}}
      onAdicionar={() => {}}
      onLimpar={() => {}}
      onDefinir={aoDefinir}
      aoRemover={comRemover ? () => {} : undefined}
    />
  );
}

const CELULAR = ["Memória / Armazenamento"];

describe("1. dois nomes do mesmo tipo no mesmo produto (Memória / Armazenamento)", () => {
  it("o cartão mostra o NOME GRAVADO quando ele difere do tipo", async () => {
    for (const [nome, esperado] of [
      ["Memória", "1 · Memória"],
      ["Armazenamento", "1 · Armazenamento"],
      ["armazenamento", "1 · armazenamento"],
      ["Capacidade", "1 · Capacidade"],
      ["tamanho", "1 · Tamanho"],
      [" COR ", "1 · Cor"],
    ] as const) {
      await act(async () => {
        raiz.render(<Grade key={nome} nomeInicial={nome} />);
      });
      expect(titulo(), nome).toBe(esperado);
    }
  });

  it("os dois nomes em uso viram atalhos com o NOME REAL, e o do cartão fica marcado", async () => {
    await act(async () => {
      raiz.render(<Grade nomeInicial="Memória" sugestoes={CELULAR} />);
    });
    expect(atalhos().map((a) => texto(a))).toEqual([
      "Memória",
      "Armazenamento",
    ]);
    expect(atalhos().map((a) => a.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
    // A peça Capacidade segue marcada: os dois nomes são do mesmo tipo.
    expect(peca("Capacidade")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("tocar o atalho do outro nome grava esse nome (não o primeiro da lista)", async () => {
    const aoNome = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade nomeInicial="Memória" sugestoes={CELULAR} aoNome={aoNome} />,
      );
    });
    await clicar(atalhos().at(1));
    expect(aoNome).toHaveBeenLastCalledWith("Armazenamento");
    expect(titulo()).toBe("1 · Armazenamento");
  });

  it("atalho de nome que OUTRO par já usa fica apagado e não grava", async () => {
    const aoNome = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          nomeInicial="Memória"
          sugestoes={CELULAR}
          nomesOcupados={["Armazenamento"]}
          aoNome={aoNome}
        />,
      );
    });
    const ocupado = atalhos().at(1);
    expect(ocupado?.getAttribute("aria-disabled")).toBe("true");
    await clicar(ocupado);
    expect(aoNome).not.toHaveBeenCalled();
  });

  it("(c) a peça grava o nome em uso que NENHUM outro par tomou", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          sugestoes={CELULAR}
          nomesOcupados={["Memória"]}
          aoMudar={aoMudar}
        />,
      );
    });
    await clicar(peca("Capacidade"));
    expect(aoMudar).toHaveBeenLastCalledWith("Armazenamento", "");
  });

  it("(c) sem nada tomado, a peça grava o primeiro nome em uso", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico sugestoes={CELULAR} nomesOcupados={[]} aoMudar={aoMudar} />,
      );
    });
    await clicar(peca("Capacidade"));
    expect(aoMudar).toHaveBeenLastCalledWith("Memória", "");
  });

  it("(c) a comparação ignora caixa e acento: 'MEMORIA' tomado deixa 'Armazenamento'", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          sugestoes={CELULAR}
          nomesOcupados={["MEMORIA"]}
          aoMudar={aoMudar}
        />,
      );
    });
    await clicar(peca("Capacidade"));
    expect(aoMudar).toHaveBeenLastCalledWith("Armazenamento", "");
  });

  it("(c) todos os nomes do tipo tomados: a peça apaga e nunca escreve um repetido", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          sugestoes={CELULAR}
          nomesOcupados={["Memória", "Armazenamento"]}
          aoMudar={aoMudar}
        />,
      );
    });
    const capacidade = peca("Capacidade");
    expect(capacidade?.getAttribute("aria-disabled")).toBe("true");
    await clicar(capacidade);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("(c) sem produto em uso, o nome tomado pelo outro par não vira repetido na peça (canônico livre)", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico nomesOcupados={["Cor"]} aoMudar={aoMudar} />);
    });
    expect(peca("Cor")?.getAttribute("aria-disabled")).toBe("true");
    await clicar(peca("Tamanho"));
    expect(aoMudar).toHaveBeenLastCalledWith("Tamanho", "");
  });

  it("um tipo com UM nome só em uso não ganha atalho (a peça basta)", async () => {
    await act(async () => {
      raiz.render(<Unico sugestoes={["Cor / tamanho", "cor"]} />);
    });
    expect(atalhos()).toHaveLength(0);
  });
});

describe("2. o × de remover fica dentro do cartão a 320 px", () => {
  it("a contagem quebra para baixo do título dentro do mesmo bloco; o × é irmão do bloco e não encolhe", async () => {
    await act(async () => {
      raiz.render(<Grade comRemover />);
    });
    const contagem = hospedeiro.querySelector(
      '[data-testid="contagem-do-atributo"]',
    );
    const bloco = contagem?.parentElement;
    expect(bloco?.className).toContain("flex-wrap");
    expect(bloco?.className).toContain("min-w-0");
    const remover = hospedeiro.querySelector<HTMLElement>(
      '[aria-label="Remover atributo 1"]',
    );
    expect(bloco?.contains(remover ?? null)).toBe(false);
    expect(remover?.className).toContain("shrink-0");
    expect(bloco?.parentElement).toBe(remover?.parentElement);
  });
});

describe("3. 320 px: botões de 4 colunas e abas", () => {
  it("Tamanho vira 3 colunas abaixo de 360 px e volta a 4 acima", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="Único" />);
    });
    const grade = hospedeiro.querySelector(
      '[data-testid="valores-do-atributo"]',
    );
    expect(grade?.className).toContain("grid-cols-4");
    expect(grade?.className).toContain("max-[359px]:grid-cols-3");
    expect(valor("Único")?.className).toContain("min-h-[52px]");
  });

  it("as abas encolhem sem vazar: min-w-0, truncate e alvo de 44 px", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    for (const a of abas()) {
      expect(a.className, texto(a)).toContain("min-w-0");
      expect(a.className, texto(a)).toContain("truncate");
      expect(a.className, texto(a)).toContain("min-h-11");
    }
  });
});

describe("4. tocar usa a grafia gravada, mesmo com acento e espaço diferentes", () => {
  it("'128gb' gravado + toque em '128 GB' mantém '128gb' e o botão aparece marcado", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          nomeInicial="Capacidade"
          valoresEmUso={["128gb"]}
          aoMudar={aoMudar}
        />,
      );
    });
    await clicar(valor("128 GB"));
    expect(aoMudar).toHaveBeenLastCalledWith("Capacidade", "128gb");
  });

  it("'Algodao' gravado + toque em 'Algodão' mantém 'Algodao'", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          nomeInicial="Material"
          valoresEmUso={["Algodao"]}
          aoMudar={aoMudar}
        />,
      );
    });
    await clicar(valor("Algodão"));
    expect(aoMudar).toHaveBeenLastCalledWith("Material", "Algodao");
  });

  it("o valor gravado '128gb' marca o botão '128 GB' e abre na aba Armazenamento", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Capacidade" valorInicial="128gb" />);
    });
    expect(valor("128 GB")?.getAttribute("aria-pressed")).toBe("true");
    expect(
      abas().find((a) => a.getAttribute("aria-selected") === "true")
        ?.textContent,
    ).toBe("Armazenamento");
  });

  it("na grade: chip '128gb' (já usado) + toque em '128 GB' alterna '128gb'", async () => {
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          chips={[{ valor: "128gb", usado: true }]}
          aoAlternar={aoAlternar}
        />,
      );
    });
    await clicar(valor("128 GB"));
    expect(aoAlternar).toHaveBeenCalledWith("128gb");
  });

  it("na grade, o digitado nesta abertura ('128gb' marcado) também é reaproveitado: o toque o DESMARCA, não cria um segundo", async () => {
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          chips={[{ valor: "128gb", usado: false }]}
          selecionadosIniciais={["128gb"]}
          aoAlternar={aoAlternar}
        />,
      );
    });
    expect(valor("128 GB")?.getAttribute("aria-pressed")).toBe("true");
    await clicar(valor("128 GB"));
    expect(aoAlternar).toHaveBeenCalledWith("128gb");
  });

  it("Marcar todos usa a grafia gravada com acento/espaço diferentes", async () => {
    const aoDefinir = vi.fn();
    await act(async () => {
      raiz.render(
        <Grade
          nomeInicial="Material"
          chips={[{ valor: "Algodao", usado: true }]}
          aoDefinir={aoDefinir}
        />,
      );
    });
    await clicar(botoes().find((b) => texto(b) === "Marcar todos"));
    const enviados = aoDefinir.mock.lastCall?.[0] as string[];
    expect(enviados).toContain("Algodao");
    expect(enviados).not.toContain("Algodão");
  });

  it("o texto DIGITADO continua sem ser reescrito: '128 gb' digitado grava '128 gb'", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          nomeInicial="Capacidade"
          valoresEmUso={["128gb"]}
          aoMudar={aoMudar}
        />,
      );
    });
    const campo = document.getElementById("variant-value") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "128 gb");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(aoMudar).toHaveBeenLastCalledWith("Capacidade", "128 gb");
  });

  it("valores diferentes de verdade não se confundem: '1 L' e '1 TB' seguem distintos", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          nomeInicial="Capacidade"
          valoresEmUso={["1L"]}
          aoMudar={aoMudar}
        />,
      );
    });
    await clicar(valor("1 TB"));
    expect(aoMudar).toHaveBeenLastCalledWith("Capacidade", "1 TB");
  });
});

describe("5. abas no padrão tablist", () => {
  it("cada aba aponta para o painel (aria-controls) e o painel diz quem o nomeia (aria-labelledby)", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    const painel = hospedeiro.querySelector('[role="tabpanel"]');
    expect(painel?.id).toBeTruthy();
    for (const a of abas()) {
      expect(a.id, texto(a)).toBeTruthy();
      expect(a.getAttribute("aria-controls"), texto(a)).toBe(painel?.id);
    }
    const ativa = abas().find(
      (a) => a.getAttribute("aria-selected") === "true",
    );
    expect(painel?.getAttribute("aria-labelledby")).toBe(ativa?.id);
    await clicar(abas().at(1));
    expect(painel?.getAttribute("aria-labelledby")).toBe(abas().at(1)?.id);
  });

  it("só a aba ativa está na ordem do Tab (tabindex 0); as outras, -1", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    expect(abas().map((a) => a.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
    ]);
  });

  it("→ e ← trocam de aba e levam o foco; nas pontas dão a volta; Home e End vão às pontas", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    const selecionada = () =>
      texto(abas().find((a) => a.getAttribute("aria-selected") === "true"));
    await tecla(abas().at(0), "ArrowRight");
    expect(selecionada()).toBe("Números");
    expect(document.activeElement).toBe(abas().at(1));
    await tecla(abas().at(1), "ArrowLeft");
    await tecla(abas().at(0), "ArrowLeft");
    expect(selecionada()).toBe("Outro");
    expect(document.activeElement).toBe(abas().at(3));
    await tecla(abas().at(3), "ArrowRight");
    expect(selecionada()).toBe("Roupas");
    await tecla(abas().at(0), "End");
    expect(selecionada()).toBe("Outro");
    await tecla(abas().at(3), "Home");
    expect(selecionada()).toBe("Roupas");
  });

  it("mexer nas setas NÃO apaga nem grava valor", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico nomeInicial="Tamanho" valorInicial="38" aoMudar={aoMudar} />,
      );
    });
    await tecla(abas().at(1), "ArrowRight");
    await tecla(abas().at(2), "ArrowRight");
    expect(aoMudar).not.toHaveBeenCalled();
  });
});
