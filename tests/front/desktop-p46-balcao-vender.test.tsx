// @vitest-environment jsdom
//
// P46 — a tela de VENDER do Balcão (etapa "cupom") no computador.
//
// O Balcão toca dinheiro: o celular (< 1280 px) e todas as outras etapas
// (variação, cliente, fechamento, recibo) têm de ficar IGUAIS. A garantia é em
// camadas:
//  1. o pdv.css sem o bloco novo tem a MESMA assinatura do arquivo original
//     (literal gravado antes da edição; o CI clona 1 commit, então nada de git);
//  2. o bloco novo é um único `@media (min-width: 1280px)`, sem `!important`,
//     sem seletor global, e todo seletor dele começa em `.pdv[data-etapa="cupom"]`;
//  3. cada seletor do bloco casa ELEMENTOS REAIS da tela de vender montada
//     (AdminPdvView de verdade, em jsdom) — seletor que casa 0 passa em teste
//     fabricado e não faz nada na tela (lição P29);
//  4. cada filho da grade tem uma célula, e nenhuma célula é de dois filhos;
//  5. controles: mutantes em CÓPIA do css derrubam cada camada.
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
// O leitor de câmera vira um botão (molde de balcao-bipar-com-rede-lenta); o
// painel `#leitor-do-balcao` que o envolve é o da VIEW, de verdade.
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
// Assinatura (sha256, fim de linha LF) do pdv.css de a69e9e6ba, ANTES do bloco.
// Refeita em 27/11/2026 por uma mudança DE CELULAR, fora do bloco: o rótulo
// do desconto sobe para cima do campo em tela estreita
// (`tests/e2e/jornada-balcao-desconto-no-celular.spec.ts`). Refeita de novo
// no mesmo dia, outra vez DE CELULAR: total do rodapé, aviso de limpar a venda
// (`tests/e2e/jornada-balcao-textos-no-celular.spec.ts`).
const ASSINATURA_DO_CSS_ORIGINAL =
  "e7ce3e128c8261649db0f20d922ef26c960fcdc7bccb9cfc359e1f77b857e426";
const PARAMS_DO_BLOCO = "(min-width: 1280px)";
const RAIZ = '.pdv[data-etapa="cupom"]';

const cssReal = readFileSync(CAMINHO_CSS, "utf8").replace(/\r\n/g, "\n");

function sha(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

function blocosNovos(raiz: Root): AtRule[] {
  const achados: AtRule[] = [];
  for (const no of raiz.nodes) {
    if (no.type === "atrule" && no.name === "media") {
      if (no.params.replace(/\s+/g, " ").trim() === PARAMS_DO_BLOCO) {
        achados.push(no);
      }
    }
  }
  return achados;
}

/** O pdv.css como era: o texto sem o(s) bloco(s) `@media (min-width: 1280px)`. */
function semOBloco(css: string): string {
  const raiz = postcss.parse(css);
  for (const bloco of blocosNovos(raiz)) bloco.remove();
  return raiz.toString();
}

function conferirBaseIntacta(css: string): void {
  expect(sha(semOBloco(css)), "ASSINATURA do css de antes do bloco mudou").toBe(
    ASSINATURA_DO_CSS_ORIGINAL,
  );
}

// ---------------------------------------------------------------------------
// A tela de vender montada de verdade (um recorte do DOM por cenário).
// ---------------------------------------------------------------------------

const AGORA = Date.parse("2026-11-06T15:00:00Z");
const HORA = 3_600_000;
const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-2",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

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

function vendaComItem(etapa: EstadoDaVenda["etapa"]): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-p46"),
    etapa,
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
  readonly rascunho?: { estado: EstadoDaVenda; idadeMs: number };
  readonly rpc?: (nome: string) => Promise<unknown>;
  readonly passos?: (
    agir: (aba: string) => Promise<void>,
    avancar: () => Promise<void>,
  ) => Promise<void>;
}

async function capturar(cenario: Cenario): Promise<HTMLElement> {
  const armazem = new Map<string, string>();
  if (cenario.rascunho) {
    armazem.set(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(
        cenario.rascunho.estado,
        AGORA - cenario.rascunho.idadeMs,
      ),
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
      (async (nome: string) => {
        if (nome === "buscar_por_codigo_barras") {
          return { data: PRODUTO_SIMPLES, error: null };
        }
        return { data: { data: [], total_count: 0 }, error: null };
      }),
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
  const agir = async (aba: string) => {
    const alvo = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(aba),
    );
    expect(alvo, `botão "${aba}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  };
  try {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await cenario.passos?.(agir, avancar);
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

const cenarios = new Map<string, HTMLElement>();
const tela = (nome: string): HTMLElement => cenarios.get(nome)!;
const guardar = async (nome: string, cenario: Cenario): Promise<void> => {
  cenarios.set(nome, await capturar(cenario));
};

beforeAll(async () => {
  codigoBipadoRef.atual = PRODUTO_SIMPLES.codigo;
  // Cupom de ontem: aviso de venda antiga + item + "Limpar" + leitor.
  await guardar("antiga", {
    rascunho: { estado: vendaComItem("cupom"), idadeMs: 20 * HORA },
  });
  // Câmera: caixa vazia, leitor aberto.
  await guardar("vazia", {});
  // Bipou e a consulta está pendurada: "Consultando…".
  await guardar("consultando", {
    rpc: () => new Promise(() => {}),
    passos: async (agir) => agir("bipar"),
  });
  // Modo Buscar com a lista base na tela.
  await guardar("busca", {
    rpc: async (nome) =>
      nome === "get_admin_products_paged"
        ? {
            data: {
              data: [
                {
                  id: "p1",
                  nome: "Camiseta",
                  preco_venda: 27.9,
                  estoque: 2,
                  imagem_url: null,
                  imagem_urls: [],
                  product_variants: [],
                },
              ],
              total_count: 1,
            },
            error: null,
          }
        : { data: PRODUTO_SIMPLES, error: null },
    passos: async (agir) => agir("Buscar"),
  });
  // Item na venda e aviso "Código não encontrado" (camada sobreposta).
  await guardar("aviso", {
    rpc: async () => ({ data: NAO_CADASTRADO, error: null }),
    passos: async (agir) => agir("bipar"),
  });
  // Pergunta "Limpar a tela da venda?" (também sobreposta).
  await guardar("cancelando", {
    rascunho: { estado: vendaComItem("cupom"), idadeMs: 2 * HORA },
    passos: async (agir) => agir("Limpar a tela da venda"),
  });
  // As outras etapas, que NÃO podem ser tocadas.
  await guardar("fechamento", {
    rascunho: { estado: vendaComItem("fechamento"), idadeMs: 2 * HORA },
  });
  await guardar("cliente", {
    rascunho: { estado: vendaComItem("cliente"), idadeMs: 2 * HORA },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const ETAPAS_DE_VENDER = [
  "antiga",
  "vazia",
  "consultando",
  "busca",
  "aviso",
  "cancelando",
] as const;

// ---------------------------------------------------------------------------
// Leitura do bloco novo
// ---------------------------------------------------------------------------

function declaracoes(regra: Rule): Record<string, string> {
  const saida: Record<string, string> = {};
  regra.walkDecls((d) => {
    saida[d.prop] = d.value;
  });
  return saida;
}

function regrasDoBloco(css: string): Rule[] {
  const blocos = blocosNovos(postcss.parse(css));
  expect(
    blocos,
    "tem de haver UM bloco @media (min-width: 1280px)",
  ).toHaveLength(1);
  const regras: Rule[] = [];
  blocos[0].walkRules((r) => {
    regras.push(r);
  });
  expect(regras.length).toBeGreaterThan(0);
  return regras;
}

/** Os filhos que ENTRAM na grade de `.pdv`: `.pdv-flow` é `display: contents`
 * (o filho dele vira filho da grade); `[hidden]` e `position: absolute` ficam
 * fora (o CSS base, lido do próprio arquivo, diz quem é absoluto). */
function filhosDaGrade(
  painel: Element,
  seletoresAbsolutos: readonly string[],
): Element[] {
  const saida: Element[] = [];
  const visitar = (pai: Element) => {
    for (const filho of Array.from(pai.children)) {
      if (filho.hasAttribute("hidden")) continue;
      if (seletoresAbsolutos.some((s) => filho.matches(s))) continue;
      if (filho.matches(".pdv-flow")) visitar(filho);
      else saida.push(filho);
    }
  };
  visitar(painel);
  return saida;
}

function seletoresAbsolutosDoBase(css: string): string[] {
  const raiz = postcss.parse(semOBloco(css));
  const lista: string[] = [];
  raiz.walkRules((r) => {
    if (r.parent?.type === "atrule") return;
    if (declaracoes(r).position === "absolute") {
      for (const s of r.selectors) {
        if (!s.includes("pdv-reader") && !s.includes("::")) lista.push(s);
      }
    }
  });
  return lista;
}

function contarTrilhas(valor: string): number {
  const repeticao = valor.match(/^repeat\(\s*(\d+)\s*,/);
  if (repeticao) return Number(repeticao[1]);
  let nivel = 0;
  let atual = "";
  const trilhas: string[] = [];
  for (const letra of valor) {
    if (letra === "(") nivel++;
    if (letra === ")") nivel--;
    if (/\s/.test(letra) && nivel === 0) {
      if (atual) trilhas.push(atual);
      atual = "";
    } else atual += letra;
  }
  if (atual) trilhas.push(atual);
  return trilhas.length;
}

function linhasDaFaixa(valor: string, total: number): [number, number] {
  const partes = valor.split("/").map((p) => Number.parseInt(p.trim(), 10));
  const inicio = partes[0];
  let fim = partes.length > 1 ? partes[1] : inicio + 1;
  if (fim < 0) fim = total + 2 + fim; // -1 = última linha da grade
  return [inicio, fim];
}

function conferirBloco(css: string): void {
  const regras = regrasDoBloco(css);
  const bloco = blocosNovos(postcss.parse(css))[0];
  // Só regras simples: nada de @media/@supports aninhado.
  bloco.walkAtRules(() => {
    throw new Error("o bloco novo não pode ter at-rule aninhada");
  });
  for (const regra of regras) {
    for (const seletor of regra.selectors) {
      expect(seletor.startsWith(RAIZ), `escopo: ${seletor}`).toBe(true);
      expect(seletor, seletor).not.toMatch(
        /(^|[\s>+~,(])(\*|body|html|:root)\b/,
      );
      expect(seletor.includes("*"), seletor).toBe(false);
    }
    regra.walkDecls((d) => {
      expect(
        Boolean(d.important),
        `!important em ${regra.selector} { ${d.prop} }`,
      ).toBe(false);
    });
  }

  // Cada seletor casa elementos REAIS em algum cenário da tela de vender.
  for (const regra of regras) {
    for (const seletor of regra.selectors) {
      const casou = ETAPAS_DE_VENDER.some(
        (c) => tela(c).querySelectorAll(seletor).length > 0,
      );
      expect(casou, `seletor sem alvo na tela montada: ${seletor}`).toBe(true);
    }
  }
  // E nenhum casa nas outras etapas: variação, cliente, fechamento e recibo
  // ficam como estão.
  for (const regra of regras) {
    for (const seletor of regra.selectors) {
      for (const etapa of ["fechamento", "cliente"] as const) {
        expect(
          tela(etapa).querySelectorAll(seletor).length,
          `${seletor} tocou a etapa ${etapa}`,
        ).toBe(0);
      }
    }
  }

  // Grade: cada filho tem UMA célula e nenhuma célula é de dois filhos.
  const raizRegra = regras.find((r) => r.selectors.includes(RAIZ));
  expect(raizRegra, "regra da raiz da grade").toBeDefined();
  const base = declaracoes(raizRegra!);
  expect(base.display).toBe("grid");
  const colunas = contarTrilhas(base["grid-template-columns"]);
  const linhas = contarTrilhas(base["grid-template-rows"]);
  expect(colunas).toBe(2);
  // A linha da lista "Venda atual" é `1fr` (piso automático = altura mínima do
  // conteúdo). Com `minmax(0, 1fr)` a lista passava por cima da barra do total
  // em janela baixa com o aviso de venda antiga aberto (revisão Opus, 15/11).
  expect(base["grid-template-rows"]).not.toContain("minmax(0");
  // A busca é item da grade: sem `min-height: 0` o piso automático da linha
  // volta e ela passa por cima da barra do total em janela baixa. A regra tem
  // de EXISTIR (o "seletor casa elemento" acima só vale para as que existem).
  const regraDaBusca = regras.filter((r) =>
    r.selectors.includes(`${RAIZ} > #busca-do-balcao`),
  );
  expect(regraDaBusca, "regra da busca do balcão").toHaveLength(1);
  expect(declaracoes(regraDaBusca[0])["min-height"]).toBe("0");
  // Avisos e a pergunta "Limpar a tela da venda?" flutuam: presos à direita
  // (`left: auto`) em vez de atravessar a tela. A largura é livre para mudar.
  const regraDosAvisos = regras.filter((r) =>
    r.selectors.includes(`${RAIZ} > .pdv-flow > .pdv-notice`),
  );
  expect(regraDosAvisos, "regra dos avisos flutuantes").toHaveLength(1);
  expect(declaracoes(regraDosAvisos[0]).left).toBe("auto");
  const absolutos = seletoresAbsolutosDoBase(css);
  expect(absolutos.length).toBeGreaterThan(0);
  for (const etapa of ETAPAS_DE_VENDER) {
    const painel = tela(etapa).querySelector(RAIZ)!;
    expect(painel, `painel do cenário ${etapa}`).not.toBeNull();
    const ocupadas = new Map<string, string>();
    const filhos = filhosDaGrade(painel, absolutos);
    expect(filhos.length).toBeGreaterThan(2);
    for (const filho of filhos) {
      const nome = `${etapa}: <${filho.tagName.toLowerCase()} class="${filho.getAttribute("class")}" id="${filho.id}">`;
      const donas = regras.filter(
        (r) =>
          r !== raizRegra &&
          r.selectors.some((s) => filho.matches(s)) &&
          ("grid-column" in declaracoes(r) || "grid-row" in declaracoes(r)),
      );
      const col = donas.filter((r) => "grid-column" in declaracoes(r));
      const lin = donas.filter((r) => "grid-row" in declaracoes(r));
      expect(col, `${nome} sem UMA coluna`).toHaveLength(1);
      expect(lin, `${nome} sem UMA linha`).toHaveLength(1);
      const [c0, c1] = linhasDaFaixa(
        declaracoes(col[0])["grid-column"],
        colunas,
      );
      const [r0, r1] = linhasDaFaixa(declaracoes(lin[0])["grid-row"], linhas);
      expect(c0).toBeGreaterThanOrEqual(1);
      expect(c1).toBeLessThanOrEqual(colunas + 1);
      expect(r0).toBeGreaterThanOrEqual(1);
      expect(r1).toBeLessThanOrEqual(linhas + 1);
      for (let c = c0; c < c1; c++) {
        for (let r = r0; r < r1; r++) {
          const chave = `${c},${r}`;
          expect(
            ocupadas.has(chave),
            `${nome} sobrepõe ${ocupadas.get(chave)} na célula ${chave}`,
          ).toBe(false);
          ocupadas.set(chave, nome);
        }
      }
    }
  }
}

function copiaComTroca(de: string | RegExp, por: string): string {
  const mutante = cssReal.replace(de, por);
  expect(mutante, `a troca ${String(de)} não mudou nada`).not.toBe(cssReal);
  return mutante;
}

describe("P46 — Balcão: vender no computador", () => {
  it("o css de antes do bloco é BYTE A BYTE o original (celular e demais etapas)", () => {
    conferirBaseIntacta(cssReal);
  });

  it("o bloco novo existe, só vale de 1280 px, sem !important nem seletor global", () => {
    conferirBloco(cssReal);
  });

  it("monta de verdade: o painel de vender, o aviso antigo, a consulta, a busca e as camadas casam o desenho", () => {
    // Os alvos das peças condicionais existem na tela real (não são fabricados).
    expect(tela("antiga").querySelector(".pdv > .pdv-notice")).not.toBeNull();
    expect(
      tela("consultando").querySelector('.pdv > p.pdv-heading[role="status"]'),
    ).not.toBeNull();
    expect(
      tela("busca").querySelector("#busca-do-balcao:not([hidden])"),
    ).not.toBeNull();
    expect(
      tela("aviso").querySelector(".pdv-flow > .pdv-notice"),
    ).not.toBeNull();
    expect(
      tela("cancelando").querySelector('.pdv-flow > [role="group"]'),
    ).not.toBeNull();
    expect(
      tela("fechamento").querySelector(".pdv")?.getAttribute("data-etapa"),
    ).toBe("fechamento");
    expect(
      tela("cliente").querySelector(".pdv")?.getAttribute("data-etapa"),
    ).toBe("cliente");
  });

  it("o total e o botão de fechar ficam FORA da lista de itens (a lista rola, eles não)", () => {
    for (const etapa of ["antiga", "vazia", "busca"] as const) {
      const painel = tela(etapa).querySelector(RAIZ)!;
      const cupom = painel.querySelector(".pdv-cupom")!;
      const rodape = painel.querySelector(".admin-acao-inline")!;
      expect(rodape.querySelector(".pdv-total")).not.toBeNull();
      expect(rodape.querySelector(".pdv-sale-action")).not.toBeNull();
      expect(cupom.contains(rodape)).toBe(false);
      expect(rodape.contains(cupom)).toBe(false);
      expect(rodape.parentElement).toBe(cupom.parentElement);
    }
  });

  describe("controles: o teste cai quando o desenho quebra (mutantes em cópia)", () => {
    it("mutar o css de ANTES do bloco quebra a assinatura", () => {
      expect(() =>
        conferirBaseIntacta(
          copiaComTroca("max-width: 900px", "max-width: 901px"),
        ),
      ).toThrow(/ASSINATURA/);
      expect(() =>
        conferirBaseIntacta(
          copiaComTroca(".pdv-flow,", ".pdv-flow ,\n.pdv-extra,"),
        ),
      ).toThrow(/ASSINATURA/);
    });

    it("sem o bloco novo, a prova de existência falha", () => {
      expect(() => conferirBloco(cssReal)).not.toThrow();
      expect(() => conferirBloco(semOBloco(cssReal))).toThrow(
        /tem de haver UM bloco/,
      );
    });

    it("seletor que não casa elemento real derruba", () => {
      const mutante = cssReal.replace(
        "#leitor-do-balcao",
        "#leitor-do-balcao-que-nao-existe",
      );
      // Só vale se o bloco do arquivo tem esse seletor.
      expect(mutante).not.toBe(cssReal);
      expect(() => conferirBloco(mutante)).toThrow(/sem alvo na tela montada/);
    });

    it("sem `min-height: 0` na busca, a prova derruba", () => {
      const mutante = cssReal.replace(
        /(#busca-do-balcao\s*\{[^}]*?)\s*min-height:\s*0;/,
        "$1",
      );
      expect(mutante).not.toBe(cssReal);
      expect(() => conferirBloco(mutante)).toThrow();
    });

    it("sem a regra dos avisos presos à direita, a prova derruba", () => {
      const mutante = cssReal.replace(
        /\s*\.pdv\[data-etapa="cupom"\] > \.pdv-flow > \.pdv-notice \{[^}]*\}/,
        "",
      );
      expect(mutante).not.toBe(cssReal);
      expect(() => conferirBloco(mutante)).toThrow(/regra dos avisos/);
    });

    it("dois filhos na mesma célula derrubam", () => {
      const mutante = cssReal.replace(
        /(\.pdv-flow > \.pdv-cupom\s*\{[^}]*grid-row:\s*)[^;]+;/,
        (_inteiro, antes: string) => `${antes}3 / 8;`,
      );
      expect(mutante).not.toBe(cssReal);
      expect(() => conferirBloco(mutante)).toThrow(/sobrepõe/);
    });

    it("!important e seletor global dentro do bloco derrubam", () => {
      const comImportant = cssReal.replace(
        /(\n@media \(min-width: 1280px\) \{[\s\S]*?display:\s*grid)/,
        "$1 !important",
      );
      expect(comImportant).not.toBe(cssReal);
      expect(() => conferirBloco(comImportant)).toThrow(/!important/);
      const global = cssReal.replace(
        /\n@media \(min-width: 1280px\) \{/,
        "\n@media (min-width: 1280px) {\n  * {\n    margin: 0;\n  }\n  body {\n    overflow: hidden;\n  }",
      );
      expect(global).not.toBe(cssReal);
      expect(() => conferirBloco(global)).toThrow(/escopo/);
    });

    it("regra que escapa do escopo da etapa 'cupom' derruba", () => {
      const mutante = cssReal.replace(
        /\n@media \(min-width: 1280px\) \{/,
        '\n@media (min-width: 1280px) {\n  .pdv[data-etapa="fechamento"] {\n    display: grid;\n  }',
      );
      expect(mutante).not.toBe(cssReal);
      expect(() => conferirBloco(mutante)).toThrow(/escopo/);
    });

    it("regra que valha abaixo de 1280 px (fora do @media) quebra a assinatura", () => {
      const mutante = `${cssReal}\n.pdv[data-etapa="cupom"] {\n  display: grid;\n}\n`;
      expect(() => conferirBaseIntacta(mutante)).toThrow(/ASSINATURA/);
    });
  });
});
