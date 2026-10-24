// @vitest-environment jsdom
//
// Confirmação de "Tornar administrador / Remover acesso" (PromoverAdminConfirmacao).
// A prova no celular achou três defeitos visuais; este teste trava o que o
// jsdom consegue travar:
//
//   1. em 320x640 a barra inferior do painel (z-[60]) cobria o "Cancelar", porque
//      a confirmação era z-50: o cartão agora fica ACIMA da barra;
//   2. o `max-w-md` passado ao componente SUBSTITUÍA o `max-w-[calc(100%-2rem)]`
//      padrão do AlertDialogContent e o cartão encostava nas duas bordas do
//      celular: agora é `max-w-[calc(100%-2rem)] sm:max-w-md`;
//   3. em tela baixa o cartão pode passar da altura visível: `max-h` + rolagem
//      interna mantêm o "Cancelar" alcançável.
//
// O jsdom não calcula CSS: classe inventada passa em todo teste de componente e
// não pinta nada. Por isso o Tailwind REAL do projeto compila as classes e o
// teste reprova se alguma não virar regra. Molde: perfil-classes-geram-css.
// NÃO prova: a sobreposição de verdade, a altura medida e o contraste, que só
// o navegador mede (ver o relatório da tarefa).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { act } from "react";
import { createRoot } from "react-dom/client";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { PromoverAdminConfirmacao } from "@/components/admin/users/PromoverAdminConfirmacao";
import type { Customer } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const requisitar = createRequire(import.meta.url);
const ARQUIVO = "src/components/admin/users/PromoverAdminConfirmacao.tsx";

/** Classes novas deste ajuste, além das que o componente já usava. */
const CLASSES_DO_AJUSTE = [
  "z-[70]",
  "max-w-[calc(100%-2rem)]",
  "sm:max-w-md",
  "max-h-[calc(100dvh-2rem)]",
  "overflow-y-auto",
  "p-4",
  "sm:p-6",
];

/** Todo texto de `className="..."` do arquivo (sem ternário elaborado: só literais). */
function classesDoArquivo(fonte: string): string[] {
  const classes = new Set<string>();
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const colher = (no: ts.Node) => {
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
      for (const t of no.text.split(/\s+/)) if (t) classes.add(t);
    ts.forEachChild(no, colher);
  };
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText() === "className" &&
      no.initializer
    )
      colher(no.initializer);
    ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return [...classes];
}

async function classesGeradas(candidatas: string[]): Promise<Set<string>> {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
  const geradas = new Set<string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        geradas.add(c.value);
      });
    }).processSync(regra.selector);
  });
  return geradas;
}

function cliente(): Customer {
  return {
    id: "cli-1",
    email: "maria.silva@exemplo.com",
    full_name: "Maria Silva",
    phone: "34999990000",
    role: "customer",
    created_at: "2026-08-01T00:00:00Z",
    orders_count: 1,
    total_spent: 10,
  };
}

describe("confirmação de administrador — toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada NÃO vira regra e as do ajuste viram", async () => {
    const g = await classesGeradas([
      "bg-marca-inventada-900",
      "z-inventado-70",
      ...CLASSES_DO_AJUSTE,
    ]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("z-inventado-70")).toBe(false);
    // As classes com `:` e `[...]` saem escapadas no seletor; o walker as
    // devolve já sem escape, então a comparação é pelo nome real.
    for (const c of CLASSES_DO_AJUSTE) expect(g.has(c), c).toBe(true);
  }, 60_000);

  it("nenhuma classe do componente deixa de gerar CSS", async () => {
    const classes = classesDoArquivo(readFileSync(ARQUIVO, "utf8"));
    expect(classes.length).toBeGreaterThan(0);
    const g = await classesGeradas(classes);
    expect(classes.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);
});

describe("confirmação de administrador — o cartão que chega ao DOM", () => {
  let hospedeiro: HTMLDivElement | null = null;
  let desmontar: (() => void) | null = null;

  afterEach(() => {
    desmontar?.();
    hospedeiro?.remove();
    document.body.removeAttribute("style");
    document.body.className = "";
    hospedeiro = null;
    desmontar = null;
  });

  async function abrir(acao: "promover" | "remover"): Promise<Element> {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    desmontar = () => act(() => raiz.unmount());
    await act(async () => {
      raiz.render(
        <PromoverAdminConfirmacao
          acao={acao}
          aberta
          customer={cliente()}
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
          retornoDoFoco={{ current: null }}
        />,
      );
    });
    const cartao = document.querySelector('[data-slot="alert-dialog-content"]');
    if (!cartao) throw new Error("a confirmação não abriu");
    return cartao;
  }

  for (const acao of ["promover", "remover"] as const) {
    it(`(${acao}) margem lateral no celular e largura máxima só a partir de sm`, async () => {
      const fichas = (await abrir(acao)).className.split(/\s+/);
      expect(fichas).toContain("max-w-[calc(100%-2rem)]");
      expect(fichas).toContain("sm:max-w-md");
      // O `max-w-md` puro (sem prefixo) era o defeito: tirava a margem lateral.
      expect(fichas).not.toContain("max-w-md");
      expect(fichas).not.toContain("sm:max-w-lg");
    });

    it(`(${acao}) fica acima da barra inferior e cabe em tela baixa`, async () => {
      const fichas = (await abrir(acao)).className.split(/\s+/);
      expect(fichas).toContain("z-[70]");
      expect(fichas).not.toContain("z-50");
      expect(fichas).toContain("max-h-[calc(100dvh-2rem)]");
      expect(fichas).toContain("overflow-y-auto");
    });
  }

  it("a camada do cartão é maior que a da barra inferior do painel (lida do AdminLayout)", async () => {
    const layout = readFileSync(
      "src/components/layouts/AdminLayout.tsx",
      "utf8",
    );
    const barra = layout
      .split("\n")
      .find(
        (l) =>
          l.includes("z-[") &&
          l.includes("fixed inset-x-5") &&
          l.includes("lg:hidden"),
      );
    const zDaBarra = Number(/z-\[(\d+)\]/.exec(barra ?? "")?.[1]);
    expect(Number.isFinite(zDaBarra)).toBe(true);
    const fichas = (await abrir("promover")).className.split(/\s+/);
    const zDoCartao = Number(
      fichas
        .map((f) => /^z-(?:\[(\d+)\]|(\d+))$/.exec(f))
        .find(Boolean)
        ?.slice(1)
        .find(Boolean),
    );
    expect(Number.isFinite(zDoCartao)).toBe(true);
    expect(zDoCartao).toBeGreaterThan(zDaBarra);
  });
});
