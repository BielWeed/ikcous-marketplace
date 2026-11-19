// @vitest-environment jsdom
//
// P54 — Balcão no computador: três medidas que a prova visual no Chromium
// (1280x720, 1366x650, 1536x864, 1920x1080) achou fora do lugar.
//  1. o aviso flutuante ("Código não encontrado", "Limpar a tela da venda?") tinha
//     36rem e invadia a coluna esquerda em 1280 (92 px) e 1366 (49 px);
//  2. a busca deixava 124 px vazios ao lado da barra do total;
//  3. os botões do item (lixeira, quantidade, "+") saíam do cartão ~8 px quando
//     a lista rolava (o cartão encolhia de 93 para 68 px).
// A garantia: as três correções estão DENTRO do `@media (min-width: 1280px)`
// (e só nele), cada seletor casa elemento do DOM REAL do Balcão montado em
// jsdom, e o css de fora do bloco continua com a assinatura do P46.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import postcss, { type AtRule, type Root, type Rule } from "postcss";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

const CAMINHO_CSS = "src/components/admin/pdv/pdv.css";
// Mesma assinatura do P46: o css SEM o bloco de 1280 px é o de antes dele.
const ASSINATURA_DO_CSS_ORIGINAL =
  "3f13e48b2236ab03342ef3786f4c74770c508ef9451a03ac011f80973e55da0d";
const PARAMS_DO_BLOCO = "(min-width: 1280px)";
const RAIZ = '.pdv[data-etapa="cupom"]';
const SEL_AVISO = `${RAIZ} > .pdv-flow > .pdv-notice`;
const SEL_BUSCA = `${RAIZ} > #busca-do-balcao`;
const SEL_CARTAO = `${RAIZ} .pdv-cupom > ul > li`;

const cssReal = readFileSync(CAMINHO_CSS, "utf8").replace(/\r\n/g, "\n");

function sha(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

function blocosNovos(raiz: Root): AtRule[] {
  return raiz.nodes.filter(
    (no): no is AtRule =>
      no.type === "atrule" &&
      no.name === "media" &&
      no.params.replace(/\s+/g, " ").trim() === PARAMS_DO_BLOCO,
  );
}

function semOBloco(css: string): string {
  const raiz = postcss.parse(css);
  for (const bloco of blocosNovos(raiz)) bloco.remove();
  return raiz.toString();
}

function declaracoes(regra: Rule): Record<string, string> {
  const saida: Record<string, string> = {};
  regra.walkDecls((d) => {
    saida[d.prop] = d.value;
  });
  return saida;
}

/** Regras do bloco (e só do bloco) cujo seletor é exatamente `seletor`. */
function regrasDoBlocoCom(css: string, seletor: string): Rule[] {
  const blocos = blocosNovos(postcss.parse(css));
  expect(
    blocos,
    "tem de haver UM bloco @media (min-width: 1280px)",
  ).toHaveLength(1);
  const achadas: Rule[] = [];
  blocos[0].walkRules((r) => {
    if (r.selectors.includes(seletor)) achadas.push(r);
  });
  return achadas;
}

function regraUnica(css: string, seletor: string): Record<string, string> {
  const achadas = regrasDoBlocoCom(css, seletor);
  expect(achadas, `regra do bloco: ${seletor}`).toHaveLength(1);
  return declaracoes(achadas[0]);
}

function trilhas(valor: string): string[] {
  const saida: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const letra of valor) {
    if (letra === "(") nivel++;
    if (letra === ")") nivel--;
    if (/\s/.test(letra) && nivel === 0) {
      if (atual) saida.push(atual);
      atual = "";
    } else atual += letra;
  }
  if (atual) saida.push(atual);
  return saida;
}

/** As três medidas, dentro do bloco. Lança no primeiro desvio. */
function conferirMedidas(css: string): void {
  const aviso = regraUnica(css, SEL_AVISO);
  expect(aviso.width, "largura do aviso").toBe("min(36rem, calc(50% - 28px))");
  // Preso à direita: sem `left: auto` o `left` do aviso de antes volta a valer.
  expect(aviso.left, "aviso preso à direita").toBe("auto");

  const raiz = regraUnica(css, RAIZ);
  // A linha 6 é a `1fr`: a busca que cobre 6 / 8 termina junto da barra do total.
  expect(trilhas(raiz["grid-template-rows"])[5], "linha 6 da grade").toBe(
    "1fr",
  );
  const busca = regraUnica(css, SEL_BUSCA);
  expect(busca["grid-row"], "linhas da busca").toBe("6 / 8");
  expect(busca["margin-bottom"], "margem da busca").toBe("0");

  const cartao = regraUnica(css, SEL_CARTAO);
  expect(cartao["flex-shrink"], "cartão do item não encolhe").toBe("0");
}

/**
 * A grade de duas colunas do mesmo bloco: as medidas que o teste do P46 não
 * conferia (auditoria de mutantes da 1.5.192: trocar qualquer uma delas
 * sobrevivia). Lança no primeiro desvio.
 */
function conferirGradeDoBloco(css: string): void {
  const raiz = regraUnica(css, RAIZ);
  expect(raiz["max-width"], "largura máxima da tela de vender").toBe("1440px");
  expect(raiz["column-gap"], "vão entre as colunas").toBe("24px");
  const titulo = regraUnica(css, `${RAIZ} > .pdv-page-heading`);
  expect(titulo["grid-column"], "título nas duas colunas").toBe("1 / -1");
  const avisoDoTopo = regraUnica(css, `${RAIZ} > .pdv-notice`);
  expect(avisoDoTopo["grid-column"], "aviso do topo nas duas colunas").toBe(
    "1 / -1",
  );
  const cupom = regraUnica(css, `${RAIZ} > .pdv-flow > .pdv-cupom`);
  expect(cupom["grid-row"], "a venda atual cobre as linhas 3 a 6").toBe(
    "3 / 7",
  );
}

/** Nada disso pode valer abaixo de 1280 px: fora do bloco, nenhum vestígio. */
function conferirNadaForaDoBloco(css: string): void {
  const fora = postcss.parse(semOBloco(css));
  fora.walkRules((r) => {
    for (const s of r.selectors) {
      expect(s, "seletor do P54 fora do bloco").not.toMatch(
        /\.pdv-cupom\s*>\s*ul\s*>\s*li/,
      );
    }
  });
  fora.walkDecls((d) => {
    expect(d.value, `${d.prop} fora do bloco`).not.toContain("50% - 28px");
  });
  expect(sha(semOBloco(css)), "ASSINATURA do css de antes do bloco mudou").toBe(
    ASSINATURA_DO_CSS_ORIGINAL,
  );
}

// ---------------------------------------------------------------------------
// O Balcão montado de verdade.
// ---------------------------------------------------------------------------

const AGORA = Date.parse("2026-11-06T15:00:00Z");
const HORA = 3_600_000;
const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

const NAO_CADASTRADO = {
  encontrado: false,
  origem: null,
  codigo: "00000",
  produto: null,
  variante: null,
  preco: null,
  estoque: null,
  variacoes: [],
};

function vendaComItem(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-p54"),
    etapa: "cupom",
    itens: [
      {
        chave: "prod-1::",
        productId: "prod-1",
        variantId: null,
        nome: "Caneca da Maria",
        variacao: null,
        preco: 10,
        quantidade: 1,
        estoque: 5,
        imagem: "",
      },
    ],
  };
}

interface Cenario {
  readonly comRascunho?: boolean;
  readonly rpc?: (nome: string) => Promise<unknown>;
  readonly passo?: string;
}

async function capturar(cenario: Cenario): Promise<HTMLElement> {
  const armazem = new Map<string, string>();
  if (cenario.comRascunho) {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(vendaComItem(), AGORA - 2 * HORA),
    );
  }
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, v);
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
  });
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  rpcMock.mockReset();
  rpcMock.mockImplementation(
    cenario.rpc ??
      (async () => ({ data: { data: [], total_count: 0 }, error: null })),
  );
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const avancar = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  try {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    if (cenario.passo) {
      const alvo = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(cenario.passo as string),
      );
      expect(alvo, `botão "${cenario.passo}" ausente`).toBeTruthy();
      await act(async () => {
        alvo?.click();
      });
      await avancar();
    }
    return hospedeiro.cloneNode(true) as HTMLElement;
  } finally {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}

const telas = new Map<string, HTMLElement>();

beforeAll(async () => {
  codigoBipadoRef.atual = "00000";
  // Item na venda: a lista, os cartões e a busca (escondida) existem.
  telas.set("item", await capturar({ comRascunho: true }));
  // Modo Buscar: a busca visível, filha direta de `.pdv`.
  telas.set(
    "busca",
    await capturar({
      comRascunho: true,
      passo: "Buscar",
      rpc: async () => ({ data: { data: [], total_count: 0 }, error: null }),
    }),
  );
  // Aviso flutuante: "Código não encontrado" dentro de `.pdv-flow`.
  telas.set(
    "aviso",
    await capturar({
      rpc: async () => ({ data: NAO_CADASTRADO, error: null }),
      passo: "bipar",
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function copiaComTroca(de: string | RegExp, por: string): string {
  const mutante = cssReal.replace(de, por);
  expect(mutante, `a troca ${String(de)} não mudou nada`).not.toBe(cssReal);
  return mutante;
}

describe("P54 — Balcão no computador: aviso, busca e cartões do item na medida", () => {
  it("as três medidas existem DENTRO do bloco de 1280 px", () => {
    conferirMedidas(cssReal);
  });

  it("a grade do bloco: largura máxima, vão, título, aviso do topo e a venda atual na medida", () => {
    conferirGradeDoBloco(cssReal);
  });

  it("nada disso existe fora do bloco: celular e janela estreita ficam iguais", () => {
    conferirNadaForaDoBloco(cssReal);
  });

  it("cada seletor casa elemento do Balcão real montado", () => {
    expect(
      telas.get("aviso")?.querySelectorAll(SEL_AVISO).length,
      "aviso flutuante",
    ).toBeGreaterThan(0);
    expect(
      telas.get("busca")?.querySelectorAll(`${SEL_BUSCA}:not([hidden])`).length,
      "busca visível",
    ).toBe(1);
    expect(
      telas.get("item")?.querySelectorAll(SEL_CARTAO).length,
      "cartão do item",
    ).toBeGreaterThan(0);
  });

  describe("controles: o teste cai quando a medida some (mutantes em cópia)", () => {
    it("sem a largura nova do aviso", () => {
      expect(() =>
        conferirMedidas(copiaComTroca("calc(50% - 28px)", "calc(100% - 32px)")),
      ).toThrow(/largura do aviso/);
    });

    it("sem a busca descer até a barra do total", () => {
      expect(() =>
        conferirMedidas(
          copiaComTroca(
            /(#busca-do-balcao \{[^}]*grid-row:\s*)6 \/ 8;/,
            "$16;",
          ),
        ),
      ).toThrow(/linhas da busca/);
    });

    it("com margem na busca, sobra buraco embaixo", () => {
      expect(() =>
        conferirMedidas(
          copiaComTroca(
            /(#busca-do-balcao \{[^}]*margin-bottom:\s*)0;/,
            "$110px;",
          ),
        ),
      ).toThrow(/margem da busca/);
    });

    it("sem o cartão do item parar de encolher", () => {
      expect(() =>
        conferirMedidas(
          copiaComTroca(
            /(\.pdv-cupom > ul > li \{[^}]*flex-shrink:\s*)0;/,
            "$11;",
          ),
        ),
      ).toThrow(/cartão do item/);
    });

    it("sem o aviso preso à direita (left: auto)", () => {
      expect(() =>
        conferirMedidas(
          copiaComTroca(
            "left: auto;\n    width: min(36rem",
            "width: min(36rem",
          ),
        ),
      ).toThrow(/preso à direita/);
    });

    it("grade: largura máxima, vão, título, aviso e venda atual", () => {
      const casos: Array<[RegExp, string, RegExp]> = [
        [
          /(\.pdv\[data-etapa="cupom"\] \{[^}]*max-width:\s*)1440px/,
          "$1 1280px",
          /largura máxima/,
        ],
        [
          /(\.pdv\[data-etapa="cupom"\] \{[^}]*column-gap:\s*)24px/,
          "$1 0",
          /vão entre as colunas/,
        ],
        [
          /(> \.pdv-page-heading \{[^}]*grid-column:\s*)1 \/ -1/,
          "$1 1",
          /título nas duas colunas/,
        ],
        [
          /(\.pdv\[data-etapa="cupom"\] > \.pdv-notice \{[^}]*grid-column:\s*)1 \/ -1/,
          "$1 1",
          /aviso do topo/,
        ],
        [
          /(> \.pdv-flow > \.pdv-cupom \{[^}]*grid-row:\s*)3 \/ 7/,
          "$1 3 / 6",
          /linhas 3 a 6/,
        ],
      ];
      for (const [de, por, mensagem] of casos) {
        expect(() => conferirGradeDoBloco(copiaComTroca(de, por))).toThrow(
          mensagem,
        );
      }
    });

    it("a medida vazada para fora do bloco derruba", () => {
      expect(() =>
        conferirNadaForaDoBloco(
          `${cssReal}\n.pdv-cupom > ul > li {\n  flex-shrink: 0;\n}\n`,
        ),
      ).toThrow(/fora do bloco/);
    });

    it("seletor que não casa o DOM real fica sem alvo", () => {
      const mutante = SEL_CARTAO.replace("> ul >", "> ol >");
      expect(telas.get("item")?.querySelectorAll(mutante).length).toBe(0);
    });
  });
});
