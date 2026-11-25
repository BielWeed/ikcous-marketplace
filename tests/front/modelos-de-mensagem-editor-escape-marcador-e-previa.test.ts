// @vitest-environment jsdom
// O editor de "Compartilhar" (Minha loja › Contato) guarda o texto com
// `[nome]`, `[preco]`, `[link]` e desenha cada marcador como um chip. Os testes
// que já existiam cobrem a quebra de linha; aqui ficam as bordas que sobravam:
// o escape de `& < >` (texto da lojista nunca vira HTML), marcador repetido
// (todas as ocorrências viram chip, não só a primeira), espaço entre dois chips,
// elementos de formatação soltos, o chip que não pode ser editado por dentro e
// o id padrão da prévia.
import {
  PRESETS,
  htmlDoMarcador,
  htmlParaTexto,
  textoDaPrevia,
  textoParaHtml,
} from "@/components/admin/minha-loja/modelos-de-mensagem";
import { describe, expect, it } from "vitest";

const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;

describe("textoParaHtml — o texto da lojista nunca vira HTML", () => {
  it("escapa &, < e > (cada um, em todas as ocorrências)", () => {
    expect(textoParaHtml("a & b & c")).toBe("a &amp; b &amp; c");
    expect(textoParaHtml("1 < 2 < 3")).toBe("1 &lt; 2 &lt; 3");
    expect(textoParaHtml("3 > 2 > 1")).toBe("3 &gt; 2 &gt; 1");
  });

  it("uma tag digitada pela lojista aparece como texto, sem elemento nenhum", () => {
    const html = textoParaHtml('Veja <img src=x onerror="alert(1)"> agora');
    expect(html).not.toContain("<img");
    const alvo = document.createElement("div");
    alvo.innerHTML = html;
    expect(alvo.querySelector("img")).toBeNull();
    expect(alvo.textContent).toBe('Veja <img src=x onerror="alert(1)"> agora');
  });

  it("o & é escapado ANTES dos outros: '&lt;' digitado volta como '&lt;', não como '<'", () => {
    expect(textoParaHtml("&lt;")).toBe("&amp;lt;");
    expect(htmlParaTexto(textoParaHtml("&lt; e &amp; e <b>"))).toBe(
      "&lt; e &amp; e <b>",
    );
  });

  it("cada quebra de linha vira um <br> (não só a primeira)", () => {
    expect(textoParaHtml("a\nb\nc")).toBe("a<br>b<br>c");
    expect(contar(textoParaHtml("1\n2\n3\n4"), "<br>")).toBe(3);
  });

  it("texto vazio vira HTML vazio", () => {
    expect(textoParaHtml("")).toBe("");
    expect(htmlParaTexto("")).toBe("");
  });
});

describe("marcadores repetidos e chips", () => {
  it("todas as ocorrências de [nome], [preco] e [link] viram chip", () => {
    const texto = "[nome] e [nome]; [preco] ou [preco]; [link] / [link]";
    const html = textoParaHtml(texto);
    expect(contar(html, 'data-tag="nome"')).toBe(2);
    expect(contar(html, 'data-tag="preco"')).toBe(2);
    expect(contar(html, 'data-tag="link"')).toBe(2);
    expect(html).not.toMatch(/\[(nome|preco|link)\]/);
    expect(htmlParaTexto(html)).toBe(texto);
  });

  it("o chip não é editável por dentro e leva o rótulo e o tipo certos", () => {
    const esperado = {
      nome: "🏷️ Nome do Produto",
      preco: "💰 Preço",
      link: "🔗 Link",
    } as const;
    for (const tipo of ["nome", "preco", "link"] as const) {
      const alvo = document.createElement("div");
      alvo.innerHTML = htmlDoMarcador(tipo);
      const chip = alvo.querySelector("span") as HTMLElement;
      expect(chip.getAttribute("contenteditable")).toBe("false");
      expect(chip.getAttribute("data-tag")).toBe(tipo);
      expect(chip.textContent).toBe(Reflect.get(esperado, tipo));
    }
  });

  it("o texto do chip tem 11px no mínimo (régua visual do painel) e cada tipo tem cor própria", () => {
    const classes = (["nome", "preco", "link"] as const).map((tipo) => {
      const alvo = document.createElement("div");
      alvo.innerHTML = htmlDoMarcador(tipo);
      return (alvo.querySelector("span") as HTMLElement).className;
    });
    for (const classe of classes) {
      const tamanhos = [...classe.matchAll(/text-\[(\d+)px\]/g)].map((m) =>
        Number(m[1]),
      );
      expect(tamanhos.length).toBeGreaterThan(0);
      for (const px of tamanhos) expect(px).toBeGreaterThanOrEqual(11);
    }
    expect(new Set(classes).size).toBe(3);
  });

  it("espaço SOZINHO entre dois chips na mesma linha não se perde", () => {
    const html = `${htmlDoMarcador("nome")} ${htmlDoMarcador("link")}`;
    expect(htmlParaTexto(html)).toBe("[nome] [link]");
    expect(htmlParaTexto(`${htmlDoMarcador("nome")} `)).toBe("[nome] ");
  });
});

describe("htmlParaTexto — bordas do que o navegador grava", () => {
  it("só um <br> é uma quebra (duas linhas vazias); dois são duas quebras", () => {
    expect(htmlParaTexto("<br>")).toBe("\n");
    expect(htmlParaTexto("<br><br>")).toBe("\n\n");
  });

  it("negrito, itálico e span sem tag de marcador não derrubam o texto de dentro", () => {
    expect(htmlParaTexto("<b>negrito</b> e <i>itálico</i>")).toBe(
      "negrito e itálico",
    );
    expect(htmlParaTexto("A <span>B <u>C</u></span> D")).toBe("A B C D");
  });

  it("formatação dentro de um bloco continua sendo da mesma linha", () => {
    expect(htmlParaTexto("A<div><b>B</b> C</div><div>D</div>")).toBe(
      "A\nB C\nD",
    );
  });

  it("texto seguido de um bloco DENTRO do mesmo bloco: o bloco de dentro começa linha nova", () => {
    expect(htmlParaTexto("<div>A<div>B</div></div>")).toBe("A\nB");
    expect(htmlParaTexto("<div>A<p>B</p></div>")).toBe("A\nB");
    expect(htmlParaTexto("<div>A<div>B</div><div>C</div></div>")).toBe(
      "A\nB\nC",
    );
  });

  it("o texto digitado com marcador de formatação não cria marcador falso", () => {
    expect(htmlParaTexto("<span>[nome]</span>")).toBe("[nome]");
  });
});

describe("modelos prontos (PRESETS) — todos entram no editor e voltam iguais", () => {
  it("há mais de um modelo, cada nome é único e cada um traz descrição", () => {
    expect(PRESETS.length).toBeGreaterThan(1);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.name.trim(), p.name).not.toBe("");
      expect(p.description.trim(), p.name).not.toBe("");
    }
  });

  it("cada modelo usa [nome], [preco] e [link] exatamente uma vez e nenhum outro colchete", () => {
    for (const p of PRESETS) {
      expect(contar(p.text, "[nome]"), p.name).toBe(1);
      expect(contar(p.text, "[preco]"), p.name).toBe(1);
      expect(contar(p.text, "[link]"), p.name).toBe(1);
      const colchetes = p.text.match(/\[[^\]]*\]/g) ?? [];
      expect(colchetes.length, p.name).toBe(3);
    }
  });

  it("texto → HTML do editor → texto devolve o modelo sem perder emoji nem marcador", () => {
    for (const p of PRESETS) {
      expect(htmlParaTexto(textoParaHtml(p.text)), p.name).toBe(p.text);
    }
  });
});

describe("textoDaPrevia — produto de exemplo", () => {
  const link = (id: string) =>
    `${window.location.origin}/product-detail?id=${id}`;

  it("sem id usa o produto 1; id vazio também (não deixa 'id=' solto)", () => {
    expect(textoDaPrevia("[link]", { name: "Camisa", price: 10 })).toBe(
      link("1"),
    );
    expect(textoDaPrevia("[link]", { name: "Camisa", price: 10, id: "" })).toBe(
      link("1"),
    );
  });

  it("com id usa o id dado", () => {
    expect(
      textoDaPrevia("[link]", { name: "Camisa", price: 10, id: "42" }),
    ).toBe(link("42"));
  });

  it("o preço sai em reais com vírgula e centavos, e o nome entra como está", () => {
    const r = textoDaPrevia("[nome] custa [preco] [link]", {
      name: "Camisa Azul",
      price: 1234.5,
      id: "9",
    });
    expect(r).toMatch(/^Camisa Azul custa R\$\s1\.234,50 /);
    expect(r.endsWith(link("9"))).toBe(true);
  });
});
