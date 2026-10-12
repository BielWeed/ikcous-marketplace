// Modelos de mensagem de compartilhar um produto (Minha loja › Contato) e as
// funções puras que ligam o texto ao editor. Extraídos da antiga tela
// "Atendimento" (painel simples, D9) sem mudar o comportamento; o que mudou é
// só o visual dos marcadores: texto de 11px no mínimo (régua visual do painel).

export type TipoDeMarcador = "nome" | "preco" | "link";

export interface ModeloDeMensagem {
  readonly name: string;
  readonly text: string;
  readonly description: string;
}

export const PRESETS: readonly ModeloDeMensagem[] = [
  {
    name: "Clássico",
    text: "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]",
    description: "Ideal para compartilhamento simples e direto.",
  },
  {
    name: "Oferta Quente",
    text: "🔥 Oportunidade Única! Adquira o [nome] por apenas [preco] na nossa loja. Clique no link para comprar agora: [link] 🛍️",
    description: "Excelente para conversão e promoções de escassez.",
  },
  {
    name: "Últimas Unidades",
    text: "⚠️ ATENÇÃO: Últimas unidades de [nome] em estoque por [preco]! Não perca a chance: [link]",
    description: "Cria senso de urgência baseado em escassez de estoque.",
  },
  {
    name: "Desconto Especial",
    text: "🎉 Conseguimos um preço especial para você! [nome] por apenas [preco]. Garanta o seu: [link]",
    description: "Enfoque em preço reduzido e benefício financeiro.",
  },
  {
    name: "Recomendação",
    text: "Olha o que eu acabei de encontrar! [nome] por apenas [preco]. Achei a sua cara: [link]",
    description: "Ideal para compartilhamento entre amigos.",
  },
  {
    name: "Preço Baixou",
    text: "🚨 CORRE! O preço do [nome] baixou para [preco]. Clique no link e aproveite antes que suba de novo: [link]",
    description: "Destaque na queda do preço com tom de pressa.",
  },
  {
    name: "Mais Vendido",
    text: "⭐ O queridinho da loja! Veja por que todos estão amando o [nome] por apenas [preco]: [link]",
    description: "Utiliza prova social para incentivar a compra.",
  },
  {
    name: "Elegante",
    text: "✨ Sofisticação e qualidade: conheça o [nome]. Disponível por [preco]. Visite nosso site: [link]",
    description: "Tom refinado e sofisticado para produtos premium.",
  },
  {
    name: "Novidade",
    text: "🆕 Acabou de chegar! Seja um dos primeiros a garantir o [nome] por [preco]: [link]",
    description: "Desperta curiosidade de novidade e exclusividade.",
  },
  {
    name: "Presente Perfeito",
    text: "🎁 Procurando o presente ideal? Encontrei o [nome] por apenas [preco]! Dá uma olhada: [link]",
    description: "Sugestão focada em datas comemorativas e presentes.",
  },
  {
    name: "Economia Garantida",
    text: "💰 Economize de verdade! [nome] com preço imbatível de [preco] só hoje: [link]",
    description: "Foco claro na economia do comprador.",
  },
  {
    name: "Curto/Direto",
    text: "[nome] por apenas [preco]. Acesse: [link]",
    description: "Cópia ultra-minimalista sem distrações.",
  },
  {
    name: "Status de Luxo",
    text: "👑 Eleve seu estilo com o [nome] por apenas [preco]. Estoque limitado: [link]",
    description: "Posicionamento focado em status e valor de marca.",
  },
  {
    name: "Indicação Amigável",
    text: "Olá! Lembrei de você na hora quando vi o [nome] por [preco]. Olha que legal: [link]",
    description: "Tom altamente pessoal e carinhoso.",
  },
  {
    name: "Segurança total",
    text: "🔒 Compra 100% garantida! Adquira o seu [nome] por apenas [preco]: [link]",
    description: "Ideal para construir confiança no processo de compra.",
  },
  {
    name: "Sensação do momento",
    text: "💥 BOMBOU! O produto [nome] está disponível por apenas [preco]. Clique rápido e garanta o seu: [link]",
    description: "Cópia enérgica e focada em tendências.",
  },
  {
    name: "Edição Limitada",
    text: "💎 Raro e exclusivo: [nome] por [preco]. Pouquíssimas unidades disponíveis: [link]",
    description: "Tom exclusivo e focado em edições de colecionador.",
  },
  {
    name: "Tendência",
    text: "🌟 Tendência do momento! [nome] por apenas [preco] na nossa loja. Veja mais no link: [link]",
    description: "Posicionamento de produto em alta nas redes sociais.",
  },
  {
    name: "Solução Fácil",
    text: "Facilite seu dia a dia com o [nome] por apenas [preco]! Confira os benefícios: [link]",
    description: "Enfoque em utilidade e resolução de problemas.",
  },
  {
    name: "VIP",
    text: "Acesso VIP liberado! Adquira o [nome] por [preco] em primeira mão: [link]",
    description: "Sensação de privilégio para clientes fiéis.",
  },
  {
    name: "Compartilhe",
    text: "Compartilhe com quem você gosta! [nome] está por apenas [preco]: [link]",
    description: "Incentiva o compartilhamento orgânico.",
  },
  {
    name: "Última Chance",
    text: "⏰ Última chance de garantir o [nome] pelo preço promocional de [preco]. Clique agora: [link]",
    description: "Gera urgência extrema pelo fim da promoção.",
  },
  {
    name: "Segredo Revelado",
    text: "🤫 O segredo dos especialistas! Descubra o [nome] por apenas [preco]: [link]",
    description: "Copy intrigante e focada em curiosidade.",
  },
  {
    name: "Foco em Benefício",
    text: "💡 Menos esforço, mais resultados com [nome] por [preco]. Compre já: [link]",
    description: "Venda baseada em valor agregado e usabilidade.",
  },
  {
    name: "Ideal para Você",
    text: "🎯 Encontramos o que você precisava! [nome] por apenas [preco]. Clique aqui: [link]",
    description: "Posicionamento personalizado e direto.",
  },
  {
    name: "Estoque Renovado",
    text: "🔄 ESTOQUE RENOVADO! O queridinho [nome] voltou por apenas [preco]. Garanta o seu antes que esgote: [link]",
    description: "Gera apelo de reposição de produto de alta procura.",
  },
  {
    name: "Sem Enrolação",
    text: "Sem rodeios: [nome] disponível por [preco]. Veja fotos e detalhes: [link]",
    description: "Ideal para compradores pragmáticos.",
  },
  {
    name: "Garantia de Satisfação",
    text: "Satisfação garantida ou seu dinheiro de volta! Peça o [nome] por [preco]: [link]",
    description: "Quebra de objeção clássica de garantia.",
  },
  {
    name: "Clube de Vantagens",
    text: "Entrou em oferta no nosso clube! [nome] por apenas [preco]: [link]",
    description: "Sensação de comunidade de vantagens.",
  },
  {
    name: "Recomendação Premium",
    text: "🏆 Escolha número 1 da categoria! [nome] por [preco]. Veja e comprove: [link]",
    description: "Apelo à liderança de mercado do produto.",
  },
];

const BASE_DO_MARCADOR =
  "inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md border text-[11px] font-bold select-none cursor-default";

const MARCADORES: Record<
  TipoDeMarcador,
  { readonly cores: string; readonly rotulo: string }
> = {
  nome: {
    cores: "bg-admin-gold/20 text-admin-gold border-admin-gold/30",
    rotulo: "🏷️ Nome do Produto",
  },
  preco: {
    cores: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rotulo: "💰 Preço",
  },
  link: {
    cores: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    rotulo: "🔗 Link",
  },
};

/** O chip (HTML) de um marcador: o editor guarda `[nome]` como este span. */
export function htmlDoMarcador(tipo: TipoDeMarcador): string {
  // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada de usuário
  const { cores, rotulo } = MARCADORES[tipo];
  return `<span class="${BASE_DO_MARCADOR} ${cores}" data-tag="${tipo}" contenteditable="false">${rotulo}</span>`;
}

/** Texto salvo (com `[nome]`, `[preco]`, `[link]`) → HTML do editor. */
export function textoParaHtml(texto: string): string {
  if (!texto) return "";
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")
    .replace(/\[nome\]/g, htmlDoMarcador("nome"))
    .replace(/\[preco\]/g, htmlDoMarcador("preco"))
    .replace(/\[link\]/g, htmlDoMarcador("link"));
}

/** HTML do editor → texto salvo (o inverso exato de `textoParaHtml`). */
export function htmlParaTexto(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const marcador of doc.querySelectorAll("span[data-tag]")) {
    const tag = marcador.getAttribute("data-tag");
    marcador.replaceWith(doc.createTextNode(`[${tag}]`));
  }
  for (const quebra of doc.querySelectorAll("br")) {
    quebra.replaceWith(doc.createTextNode("\n"));
  }

  return doc.body.textContent || "";
}

/** O texto com os marcadores trocados por um produto de exemplo (a prévia). */
export function textoDaPrevia(
  texto: string,
  exemplo: { name: string; price: number; id?: string },
): string {
  if (!texto) return "Confira os produtos!";

  const preco = exemplo.price.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const link = `${window.location.origin}/produtos?id=${exemplo.id || "1"}`;

  // Funções no lugar de strings: um nome de produto com "$&" não vira padrão.
  return texto
    .replace(
      /\[nome_produto\]|\{nome_produto\}|\[nome\]|\{nome\}/gi,
      () => exemplo.name,
    )
    .replace(
      /\[preco_produto\]|\{preco_produto\}|\[preco\]|\{preco\}/gi,
      () => preco,
    )
    .replace(
      /\[link_produto\]|\{link_produto\}|\[link\]|\{link\}/gi,
      () => link,
    );
}
