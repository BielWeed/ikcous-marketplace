// O escurecimento (scrim) atrás do texto do banner mora AQUI, numa fonte
// única, porque dois lugares desenham o mesmo banner: a vitrine
// (`BannerCarousel.tsx`) e a prévia do painel (`ImageAdjuster.tsx`). Regra
// copiada em dois lugares já divergiu neste projeto antes ("prepara com uma
// etiqueta e pede com outra") — aqui os dois importam a MESMA função, e
// quem mudar o gradiente muda os dois de uma vez.
//
// Por que existe, além do overlay do lojista (0-100%): overlay a 40% sobre
// imagem clara ainda dá contraste baixo demais para texto branco, e um piso
// numérico no slider trocaria o significado do número que o lojista
// escolheu (decisão de produto, fora desta frente). A garantia é LOCAL —
// um gradiente atrás do bloco de texto, que soma ao overlay em vez de
// substituí-lo.

export function classeDoScrimDoBanner(templateType?: string | null): string {
  if (templateType === "glassmorphic") {
    // Já tem `bg-black/40 backdrop-blur-md` na própria caixa do texto —
    // duplicar aqui escureceria demais.
    return "";
  }

  if (templateType === "split_center") {
    // Texto centralizado vertical e horizontalmente: o escurecimento
    // acompanha o centro, não o rodapé.
    return "bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.45)_45%,rgba(0,0,0,0)_80%)]";
  }

  // default, split_left, split_right, neon_glow, undefined, null: o texto
  // fica embaixo (`justify-end`) — o escurecimento acompanha o rodapé.
  return "bg-gradient-to-t from-black/75 via-black/45 to-transparent";
}
