/* eslint-disable security/detect-non-literal-fs-filename -- varredura apenas de fontes locais do repositório */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");

// Exceções contam ocorrências, não liberam arquivos inteiros para novas faixas.
const EXCECOES = new Map([
  [
    "src/views/admin/AdminProductFormView.tsx",
    "Publicar produto: barra preexistente fora desta rodada",
  ],
  [
    "src/components/admin/users/FolhaClientes.tsx",
    "Folha modal, não ação de tela",
  ],
  [
    "src/components/admin/primitivos/FolhaDoPainel.tsx",
    "Folha modal, não ação de tela",
  ],
]);

function fontes(pasta: string): string[] {
  return readdirSync(resolve(RAIZ, pasta), { withFileTypes: true }).flatMap(
    (entrada) => {
      const caminho = `${pasta}/${entrada.name}`;
      return entrada.isDirectory()
        ? fontes(caminho)
        : caminho.endsWith(".tsx")
          ? [caminho]
          : [];
    },
  );
}

function faixas(caminho: string) {
  const fonte = ts.createSourceFile(
    caminho,
    readFileSync(resolve(RAIZ, caminho), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
      const classe = no.initializer?.getText(fonte) ?? "";
      if (
        classe.includes("bottom-[var(--admin-tab-pb") ||
        (/\bfixed\b/.test(classe) &&
          classe.includes("inset-x-") &&
          /\bbottom-/.test(classe))
      ) {
        achados.push(classe);
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

it("nenhuma tela cria outra faixa solta acima da pílula", () => {
  const problemas = fontes("src/views/admin")
    .concat(fontes("src/components/admin"))
    .flatMap((caminho) => {
      const ocorrencias = faixas(caminho);
      const permitidas = EXCECOES.has(caminho) ? 1 : 0;
      return ocorrencias.length > permitidas
        ? [
            `${caminho}: ${ocorrencias.length} faixa(s), permitido ${permitidas}`,
          ]
        : [];
    });
  expect(problemas).toEqual([]);
});

it("Produtos e Vender deixam de posicionar suas ações por CSS próprio", () => {
  const produtos = readFileSync(
    resolve(RAIZ, "src/components/admin/products/catalogo-produtos.css"),
    "utf8",
  );
  const pdv = readFileSync(
    resolve(RAIZ, "src/components/admin/pdv/pdv.css"),
    "utf8",
  );
  expect(produtos).not.toContain(".produtos-novo");
  // Só a propriedade `bottom` (não `padding-bottom`, que é legítimo).
  expect(pdv).not.toMatch(/(^|[\s;{])bottom:\s*var\(--admin-tab-pb/m);
});
