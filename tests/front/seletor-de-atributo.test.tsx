// @vitest-environment jsdom
//
// O seletor que troca "digitar Cor e Espacial Grey" por TOCAR: quatro peças de
// tipo (Cor, Tamanho, Voltagem, Outro) e, embaixo, as bolinhas de cor, os
// tamanhos ou as voltagens. O que é GRAVADO continua sendo o nome do atributo
// e o nome do valor — o seletor só muda como o lojista chega neles.
import {
  SeletorDeAtributo,
  tipoDoNome,
  valorDaPaleta,
} from "@/components/admin/products/SeletorDeAtributo";
import { PALETA_DE_CORES } from "@/utils/cor-da-variacao";
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

const botoes = () => [...hospedeiro.querySelectorAll("button")];
const porRotulo = (rotulo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`);
const peca = (texto: string) =>
  botoes().find((b) => (b.textContent ?? "").trim() === texto);
const campo = (id: string) =>
  hospedeiro.querySelector<HTMLInputElement>(`#${id}`);

async function clicar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function digitar(id: string, valor: string) {
  const el = campo(id);
  if (!el) throw new Error(`campo ${id} não está na tela`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarEEsperar(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

/** Seletor de variação ÚNICA com estado, como o modal o usa. */
function Unico({
  nomeInicial = "",
  valorInicial = "",
  aoMudar,
  compacto = false,
}: {
  nomeInicial?: string;
  valorInicial?: string;
  aoMudar?: (nome: string, valor: string) => void;
  compacto?: boolean;
}) {
  // Um estado só, com atualização funcional: como o pai de verdade (o formulário
  // guarda nome e valor no mesmo objeto), nome e valor mudam no mesmo toque sem
  // um enxergar o antigo do outro.
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
      compacto={compacto}
      nome={par.nome}
      onNome={(n) => mudar({ nome: n })}
      valor={par.valor}
      onValor={(v) => mudar({ valor: v })}
    />
  );
}

describe("tipoDoNome — o tipo selecionado é DERIVADO do nome gravado", () => {
  it("vazio = nenhum; Cor/Tamanho/Voltagem ignoram caixa e espaço; o resto é Outro", () => {
    expect(tipoDoNome("")).toBeNull();
    expect(tipoDoNome("   ")).toBeNull();
    expect(tipoDoNome("Cor")).toBe("Cor");
    expect(tipoDoNome("  cor ")).toBe("Cor");
    expect(tipoDoNome("TAMANHO")).toBe("Tamanho");
    expect(tipoDoNome("Voltagem")).toBe("Voltagem");
    expect(tipoDoNome("Material")).toBe("Outro");
    // Composto legado ("Cor / Tamanho" numa linha só) nunca vira Cor por engano.
    expect(tipoDoNome("Cor / Tamanho")).toBe("Outro");
  });
});

describe("valorDaPaleta — o valor digitado que já existe na paleta casa e não duplica", () => {
  it("devolve o nome da paleta (caixa e acento), ou o texto como veio", () => {
    expect(valorDaPaleta("Cor", "azul marinho")).toBe("Azul marinho");
    expect(valorDaPaleta("Cor", "  PRETO ")).toBe("Preto");
    expect(valorDaPaleta("Cor", "lilas")).toBe("Lilás");
    expect(valorDaPaleta("Tamanho", "pp")).toBe("PP");
    expect(valorDaPaleta("Tamanho", "unico")).toBe("Único");
    expect(valorDaPaleta("Voltagem", "bivolt")).toBe("Bivolt");
    // Fora da paleta: o texto do lojista, intocado (só sem as pontas).
    expect(valorDaPaleta("Cor", "Espacial Grey")).toBe("Espacial Grey");
    // Cor da paleta num atributo que não é cor: não se mexe.
    expect(valorDaPaleta("Material", "preto")).toBe("preto");
    expect(valorDaPaleta("", "preto")).toBe("preto");
  });
});

describe("SeletorDeAtributo — as peças de tipo", () => {
  it("sem nome nenhuma peça está marcada e não há bolinhas nem campo de nome", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    for (const rotulo of ["Cor", "Tamanho", "Voltagem", "Outro"]) {
      const b = peca(rotulo);
      expect(b, rotulo).toBeTruthy();
      expect(b?.getAttribute("aria-pressed")).toBe("false");
    }
    expect(porRotulo("Azul marinho")).toBeNull();
    expect(campo("variant-name")).toBeNull();
  });

  it("alvo de toque de 44 px em cada peça", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    for (const rotulo of ["Cor", "Tamanho", "Voltagem", "Outro"]) {
      expect(peca(rotulo)?.className, rotulo).toContain("min-h-11");
    }
  });

  it("tocar Cor, Tamanho ou Voltagem GRAVA o nome do atributo", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico aoMudar={aoMudar} />);
    });
    await clicar(peca("Cor"));
    expect(aoMudar).toHaveBeenLastCalledWith("Cor", "");
    await clicar(peca("Tamanho"));
    expect(aoMudar).toHaveBeenLastCalledWith("Tamanho", "");
    await clicar(peca("Voltagem"));
    expect(aoMudar).toHaveBeenLastCalledWith("Voltagem", "");
    expect(peca("Voltagem")?.getAttribute("aria-pressed")).toBe("true");
    expect(peca("Cor")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("produto antigo com 'Cor' já abre com a peça Cor marcada, sem mexer no nome", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico
          nomeInicial="Cor"
          valorInicial="Espacial Grey"
          aoMudar={aoMudar}
        />,
      );
    });
    expect(peca("Cor")?.getAttribute("aria-pressed")).toBe("true");
    // Tocar a peça que já está marcada não regrava nem apaga nada.
    await clicar(peca("Cor"));
    expect(aoMudar).not.toHaveBeenCalled();
    expect(campo("variant-value")?.value).toBe("Espacial Grey");
  });

  it("nome fora dos três (ex.: Material) abre em 'Outro' com o texto preservado", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Material" valorInicial="Algodão" />);
    });
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("true");
    expect(campo("variant-name")?.value).toBe("Material");
    expect(campo("variant-value")?.value).toBe("Algodão");
    expect(porRotulo("Azul marinho")).toBeNull();
  });

  it("tocar 'Outro' revela o campo do nome (vazio) e digitar nele grava o nome livre", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico aoMudar={aoMudar} />);
    });
    expect(campo("variant-name")).toBeNull();
    await clicar(peca("Outro"));
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("true");
    expect(campo("variant-name")).not.toBeNull();
    await digitarEEsperar("variant-name", "Material");
    expect(aoMudar).toHaveBeenLastCalledWith("Material", "");
  });

  it("digitar 'Cor' no campo do Outro NÃO faz o campo sumir debaixo dos dedos", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    await clicar(peca("Outro"));
    await digitarEEsperar("variant-name", "Cor");
    expect(campo("variant-name")?.value).toBe("Cor");
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("de 'Cor' para 'Outro' o nome antigo sai e o campo do nome nasce vazio (limpar o valor é do pai)", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <Unico nomeInicial="Cor" valorInicial="Azul" aoMudar={aoMudar} />,
      );
    });
    await clicar(peca("Outro"));
    expect(aoMudar).toHaveBeenCalledWith("", "Azul");
    expect(campo("variant-name")?.value).toBe("");
  });
});

describe("SeletorDeAtributo — trocar de tipo não deixa o valor do tipo antigo para trás", () => {
  it("de Cor (Azul) para Tamanho o valor escolhido sai: 'Azul' nunca vira um tamanho", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" valorInicial="Azul" />);
    });
    await clicar(peca("Tamanho"));
    expect(campo("variant-value")?.value).toBe("");
    expect(peca("Tamanho")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("sem nome ainda (só digitou o valor), tocar uma peça NÃO apaga o que foi digitado", async () => {
    await act(async () => {
      raiz.render(<Unico valorInicial="Azul" />);
    });
    await clicar(peca("Cor"));
    expect(campo("variant-value")?.value).toBe("Azul");
  });

  it("na grade, avisa o pai para limpar as escolhas quando o tipo muda de verdade", async () => {
    const aoLimpar = vi.fn();
    await act(async () => {
      raiz.render(
        <SeletorDeAtributo
          modo="multiplo"
          numero={1}
          idDoNome="grade-nome-0"
          idDoValor="grade-valor-0"
          nome="Cor"
          onNome={() => {}}
          selecionados={["Preto"]}
          chips={[]}
          onAlternar={() => {}}
          rascunho=""
          onRascunho={() => {}}
          onAdicionar={() => {}}
          onLimpar={aoLimpar}
        />,
      );
    });
    await clicar(peca("Cor"));
    expect(aoLimpar).not.toHaveBeenCalled();
    await clicar(peca("Voltagem"));
    expect(aoLimpar).toHaveBeenCalledTimes(1);
  });
});

describe("SeletorDeAtributo — cor (modo único)", () => {
  it("mostra as 18 bolinhas, cada uma com o nome como rótulo e aria-pressed", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" />);
    });
    for (const cor of PALETA_DE_CORES) {
      const b = porRotulo(cor.nome);
      expect(b, cor.nome).toBeTruthy();
      expect(b?.getAttribute("aria-pressed")).toBe("false");
      expect(b?.tagName).toBe("BUTTON");
    }
    expect(PALETA_DE_CORES.filter((c) => porRotulo(c.nome)).length).toBe(18);
  });

  it("a bolinha tem o hex da loja e o alvo de toque é de 44 px", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" />);
    });
    const marinho = PALETA_DE_CORES.find((c) => c.nome === "Azul marinho");
    const botao = porRotulo("Azul marinho");
    const bolinha = botao?.querySelector<HTMLElement>("[data-bolinha]");
    expect(bolinha).toBeTruthy();
    expect(bolinha?.style.backgroundColor).not.toBe("");
    expect(bolinha?.getAttribute("data-bolinha")).toBe(marinho?.hex);
    expect(bolinha?.className).toContain("size-11");
  });

  it("tocar a bolinha escolhe o valor; marcada = aria-pressed + check (nunca só a cor)", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" />);
    });
    expect(
      hospedeiro.querySelector('svg[data-marca="selecionado"]'),
    ).toBeNull();
    await clicar(porRotulo("Azul marinho"));
    expect(campo("variant-value")?.value).toBe("Azul marinho");
    expect(porRotulo("Azul marinho")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(porRotulo("Preto")?.getAttribute("aria-pressed")).toBe("false");
    const checks = hospedeiro.querySelectorAll('svg[data-marca="selecionado"]');
    expect(checks).toHaveLength(1);
    expect(porRotulo("Azul marinho")?.contains(checks.item(0))).toBe(true);
  });

  it("o nome da escolha aparece ao lado do rótulo", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" valorInicial="Azul marinho" />);
    });
    const escolha = hospedeiro.querySelector('[data-testid="escolha-atual"]');
    expect(escolha?.textContent).toContain("Azul marinho");
  });

  it("o check é ESCURO sobre cor clara e claro sobre cor escura", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" valorInicial="Branco" />);
    });
    const sobreBranco = hospedeiro.querySelector(
      'svg[data-marca="selecionado"]',
    );
    expect(sobreBranco?.getAttribute("class")).toContain("text-zinc-900");
    await clicar(porRotulo("Preto"));
    const sobrePreto = hospedeiro.querySelector(
      'svg[data-marca="selecionado"]',
    );
    expect(sobrePreto?.getAttribute("class")).toContain("text-white");
  });

  it("escolha em caixa diferente (azul marinho) marca a mesma bolinha", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" valorInicial="azul MARINHO" />);
    });
    expect(porRotulo("Azul marinho")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("'Outra cor? Digite aqui' grava o texto livre e nenhuma bolinha fica marcada", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" />);
    });
    const campoDoValor = campo("variant-value");
    expect(campoDoValor?.getAttribute("placeholder")).toMatch(/Outra cor/);
    await digitarEEsperar("variant-value", "Espacial Grey");
    expect(
      hospedeiro.querySelector('[aria-pressed="true"][aria-label="Cinza"]'),
    ).toBeNull();
    expect(campo("variant-value")?.value).toBe("Espacial Grey");
  });

  it("digitar um nome que já é da paleta (em outra caixa) casa com a bolinha, sem duplicar", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" aoMudar={aoMudar} />);
    });
    await digitarEEsperar("variant-value", "azul marinho");
    expect(aoMudar).toHaveBeenLastCalledWith("Cor", "Azul marinho");
    expect(porRotulo("Azul marinho")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("SeletorDeAtributo — tamanho e voltagem (modo único)", () => {
  it("Tamanho mostra os 13 tamanhos como peças tocáveis", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" />);
    });
    for (const t of [
      "PP",
      "P",
      "M",
      "G",
      "GG",
      "XG",
      "34",
      "36",
      "38",
      "40",
      "42",
      "44",
      "Único",
    ]) {
      expect(peca(t), t).toBeTruthy();
    }
    expect(porRotulo("Azul marinho")).toBeNull();
    await clicar(peca("GG"));
    expect(campo("variant-value")?.value).toBe("GG");
    expect(peca("GG")?.getAttribute("aria-pressed")).toBe("true");
    expect(peca("G")?.getAttribute("aria-pressed")).toBe("false");
    expect(
      hospedeiro.querySelectorAll('svg[data-marca="selecionado"]'),
    ).toHaveLength(1);
  });

  it("Voltagem mostra 110V, 220V e Bivolt", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Voltagem" />);
    });
    expect(peca("110V")).toBeTruthy();
    expect(peca("220V")).toBeTruthy();
    expect(peca("Bivolt")).toBeTruthy();
    await clicar(peca("220V"));
    expect(campo("variant-value")?.value).toBe("220V");
  });

  it("'Outro tamanho? Digite aqui' existe e preserva um valor antigo fora da lista", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Tamanho" valorInicial="46" />);
    });
    expect(campo("variant-value")?.getAttribute("placeholder")).toMatch(
      /Outro tamanho/,
    );
    expect(campo("variant-value")?.value).toBe("46");
    for (const t of ["PP", "44", "Único"]) {
      expect(peca(t)?.getAttribute("aria-pressed")).toBe("false");
    }
  });
});

describe("SeletorDeAtributo — versão compacta (par de uma variante composta)", () => {
  it("usa as mesmas peças, bolinhas e campos", async () => {
    await act(async () => {
      raiz.render(<Unico nomeInicial="Cor" compacto />);
    });
    expect(peca("Cor")?.getAttribute("aria-pressed")).toBe("true");
    expect(porRotulo("Verde")).toBeTruthy();
    expect(campo("variant-value")).not.toBeNull();
    await clicar(porRotulo("Verde"));
    expect(campo("variant-value")?.value).toBe("Verde");
  });
});

describe("SeletorDeAtributo — vários valores (grade)", () => {
  function Multiplo({
    nome = "Cor",
    chips = [] as { valor: string; usado: boolean }[],
    selecionadosIniciais = [] as string[],
    aoAlternar = vi.fn(),
    aoAdicionar = vi.fn(),
  }) {
    const [rascunho, setRascunho] = useState("");
    return (
      <SeletorDeAtributo
        modo="multiplo"
        numero={1}
        idDoNome="grade-nome-0"
        idDoValor="grade-valor-0"
        nome={nome}
        onNome={() => {}}
        selecionados={selecionadosIniciais}
        chips={chips}
        onAlternar={aoAlternar}
        rascunho={rascunho}
        onRascunho={setRascunho}
        onAdicionar={aoAdicionar}
        onLimpar={() => {}}
      />
    );
  }

  it("tocar uma bolinha ALTERNA o valor (várias podem ficar marcadas)", async () => {
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Multiplo
          selecionadosIniciais={["Preto", "Rosa"]}
          aoAlternar={aoAlternar}
        />,
      );
    });
    expect(porRotulo("Preto")?.getAttribute("aria-pressed")).toBe("true");
    expect(porRotulo("Rosa")?.getAttribute("aria-pressed")).toBe("true");
    expect(porRotulo("Azul")?.getAttribute("aria-pressed")).toBe("false");
    await clicar(porRotulo("Azul"));
    expect(aoAlternar).toHaveBeenCalledWith("Azul");
  });

  it("a linha 'Selecionadas:' lista as escolhas com × que as tira", async () => {
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Multiplo
          selecionadosIniciais={["Preto", "Rosa"]}
          aoAlternar={aoAlternar}
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Selecionadas:");
    await clicar(porRotulo("Tirar Rosa"));
    expect(aoAlternar).toHaveBeenCalledWith("Rosa");
  });

  it("sem escolhas não aparece a linha 'Selecionadas:'", async () => {
    await act(async () => {
      raiz.render(<Multiplo />);
    });
    expect(hospedeiro.textContent).not.toContain("Selecionadas:");
  });

  it("os valores já usados no produto são chips 'já usado' e alternam como as bolinhas", async () => {
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Multiplo
          chips={[
            { valor: "Espacial Grey", usado: true },
            { valor: "Azul", usado: true },
            { valor: "Sálvia", usado: false },
          ]}
          aoAlternar={aoAlternar}
        />,
      );
    });
    const chips = [
      ...hospedeiro.querySelectorAll('[data-testid="chip-do-produto"]'),
    ];
    expect(
      chips.map((c) => c.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual(["Espacial Grey já usado", "Azul já usado", "Sálvia"]);
    await clicar(chips.at(0));
    expect(aoAlternar).toHaveBeenCalledWith("Espacial Grey");
  });

  it("o digitado que já tem bolinha na grade não aparece de novo como chip; o já usado aparece", async () => {
    await act(async () => {
      raiz.render(
        <Multiplo
          chips={[
            { valor: "Azul marinho", usado: false },
            { valor: "Rosa", usado: true },
            { valor: "Sálvia", usado: false },
          ]}
        />,
      );
    });
    const chips = [
      ...hospedeiro.querySelectorAll('[data-testid="chip-do-produto"]'),
    ].map((c) => c.textContent?.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(["Rosa já usado", "Sálvia"]);
  });

  it("'Outra cor? Digite aqui' + botão +: o campo e o botão mantêm os ids e rótulos de sempre", async () => {
    const aoAdicionar = vi.fn();
    await act(async () => {
      raiz.render(<Multiplo aoAdicionar={aoAdicionar} />);
    });
    const c = campo("grade-valor-0");
    expect(c?.getAttribute("name")).toBe("grade-valor-0");
    expect(c?.getAttribute("aria-label")).toBe("Novo valor do atributo 1");
    expect(c?.getAttribute("placeholder")).toMatch(/Outra cor/);
    await digitarEEsperar("grade-valor-0", "Sálvia");
    await clicar(porRotulo("Adicionar valor do atributo 1"));
    expect(aoAdicionar).toHaveBeenCalledTimes(1);
  });

  it("em 'Outro' só aparece o campo de texto (sem bolinhas nem tamanhos)", async () => {
    await act(async () => {
      raiz.render(<Multiplo nome="Material" />);
    });
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("true");
    expect(porRotulo("Azul")).toBeNull();
    expect(peca("PP")).toBeUndefined();
    expect(campo("grade-valor-0")?.getAttribute("placeholder")).toMatch(
      /Outro valor/,
    );
  });
});

describe("SeletorDeAtributo — o grupo que o produto já usa (fora de Cor/Tamanho/Voltagem)", () => {
  it("vira um atalho tocável: um produto que já usa 'Material' não obriga a redigitar", async () => {
    const aoMudar = vi.fn();
    function ComSugestao() {
      const [nome, setNome] = useState("");
      return (
        <SeletorDeAtributo
          modo="unico"
          numero={1}
          idDoNome="variant-name"
          idDoValor="variant-value"
          nome={nome}
          onNome={(n) => {
            setNome(n);
            aoMudar(n);
          }}
          valor=""
          onValor={() => {}}
          sugestoes={["Material", "Cor", "cor"]}
        />
      );
    }
    await act(async () => {
      raiz.render(<ComSugestao />);
    });
    // Cor já tem peça própria: só o que NÃO é Cor/Tamanho/Voltagem vira atalho.
    const atalhos = [
      ...hospedeiro.querySelectorAll('[data-testid="atalho-de-atributo"]'),
    ];
    expect(atalhos.map((a) => a.textContent?.trim())).toEqual(["Material"]);
    await clicar(atalhos.at(0));
    expect(aoMudar).toHaveBeenLastCalledWith("Material");
    expect(peca("Outro")?.getAttribute("aria-pressed")).toBe("true");
    expect(campo("variant-name")?.value).toBe("Material");
  });

  it("sem sugestão nenhuma não aparece atalho", async () => {
    await act(async () => {
      raiz.render(<Unico />);
    });
    expect(
      hospedeiro.querySelector('[data-testid="atalho-de-atributo"]'),
    ).toBeNull();
  });
});

describe("SeletorDeAtributo — não convida para o que a trava de um grupo por produto recusa", () => {
  const nomesDasPecas = () =>
    [...hospedeiro.querySelectorAll('[role="group"] button')].map((b) =>
      b.textContent?.trim(),
    );

  function Com({
    sugestoes,
    nomeInicial = "",
  }: { sugestoes?: string[]; nomeInicial?: string }) {
    const [nome, setNome] = useState(nomeInicial);
    return (
      <SeletorDeAtributo
        modo="unico"
        numero={1}
        idDoNome="variant-name"
        idDoValor="variant-value"
        nome={nome}
        onNome={setNome}
        valor=""
        onValor={() => {}}
        sugestoes={sugestoes}
      />
    );
  }

  it("sem grupo no produto, as quatro peças aparecem", async () => {
    await act(async () => {
      raiz.render(<Com sugestoes={[]} />);
    });
    expect(nomesDasPecas()).toEqual(["Cor", "Tamanho", "Voltagem", "Outro"]);
  });

  it("produto que já usa 'Cor' (ou 'cor'): sobram Cor e Outro — Tamanho e Voltagem somem", async () => {
    await act(async () => {
      raiz.render(<Com sugestoes={["cor"]} />);
    });
    expect(nomesDasPecas()).toEqual(["Cor", "Outro"]);
  });

  it("produto com a combinação 'Cor / Tamanho': as duas peças das partes ficam", async () => {
    await act(async () => {
      raiz.render(<Com sugestoes={["Cor / Tamanho"]} />);
    });
    expect(nomesDasPecas()).toEqual(["Cor", "Tamanho", "Outro"]);
  });

  it("produto com grupo livre ('Material'): só o atalho dele e Outro", async () => {
    await act(async () => {
      raiz.render(<Com sugestoes={["Material"]} />);
    });
    expect(nomesDasPecas()).toEqual(["Outro"]);
    expect(
      hospedeiro.querySelector('[data-testid="atalho-de-atributo"]')
        ?.textContent,
    ).toBe("Material");
  });

  it("o tipo que a linha em edição já tem nunca some, mesmo fora do que o produto usa", async () => {
    await act(async () => {
      raiz.render(<Com sugestoes={["Cor"]} nomeInicial="Tamanho" />);
    });
    expect(nomesDasPecas()).toEqual(["Cor", "Tamanho", "Outro"]);
    expect(peca("Tamanho")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SeletorDeAtributo — remover o atributo", () => {
  it("o × só existe quando o pai manda a ação, com o rótulo que ele der", async () => {
    const aoRemover = vi.fn();
    await act(async () => {
      raiz.render(
        <SeletorDeAtributo
          modo="unico"
          numero={2}
          idDoNome="variant-name-1"
          idDoValor="variant-value-1"
          nome="Tamanho"
          onNome={() => {}}
          valor=""
          onValor={() => {}}
          aoRemover={aoRemover}
          rotuloDoRemover="Remover atributo 2"
        />,
      );
    });
    await clicar(porRotulo("Remover atributo 2"));
    expect(aoRemover).toHaveBeenCalledTimes(1);
  });
});
