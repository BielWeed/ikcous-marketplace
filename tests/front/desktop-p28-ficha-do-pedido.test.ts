// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Order } from "@/types";
import postcss from "postcss";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// Só leituras são dubladas; ficha e TODOS os cartões renderizam de verdade.
const estadoDosHooks = vi.hoisted(() => ({
  devolucao: "vazio",
  estorno: "dados",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        in: () => consulta,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return consulta;
    },
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/hooks/useDevolucoesDoPedidoAdmin", () => ({
  useDevolucoesDoPedidoAdmin: () => ({
    devolucoes:
      estadoDosHooks.devolucao === "dados"
        ? [
            {
              id: "devolucao-ficticia",
              protocolo: "DV-FICTICIO",
              status: "solicitada",
              tipo: "arrependimento",
              resolucao_desejada: "reembolso",
              metodo_retorno: "entrega_na_loja",
              valor_itens: 50,
              created_at: "2026-11-01T12:00:00.000Z",
            },
          ]
        : [],
    carregando: estadoDosHooks.devolucao === "carregando",
    erro: estadoDosHooks.devolucao === "erro",
    recarregar: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => ({
    linhas: [],
    pago: 100,
    devolvido: 0,
    manual: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 100,
    reservadoPorFora: 0,
    carregando: estadoDosHooks.estorno === "carregando",
    pedidoCarregado: estadoDosHooks.estorno !== "carregando",
    erro: estadoDosHooks.estorno === "erro",
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn(),
    enviando: false,
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const caminho = "src/components/admin/orders/OrderDetail.tsx";
const fonte = readFileSync(caminho, "utf8");

// Base 251753360, gerada antes da implementação: 180 literais.
// O CI não precisa do histórico. O hash é só da lista de classes móveis,
// não do arquivo; as caixas relevantes também ficam legíveis abaixo.
// + `break-words` no endereço de retirada do cartão "Retirada na loja" (18/11/2026): só essa classe entra.
const HASH_DAS_CLASSES_MOVEIS =
  "a9a857ff22b987766e20006b416b14d8f027e3e23956706e69e9dcb005bad302";
const CLASSES_DAS_CAIXAS_NA_BASE = [
  "mx-auto w-full max-w-[600px] space-y-4 px-4 pt-5 md:px-6 md:pt-6",
  "space-y-2",
  "flex w-full items-start px-1",
  "space-y-4 p-5",
  "space-y-4 p-5",
  "p-5",
  "divide-y divide-admin-border",
  "mx-auto flex w-full max-w-[600px] items-center gap-2 px-4 py-3",
];

function analisar(texto: string) {
  return ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function atributo(
  no: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  nome: string,
) {
  const prop = no.attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText() === nome,
  );
  return prop &&
    ts.isJsxAttribute(prop) &&
    prop.initializer &&
    ts.isStringLiteral(prop.initializer)
    ? prop.initializer.text
    : "";
}

function literaisDeClasse(no: ts.Node): string[] {
  const lista: string[] = [];
  function visitar(atual: ts.Node) {
    if (ts.isJsxAttribute(atual) && atual.name.getText() === "className") {
      function literal(filho: ts.Node) {
        if (ts.isStringLiteral(filho)) lista.push(filho.text);
        ts.forEachChild(filho, literal);
      }
      if (atual.initializer) literal(atual.initializer);
    }
    ts.forEachChild(atual, visitar);
  }
  visitar(no);
  return lista;
}

function elementos(texto: string) {
  const lista: ts.JsxElement[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxElement(no)) lista.push(no);
    ts.forEachChild(no, visitar);
  }
  visitar(analisar(texto));
  return lista;
}

function caixa(texto: string, nome: string) {
  const resultado = elementos(texto).find((no) =>
    nome === "corpo"
      ? atributo(no.openingElement, "className").includes("space-y-4 px-4 pt-5")
      : nome === "barra"
        ? atributo(no.openingElement, "className").includes(
            "items-center gap-2 px-4 py-3",
          )
        : atributo(no.openingElement, "data-testid") === nome,
  );
  if (!resultado) throw new Error(`Caixa não encontrada: ${nome}`);
  return resultado;
}

function filhosDaGrade(texto: string) {
  const filhos: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function coletar(no: ts.Node) {
    if (ts.isJsxElement(no)) filhos.push(no.openingElement);
    else if (ts.isJsxSelfClosingElement(no)) filhos.push(no);
    else ts.forEachChild(no, coletar);
  }
  for (const filho of caixa(texto, "corpo").children) coletar(filho);
  return filhos;
}

function conferirPreservacao(texto: string) {
  const lista = literaisDeClasse(analisar(texto)).map(classesDoCelular);
  expect(lista, "A quantidade de literais de className mudou").toHaveLength(
    180,
  );
  expect(
    createHash("sha256").update(JSON.stringify(lista)).digest("hex"),
    "Classes móveis mudaram: compare a lista de literais com a base 251753360",
  ).toBe(HASH_DAS_CLASSES_MOVEIS);
  const caixas = [
    caixa(texto, "corpo"),
    elementos(texto).find(
      (no) => no.openingElement.tagName.getText() === "header",
    ),
    elementos(texto).find((no) => no.openingElement.tagName.getText() === "ol"),
    caixa(texto, "bloco-dinheiro"),
    caixa(texto, "bloco-entrega"),
    caixa(texto, "bloco-itens"),
    caixa(texto, "envio-lista"),
    caixa(texto, "barra"),
  ];
  expect(
    caixas
      .flatMap((no) => (no ? literaisDeClasse(no.openingElement) : []))
      .map(classesDoCelular),
  ).toEqual(CLASSES_DAS_CAIXAS_NA_BASE);
}

function conferirGrade(texto: string) {
  const tokens = atributo(
    caixa(texto, "corpo").openingElement,
    "className",
  ).split(/\s+/);
  for (const token of [
    "xl:max-w-none",
    "xl:grid",
    "xl:grid-cols-2",
    "xl:items-start",
    "xl:gap-6",
    "xl:space-y-0",
    "xl:[&>*]:min-w-0",
    "xl:[&>*]:col-span-2",
  ])
    expect(tokens).toContain(token);
  expect(tokens.filter((token) => /^(lg|2xl):/.test(token))).toEqual([]);
  expect(
    tokens.filter((token) =>
      /^(lg|xl|2xl):(?:hidden|fixed|sticky|top-|overflow-hidden|order-|grid-flow-dense)/.test(
        token,
      ),
    ),
  ).toEqual([]);
}

function conferirDistribuicao(
  grade: Element,
  tokens: string[],
  metades: boolean,
  contexto: string,
) {
  const regras = tokens
    .flatMap((token) => {
      const regra = token.match(/^xl:\[(.+)\]:col-span-(\d+)$/);
      return regra ? [{ seletor: regra[1], span: Number(regra[2]) }] : [];
    })
    .sort((a, b) => (a.seletor === "&>*" ? -1 : b.seletor === "&>*" ? 1 : 0));
  const spans = new Map<Element, number>();
  for (const regra of regras) {
    for (const filho of grade.querySelectorAll(
      regra.seletor.replace("&", ":scope"),
    )) {
      spans.set(filho, regra.span);
    }
  }
  let coluna = 0;
  for (const filho of grade.children) {
    const span = spans.get(filho) ?? 1;
    const ehPar = ["bloco-dinheiro", "bloco-entrega"].includes(
      filho.getAttribute("data-testid") ?? "",
    );
    expect(span, contexto).toBe(ehPar && metades ? 1 : 2);
    if (span === 2) expect(coluna, contexto).toBe(0);
    coluna = (coluna + span) % 2;
  }
  expect(coluna, contexto).toBe(0);
}

async function conferirEstados(texto: string) {
  expect(filhosDaGrade(texto).map((no) => no.tagName.getText())).toEqual([
    "OrderHeader",
    "OrderStepperPipeline",
    "OrderFinanceCard",
    "DevolucaoDoPedidoAdminCard",
    "EstornoCard",
    "OrderDeliveryCard",
    "OrderItemsCard",
    "section",
  ]);
  const { OrderDetail } = await import("@/components/admin/orders/OrderDetail");
  const tokens = atributo(
    caixa(texto, "corpo").openingElement,
    "className",
  ).split(/\s+/);
  const pedido: Order = {
    id: "pedido-layout-ficticio",
    customer: {
      name: "Pessoa fictícia",
      whatsapp: "",
      address: "",
      neighborhood: "",
      city: "",
      state: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "pending",
    cancelledAfterShipping: false,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  const cenarios: {
    nome: string;
    pedido?: Partial<Order>;
    devolucao?: string;
    estorno?: string;
    metades: boolean;
  }[] = [
    { nome: "sem pagamento e sem endereço", metades: true },
    { nome: "cancelado", pedido: { status: "cancelled" }, metades: true },
    { nome: "balcão", pedido: { canal: "presencial" }, metades: true },
    {
      nome: "retirada sem endereço",
      pedido: { retiradaNaLoja: true },
      metades: true,
    },
    { nome: "sem rastreio", pedido: { trackingCode: "" }, metades: true },
    {
      nome: "com rastreio",
      pedido: { trackingCode: "AB123456789BR" },
      metades: true,
    },
    {
      nome: "pagamento online pendente",
      pedido: { paymentMethod: "online", paymentStatus: "aguardando" },
      metades: true,
    },
    {
      nome: "entregue sem devolução",
      pedido: { status: "delivered" },
      metades: true,
    },
    {
      nome: "devolução carregando",
      pedido: { status: "delivered" },
      devolucao: "carregando",
      metades: true,
    },
    {
      nome: "erro da devolução",
      pedido: { status: "delivered" },
      devolucao: "erro",
      metades: false,
    },
    {
      nome: "devolução preenchida",
      pedido: { status: "delivered" },
      devolucao: "dados",
      metades: false,
    },
    ...["carregando", "erro", "dados"].map((estado) => ({
      nome: `estorno ${estado}`,
      pedido: {
        paymentMethod: "online",
        paymentStatus: "pago",
      } as Partial<Order>,
      estorno: estado,
      metades: false,
    })),
    {
      nome: "produto e dinheiro",
      pedido: {
        status: "delivered",
        paymentMethod: "online",
        paymentStatus: "pago",
      },
      devolucao: "dados",
      estorno: "dados",
      metades: false,
    },
    {
      nome: "produto e dinheiro em erro",
      pedido: {
        status: "delivered",
        paymentMethod: "online",
        paymentStatus: "pago",
      },
      devolucao: "erro",
      estorno: "erro",
      metades: false,
    },
  ];
  for (const cenario of cenarios) {
    estadoDosHooks.devolucao = cenario.devolucao ?? "vazio";
    estadoDosHooks.estorno = cenario.estorno ?? "dados";
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    try {
      await act(async () => {
        raiz.render(
          createElement(OrderDetail, {
            order: { ...pedido, ...cenario.pedido },
            onStatusChange: vi.fn(),
            active: false,
          }),
        );
      });
      const grade = hospedeiro.querySelector(
        '[data-testid="bloco-dinheiro"]',
      )?.parentElement;
      expect(grade, cenario.nome).not.toBeNull();
      if (!grade) throw new Error("Grade não renderizada");
      expect(grade.className).toBe(
        atributo(caixa(fonte, "corpo").openingElement, "className"),
      );
      expect(
        grade.querySelector(':scope > [data-testid="bloco-entrega"]'),
      ).not.toBeNull();
      expect(
        grade.querySelector(':scope > [data-testid="bloco-itens"]'),
      ).not.toBeNull();
      // Os nós e atributos são dos componentes REAIS, nunca fabricados no teste.
      conferirDistribuicao(grade, tokens, cenario.metades, cenario.nome);
    } finally {
      await act(async () => {
        raiz.unmount();
      });
      hospedeiro.remove();
    }
  }
}

describe("P28 — Ficha do pedido no computador", () => {
  it("preserva os 180 literais móveis, incluindo as caixas principais", () => {
    conferirPreservacao(fonte);
    expect(() =>
      conferirPreservacao(
        fonte.replace("space-y-4 px-4 pt-5", "space-y-5 px-4 pt-5"),
      ),
    ).toThrow();
  });

  it("abre a largura e divide só em xl, sem alterar 1024–1279", () => {
    conferirGrade(fonte);
    expect(() =>
      conferirGrade(fonte.replace("xl:grid-cols-2", "lg:grid-cols-2")),
    ).toThrow();
  });

  it("enumera os filhos e aplica seletores no DOM real em todos os estados", async () => {
    await conferirEstados(fonte);
    await expect(
      conferirEstados(fonte.replace("xl:[&>*]:col-span-2", "")),
    ).rejects.toThrow();
  });

  it("mantém ações sticky no topo e alinha a barra com o corpo em xl", () => {
    const barra = caixa(fonte, "barra");
    const pai = barra.parent;
    expect(ts.isJsxElement(pai)).toBe(true);
    if (!ts.isJsxElement(pai)) throw new Error("Barra sem pai");
    expect(atributo(pai.openingElement, "className")).toBe(
      "sticky top-0 z-40 border-b border-admin-border bg-admin-bg",
    );
    const tokens = atributo(barra.openingElement, "className").split(/\s+/);
    expect(tokens).toContain("xl:max-w-none");
    expect(tokens).toContain("xl:px-6");
    expect(tokens.filter((token) => token.startsWith("lg:"))).toEqual([]);
    expect(fonte).toContain("fade-in lg:pb-28");
  });

  it("emite CSS real apenas em 1280 para a grade, spans e largura", async () => {
    const exigir = createRequire(import.meta.url);
    const tailwind = exigir("tailwindcss");
    const classes = [
      atributo(caixa(fonte, "corpo").openingElement, "className"),
      atributo(caixa(fonte, "barra").openingElement, "className"),
    ]
      .join(" ")
      .split(/\s+/)
      .filter((token) => /^(lg|xl|2xl):/.test(token))
      .join(" ");
    const resultado = await postcss([
      tailwind({
        content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
        corePlugins: { preflight: false },
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const declaracoes: string[] = [];
    resultado.root.walkAtRules("media", (media) => {
      expect(media.params).toBe("(min-width: 1280px)");
      media.walkDecls((decl) => {
        declaracoes.push(`${decl.prop}: ${decl.value}`);
      });
    });
    for (const valor of [
      "max-width: none",
      "display: grid",
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
      "gap: 1.5rem",
      "min-width: 0px",
      "grid-column: span 2 / span 2",
      "grid-column: span 1 / span 1",
      "padding-left: 1.5rem",
      "padding-right: 1.5rem",
      "--tw-space-y-reverse: 0",
    ])
      expect(declaracoes).toContain(valor);
    const pares: string[] = [];
    resultado.root.walkRules((regra) => {
      regra.walkDecls("grid-column", (decl) => {
        if (decl.value === "span 1 / span 1") pares.push(regra.selector);
      });
    });
    expect(pares).toHaveLength(2);
    expect(
      pares.some((seletor) =>
        seletor.endsWith(
          ">[data-testid=bloco-dinheiro]:has(+[data-testid=bloco-entrega])",
        ),
      ),
    ).toBe(true);
    expect(
      pares.some((seletor) =>
        seletor.endsWith(
          ">[data-testid=bloco-dinheiro]+[data-testid=bloco-entrega]",
        ),
      ),
    ).toBe(true);
  });
});
