// A descrição da loja que o lojista digita na tela "Sobre a Loja" vira HTML
// SIMPLES no SAVE (parágrafos por linha em branco) — a forma final gravada
// no banco é a mesma que a página pública renderiza (com DOMPurify por cima,
// defesa independente que existe desde antes da coluna existir). Escapar
// &< > antes de envolver em <p> garante que o texto do lojista nunca vira
// marcação acidental: o que ele digita é CONTEÚDO, não HTML.
//
// `textoDaLoja` é o INVERSO: o que o editor mostra ao reabrir a tela. Ida e
// volta pelo MESMO módulo = o formDirty da tela só acusa diferença quando o
// lojista digita de verdade (sem isso, micro-diferenças de reconstituição
// deixavam o botão Salvar eternamente habilitado — 1ª execução real,
// 20/09/2026).

export function descricaoDaLojaParaHtml(texto: string): string {
  const paragrafos = texto
    .split(/\n\s*\n/)
    .map((bloco) => bloco.trim())
    .filter(Boolean)
    .map(
      (bloco) =>
        `<p>${bloco.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    );
  return paragrafos.join("");
}

export function textoDaLoja(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
