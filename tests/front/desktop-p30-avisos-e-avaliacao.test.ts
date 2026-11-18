import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/views/customer/OrderDetailsView.tsx";
const fonte = readFileSync(caminho, "utf8");
const css = readFileSync("src/index.css", "utf8");

// Base 251753360 + parágrafo do horário de retirada (17/11/2026).
// Conferido: a única adição é "text-xs text-zinc-500"; nenhuma classe antiga mudou.
// + linha "Recebe: X" do cartão de endereço (18/11/2026): só entra "mt-0.5 break-words text-sm font-medium text-zinc-700".
// Ordem dos literais dentro de TODOS os className, inclusive cn/condicionais.
const assinaturaDoCelular =
  "df167f5a337e47628e62640519b42c250ed00195dad727b68b9522ac31c88ed0";
const classesOriginais = [
  "fixed inset-x-0 bottom-[var(--folha-acima-da-barra)] top-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in",
  "relative z-10 max-h-[calc(100dvh-var(--folha-acima-da-barra)-72px)] w-full max-w-md overflow-y-auto rounded-t-[2.5rem] bg-zinc-50 p-6 shadow-2xl duration-300 animate-in slide-in-from-bottom",
];
const regraOriginalDoToaster = `[data-sonner-toaster][data-position^="top"] {
  top: calc(var(--safe-area-top, 0px) + 64px) !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: auto !important;
  max-width: min(calc(100vw - 24px), 420px) !important;
  z-index: 99999 !important;
}`;

function literaisDasClasses(texto: string) {
  const arvore = ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const classes: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
      function coletar(item: ts.Node) {
        if (ts.isStringLiteral(item)) classes.push(item.text);
        ts.forEachChild(item, coletar);
      }
      if (no.initializer) coletar(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  return classes;
}

function verificarAvaliacao(texto: string) {
  const classes = literaisDasClasses(texto);
  const envoltorio = classes.find((classe) =>
    classe.startsWith("fixed inset-x-0 bottom-[var(--folha-acima-da-barra)]"),
  );
  const dialogo = classes.find((classe) =>
    classe.startsWith(
      "relative z-10 max-h-[calc(100dvh-var(--folha-acima-da-barra)",
    ),
  );
  expect(envoltorio, "envoltório existente da avaliação").toBeDefined();
  expect(dialogo, "diálogo existente da avaliação").toBeDefined();
  for (const token of ["lg:bottom-0", "lg:items-center", "lg:z-[130]"]) {
    expect(envoltorio?.split(" "), `envoltório precisa de ${token}`).toContain(
      token,
    );
  }
  for (const token of ["lg:max-h-[85dvh]", "lg:rounded-3xl"]) {
    expect(dialogo?.split(" "), `diálogo precisa de ${token}`).toContain(token);
  }
  expect(classesDoCelular(envoltorio ?? "")).toBe(classesOriginais[0]);
  expect(classesDoCelular(dialogo ?? "")).toBe(classesOriginais[1]);
}

describe("P30 — avisos e avaliação no computador", () => {
  it("centraliza a avaliação sem o recuo da barra inferior, com rolagem e acima do cabeçalho", () => {
    verificarAvaliacao(fonte);
    const cabecalho = readFileSync(
      "src/components/desktop/CabecalhoDoComputador.tsx",
      "utf8",
    );
    const zCabecalho = Number(cabecalho.match(/lg:z-\[(\d+)\]/)?.[1]);
    const zAvaliacao = Number(fonte.match(/lg:z-\[(\d+)\]/)?.[1]);
    expect(zAvaliacao).toBeGreaterThan(zCabecalho);
    const sheet = readFileSync("src/components/ui/sheet.tsx", "utf8");
    expect(sheet).toContain("fixed inset-0 z-[130] bg-black/50");
    // Descarte já usa 130 e é portalado depois da folha: não fica atrás dela.
    expect(
      fonte.indexOf(
        '<AlertDialogContent overlayClassName="z-[130]" className="z-[130]">',
      ),
    ).toBeGreaterThan(fonte.indexOf("ref={avaliacaoFolhaRef}"));
  });

  it("preserva os 210 literais de celular, inclusive os dois elementos tocados", () => {
    const lista = literaisDasClasses(fonte).map(classesDoCelular);
    expect(lista).toHaveLength(210);
    expect(
      createHash("sha256").update(JSON.stringify(lista)).digest("hex"),
      "classes do celular divergiram da base 251753360; confira a lista de className, não atualize o hash sem investigar",
    ).toBe(assinaturaDoCelular);
  });

  it("mantém a regra CSS original de avisos; o offset não depende de seletor interno", () => {
    expect(css.replace(/\r\n/g, "\n")).toContain(regraOriginalDoToaster);
    const sonner = readFileSync("node_modules/sonner/dist/index.mjs", "utf8");
    expect(sonner).toContain('"data-y-position": y');
    expect(sonner).not.toContain('"data-position":');
  });

  it("mata mutante 1: retirar a centralização desktop do envoltório", () => {
    const mutante = fonte.replace(" lg:items-center", "");
    expect(mutante).not.toBe(fonte);
    expect(() => verificarAvaliacao(mutante)).toThrow("lg:items-center");
  });

  it("mata mutante 2: retirar o limite desktop de altura do diálogo", () => {
    const mutante = fonte.replace(" lg:max-h-[85dvh]", "");
    expect(mutante).not.toBe(fonte);
    expect(() => verificarAvaliacao(mutante)).toThrow("lg:max-h-[85dvh]");
  });
});
