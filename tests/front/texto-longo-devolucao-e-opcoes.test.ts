import { describe, expect, it } from "vitest";

const fontes = import.meta.glob<string>(
  [
    "/src/components/devolucao/DevolucaoDoPedidoCard.tsx",
    "/src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
    "/src/components/ui/custom/FolhaDeOpcoes.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("texto longo sem corte silencioso", () => {
  it.each([
    [
      "mensagem da loja ao cliente",
      "/src/components/devolucao/DevolucaoDoPedidoCard.tsx",
      "{atual.mensagem_loja}",
    ],
    [
      "relato do cliente",
      "/src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
      "“{detalhe.detalhe}”",
    ],
    [
      "mensagem no painel",
      "/src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
      "{detalhe.mensagem_loja}",
    ],
    [
      "inspeção",
      "/src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
      "{detalhe.observacao_inspecao}",
    ],
    [
      "nota do histórico",
      "/src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
      "{nota}",
    ],
  ])("%s quebra links e palavras sem espaços", (_nome, caminho, conteudo) => {
    const paragrafos = [
      ...(new Map(Object.entries(fontes)).get(caminho) ?? "").matchAll(
        /<p\s+className="([^"]+)"\s*>\s*([^<]+)\s*<\/p>/g,
      ),
    ];
    const paragrafo = paragrafos.find((p) => p[2].trim() === conteudo);
    expect(paragrafo, conteudo).toBeDefined();
    const classes = paragrafo?.[1].split(/\s+/) ?? [];
    expect(classes).toContain("whitespace-pre-line");
    expect(classes).toContain("break-words");
    expect(classes).not.toContain("overflow-hidden");
    expect(classes).not.toContain("truncate");
  });

  it("valores das opções limitam a largura e quebram palavras sem espaços", () => {
    const fonte = fontes["/src/components/ui/custom/FolhaDeOpcoes.tsx"];
    const botao = fonte.match(
      /<button\s+key=\{valor\}[\s\S]*?className=\{cn\(\s*"([^"]+)"/,
    );
    expect(botao).not.toBeNull();
    expect(botao?.[1].split(/\s+/)).toContain("max-w-full");
    const valor = fonte.match(
      /<span\s+className="([^"]+)"\s*>\s*\{valor\}\s*<\/span>/,
    );
    expect(valor).not.toBeNull();
    for (const classe of ["min-w-0", "break-words"])
      expect(valor?.[1].split(/\s+/)).toContain(classe);
  });

  it("o valor escolhido no cabeçalho quebra sem espremer o rótulo nem a seta", () => {
    const fonte = fontes["/src/components/ui/custom/FolhaDeOpcoes.tsx"];
    const valorEscolhido = fonte.match(
      /<span\s+className="([^"]+)"\s*>\s*\{escolhido\}\s*<\/span>/,
    );
    expect(valorEscolhido).not.toBeNull();
    const classes = valorEscolhido?.[1].split(/\s+/) ?? [];
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("break-words");
    // Reserva a outra metade para o rótulo, a seta e a bolinha de cor.
    expect(classes).toContain("max-w-[50%]");
  });

  it("nome do produto mostra reticências em duas linhas, sem teto fixo de altura", () => {
    const fonte = fontes["/src/components/ui/custom/FolhaDeOpcoes.tsx"];
    const titulo = fonte.match(
      /<SheetTitle\s+className="([^"]+)"\s*>\s*\{product.name\}/,
    );
    expect(titulo).not.toBeNull();
    const classes = titulo?.[1].split(/\s+/) ?? [];
    expect(classes).toContain("line-clamp-2");
    expect(classes).not.toContain("max-h-[60px]");
    expect(classes).not.toContain("overflow-hidden");
  });
});
