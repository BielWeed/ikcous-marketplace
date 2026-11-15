// Cartaz pre-impresso: SO no celular e no tablet (< 1024 px).
//
// Medido em Chromium real (15/11/2026): a regra do servidor nao olha a largura
// da tela, entao o computador recebia o MESMO cartaz do celular -- uma foto 2:1
// colada logo abaixo de um cabecalho de 53 px. So que o cabecalho do computador
// tem 121 px e o banner real tem outra caixa (1280 px: o cartaz nascia em
// y=53 com 1040x520, o banner real em y=121 com 1216x365). A foto saltava ao
// trocar. A correcao esconde o cartaz a partir de 1024 px, onde o layout do
// computador comeca (`CONSULTA_TELA_DE_COMPUTADOR`).
//
// ONDE MORA A REGRA: em `public/loading.css`, a folha de estilo da splash --
// o cartaz e filho da splash e sai com ela. NAO no HTML do cartaz: o trecho
// que o porteiro imprime em TODA loja continua uma `<img>` so, byte a byte o
// de antes (o teste "o trecho do celular" congela o literal). A folha e
// `style-src 'self'` e bloqueia a pintura (<link> no <head>), entao a regra ja
// vale antes da primeira pintura, sem mexer na CSP.
//
// jsdom nao avalia `@media`: aqui se le a folha de verdade com o PostCSS e se
// prende a regra (e o par `!important`, sem o qual o `display:block` do
// atributo `style` do cartaz vence a folha). O efeito visual e provado em
// navegador real fora desta suite.
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

import { CONSULTA_TELA_DE_COMPUTADOR } from "@/hooks/useTelaDeComputador";
import { ID_DO_CARTAZ, montarCartaz } from "@/hospedagem/cartaz";

const raiz = path.resolve(import.meta.dirname, "../..");
const FOLHA = readFileSync(path.resolve(raiz, "public/loading.css"), "utf8");
const LOJA = "https://lojaaaaaaaaaaaaaaaaa.supabase.co";
const FOTO = `${LOJA}/storage/v1/object/public/banners/1791565996435-7tdkqgfb019.webp`;

const SELETOR = `#${ID_DO_CARTAZ}`;
const normalizar = (valor: string) => valor.replace(/\s+/g, "").toLowerCase();

/** Toda regra da folha cujo seletor cita o cartaz, com o `@media` que a envolve. */
function regrasDoCartaz(css: string): { regra: Rule; media: AtRule | null }[] {
  const achadas: { regra: Rule; media: AtRule | null }[] = [];
  postcss.parse(css).walkRules((regra) => {
    if (!regra.selector.includes(ID_DO_CARTAZ)) return;
    let pai = regra.parent;
    let media: AtRule | null = null;
    while (pai && pai.type !== "root") {
      if (pai.type === "atrule" && (pai as AtRule).name === "media")
        media = pai as AtRule;
      pai = pai.parent;
    }
    achadas.push({ regra, media });
  });
  return achadas;
}

describe("a regra que esconde o cartaz no computador (public/loading.css)", () => {
  it("existe UMA regra para o cartaz, e ela esta dentro de um @media", () => {
    const achadas = regrasDoCartaz(FOLHA);
    expect(achadas).toHaveLength(1);
    expect(achadas[0].media).not.toBeNull();
    expect(normalizar(achadas[0].regra.selector)).toBe(normalizar(SELETOR));
  });

  it("o @media e exatamente o breakpoint do computador do app (>= 1024 px)", () => {
    const [{ media }] = regrasDoCartaz(FOLHA);
    expect(normalizar(media?.params ?? "")).toBe(
      normalizar(CONSULTA_TELA_DE_COMPUTADOR),
    );
    // Cinto e suspensorio: o numero em si, caso a constante um dia mude de lugar.
    expect(media?.params).toMatch(/^\(\s*min-width:\s*1024px\s*\)$/);
  });

  it("a regra e `display:none !important` (o atributo style do cartaz tem `display:block`)", () => {
    const [{ regra }] = regrasDoCartaz(FOLHA);
    const declaracoes = regra.nodes.filter((no) => no.type === "decl");
    expect(declaracoes).toHaveLength(1);
    const [decl] = declaracoes as unknown as {
      prop: string;
      value: string;
      important: boolean;
    }[];
    expect(decl.prop).toBe("display");
    expect(decl.value).toBe("none");
    expect(decl.important).toBe(true);
  });

  it("o `display:block` que a regra precisa vencer continua no atributo style do cartaz", () => {
    // Se um dia o `display:block` sair do atributo, o `!important` deixa de ser
    // necessario -- mas ate la ele e o que faz a regra da folha valer.
    const html = montarCartaz(
      {
        id: "b1",
        image_url: FOTO,
        position: "home_top",
        active: true,
        order: 1,
        title: "",
        subtitle: "",
        button_text: "",
        badge_text: "",
        template_type: "default",
        show_text_overlay: true,
      },
      LOJA,
    )?.html;
    expect(html).toContain("display:block");
  });
});

describe("o trecho do celular: o HTML do cartaz continua byte a byte o de antes", () => {
  // Congelado a mao (31/10/2026, lote B) para a MESMA linha de banner e a mesma
  // loja. Se isto mudar, TODA loja recebe outro HTML na abertura.
  const ESPERADO =
    '<img id="cartaz-da-loja" src="https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=640&amp;resize=contain&amp;quality=70" srcset="https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=200&amp;resize=contain&amp;quality=70 200w, https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=320&amp;resize=contain&amp;quality=70 320w, https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=480&amp;resize=contain&amp;quality=70 480w, https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=640&amp;resize=contain&amp;quality=70 640w, https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=960&amp;resize=contain&amp;quality=70 960w, https://lojaaaaaaaaaaaaaaaaa.supabase.co/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=1280&amp;resize=contain&amp;quality=70 1280w" sizes="100vw" alt="" aria-hidden="true" fetchpriority="high" loading="eager" decoding="sync" style="position:absolute;top:calc(env(safe-area-inset-top,0px) + 53px);left:0;right:0;z-index:50;display:block;width:100%;max-width:1040px;margin:0 auto;aspect-ratio:2/1;object-fit:cover;pointer-events:none">';

  it("a mesma linha de banner e a mesma loja geram o mesmo literal", () => {
    const html = montarCartaz(
      {
        id: "b1",
        image_url: FOTO,
        position: "home_top",
        active: true,
        order: 1,
        title: "",
        subtitle: "",
        button_text: "",
        badge_text: "",
        template_type: "default",
        show_text_overlay: true,
      },
      LOJA,
    )?.html;
    expect(html).toBe(ESPERADO);
  });
});
