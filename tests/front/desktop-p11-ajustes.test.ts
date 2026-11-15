import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/views/admin/AdminSettingsView.tsx";
const fonte = readFileSync(caminho, "utf8");
const arvore = ts.createSourceFile(
  caminho,
  fonte,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const classes: string[] = [];
const literais: string[] = [];

function visitar(no: ts.Node) {
  if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
    classes.push(no.initializer?.getText(arvore) ?? "");
    if (no.initializer && ts.isStringLiteral(no.initializer)) {
      literais.push(no.initializer.text);
    }
  }
  ts.forEachChild(no, visitar);
}
visitar(arvore);

const semComputador = (valor: string) =>
  valor.replace(/\s*\b(?:lg|xl|2xl):[^\s"'` }]+/g, "");
const assinatura = (valor: string) =>
  createHash("sha256").update(valor).digest("hex");
const conteudo =
  literais.find(
    (valor) =>
      classesDoCelular(valor) === "mx-auto max-w-2xl space-y-3 px-5 pb-8",
  ) ?? "";
const cabecalho =
  literais.find((valor) => valor.startsWith("admin-topo-cabecalho ")) ?? "";

function valorNaLargura(
  valor: string,
  regra: RegExp,
  janela: number,
  inicial: number,
) {
  const breakpoints = new Map([
    ["lg", 1024],
    ["xl", 1280],
    ["2xl", 1536],
  ]);
  let resultado = inicial;
  for (const token of valor.split(/\s+/)) {
    const partes = token.split(":");
    const prefixo = partes.length > 1 ? partes[0] : undefined;
    if (
      prefixo &&
      janela < (breakpoints.get(prefixo) ?? Number.POSITIVE_INFINITY)
    ) {
      continue;
    }
    const encontrado = partes.at(-1)?.match(regra);
    if (encontrado) resultado = Number(encontrado[1]);
  }
  return resultado;
}

describe("P11 — Ajustes no computador", () => {
  it("preserva a assinatura das 94 classes de celular e tablet", () => {
    expect(classes).toHaveLength(94);
    expect(
      assinatura(
        JSON.stringify(
          classes.map((valor) => classesDoCelular(semComputador(valor))),
        ),
      ),
    ).toBe("044958926251c3c1ff7507de1af65f1b9a193e51c5f444ff1d6ec2e03a09bf8a");
  });

  it("só acrescenta classes de PC: não muda pagamentos, texto ou árvore", () => {
    // Assinatura da fonte f04669a6a, normalizando só CRLF e tokens de PC.
    // Qualquer handler, ordem do DOM, wrapper ou classe móvel alterado reprova.
    expect(assinatura(semComputador(fonte).replace(/\r\n/g, "\n"))).toBe(
      "eead4ab6b31e673b6c9bab21f655702237ee69d9f033cb811260611d3665a384",
    );
  });

  it("alarga cabeçalho e conteúdo juntos e só monta a grade em 2xl", () => {
    for (const valor of [cabecalho, conteudo]) {
      expect(valor).toContain("lg:max-w-7xl");
      expect(valor).toContain("lg:px-6");
    }
    expect(conteudo.split(" ")).toEqual(
      expect.arrayContaining([
        "2xl:grid",
        "2xl:grid-cols-2",
        "2xl:items-start",
        "2xl:gap-6",
        "2xl:space-y-0",
      ]),
    );
    expect(conteudo).not.toMatch(/(?:^|\s)(?:lg|xl):grid(?:\s|-)/);
  });

  it("mantém avisos, carregamento, recebimentos e pagamentos em largura inteira", () => {
    // O aviso compartilhado não aceita className: o seletor fica só no pai.
    expect(conteudo).toContain(
      "2xl:[&>[data-aviso-loja-sem-dados]]:col-span-2",
    );
    expect(conteudo).toContain(
      "2xl:[&>#grupo-de-ajustes-pagamentos]:col-span-2",
    );
    // A porta de Entrega ocupa uma linha: preserva o fluxo sem buraco
    // antes de Pagamentos, sem dense/order ou mudança da ordem do DOM.
    expect(conteudo).toContain("2xl:[&>#grupo-de-ajustes-entrega]:col-span-2");
    // Trocas e devoluções abre um formulário de ~2500 px: ao lado de
    // Ferramentas (70 px) deixava 604 × 2513 px vazios em 1536/1920 px.
    // Os dois ocupam a linha inteira, e os ids casam com os grupos reais.
    for (const chave of ["devolucao", "ferramentas"]) {
      expect(conteudo).toContain(
        `2xl:[&>#grupo-de-ajustes-${chave}]:col-span-2`,
      );
      expect(fonte).toContain(`chave="${chave}"`);
    }
    expect(fonte).toContain("id={`grupo-de-ajustes-${chave}`}");
    for (const trecho of [
      "slide-in-from-top-2 2xl:col-span-2",
      "mt-4 animate-pulse space-y-6 2xl:col-span-2",
      "${CARTAO_AJUSTES} mb-7 space-y-3 !p-3 2xl:col-span-2 2xl:mb-0",
      "py-1 text-[11px] font-bold tracking-wider text-zinc-400 2xl:col-span-2",
      "py-4 text-left text-xs text-zinc-300 2xl:col-span-2",
    ]) {
      expect(fonte).toContain(trecho);
    }
  });

  it.each([
    [1024, 1, 720],
    [1280, 1, 976],
    [1536, 2, 604],
    [1920, 2, 604],
  ])(
    "em %i px mantém %i coluna(s), com cartão de %i px",
    (janela, colunasEsperadas, cartaoEsperado) => {
      const casca = readFileSync(
        "src/components/layouts/AdminLayout.tsx",
        "utf8",
      );
      expect(casca).toContain("hidden w-64 shrink-0");
      expect(casca).toContain(
        "relative mx-auto flex size-full max-w-7xl flex-col",
      );
      expect(conteudo).toContain("lg:max-w-7xl");
      const colunas = valorNaLargura(conteudo, /^grid-cols-(\d+)$/, janela, 1);
      const padding = valorNaLargura(conteudo, /^px-(\d+)$/, janela, 5) * 4;
      const gap = valorNaLargura(conteudo, /^gap-(\d+)$/, janela, 0) * 4;
      const largura = Math.min(janela - 256, 1280);
      const cartao = (largura - 2 * padding - (colunas - 1) * gap) / colunas;
      expect(colunas).toBe(colunasEsperadas);
      expect(cartao).toBe(cartaoEsperado);
      expect(cartao).toBeGreaterThanOrEqual(480);
    },
  );
});
