// Lote 203, lido do texto-fonte (as telas inteiras exigem banco e tempo real):
// 1. os avisos com botão ("Ver" o pedido novo, "Restaurar" a grade) duram 10 s;
// 2. o botão "Mais ações" das vitrines tem área de toque de 44 px, como o Ajuda.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do teste, sem entrada externa
  readFileSync(caminho, "utf-8").replace(/\r\n/g, "\n");

describe("avisos com botão de ação duram o bastante para tocar", () => {
  it("'Novo pedido recebido' com o botão Ver dura 10 s", () => {
    const fonte = ler("src/views/admin/AdminOrdersView.tsx");
    expect(fonte).toMatch(
      /toast\.info\(`Novo pedido recebido! #\$\{numeroDoPedido\(newId\)\}`, \{\n\s+duration: 10_000,\n\s+action: \{/,
    );
  });

  it("'variações ainda não foram salvas' com o botão Restaurar dura 10 s", () => {
    const fonte = ler("src/views/admin/AdminProductFormView.tsx");
    expect(fonte).toMatch(
      /\{\n\s+duration: 10000,\n\s+action: \{\n\s+label: "Restaurar",/,
    );
  });
});

describe("vitrines: 'Mais ações' com 44 px de toque", () => {
  it("o botão tem min-h-11 min-w-11 e o desenho de 36 px fica por dentro", () => {
    const fonte = ler("src/views/admin/AdminCarouselsView.tsx");
    const inicio = fonte.indexOf('aria-label="Mais ações"');
    const trecho = fonte.slice(inicio, inicio + 900);
    // o próprio botão (não o desenho) leva a medida de 44 px
    expect(trecho).toMatch(
      /disabled=\{salvandoVitrines\}\n\s+className="group flex min-h-11 min-w-11 /,
    );
    expect(trecho).toContain("size-9");
  });
});
