// @vitest-environment jsdom
//
// O miolo da lista de escolha (o mesmo no celular e no computador): o listbox
// nomeado, as opções com o contrato `data-valor`/`data-rotulo`, a escolhida
// marcada (✓, negrito, aria-selected), a desabilitada sem clique, a busca com
// contagem, destaque e "Nada encontrado", e a rolagem até a escolhida ao abrir.
import { CorpoDaLista } from "@/components/admin/primitivos/lista-de-escolha/CorpoDaLista";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
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
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const PARCELAS: OpcaoDaLista[] = [
  { valor: "1", rotulo: "1x", subinfo: "à vista" },
  { valor: "2", rotulo: "2x" },
  { valor: "3", rotulo: "3x", desabilitada: true },
  { valor: "12", rotulo: "12x" },
];

const ESTADOS: OpcaoDaLista[] = [
  "Acre",
  "Alagoas",
  "Amapá",
  "Amazonas",
  "Bahia",
  "Ceará",
  "Pará",
  "Rio de Janeiro",
  "Rio Grande do Norte",
  "Rio Grande do Sul",
  "São Paulo",
].map((nome) => ({ valor: nome, rotulo: nome }));

function montar(
  props: Partial<Parameters<typeof CorpoDaLista<string>>[0]> = {},
) {
  const aoEscolher = vi.fn();
  act(() => {
    raiz.render(
      <CorpoDaLista
        id="parcelas"
        rotulo="Parcelar em até"
        opcoes={PARCELAS}
        valorEscolhido="12"
        comBusca={false}
        variante="folha"
        aoEscolher={aoEscolher}
        {...props}
      />,
    );
  });
  return aoEscolher;
}

const listbox = () =>
  document.querySelector<HTMLElement>('[role="listbox"]') as HTMLElement;
const opcoes = () => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];
const opcao = (valor: string) =>
  document.querySelector<HTMLElement>(
    `[role="option"][data-valor="${valor}"]`,
  ) as HTMLElement;

function digitar(input: HTMLInputElement, texto: string) {
  const definir = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    definir?.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("lista de escolha — corpo", () => {
  it("listbox nomeado pelo rótulo, com o id derivado do campo", () => {
    montar();
    expect(listbox().getAttribute("aria-label")).toBe("Parcelar em até");
    expect(listbox().id).toBe("parcelas-lista");
  });

  it("cada opção leva data-valor e data-rotulo (o contrato do helper de teste)", () => {
    montar();
    expect(opcoes().map((o) => o.dataset.valor)).toEqual(["1", "2", "3", "12"]);
    expect(opcoes().map((o) => o.dataset.rotulo)).toEqual([
      "1x",
      "2x",
      "3x",
      "12x",
    ]);
  });

  it("a escolhida: aria-selected, negrito, fundo ouro e ✓; as outras não", () => {
    montar();
    const escolhida = opcao("12");
    expect(escolhida.getAttribute("aria-selected")).toBe("true");
    expect(escolhida.className).toContain("font-bold");
    expect(escolhida.className).toContain("lista-de-escolha-escolhida");
    expect(escolhida.querySelector("svg")).not.toBeNull();
    const outra = opcao("2");
    expect(outra.getAttribute("aria-selected")).toBe("false");
    expect(outra.className).not.toContain("font-bold");
    expect(outra.querySelector("svg")).toBeNull();
  });

  it("subinfo só onde a opção traz ('1x · à vista')", () => {
    montar();
    expect(opcao("1").textContent).toBe("1xà vista");
    expect(opcao("2").textContent).toBe("2x");
  });

  it("clique escolhe uma vez; pointerdown sozinho não escolhe", () => {
    const aoEscolher = montar();
    act(() => {
      opcao("2").dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(aoEscolher).not.toHaveBeenCalled();
    act(() => opcao("2").click());
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoEscolher).toHaveBeenCalledWith("2");
  });

  it("desabilitada: aria-disabled, cinza e o clique não escolhe", () => {
    const aoEscolher = montar();
    const desabilitada = opcao("3");
    expect(desabilitada.getAttribute("aria-disabled")).toBe("true");
    expect(desabilitada.className).toContain("opacity-40");
    act(() => desabilitada.click());
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(opcao("2").hasAttribute("aria-disabled")).toBe(false);
  });

  it("linhas de 50px na folha e de 44px no popover", () => {
    montar();
    expect(opcao("2").className).toContain("min-h-[50px]");
    montar({ variante: "popover" });
    expect(opcao("2").className).toContain("min-h-11");
    expect(opcao("2").className).not.toContain("min-h-[50px]");
  });

  it("a pílula da sigla fica um degrau acima do fundo da lista, na folha e no popover", () => {
    // Folha: fundo admin-surface, pílula admin-raised. Popover: a caixa JÁ é
    // admin-raised, então a pílula sobe para admin-hover (e, na linha sob o
    // mouse, que vira admin-hover, para admin-border-strong) — senão some.
    const UFS: OpcaoDaLista[] = [
      { valor: "PR", rotulo: "Paraná", sigla: "PR" },
      { valor: "RJ", rotulo: "Rio de Janeiro", sigla: "RJ" },
    ];
    const pilula = (valor: string) =>
      opcao(valor).querySelector<HTMLElement>("span[aria-hidden]")?.className ??
      "";
    montar({ opcoes: UFS, valorEscolhido: "RJ" });
    expect(pilula("PR")).toContain("bg-admin-raised");
    montar({ opcoes: UFS, valorEscolhido: "RJ", variante: "popover" });
    expect(pilula("PR")).not.toContain("bg-admin-raised");
    expect(pilula("PR")).toContain("bg-admin-hover");
    expect(pilula("PR")).toContain("group-hover:bg-admin-border-strong");
    expect(opcao("PR").className).toContain("group");
    // A escolhida continua com o ouro, nas duas.
    expect(pilula("RJ")).toContain("lista-de-escolha-escolhida");
  });

  it("modo ação (valorEscolhido null): ninguém marcado nem com aria-selected", () => {
    montar({ valorEscolhido: null });
    expect(
      document.querySelector('[role="option"][aria-selected="true"]'),
    ).toBeNull();
    expect(opcoes().every((o) => !o.hasAttribute("aria-selected"))).toBe(true);
  });

  it("sem busca: o listbox recebe foco (tabIndex 0) e não há combobox", () => {
    montar();
    expect(listbox().tabIndex).toBe(0);
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(listbox().getAttribute("aria-activedescendant")).toBe(
      "parcelas-opcao-3",
    );
  });
});

describe("lista de escolha — busca", () => {
  const combobox = () =>
    document.querySelector<HTMLInputElement>(
      '[role="combobox"]',
    ) as HTMLInputElement;

  it("combobox de 16px (sem zoom no iPhone) que controla o listbox", () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "São Paulo", comBusca: true });
    const busca = combobox();
    expect(busca.className).toContain("text-base");
    expect(busca.getAttribute("aria-autocomplete")).toBe("list");
    expect(busca.getAttribute("aria-controls")).toBe("parcelas-lista");
    expect(listbox().tabIndex).toBe(-1);
  });

  it('"rio" mostra 3 resultados, com o trecho em <mark>', () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "São Paulo", comBusca: true });
    expect(document.body.textContent).toContain("11 opções");
    digitar(combobox(), "rio");
    expect(opcoes().map((o) => o.dataset.rotulo)).toEqual([
      "Rio de Janeiro",
      "Rio Grande do Norte",
      "Rio Grande do Sul",
    ]);
    expect(document.body.textContent).toContain("3 resultados");
    const marcas = [...document.querySelectorAll("mark")].map(
      (m) => m.textContent,
    );
    expect(marcas).toEqual(["Rio", "Rio", "Rio"]);
  });

  it("um só resultado fala no singular; acento não atrapalha", () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "", comBusca: true });
    digitar(combobox(), "SAO");
    expect(document.body.textContent).toContain("1 resultado");
    expect(document.querySelector("mark")?.textContent).toBe("São");
  });

  it('nada achado: "Nada encontrado" e nenhuma opção', () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "", comBusca: true });
    digitar(combobox(), "xyz");
    expect(opcoes()).toHaveLength(0);
    expect(document.body.textContent).toContain("Nada encontrado");
    expect(document.body.textContent).toContain("0 resultados");
  });

  it("os ids das opções ficam estáveis com o filtro (índice original)", () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "", comBusca: true });
    digitar(combobox(), "sul");
    expect(opcoes()[0].id).toBe("parcelas-opcao-9");
  });

  it("buscar aponta o primeiro resultado como ativo (Enter escolhe ele)", () => {
    montar({ opcoes: ESTADOS, valorEscolhido: "São Paulo", comBusca: true });
    digitar(combobox(), "rio");
    expect(combobox().getAttribute("aria-activedescendant")).toBe(
      "parcelas-opcao-7",
    );
  });
});

describe("lista de escolha — abre rolada até a escolhida (0.11)", () => {
  it("chama scrollIntoView({block:'center'}) na escolhida, uma vez", () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    try {
      montar({ opcoes: ESTADOS, valorEscolhido: "São Paulo", comBusca: true });
      expect(rolar).toHaveBeenCalledTimes(1);
      expect(rolar).toHaveBeenCalledWith({ block: "center" });
      expect(rolar.mock.contexts[0]).toBe(opcao("São Paulo"));
    } finally {
      // biome-ignore lint/performance/noDelete: o jsdom não tem a função; devolve o estado original.
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("sem a função (jsdom, navegador velho) abre sem quebrar", () => {
    expect(Element.prototype.scrollIntoView).toBeUndefined();
    expect(() =>
      montar({ opcoes: ESTADOS, valorEscolhido: "São Paulo", comBusca: true }),
    ).not.toThrow();
  });

  it("sem escolhida (modo ação) não rola", () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    try {
      montar({ valorEscolhido: null });
      expect(rolar).not.toHaveBeenCalled();
    } finally {
      // biome-ignore lint/performance/noDelete: o jsdom não tem a função; devolve o estado original.
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
