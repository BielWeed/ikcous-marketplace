/**
 * Glossário do painel: termo técnico → termo do lojista (spec "Painel
 * simples", §6). O técnico pode ficar entre parênteses ou em "Avançado"; o que
 * a lojista lê primeiro é o termo dela.
 *
 * Duas serventias:
 * 1. fonte única dos rótulos (as telas importam daqui em vez de repetir texto);
 * 2. alimenta a guarda `tests/front/painel-sem-jargao.test.ts`, que conta por
 *    arquivo os termos `proibido` em `src/views/admin/**` e
 *    `src/components/admin/**` e não deixa a contagem subir.
 *
 * `proibido` é o padrão que a guarda procura. Na maioria respeita a caixa, de
 * propósito: "Reviews" é rótulo de tela, `reviews` é nome de variável; só
 * Ticket médio, chargeback, Public Key e Access Token ignoram a caixa (não
 * há identificador com esses nomes). `null` = termo só para consulta, genérico
 * demais para varrer o código.
 *
 * Pura: sem hook, sem Supabase.
 */

export interface EntradaDoGlossario {
  /** Como o termo aparece hoje, ou aparecia, na tela. */
  readonly tecnico: string;
  /** Como a lojista o chama. */
  readonly lojista: string;
  /** Padrão que a guarda de jargão conta; `null` = só consulta. */
  readonly proibido: RegExp | null;
}

export const GLOSSARIO_DO_PAINEL: readonly EntradaDoGlossario[] = [
  {
    tecnico: "Dashboard CRM",
    lojista: "Relatórios",
    proibido: /Dashboard CRM/,
  },
  { tecnico: "RFM", lojista: "Grupos de clientes", proibido: /\bRFM\b/ },
  {
    tecnico: "LTV / LTV (Gasto)",
    lojista: "Total já comprado",
    proibido: /\bLTV\b/,
  },
  {
    tecnico: "Ticket médio",
    lojista: "Valor médio por venda",
    proibido: /Ticket m[ée]dio/i,
  },
  {
    tecnico: "Campeões",
    lojista: "Melhores clientes",
    proibido: /Campe[õo]es/,
  },
  { tecnico: "Leais", lojista: "Fiéis", proibido: /\bLeais\b/ },
  { tecnico: "Quase dormindo", lojista: "Sumindo", proibido: /Quase dormindo/ },
  {
    tecnico: "Não pode perder",
    lojista: "Bons clientes sumindo",
    proibido: /Não pode perder/,
  },
  {
    tecnico: "Hibernando",
    lojista: "Parados há muito tempo",
    proibido: /Hibernando/,
  },
  { tecnico: "Em risco", lojista: "Podem não voltar", proibido: /Em risco/ },
  {
    tecnico: "ROI do Estoque",
    lojista: "Retorno do estoque",
    proibido: /ROI do Estoque/,
  },
  {
    tecnico: "Capital Alocado",
    lojista: "Dinheiro parado em estoque",
    proibido: /Capital Alocado/,
  },
  {
    tecnico: "Lucro Potencial",
    lojista: "Lucro se vender tudo",
    proibido: /Lucro Potencial/,
  },
  { tecnico: "Rendimento %", lojista: "Margem %", proibido: /Rendimento %/ },
  { tecnico: "DRE", lojista: "Resultado do mês", proibido: /\bDRE\b/ },
  {
    tecnico: "Competência",
    lojista: "Mês da venda",
    proibido: /Compet[êe]ncia/,
  },
  {
    tecnico: "Margem de contribuição",
    lojista: "Sobra depois dos custos da venda",
    proibido: /Margem de contribui[çc][ãa]o/,
  },
  { tecnico: "SKU", lojista: "Código interno", proibido: /\bSKU\b/ },
  {
    tecnico: "EAN / UPC / GTIN",
    lojista: "Código de barras",
    proibido: /\b(?:EAN|UPC|GTIN)\b/,
  },
  {
    tecnico: "Efetivar Variante",
    lojista: "Salvar variação",
    proibido: /Efetivar Variante/,
  },
  {
    tecnico: "Salvar Protocolo",
    lojista: "Salvar",
    proibido: /Salvar Protocolo/,
  },
  {
    tecnico: "Sobrescrever R$",
    lojista: "Preço diferente nesta variação",
    proibido: /Sobrescrever R\$/,
  },
  {
    tecnico: "Status no Catálogo",
    lojista: "Aparece na loja?",
    proibido: /Status no Cat[áa]logo/,
  },
  { tecnico: "Q&A", lojista: "Perguntas", proibido: /Q&A|Q&amp;A/ },
  { tecnico: "Suporte", lojista: "Perguntas", proibido: null },
  { tecnico: "SAC", lojista: "Perguntas", proibido: /\bSAC\b/ },
  { tecnico: "Reviews", lojista: "Avaliações", proibido: /\bReviews\b/ },
  { tecnico: "Role", lojista: "Tipo de conta", proibido: /\bRole\b/ },
  {
    tecnico: "chargeback",
    lojista: "Contestação no cartão",
    proibido: /chargeback/i,
  },
  {
    tecnico: "Estorno devido",
    lojista: "Devolver ao cliente",
    proibido: /Estorno devido/,
  },
  {
    tecnico: "Public Key",
    lojista: "Chave pública",
    proibido: /Public Key/i,
  },
  {
    tecnico: "Access Token",
    lojista: "Chave secreta (em Avançado)",
    proibido: /Access Token/i,
  },
  {
    tecnico: "Webhooks",
    lojista: "Aviso automático de pagamento",
    proibido: /Webhooks?\b/,
  },
  {
    tecnico: "Chave de notificações",
    lojista: "Senha dos avisos",
    proibido: /Chave de notifica[çc][õo]es/,
  },
  {
    tecnico: "Assinatura secreta",
    lojista: "Senha dos avisos",
    proibido: /Assinatura secreta/,
  },
  { tecnico: "Sandbox", lojista: "Modo de teste", proibido: /Sandbox/ },
  {
    tecnico: "Favicon / Ícone Apple / 192 / 512 / máscara",
    lojista: "Ícones do app (avançado)",
    proibido: /Favicon|[ÍI]cone Apple/,
  },
  {
    tecnico: "CDC art. 49 / 26",
    lojista:
      "Direito de arrependimento (lei: mínimo 7 dias) / Defeito (mínimo 30 dias)",
    proibido: /CDC art/,
  },
  {
    tecnico: "Latência / perda de pacotes / Supabase",
    lojista: "Conexão boa / lenta / sem internet",
    proibido: /Lat[êe]ncia|perda de pacotes|Supabase/,
  },
  {
    tecnico: "/exemplo-pagina, https://wa.me/…, /categoria/calcados",
    lojista:
      "Abrir: produto / categoria / … (caminho manual vai para Avançado)",
    proibido: /\/exemplo-pagina|https:\/\/wa\.me|\/categoria\/calcados/,
  },
  {
    tecnico: "MP_ACCESS_TOKEN / segredos do Supabase / frota",
    lojista: "Falta ativar o pagamento pelo app — fale com o suporte técnico",
    proibido: /MP_ACCESS_TOKEN|\bfrota\b/,
  },
  {
    tecnico: "Banners Promocionais / Gerenciador de Banners",
    lojista: "Banners",
    proibido: /Banners Promocionais|Gerenciador de Banners/,
  },
  {
    tecnico: "Vitrines (Carrosséis) / Vitrines & Carrosséis",
    lojista: "Vitrines",
    proibido: /Vitrines \(Carross[ée]is\)|Vitrines (?:&|&amp;) Carross[ée]is/,
  },
  {
    tecnico: "Engenharia & Cadastro de Produtos",
    lojista: "Como cadastrar um produto",
    proibido: /Engenharia (?:&|&amp;) Cadastro de Produtos/,
  },
  {
    tecnico: "Central de Inteligência & KPIs",
    lojista: "Como ler os relatórios",
    proibido: /Central de Intelig[êe]ncia (?:&|&amp;) KPIs/,
  },
  {
    tecnico: "Conversão Comercial",
    lojista: "(sai: é cartão vazio, não é capacidade)",
    proibido: /Convers[ãa]o Comercial/,
  },
];

/** Padrões que a guarda de jargão conta (as entradas com `proibido`). */
export function padroesProibidosDoPainel(): readonly RegExp[] {
  return GLOSSARIO_DO_PAINEL.flatMap((entrada) =>
    entrada.proibido ? [entrada.proibido] : [],
  );
}

/** Termo do lojista para um termo técnico (comparação exata), ou `null`. */
export function termoDoLojista(tecnico: string): string | null {
  return (
    GLOSSARIO_DO_PAINEL.find((entrada) => entrada.tecnico === tecnico)
      ?.lojista ?? null
  );
}
