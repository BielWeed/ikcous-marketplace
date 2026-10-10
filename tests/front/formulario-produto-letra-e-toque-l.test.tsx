// Painel simples, onda L, frente L5 (formulario-de-produto) — o formulário de
// produto sem letra abaixo de 11px e com alvos de 44px no que restou da onda K:
//
//   a. o arquivo não tem nenhum `text-[6..10.5px]` fora de comentário;
//   b. o seletor de setor (`SelectTrigger id="product-category"`) tem `min-h-11`
//      (o `data-[size=default]:h-9` do ui/select vence o `h-auto`; min-height
//      vence height);
//   c. "Tirar Foto" (estado vazio) com `min-h-11`; os botões da câmera e de
//      adicionar fotos (galeria com fotos) com `size-11`;
//   d. "Tentar de novo" / "Remover" da foto com falha e "Recarregar" do erro de
//      carga com `min-h-11`;
//   e. chip de atributo e "+ Atributo" do modal de variante com `min-h-11`;
//   f. os botões editar/ligar/excluir da lista de variações (`VariantItem`) com
//      `size-11` e os `aria-label`/`title` que o teste de ligar/desligar lê;
//   g. "Visualizar App" (botão flutuante) em 11px.
//
// Estático: o jsdom não aplica CSS; a medida real é do render (ver relatório).
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   a prova estática lê o próprio arquivo-fonte da tela (caminho fixo no repositório, não entrada de usuário);
   a regex da letra é constante, sem entrada de usuário */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FONTE = readFileSync(
  join(__dirname, "..", "..", "src/views/admin/AdminProductFormView.tsx"),
  "utf8",
);

/** text-[6px] … text-[10.5px], com ou sem prefixo de tela — a regex da régua. */
const TEXTO_MIUDO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

/** A tag de abertura JSX que começa em `inicio` (até o `>` fora de `{}` e de aspas). */
function tagAPartirDe(inicio: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = inicio + 1; i < FONTE.length; i++) {
    const c = FONTE[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (profundidade === 0 && (c === '"' || c === "'")) aspas = c;
    else if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return FONTE.slice(inicio, i + 1);
  }
  return "";
}

/** A tag `<elemento` que abre imediatamente antes da primeira ocorrência de `ancora`. */
function tagDe(elemento: string, ancora: string, apartirDe = 0): string {
  const posicao = FONTE.indexOf(ancora, apartirDe);
  expect(posicao, `âncora ausente: ${ancora}`).toBeGreaterThan(-1);
  const inicio = FONTE.lastIndexOf(`<${elemento}`, posicao);
  expect(inicio, `<${elemento} antes de: ${ancora}`).toBeGreaterThan(-1);
  return tagAPartirDe(inicio);
}

describe("AdminProductFormView — letra e toque (onda L, L5)", () => {
  it("a. nenhum text-[<11px] fora de comentário", () => {
    const semComentario = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    const achados: string[] = [];
    for (const m of semComentario.matchAll(TEXTO_MIUDO)) {
      const linha = semComentario.slice(0, m.index).split("\n").length;
      achados.push(`${m[0]} (linha ~${linha} sem comentários)`);
    }
    expect(achados).toEqual([]);
  });

  it("b. o seletor de setor tem min-h-11", () => {
    const gatilho = tagDe("SelectTrigger", 'id="product-category"');
    expect(gatilho).toContain("min-h-11");
  });

  it("c. 'Tirar Foto' do estado vazio com min-h-11 e 11px; câmera e '+' das fotos com size-11", () => {
    const rotulosDaCamera = [
      ...FONTE.matchAll(/<label\s+htmlFor="product-image-capture"/g),
    ].map((m) => tagAPartirDe(m.index));
    expect(rotulosDaCamera).toHaveLength(2);

    const comFotos = rotulosDaCamera.find((t) =>
      t.includes('title="Tirar Foto"'),
    );
    const vazio = rotulosDaCamera.find(
      (t) => !t.includes('title="Tirar Foto"'),
    );
    expect(comFotos, "câmera da galeria com fotos").toBeDefined();
    expect(vazio, "Tirar Foto do estado vazio").toBeDefined();
    expect(comFotos).toContain("size-11");
    expect(vazio).toContain("min-h-11");
    expect(vazio).toContain("text-[11px]");

    const adicionar = tagDe("label", 'title="Adicionar Mais Imagens"');
    expect(adicionar).toContain("size-11");
  });

  it("d. 'Tentar de novo', 'Remover' e 'Recarregar' com min-h-11 e 11px", () => {
    for (const onClick of [
      "onClick={() => void tentarFotoDeNovo(falha.id)}",
      "onClick={() => descartarFotoComFalha(falha.id)}",
      "onClick={() => window.location.reload()}",
    ]) {
      const botao = tagDe("button", onClick);
      expect(botao, onClick).toContain("min-h-11");
      expect(botao, onClick).toContain("text-[11px]");
    }
  });

  it("e. chip de atributo e '+ Atributo' do modal de variante com min-h-11", () => {
    const sugestoes = FONTE.indexOf("suggestedAttributes.map(");
    expect(sugestoes).toBeGreaterThan(-1);
    const chip = tagAPartirDe(FONTE.indexOf("<button", sugestoes));
    expect(chip).toContain("min-h-11");
    expect(chip).toContain('type="button"');

    // a última ocorrência é o texto do botão (as anteriores são comentários)
    const posicaoTexto = FONTE.lastIndexOf("+ Atributo");
    expect(posicaoTexto).toBeGreaterThan(-1);
    const maisAtributo = tagAPartirDe(
      FONTE.lastIndexOf("<button", posicaoTexto),
    );
    expect(maisAtributo).toContain("min-h-11");
    expect(maisAtributo).toContain("text-[11px]");
  });

  it("f. editar, ligar/desligar e excluir da lista de variações com size-11", () => {
    const inicio = FONTE.indexOf("const VariantItem = React.memo(");
    expect(inicio).toBeGreaterThan(-1);
    const trecho = FONTE.slice(inicio);
    const botoes = [...trecho.matchAll(/<button\b/g)].map((m) =>
      tagAPartirDe(inicio + m.index),
    );
    expect(botoes).toHaveLength(3);
    for (const botao of botoes) expect(botao).toContain("size-11");
    // o rótulo que o teste de desligar/religar lê continua no botão do meio
    expect(trecho).toContain(
      'aria-label={`${variant.active ? "Desligar" : "Religar"} variação ${variant.value}`}',
    );
  });

  it("f2. a linha da variação cabe a 360px: lado esquerdo encolhe e as pílulas quebram linha", () => {
    const inicio = FONTE.indexOf("const VariantItem = React.memo(");
    const trecho = FONTE.slice(inicio);
    // lado esquerdo: o primeiro <div> depois do cartão
    const cartao = trecho.indexOf('<div className="group flex');
    expect(cartao).toBeGreaterThan(-1);
    const esquerdo = tagAPartirDe(inicio + trecho.indexOf("<div", cartao + 5));
    expect(esquerdo).toContain("min-w-0");
    // <div> interno do texto: o que contém o data-testid
    const testid = trecho.indexOf('data-testid="variante-cadastrada"');
    const interno = tagAPartirDe(
      inicio +
        trecho.lastIndexOf("<div", trecho.lastIndexOf("<div", testid) - 1),
    );
    expect(interno).toContain("min-w-0");
    // linha das pílulas de estoque/preço
    const pilulas = tagDe("div", "tracking-tighter", inicio);
    expect(pilulas).toContain("flex-wrap");
  });

  it("f3. editar e excluir da variação têm nome acessível", () => {
    const inicio = FONTE.indexOf("const VariantItem = React.memo(");
    const trecho = FONTE.slice(inicio);
    expect(trecho).toContain("aria-label={`Editar variação ${variant.value}`}");
    expect(trecho).toContain(
      "aria-label={`Excluir variação ${variant.value}`}",
    );
  });

  it("g. 'Visualizar App' (botão flutuante) em 11px", () => {
    const posicao = FONTE.indexOf("Visualizar App");
    expect(posicao).toBeGreaterThan(-1);
    const rotulo = tagAPartirDe(FONTE.lastIndexOf("<span", posicao));
    expect(rotulo).toContain("text-[11px]");
  });
});
