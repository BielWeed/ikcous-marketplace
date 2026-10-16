import { DIAS_DA_ENTREGA_PROPRIA_PADRAO } from "@/lib/guarda-de-frete";
import type { StoreConfig } from "@/types";

// DONO ÚNICO da regra de cor da loja (defeito do b531ca9 apontado na revisão
// 20260825-1015). Vive em módulo próprio — não no StoreContext — para que
// quem precisa da regra (o efeito de --primary do StoreContext e o meta
// theme-color do App.tsx) importe sem depender do contexto, e testes que
// dublam o contexto não quebrem por causa dela (medido: mock do StoreContext
// derrubava o App quando a regra morava lá).
//
// CONTRATO: sentinela de "sem valor" é AUSÊNCIA, nunca uma cor válida.
// `primaryColor` não tem reserva no default (mesmo tratamento do originCep):
// ausente = o banco ainda não disse nada (inclusive quando o fetch FALHOU,
// isLoaded=true no finally com a config intacta), e quem consome fica com a
// semente do build — no --primary e no meta theme-color.
//
// SOBRE #000000 — guarda temporária com condição de saída escrita (revisão
// 20260825-1305 + migration 20260980000000): enquanto NÃO existir tela de
// escrever cor no app, um `#000000` no banco só pode ser (a) resíduo da
// fábrica antiga (DEFAULT da coluna + COALESCE da RPC, que a migration
// desliga e limpa) num banco onde ela ainda não rodou, ou (b) escrita
// manual no editor SQL. Nenhum dos dois é escolha de marca — nenhum lojista
// consegue escolher preto pelo app hoje. A janela entre código novo
// deployado e migration aplicada ao banco deixaria a fábrica viva mostrando
// preto como marca; esta guarda fecha a janela no lado do app.
// **SAÍDA DA GUARDA:** no dia em que a tela de escrever cor existir (pedido
// 004, item de escrita), esta comparação sai — e #000000 passa a significar
// preto escolhido, porque alguém poderá tê-lo escolhido.
export const defaultStoreConfig: StoreConfig = {
  freeShippingMin: 350,
  shippingFee: 15,
  // whatsappNumber NÃO tem reserva de propósito (mesmo molde do businessHours
  // abaixo). Valia "34999999999" — nove noves — e esse literal viajou do
  // fallback de leitura para o banco de toda loja nova: a vitrine mostrava um
  // botão de WhatsApp apontando para um número que não existe (laudo
  // caça-bugs 30/08 + migration 20261033000000). Sem valor = a loja não
  // disse; o botão só nasce quando a lojista configurar o dela.
  whatsappNumber: "",
  shareText: "Olha que achei na IKCOUS!",
  // businessHours NÃO tem reserva de propósito (mesmo molde da sentinela de
  // cor da linha de baixo, e do originCep). Valia "Seg-Sáb: 9h às 18h", e
  // isso fazia a vitrine publicar um expediente que ninguém digitou (item 6
  // do laudo de 29/08 + migration 20261029000000, que matou o default no
  // banco). Sem valor = a loja não disse.
  businessHours: "",
  enableReviews: true,
  enableCoupons: true,
  // primaryColor NÃO tem reserva de propósito (como o originCep abaixo).
  // Valia "#000000", e isso fazia duas coisas ruins ao mesmo tempo: o app
  // gravava preto no banco de toda loja que inicializava, calado, e a regra
  // ignorava lojista que escolhesse preto de propósito. Sem valor = a loja
  // não disse; preto = preto.
  themeMode: "light",
  realTimeSalesAlerts: true,
  pushMarketingEnabled: false,
  // originCep NÃO tem reserva de propósito. Ele valia "38500-000", e isso fazia
  // toda loja que nunca informou de onde despacha calcular frete a partir de
  // Monte Carmelo, calada. Sem valor = a loja não disse, e quem consome trata isso.
  shippingProvider: "flat_fee",
  enabledShippingMethods: ["sedex", "pac"],
  shippingCoverage: "national",
  localDeliveryFee: 10,
  // "Como entrego na minha cidade" (16/10/2026): o PADRÃO é o que toda loja
  // já era — entrega própria ligada, 1 dia. Fica aqui (e não só no fallback
  // do `mapConfig`) para o estado inicial, o cache antigo do cofre e a
  // leitura do banco concordarem: sem isso, o primeiro `fetchConfig` depois
  // do deploy enxerga "config mudou" onde nada mudou e grava o cofre à toa.
  localDeliveryEnabled: true,
  localDeliveryDays: DIAS_DA_ENTREGA_PROPRIA_PADRAO,
  localCepRange: "",
  // Estratégias de frete nacional (migration 20261171000000): loja nova
  // nasce DESLIGADA -- mesma decisão (D2/M2) de "sem regra até a lojista
  // escolher" que já vale para o preset local (freeShippingMin=0 no
  // configInicial do StoreContext). `mais_barata` é o DEFAULT da coluna
  // (`national_benefit_scope`), sem efeito enquanto a estratégia está
  // desligada.
  nationalShippingStrategy: "desligado",
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata",
  homeSections: [
    { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
    { id: "offers", title: "Ofertas Imperdíveis", active: true },
    { id: "bestsellers", title: "Destaques em Alta", active: true },
  ],
  // Formas de pagamento por loja (migration 20261174000000): loja nova
  // nasce com as três ligadas — MESMO default da coluna no banco
  // (`ARRAY['pix','card','cash']`). Nenhuma loja muda de comportamento
  // sozinha.
  formasPagamentoEntrega: ["pix", "card", "cash"],
};

// Devolve a cor da loja quando ela EXISTE, senão `null` (quem consome fica
// com a semente do build). Tolerante a `config` nula: consumidor de contexto
// dublado pode entregar null, e a resposta certa continua sendo "semente".
// Único juiz de "tem cor ou não tem" — nenhum caminho aplica valor cru por
// fora daqui (quatro atalhos faziam isso; revisão 20260825, msg #25).
export function corPrimariaEfetiva(config: StoreConfig | null): string | null {
  if (!config?.primaryColor) return null;
  if (config.primaryColor === "#000000") return null;
  // Guarda temporária — ver bloco "SOBRE #000000" acima para a condição
  // de saída. Enquanto não existe tela de escrever cor, preto no banco é
  // resíduo de fábrica ou escrita manual: mostra a semente do build.
  return config.primaryColor;
}

// ── A TELA DE ESCREVER COR EXISTE (02/09/2026, pedido 004) ──
// AdminSettingsView passa a ter seção "Cor da loja" que grava pelo
// updateConfig — e a escrita passa por AQUI, ao lado da regra de leitura,
// para que as duas mãos fiquem no mesmo arquivo (fonte única da regra de
// cor; lição #53).
//
// POR QUE A GUARDA DA LEITURA NÃO SAIU com a chegada da tela: a tela
// RECUSA #000000 (motivo "preto", abaixo). Se ninguém consegue gravar
// preto pelo app, a invariante que sustentava a guarda continua de pé —
// preto no banco segue sendo resíduo de fábrica ou escrita manual no
// editor SQL, nunca escolha de lojista — e a guarda continua fechando a
// janela "código novo deployado, migration 20260980000000 ainda não
// rodou no banco". A condição de saída REAL passou a ser: o dia em que
// esta validação parar de recusar preto, a comparação da leitura sai e
// o teste (e) de cor-da-loja-vem-do-banco.test.tsx inverte de propósito.
//
// Normalização para MINÚSCULAS é parte do contrato: a comparação da
// guarda da leitura é exata (===), então "#000000" com caixa variada
// precisaria passar pela validação para nunca alcançar o banco. O
// input type="color" do navegador já devolve minúsculas — esta função
// é quem garante o mesmo canônico para o que vier do campo de texto.
export type ResultadoValidacaoCor =
  | { ok: true; cor: string }
  | { ok: false; motivo: "formato" | "preto" };

export function validaCorDaLoja(valor: string): ResultadoValidacaoCor {
  const cor = valor.trim().toLowerCase();
  // Formato: # seguido de EXATAMENTE seis dígitos hexadecimais (#RRGGBB).
  // Curto (#abc) e longo (#RRGGBBAA) ficam de fora de propósito — o valor
  // gravado tem de ser o mesmo canônico que a leitura e o meta esperam.
  if (!/^#[0-9a-f]{6}$/.test(cor)) {
    return { ok: false, motivo: "formato" };
  }
  if (cor === "#000000") {
    return { ok: false, motivo: "preto" };
  }
  return { ok: true, cor };
}

// ── O TEXTO QUE FICA SOBRE A COR DA LOJA ──
// A validação acima NÃO proíbe cor clara (amarelo, rosa claro, dourado são
// escolhas legítimas). Em compensação, o texto sobre `bg-primary` não pode
// ser sempre branco: em cor clara o botão principal da compra ficava quase
// sem texto legível. `--primary-foreground` passa a sair do contraste WCAG.
//
// Os dois tokens são os que o index.css já usa (--primary-foreground do tema
// claro e do escuro), em HSL do Tailwind. Os hexadecimais abaixo são os
// MESMOS dois tons, só para a conta de contraste.
export const TEXTO_CLARO_SOBRE_A_COR_DA_LOJA = "0 0% 98%";
export const TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA = "240 5.9% 10%";
const HEX_DO_TEXTO_CLARO = "#fafafa";
const HEX_DO_TEXTO_ESCURO = "#18181b";
// WCAG 2.x, texto normal: o mínimo de contraste para ser legível.
const CONTRASTE_MINIMO_DO_TEXTO = 4.5;

// Luminância relativa do WCAG. Valor que não é #RGB/#RRGGBB cai em preto —
// o mesmo que `hexToTailwindHsl` já faz com cor inválida ("0 0% 0%").
function luminanciaRelativa(hex: string): number {
  let limpo = hex.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(limpo)) {
    limpo = `${limpo[0]}${limpo[0]}${limpo[1]}${limpo[1]}${limpo[2]}${limpo[2]}`;
  }
  if (!/^[0-9a-f]{6}$/.test(limpo)) return 0;
  const canal = (inicio: number): number => {
    const c = Number.parseInt(limpo.slice(inicio, inicio + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

export function razaoDeContraste(corA: string, corB: string): number {
  const a = luminanciaRelativa(corA);
  const b = luminanciaRelativa(corB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Devolve o token HSL (formato Tailwind) do texto que fica sobre `corDaLoja`:
// o branco de sempre quando ele chega a 4,5:1 — por isso toda loja de cor
// escura fica idêntica —, senão o escuro. Na faixa do meio, onde nenhum dos
// dois chega a 4,5:1, vence o de maior contraste.
export function textoSobreACorDaLoja(corDaLoja: string): string {
  const contrasteDoClaro = razaoDeContraste(HEX_DO_TEXTO_CLARO, corDaLoja);
  if (contrasteDoClaro >= CONTRASTE_MINIMO_DO_TEXTO) {
    return TEXTO_CLARO_SOBRE_A_COR_DA_LOJA;
  }
  const contrasteDoEscuro = razaoDeContraste(HEX_DO_TEXTO_ESCURO, corDaLoja);
  return contrasteDoClaro >= contrasteDoEscuro
    ? TEXTO_CLARO_SOBRE_A_COR_DA_LOJA
    : TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA;
}
