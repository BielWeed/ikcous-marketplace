// @vitest-environment jsdom
//
// Ordem do dono (22/10/2026): no painel, item selecionado e botão principal
// não usam o dourado de marca. Selecionado = contorno forte neutro + marca de
// "check"; botão principal = fundo neutro de alto contraste. Dourado só no
// "Finalizar Pedido" da loja e no tracinho da aba ativa da barra de baixo.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const tailwindcss = require("tailwindcss");

function carregarConfigDoProjeto() {
  const caminho = resolve(__dirname, "../../tailwind.config.js");
  const modulo = new (Module as any)(caminho);
  modulo.filename = caminho;
  modulo.paths = (Module as any)._nodeModulePaths(dirname(caminho));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do config do próprio projeto
  modulo._compile(readFileSync(caminho, "utf-8"), caminho);
  return modulo.exports;
}

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

describe("painel — selecionado e botão principal são neutros", () => {
  it("AcaoDoPainel primária: fundo neutro, sem dourado, foco com anel neutro", async () => {
    const { AcaoDoPainel } = await import(
      "@/components/admin/primitivos/AcaoDoPainel"
    );
    await act(async () => {
      raiz.render(<AcaoDoPainel>Salvar</AcaoDoPainel>);
    });
    const b = hospedeiro.querySelector("button")!;
    expect(b.className).toContain("bg-foreground");
    expect(b.className).toContain("text-background");
    expect(b.className).toContain("focus-visible:ring-2");
    expect(b.className).not.toContain("admin-gold");
  });

  it("AlternadorDeTelas: a tela atual é neutra e leva aria-current", async () => {
    const { AlternadorDeTelas } = await import(
      "@/components/admin/primitivos/AlternadorDeTelas"
    );
    await act(async () => {
      raiz.render(<AlternadorDeTelas atual="admin-qa" onNavigate={() => {}} />);
    });
    const atual = hospedeiro.querySelector('[aria-current="page"]')!;
    expect(atual).toBeTruthy();
    // Selecionado é neutro: moldura forte e fundo elevado (tela de Perguntas/Avaliações).
    expect(atual.className).toContain("border-solid");
    expect(atual.className).toContain("border-admin-border-strong");
    expect(atual.className).toContain("bg-admin-raised");
    expect(hospedeiro.innerHTML).not.toContain("admin-gold");
  });

  it("EstadoVazio: o botão da ação é neutro", async () => {
    const { EstadoVazio } = await import(
      "@/components/admin/primitivos/EstadoVazio"
    );
    await act(async () => {
      raiz.render(
        <EstadoVazio
          titulo="Nada"
          frase="Vazio"
          acao={{ rotulo: "Criar", aoClicar: () => {} }}
        />,
      );
    });
    expect(hospedeiro.innerHTML).not.toContain("admin-gold");
    expect(hospedeiro.querySelector("button")!.className).toContain(
      "bg-foreground",
    );
  });

  it("OpcoesDaBusca: a opção selecionada tem contorno forte neutro e um check, sem dourado", async () => {
    const { OpcoesDaBusca } = await import("@/components/admin/BarraDeBusca");
    await act(async () => {
      raiz.render(
        <OpcoesDaBusca
          opcoes={[
            {
              valor: "a",
              rotulo: "Alfa",
              selecionada: true,
              onClick: () => {},
            },
            {
              valor: "b",
              rotulo: "Beta",
              selecionada: false,
              onClick: () => {},
            },
          ]}
        />,
      );
    });
    const [sel, nao] = Array.from(hospedeiro.querySelectorAll("button"));
    expect(sel.getAttribute("aria-pressed")).toBe("true");
    expect(sel.className).toContain("border-foreground");
    expect(sel.className).toContain("border-solid");
    // O anel do filtro escolhido fica por DENTRO: a faixa de filtros rola na
    // horizontal e o overflow cortava um anel por fora (em cima, embaixo e na
    // ponta encostada na borda). O jsdom não vê o corte; a regra é esta.
    expect(sel.className).toContain("ring-inset");
    expect(sel.className).toContain("focus-visible:ring-inset");
    expect(nao.className).toContain("focus-visible:ring-inset");
    expect(sel.className).not.toContain("admin-gold");
    expect(sel.querySelector('svg[data-marca="selecionado"]')).toBeTruthy();
    expect(nao.querySelector('svg[data-marca="selecionado"]')).toBeNull();
  });
});

describe("painel — as classes neutras geram CSS", () => {
  it("compila o Tailwind do projeto e acha regra para cada uma", async () => {
    const classes = [
      "bg-foreground",
      "text-background",
      "hover:opacity-90",
      "border-foreground",
      "border-solid",
      "ring-1",
      "ring-inset",
      "focus-visible:ring-inset",
      "ring-foreground",
      "bg-admin-hover",
      "text-foreground",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-admin-nav",
    ];
    const resultado = await postcss([
      tailwindcss({
        ...carregarConfigDoProjeto(),
        content: [{ raw: classes.join(" "), extension: "html" }],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    expect(
      classes.filter((c) => !resultado.css.includes(`.${escapar(c)}`)),
    ).toEqual([]);
  });
});

describe("Pedidos — filtro escolhido é neutro", () => {
  it("a fonte não pinta o filtro escolhido de dourado", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de um arquivo do próprio projeto
    const fonte = readFileSync(
      resolve(__dirname, "../../src/views/admin/AdminOrdersView.tsx"),
      "utf-8",
    );
    expect(fonte).not.toContain("admin-gold");
  });
});

// Fase 2: o que o revisor listou. Cada trecho abaixo era seleção ou botão
// sólido dourado; agora não pode voltar.
const SEM_DOURADO: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "src/components/admin/crm/ClientesDoCrm.tsx",
    [
      "border-admin-gold/60 bg-admin-gold/[0.08]",
      'gruposAbertos && "bg-admin-gold/15',
      '"border-admin-gold bg-admin-gold/15 text-admin-gold"',
    ],
  ],
  [
    "src/views/admin/AdminCrmView.tsx",
    ["admin-gold-fill", "border-admin-gold bg-admin-gold/15"],
  ],
  [
    "src/components/admin/devolucoes/AcoesDaDevolucao.tsx",
    [
      'modo === "aprovar" && "border-admin-gold',
      'modo === "concluir" && "border-admin-gold',
      "border-admin-gold/60 bg-admin-gold/10",
      "data-[state=checked]:bg-admin-gold",
    ],
  ],
  [
    "src/components/admin/devolucoes/CartaoDaDevolucao.tsx",
    ["border-admin-gold/40 bg-admin-gold"],
  ],
  [
    "src/views/admin/AdminDevolucoesView.tsx",
    ["border-admin-gold/50 bg-admin-gold/10", '"bg-admin-gold text-black"'],
  ],
  [
    "src/components/admin/financeiro/FolhasDeCadastro.tsx",
    ["border-admin-gold/50 bg-admin-gold/10"],
  ],
  [
    "src/components/admin/financeiro/partes.tsx",
    ["border-admin-gold/60 bg-admin-gold/10"],
  ],
  [
    "src/components/admin/financeiro/SeletorDePeriodo.tsx",
    [
      "border-admin-gold/50 bg-admin-gold/10",
      '"bg-admin-gold/10 text-admin-gold"',
    ],
  ],
  [
    "src/components/admin/products/ModalVarianteGrade.tsx",
    ["bg-admin-gold/10 border-admin-gold"],
  ],
  [
    "src/components/admin/settings/PoliticaDeDevolucaoSection.tsx",
    [
      "border-admin-gold/50 bg-admin-gold/10",
      "border-admin-gold/60 bg-admin-gold/10",
    ],
  ],
  [
    "src/components/admin/settings/PrivacidadeDosClientesSection.tsx",
    ["border-admin-gold bg-admin-gold/10"],
  ],
  [
    "src/views/admin/AdminProductFormView.tsx",
    [
      "bg-admin-gold/10 border-admin-gold",
      "border-2 border-admin-gold",
      "bottom-0 bg-admin-gold",
    ],
  ],
  [
    "src/views/admin/AdminProductsView.tsx",
    ["border border-admin-gold bg-admin-gold/10"],
  ],
  [
    "src/components/admin/vitrines/CartaoDaVitrine.tsx",
    [
      "data-[state=checked]:bg-admin-gold",
      'border-admin-gold/25 bg-admin-gold/10 text-admin-gold"\n',
    ],
  ],
  ["src/components/admin/crm/CanaisDoCrm.tsx", ["admin-gold-fill"]],
  ["src/components/admin/crm/VisaoGeralDoCrm.tsx", ["admin-gold-fill"]],
  ["src/components/admin/pdv/ReciboDaVenda.tsx", ["bg-admin-gold"]],
  [
    "src/components/admin/orders/EtiquetaDoPedidoCard.tsx",
    ["border-admin-gold/30 bg-admin-gold/10"],
  ],
  [
    "src/components/admin/settings/TransportadorasCard.tsx",
    [
      "data-[state=checked]:bg-admin-gold",
      "border-admin-gold/30 bg-admin-gold/10",
    ],
  ],
  [
    "src/components/admin/settings/aparencia-do-painel.css",
    ["var(--admin-gold)"],
  ],
  ["src/components/admin/settings/ajustes.css", ["f4c43f"]],
  [
    "src/views/admin/AdminFinanceiroView.tsx",
    [
      "data-[state=active]:border-admin-gold",
      "data-[state=active]:bg-admin-gold",
      "data-[state=active]:text-admin-gold",
    ],
  ],
  ["src/views/admin/AdminShippingView.tsx", ["admin-gold-fill"]],
  ["src/components/admin/shipping/PreviaDoFrete.tsx", ["admin-gold-fill"]],
  [
    "src/components/admin/settings/IdentitySettingsSection.tsx",
    ["accent-admin-gold"],
  ],
  [
    "src/components/admin/settings/PoliticaDeDevolucaoSection.tsx",
    ["accent-admin-gold"],
  ],
  [
    "src/components/admin/settings/TransportadorasCard.tsx",
    ["accent-admin-gold"],
  ],
  [
    "src/components/admin/products/formulario-produto.css",
    ["button.bg-admin-gold"],
  ],
];

describe("fase 2 — seleção e botão sólido sem dourado no resto do painel", () => {
  for (const [arquivo, proibidos] of SEM_DOURADO) {
    it(`${arquivo.split("/").pop()} não pinta seleção/botão de dourado`, () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- lista fixa de arquivos do próprio projeto
      const fonte = readFileSync(resolve(__dirname, "../..", arquivo), "utf-8");
      for (const p of proibidos) expect(fonte, p).not.toContain(p);
    });
  }

  it("filtros de Pedidos mostram o check do escolhido", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo fixo do projeto
    const fonte = readFileSync(
      resolve(__dirname, "../../src/views/admin/AdminOrdersView.tsx"),
      "utf-8",
    );
    expect(
      fonte.match(/data-marca="selecionado"/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("as classes novas da fase 2 geram CSS", async () => {
    const classes = [
      "data-[state=checked]:bg-foreground",
      "border-admin-border-strong",
      "hover:bg-admin-hover",
      "bg-foreground",
      "text-background",
      "border-2",
      "ring-2",
      "accent-foreground",
    ];
    const resultado = await postcss([
      tailwindcss({
        ...carregarConfigDoProjeto(),
        content: [{ raw: classes.join(" "), extension: "html" }],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    expect(
      classes.filter((c) => !resultado.css.includes(`.${escapar(c)}`)),
    ).toEqual([]);
  });
});
