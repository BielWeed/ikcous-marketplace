// @vitest-environment jsdom
//
// Folha "Escolher opções" do card — bordas sem guarda:
//  1. A bolinha da cor aparece mesmo com a cor escrita com maiúscula ("Azul"),
//     e só no eixo de cor (nunca no Tamanho).
//  2. Tocar no eixo que já está aberto o FECHA (pede `null`); tocar num fechado
//     abre ele.
//  3. Painel fechado fica `inert` e escondido do leitor de tela; aberto não.
//  4. O aviso passado pela tela só aparece no eixo dono dele; o aviso de
//     "combinação" só aparece quando há escolha em OUTRO eixo da mesma
//     variação, e cita só as outras escolhas (nunca a do próprio eixo).
//  5. Sem estoque, a quantidade continua com piso de 1 (o "+" explica o limite
//     de 1 unidade em vez de dizer "Aumentar") e o aviso de máximo só aparece
//     com estoque de verdade.
//  6. Produto indisponível não mostra seletor de quantidade, e o botão de
//     adicionar fica marcado como desativado (também enquanto salva).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";
import type { ProductVariant } from "@/types";
import {
  type ModeloDeEixos,
  criarEixosDaVariacao,
} from "@/utils/eixos-da-variacao";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "local" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variante = (value: string, stockIncrement: number): ProductVariant => ({
  id: value,
  productId: "p",
  name: "Cor / Tamanho",
  value,
  stockIncrement,
  active: true,
});

// Cor x Tamanho: Azul só existe em PP; Verde só em G.
const modelo = criarEixosDaVariacao([
  variante("Azul / PP", 5),
  variante("Verde / G", 5),
]);
const eixoCor = modelo.eixos.find((e) => e.nome === "Cor")!;
const eixoTamanho = modelo.eixos.find((e) => e.nome === "Tamanho")!;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeAll(async () => {
  await import("@/components/ui/custom/FolhaDeOpcoes");
}, 60_000);

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

interface Opcoes {
  modeloDaFolha?: ModeloDeEixos;
  escolhas?: [string, string][];
  eixoAberto?: string | null;
  aviso?: { chave: string; texto: string } | null;
  estoque?: number;
  quantidade?: number;
  indisponivel?: boolean;
  cartStatus?: "idle" | "loading" | "success";
  onAbrirEixo?: (chave: string | null) => void;
}

function abrir({
  modeloDaFolha = modelo,
  escolhas = [],
  eixoAberto = null,
  aviso = null,
  estoque = 6,
  quantidade = 1,
  indisponivel = false,
  cartStatus = "idle",
  onAbrirEixo = () => {},
}: Opcoes = {}) {
  act(() => {
    raiz.render(
      <FolhaDeOpcoes aberta onMudar={() => {}}>
        <CorpoDaFolhaDeOpcoes
          id="f"
          product={{ id: "p", name: "Camisa", price: 10, images: [] } as never}
          modelo={modeloDaFolha}
          escolhas={new Map(escolhas)}
          eixoAberto={eixoAberto}
          aviso={aviso}
          imagem=""
          preco={10}
          estoque={estoque}
          quantidade={quantidade}
          indisponivel={indisponivel}
          cartStatus={cartStatus}
          avisoDeAdicionado=""
          onAbrirEixo={onAbrirEixo}
          onEscolher={() => {}}
          onQuantidade={() => {}}
          onAdicionar={() => {}}
          onDetalhes={() => {}}
        />
      </FolhaDeOpcoes>,
    );
  });
}

const cabecalho = (chave: string) =>
  document.querySelector<HTMLButtonElement>(
    `button[aria-controls="f-${chave}"]`,
  ) as HTMLButtonElement;
const painel = (chave: string) =>
  document.getElementById(`f-${chave}`) as HTMLElement;
const bolinhas = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')].filter(
    (s) => s.style.backgroundColor !== "",
  );

describe("FolhaDeOpcoes — bolinha da cor", () => {
  it("'Azul' com maiúscula ganha a bolinha azul no cabeçalho e na opção; o Tamanho não ganha", () => {
    abrir({
      escolhas: [
        [eixoCor.chave, "Azul"],
        [eixoTamanho.chave, "PP"],
      ],
      eixoAberto: eixoCor.chave,
    });
    const doCabecalho = bolinhas(cabecalho(eixoCor.chave));
    expect(doCabecalho).toHaveLength(1);
    expect(doCabecalho[0].style.backgroundColor).toBe("rgb(37, 99, 235)");

    // Opções do eixo de cor: uma bolinha por cor conhecida (Azul e Verde).
    const cores = bolinhas(painel(eixoCor.chave)).map(
      (b) => b.style.backgroundColor,
    );
    expect(cores).toEqual(["rgb(37, 99, 235)", "rgb(22, 163, 74)"]);

    expect(bolinhas(cabecalho(eixoTamanho.chave))).toHaveLength(0);
    expect(bolinhas(painel(eixoTamanho.chave))).toHaveLength(0);
  });
});

describe("FolhaDeOpcoes — abrir e fechar o eixo", () => {
  it("tocar no eixo aberto pede para FECHAR (null); no fechado, pede para abrir", () => {
    const onAbrirEixo = vi.fn();
    abrir({ eixoAberto: eixoCor.chave, onAbrirEixo });

    act(() => cabecalho(eixoCor.chave).click());
    expect(onAbrirEixo).toHaveBeenLastCalledWith(null);

    act(() => cabecalho(eixoTamanho.chave).click());
    expect(onAbrirEixo).toHaveBeenLastCalledWith(eixoTamanho.chave);
  });

  it("painel fechado: inert e escondido do leitor; o aberto, não", () => {
    abrir({ eixoAberto: eixoCor.chave });
    expect(painel(eixoCor.chave).hasAttribute("inert")).toBe(false);
    expect(painel(eixoCor.chave).getAttribute("aria-hidden")).toBe("false");
    expect(painel(eixoTamanho.chave).hasAttribute("inert")).toBe(true);
    expect(painel(eixoTamanho.chave).getAttribute("aria-hidden")).toBe("true");
    expect(cabecalho(eixoCor.chave).getAttribute("aria-expanded")).toBe("true");
    expect(cabecalho(eixoTamanho.chave).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});

describe("FolhaDeOpcoes — avisos por eixo", () => {
  const AVISO_DA_TELA = "Escolha primeiro o tamanho";

  it("o aviso da tela aparece só no eixo dono dele", () => {
    abrir({
      eixoAberto: eixoTamanho.chave,
      aviso: { chave: eixoTamanho.chave, texto: AVISO_DA_TELA },
    });
    expect(painel(eixoTamanho.chave).textContent).toContain(AVISO_DA_TELA);
    expect(painel(eixoCor.chave).textContent).not.toContain(AVISO_DA_TELA);
    expect(document.body.textContent?.split(AVISO_DA_TELA)).toHaveLength(2);
  });

  it("opção esgotada SEM escolha em outro eixo não gera aviso de combinação", () => {
    const comEsgotada = criarEixosDaVariacao([
      variante("Azul / PP", 5),
      variante("Azul / GG", 0),
    ]);
    const tamanho = comEsgotada.eixos.find((e) => e.nome === "Tamanho")!;
    abrir({ modeloDaFolha: comEsgotada, eixoAberto: tamanho.chave });
    expect(painel(tamanho.chave).textContent).toContain("GG");
    expect(document.body.textContent).not.toContain("Opções indisponíveis em");
  });

  it("o aviso de combinação cita só as OUTRAS escolhas (nunca a do próprio eixo)", () => {
    abrir({
      eixoAberto: eixoCor.chave,
      escolhas: [
        [eixoCor.chave, "Azul"],
        [eixoTamanho.chave, "G"],
      ],
    });
    // Com Tamanho G, a cor Azul não existe: o aviso do eixo Cor fala só do G.
    expect(painel(eixoCor.chave).textContent).toContain(
      "Opções indisponíveis em G aparecem como indisponíveis",
    );
    // E o do eixo Tamanho fala só da cor escolhida.
    expect(painel(eixoTamanho.chave).textContent).toContain(
      "Opções indisponíveis em Azul aparecem como indisponíveis",
    );
  });
});

const mais = () =>
  document.querySelector<HTMLButtonElement>(
    'button[aria-label="Aumentar quantidade"]',
  );

describe("FolhaDeOpcoes — quantidade sem estoque", () => {
  it("estoque 0: o '+' diz 'Limite do estoque (1 unidade)', não 'Aumentar'", () => {
    abrir({ estoque: 0, quantidade: 1 });
    expect(mais()?.title).toBe("Limite do estoque (1 unidade)");
    expect(mais()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("estoque 0 não gera o aviso 'Máximo de 0 unidades'; no limite real o aviso aparece", () => {
    abrir({ estoque: 0, quantidade: 1 });
    expect(document.body.textContent).not.toContain("Máximo de");
    expect(document.body.textContent).not.toContain("Só tem");

    abrir({ estoque: 1, quantidade: 1 });
    expect(document.body.textContent).toContain("Só tem 1 unidade em estoque.");

    abrir({ estoque: 3, quantidade: 3 });
    expect(document.body.textContent).toContain(
      "Máximo de 3 unidades (é o que tem em estoque).",
    );
  });
});

describe("FolhaDeOpcoes — produto indisponível e botão ocupado", () => {
  const adicionar = () =>
    document.querySelector<HTMLButtonElement>(
      '[data-testid="product-card-options-add"]',
    ) as HTMLButtonElement;

  it("indisponível: sem seletor de quantidade e o botão fica marcado como desativado", () => {
    abrir({ indisponivel: true });
    expect(
      document.querySelector('[role="group"][aria-label^="Quantidade"]'),
    ).toBeNull();
    expect(mais()).toBeNull();
    expect(document.body.textContent).toContain(
      "Sem opções disponíveis no momento.",
    );
    expect(adicionar().getAttribute("aria-disabled")).toBe("true");
  });

  it("disponível: tem seletor de quantidade; o botão só fica desativado enquanto salva", () => {
    abrir({ indisponivel: false });
    expect(
      document.querySelector('[role="group"][aria-label^="Quantidade"]'),
    ).not.toBeNull();
    expect(adicionar().getAttribute("aria-disabled")).toBeNull();

    abrir({ indisponivel: false, cartStatus: "loading" });
    expect(adicionar().getAttribute("aria-disabled")).toBe("true");
  });
});
