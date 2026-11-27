// @vitest-environment jsdom
//
// O campo fechado da lista de escolha (o lugar do `<select>` do painel):
// botão com a semântica de lista (`aria-haspopup="listbox"`), nome feito do
// rótulo + valor, `data-valor` (contrato do helper de teste), placeholder,
// erro com `role=alert` e `aria-invalid`, ajuda que some com erro,
// desabilitado, 72px de altura e anel ouro no foco de teclado.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type {
  OpcaoDaLista,
  PropsDaEscolha,
} from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

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

const CONTAS: OpcaoDaLista<"caixa" | "banco" | "mp">[] = [
  { valor: "caixa", rotulo: "Caixa da loja" },
  { valor: "banco", rotulo: "Conta no banco" },
  { valor: "mp", rotulo: "Mercado Pago" },
];

type Props = ComponentProps<typeof CampoDeEscolha<"caixa" | "banco" | "mp">>;

function montar(extra: Partial<Props> = {}) {
  const aoMudar = vi.fn();
  act(() => {
    raiz.render(
      <CampoDeEscolha
        id="fin-conta"
        rotulo="Conta"
        opcoes={CONTAS}
        valor="banco"
        aoMudar={aoMudar}
        placeholder="Escolha uma conta"
        {...(extra as object)}
      />,
    );
  });
  return aoMudar;
}

const botao = () => document.getElementById("fin-conta") as HTMLButtonElement;
const nome = () =>
  (botao().getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? `(sem #${id})`)
    .join(" ");

describe("lista de escolha — campo fechado", () => {
  it("botão com a semântica de lista, fechado", () => {
    montar();
    const b = botao();
    expect(b.tagName).toBe("BUTTON");
    expect(b.type).toBe("button");
    expect(b.getAttribute("aria-haspopup")).toBe("listbox");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-controls")).toBe("fin-conta-lista");
  });

  it("o nome é rótulo + valor, e o rótulo é <label> do botão", () => {
    montar();
    expect(botao().getAttribute("aria-labelledby")).toBe(
      "fin-conta-rotulo fin-conta-valor",
    );
    expect(nome()).toBe("Conta Conta no banco");
    const rotulo = document.getElementById("fin-conta-rotulo");
    expect(rotulo?.tagName).toBe("LABEL");
    expect(rotulo?.getAttribute("for")).toBe("fin-conta");
  });

  it("data-valor leva o valor escolhido", () => {
    montar();
    expect(botao().dataset.valor).toBe("banco");
  });

  it("valor fora das opções mostra o placeholder e data-valor vazio", () => {
    montar({ valor: "inexistente" as "mp" });
    expect(nome()).toBe("Conta Escolha uma conta");
    expect(botao().dataset.valor).toBe("");
  });

  it("sem placeholder próprio, o padrão é 'Escolha uma opção'", () => {
    montar({ valor: "" as "mp", placeholder: undefined });
    expect(nome()).toBe("Conta Escolha uma opção");
  });

  it("opção de valor '' é de verdade (Não informar), não placeholder", () => {
    const aoMudar = vi.fn();
    act(() => {
      raiz.render(
        <CampoDeEscolha
          id="fin-forma"
          rotulo="Forma"
          opcoes={[
            { valor: "", rotulo: "Não informar" },
            { valor: "pix", rotulo: "Pix" },
          ]}
          valor=""
          aoMudar={aoMudar}
          placeholder="Escolha"
        />,
      );
    });
    expect(document.getElementById("fin-forma-valor")?.textContent).toBe(
      "Não informar",
    );
  });

  it("72px de altura e anel ouro de teclado", () => {
    montar();
    expect(botao().className).toContain("min-h-[72px]");
    expect(botao().className).toContain("lista-de-escolha-anel");
  });

  it("ajuda aparece sem erro e vira descrição do botão", () => {
    montar({ ajuda: "Até quantas vezes o cliente pode dividir." });
    expect(document.body.textContent).toContain("Até quantas vezes");
    expect(botao().getAttribute("aria-describedby")).toBe("fin-conta-ajuda");
    expect(botao().hasAttribute("aria-invalid")).toBe(false);
  });

  it("erro=true: 'Escolha uma opção' em role=alert, aria-invalid, e a ajuda some", () => {
    montar({ erro: true, ajuda: "Texto de ajuda" });
    const erro = document.getElementById("fin-conta-erro");
    expect(erro?.getAttribute("role")).toBe("alert");
    expect(erro?.textContent).toBe("Escolha uma opção");
    expect(botao().getAttribute("aria-invalid")).toBe("true");
    expect(botao().getAttribute("aria-describedby")).toBe("fin-conta-erro");
    expect(document.body.textContent).not.toContain("Texto de ajuda");
    expect(botao().className).toContain("border-red-400");
  });

  it("erro em texto mostra a mensagem da tela", () => {
    montar({ erro: "Escolha a conta de destino." });
    expect(document.getElementById("fin-conta-erro")?.textContent).toBe(
      "Escolha a conta de destino.",
    );
  });

  it("erro vazio ou false não mostra nada", () => {
    montar({ erro: "" });
    expect(document.getElementById("fin-conta-erro")).toBeNull();
    montar({ erro: false });
    expect(document.getElementById("fin-conta-erro")).toBeNull();
    expect(botao().hasAttribute("aria-invalid")).toBe(false);
  });

  it("desabilitado: botão disabled e o clique não abre", () => {
    montar({ desabilitado: true });
    expect(botao().disabled).toBe(true);
    act(() => botao().click());
    expect(botao().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("aberto: aria-expanded, borda, rótulo e chevron dourados", () => {
    montar();
    act(() => botao().click());
    expect(botao().getAttribute("aria-expanded")).toBe("true");
    expect(botao().className).toContain("lista-de-escolha-aberta");
    expect(document.getElementById("fin-conta-rotulo")?.className).toContain(
      "lista-de-escolha-ouro",
    );
    expect(botao().querySelector("svg")?.getAttribute("class")).toContain(
      "lista-de-escolha-ouro",
    );
  });

  it("className vai no contêiner do campo", () => {
    montar({ className: "col-span-2" });
    expect(botao().parentElement?.className).toContain("col-span-2");
  });
});

describe("lista de escolha — a API (tipos)", () => {
  it("modo valor exige valor e aoMudar; modo ação exige aoEscolher e placeholder", () => {
    expectTypeOf<PropsDaEscolha<"a">>().toMatchTypeOf<{
      readonly id: string;
      readonly rotulo: string;
    }>();
    const valor: PropsDaEscolha<"a" | "b"> = {
      id: "x",
      rotulo: "X",
      opcoes: [],
      valor: "a",
      aoMudar: (v) => expectTypeOf(v).toEqualTypeOf<"a" | "b">(),
    };
    const acao: PropsDaEscolha<"a"> = {
      id: "x",
      rotulo: "X",
      opcoes: [],
      modo: "acao",
      aoEscolher: () => {},
      placeholder: "Escolha uma combinação",
    };
    // @ts-expect-error modo ação sem placeholder não compila
    const semPlaceholder: PropsDaEscolha<"a"> = {
      id: "x",
      rotulo: "X",
      opcoes: [],
      modo: "acao",
      aoEscolher: () => {},
    };
    const valorErrado: PropsDaEscolha<"a"> = {
      id: "x",
      rotulo: "X",
      opcoes: [],
      // @ts-expect-error valor fora do tipo da lista não compila
      valor: "b",
      aoMudar: () => {},
    };
    expect([valor, acao, semPlaceholder, valorErrado]).toHaveLength(4);
  });
});
