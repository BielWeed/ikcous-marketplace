// Lote 211 — acabamento da vitrine ate o endereco do checkout. O jsdom nao ve
// CSS nem layout, entao o contrato de tamanho de texto, contraste e alvo de
// toque e fixado na classe do fonte (a mesma tecnica de
// regua-visual-do-painel.test.ts). O texto do plural e o CEP so-leitura sao
// provados em outros testes (cart-context-* e address-form-cep-race).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  readFileSync(resolve(process.cwd(), caminho), "utf8");

const CARD = ler("src/components/ui/custom/ProductCard.tsx");
const LISTA_END = ler("src/components/ui/custom/AddressList.tsx");
const FORM_END = ler("src/components/ui/custom/AddressForm.tsx");
const CATEGORIAS = ler("src/components/ui/custom/CategoryFilter.tsx");
const BUSCA = ler("src/views/customer/SearchView.tsx");
const ITENS = ler("src/components/ui/custom/CartItemsList.tsx");
const LEMBRETE = ler("src/components/ui/custom/CartReminder.tsx");
const BARRA = ler("src/components/ui/custom/SearchBar.tsx");

describe("card do produto: texto legivel", () => {
  it("categoria, 'De:' e 'A partir de' nao usam 9 px nem cinza claro", () => {
    expect(CARD).not.toContain("text-[9px]");
    expect(CARD).not.toMatch(/text-\[1[01]px\][^"]*text-slate-400/);
    expect(CARD).not.toContain("text-slate-400");
  });
});

describe("lista de enderecos: contraste", () => {
  it("o CEP e o botao Editar nao usam zinc-400 (contraste fraco)", () => {
    // Os outros zinc-400 do arquivo sao icones decorativos, nao texto.
    expect(LISTA_END).not.toContain("text-[11px] font-bold text-zinc-400");
    expect(LISTA_END).not.toContain("bg-white text-zinc-400 shadow-sm");
  });
});

describe("formulario de endereco: alvos de toque", () => {
  it("'Nao sei meu CEP' e 'Ponto de referencia' tem 44 px de altura", () => {
    const link = FORM_END.match(/<a[^>]*URL_DESCOBRIR_CEP[\s\S]*?>/)?.[0] ?? "";
    expect(link).toContain("min-h-11");
    const botao =
      FORM_END.match(
        /onClick=\{\(\) => setReferenciaAberta\(true\)\}[\s\S]*?>/,
      )?.[0] ?? "";
    expect(botao).toContain("min-h-11");
  });
});

describe("filtro de categorias", () => {
  it("nome cortado em 1 linha continua legivel por title", () => {
    expect(CATEGORIAS).toContain("title={category.name}");
  });
});

describe("busca sem resultado", () => {
  it("nao promete 'tendencia' e o botao nao usa 10 px", () => {
    expect(BUSCA).not.toContain("o que é tendência");
    const bloco = BUSCA.slice(
      BUSCA.indexOf("Smart Empty State"),
      BUSCA.indexOf("trendingProducts.map"),
    );
    expect(bloco).not.toContain("text-[10px]");
  });
});

describe("itens do carrinho", () => {
  it("o preco por unidade tem rotulo quando ha mais de uma unidade", () => {
    expect(ITENS).toContain("cart-item-preco-cada");
  });
});

describe("lembrete do carrinho", () => {
  it("texto de 12 px, botao com area de 44 px e tempo de leitura de 8 s", () => {
    // So o numerinho dentro da bolinha do carrinho fica em 10 px.
    expect(LEMBRETE.split("text-[10px]").length - 1).toBe(1);
    expect(LEMBRETE).not.toContain("text-[8px]");
    expect(LEMBRETE).not.toContain("5000");
    expect(LEMBRETE).toContain("8000");
    expect(LEMBRETE).toContain("duration: 8");
    const botao = LEMBRETE.match(/onClick=\{onAction\}[\s\S]*?>/)?.[0] ?? "";
    // A area de 44 px vem do after:-inset-y-1.5 em volta dos 32 px (Lote 201).
    expect(botao).toContain("after:-inset-y-1.5");
    expect(botao).toContain("text-xs");
  });
});

describe("barra de busca: alvos de toque", () => {
  it("sugestoes e categorias encontradas tem 44 px", () => {
    const chips = BARRA.match(/shadow-2xs flex [^"]*items-center[^"]*"/g) ?? [];
    expect(chips.length).toBe(2);
    for (const c of chips) expect(c).toContain("min-h-11");
  });
});
