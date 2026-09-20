// A descrição da loja que o lojista digita na tela "Sobre a Loja" vira HTML
// SIMPLES no SAVE (parágrafos por linha em branco) — a forma final gravada
// no banco é a mesma que a página pública renderiza (com DOMPurify por cima,
// defesa independente que existe desde antes da coluna existir). Escapar
// &< > antes de envolver em <p> garante que o texto do lojista nunca vira
// marcação acidental: o que ele digita é CONTEÚDO, não HTML.
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
