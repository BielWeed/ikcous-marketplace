import { cepEhLocal } from "@/lib/cep-local";
import { lerEnderecoConferido } from "@/lib/endereco-da-loja";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import type { View } from "@/types";

/**
 * Lista "sua loja está pronta para vender?" do Início, como função PURA:
 * recebe os fatos já lidos (config, produtos, flags de build) e devolve os
 * SEIS passos do painel simples (spec §8) com o estado de cada um. Sem hook,
 * sem `import.meta.env`, sem React — o cartão só desenha o que esta função
 * decide, e o "Falta preencher" de Minha loja e o subtítulo dos grupos de
 * Ajustes leem os mesmos exports.
 */

export type EstadoDoItem = "carregando" | "feito" | "pendente";

/** CEP completo: oito dígitos, com ou sem o hífen após o quinto. */
function cepCompleto(cep: string | null | undefined): boolean {
  return /^\d{5}-?\d{3}$/.test(cep?.trim() ?? "");
}

/**
 * O fato "entrega" do Início, calculado SÓ com o que já está na config da loja
 * (nenhuma chamada de rede: a régua completa, com transportadoras ligadas e
 * credenciais, é `status-da-entrega` e mora no Frete).
 *
 * Sem CEP completo a loja não entrega nada — entrega local, retirada e
 * transportadora partem do CEP da loja — e o passo fica pendente. Com CEP, a
 * entrega própria na cidade já funciona (não há interruptor dela, só a taxa; a
 * taxa 0 é "grátis na cidade"), que é exatamente o que a faixa do Frete diz em
 * "Na sua cidade". Enquanto a config carrega, "não sei".
 *
 * Com CEP, o passo ainda precisa do ALCANCE: o mesmo aviso amarelo que a tela
 * de Frete mostra (`avisoDaFaixaDeCep`) deixa o passo pendente — CEP de rua com
 * "Alcance por CEP" vazio só entrega para os mesmos 5 primeiros números do CEP
 * (um pedaço de bairro), e cliente de outro bairro, sem conta, vai embora.
 * É a MESMA função, nunca uma cópia da regra, para o cartão e a tela de Frete
 * não divergirem. O caso que continua "pronto" é o CEP geral de cidade pequena
 * (termina em "000"): ali o aviso é calado de propósito, e este passo só segue.
 */
export function estadoDaEntrega(
  config: {
    readonly originCep?: string | null;
    readonly localCepRange?: string | null;
  },
  configCarregando: boolean,
): EstadoDoItem {
  if (configCarregando) return "carregando";
  if (!cepCompleto(config.originCep)) return "pendente";
  return entregaComAlcanceCurto(config) ? "pendente" : "feito";
}

/**
 * Há CEP completo e o "Alcance por CEP" não dá conta (curto demais, ou escrito
 * num formato que o servidor não entende)? É o aviso da tela de Frete virado em
 * sim/não — o motivo que distingue "falta o alcance" de "falta o CEP" no texto
 * do passo (cartão do Início e subtítulo de Ajustes).
 */
export function entregaComAlcanceCurto(config: {
  readonly originCep?: string | null;
  readonly localCepRange?: string | null;
}): boolean {
  return cepCompleto(config.originCep) && avisoDaFaixaDeCep(config) !== null;
}

/**
 * Os 5 primeiros números do CEP da loja, ou `null` sem CEP completo.
 *
 * É a regra REAL da "faixa de CEP" vazia: o servidor (`is_local_cep` no banco,
 * edge calculate-shipping e `cepEhLocal` na tela) só compara os 5 primeiros
 * números do CEP da cliente com os do CEP da loja. Nunca foi "a cidade inteira".
 */
export function prefixoDoCepDaLoja(
  cep: string | null | undefined,
): string | null {
  return cepCompleto(cep) ? (cep as string).trim().slice(0, 5) : null;
}

/** A dica do campo "Alcance por CEP" quando a faixa está vazia. */
export function dicaDaFaixaVazia(cepDaLoja: string | null | undefined): string {
  const prefixo = prefixoDoCepDaLoja(cepDaLoja);
  return prefixo
    ? `Vazio = só CEPs que começam com ${prefixo}`
    : "Vazio = só CEPs que começam com os mesmos 5 números do CEP da loja";
}

/**
 * Aviso (nunca bloqueio) de faixa escrita num formato que o servidor não
 * entende. O campo é texto livre, mas a regra (`is_local_cep`, edge e
 * `cepEhLocal`) só lê dois CEPs completos separados por vírgula: quem escreve
 * "38500-000 a 38509-999" via "salvo" e ficava sem entrega local, em silêncio.
 *
 * O teste é o próprio `cepEhLocal`: se nem o CEP da loja cai na faixa, a faixa
 * não está sendo entendida (ou ficou velha depois de trocar o endereço). É só
 * aviso — uma faixa legítima pode deixar o CEP da loja de fora.
 */
function avisoDaFaixaNaoEntendida(
  originCep: string | null | undefined,
  faixa: string,
): string | null {
  if (!cepCompleto(originCep)) return null;
  const cepDaLoja = (originCep as string).trim();
  if (cepEhLocal(cepDaLoja, cepDaLoja, faixa)) return null;
  return "O alcance que você escreveu não está sendo entendido: nem o CEP da sua loja entra. Escreva dois CEPs separados por vírgula, assim: 38500-000, 38509-999";
}

/**
 * Aviso (nunca bloqueio) sobre o "Alcance por CEP".
 *
 * Faixa PREENCHIDA: avisa se o servidor não a entende (nem o CEP da loja
 * entra) — ver `avisoDaFaixaNaoEntendida`.
 *
 * Faixa VAZIA: avisa entrega local curta demais quando o CEP da loja tem cara
 * de CEP de rua. Heurística: CEP geral de cidade pequena termina em "000"
 * (Monte Carmelo, 38500-000 — um CEP só para a cidade, e os 5 primeiros
 * números bastam). CEP que NÃO termina em "000" é de rua, e a cidade
 * provavelmente tem vários prefixos (Uberlândia, 38400 a 38415): a cliente de
 * outro bairro seria tratada como "de fora". Devolve o texto para a lojista,
 * ou `null`.
 */
export function avisoDaFaixaDeCep(config: {
  readonly originCep?: string | null;
  readonly localCepRange?: string | null;
}): string | null {
  const faixa = (config.localCepRange ?? "").trim();
  if (faixa !== "") return avisoDaFaixaNaoEntendida(config.originCep, faixa);
  const prefixo = prefixoDoCepDaLoja(config.originCep);
  if (prefixo === null) return null;
  const cepLimpo = (config.originCep as string).replace(/\D/g, "");
  if (cepLimpo.endsWith("000")) return null;
  return `Sua entrega local só vale para CEPs que começam com ${prefixo}. Se sua cidade tem vários CEPs, preencha a faixa de CEP`;
}

// ── Os SEIS passos do painel simples (spec §8) ──────────────────────────────
//
// O horário de atendimento é opcional e fica FORA da contagem.

export type ChaveDosSeisPassos =
  | "marca"
  | "endereco"
  | "whatsapp"
  | "recebe"
  | "entrega"
  | "produto";

export interface PassoDaLoja {
  readonly chave: ChaveDosSeisPassos;
  /** Nome curto do passo — o "Falta preencher: …" e o subtítulo dos grupos. */
  readonly rotulo: string;
  readonly rotuloFeito: string;
  /** Ação no imperativo — é o texto do botão "Próximo passo: …". */
  readonly rotuloPendente: string;
  readonly estado: EstadoDoItem;
  readonly destino: View;
  /**
   * Uma frase para a lojista, só quando o passo está pendente e o motivo
   * merece mais que o botão (hoje: "entrega" com alcance curto). Ausente =
   * o rótulo basta.
   */
  readonly explicacaoPendente?: string;
}

/** Só o que os seis passos leem da config da loja. */
export interface ConfigDosSeisPassos {
  readonly storeName?: string | null;
  readonly logoUrl?: string | null;
  readonly originCep?: string | null;
  readonly storeAddress?: string | null;
  readonly whatsappNumber?: string | null;
  /** O aviso da faixa de CEP (`avisoDaFaixaDeCep`) e o passo "entrega" leem. */
  readonly localCepRange?: string | null;
}

/** Os fatos que NÃO vêm da config. */
export interface FatosDosSeisPassos {
  /** PIX online pronto: flag de build ligada E chave pública no deploy. */
  readonly pixOk: boolean;
  /** `config.formasPagamentoEntrega`. */
  readonly formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  readonly produtos: readonly { readonly isActive: boolean }[];
  readonly configCarregando: boolean;
  readonly produtosCarregando: boolean;
  /**
   * "Como você entrega" chega como FATO pronto. Por decisão, o passo é só a
   * parte barata da entrega — o CEP completo da loja e o alcance que cobre a
   * cidade —, calculada por
   * `estadoDaEntrega` (acima). Quem chama (Início, Ajustes) DEVE usá-la em vez
   * de calcular a própria régua, para as duas telas nunca divergirem. O
   * detalhe de transportadora (credenciais, provedores ligados) fica no texto
   * de `statusDaEntrega`, na tela do Frete, e não neste passo.
   */
  readonly entrega: EstadoDoItem;
}

export interface EntradaDosSeisPassos {
  readonly estados: Readonly<Record<ChaveDosSeisPassos, EstadoDoItem>>;
  /** Só para o texto do "recebe": não diz "PIX" de quem só recebe na entrega. */
  readonly pixOk: boolean;
  /**
   * A entrega está pendente porque o ALCANCE é curto (há CEP, mas o aviso da
   * tela de Frete dispara) — e não porque falta o CEP. Só muda o texto do
   * passo "entrega"; ausente = falta o CEP (o texto de antes).
   */
  readonly entregaAlcanceCurto?: boolean;
}

function textoPreenchido(texto: string | null | undefined): boolean {
  return (texto ?? "").trim() !== "";
}

/** Do config e dos fatos ao estado de cada um dos seis passos. */
export function entradaDosSeisPassos(
  config: ConfigDosSeisPassos,
  fatos: FatosDosSeisPassos,
): EntradaDosSeisPassos {
  const { pixOk, formasNaEntrega, produtos, configCarregando } = fatos;
  const daConfig = (pronto: boolean): EstadoDoItem =>
    configCarregando ? "carregando" : pronto ? "feito" : "pendente";

  // "Como você recebe": PIX pronto OU alguma forma na entrega. O PIX vem de
  // constantes de build, então com PIX ok o passo está `feito` na hora, mesmo
  // com a config carregando; sem PIX a resposta depende das formas — e antes
  // de a config chegar elas são o PADRÃO do app, não a escolha da loja.
  const recebe: EstadoDoItem = pixOk
    ? "feito"
    : daConfig(formasNaEntrega.length > 0);

  // Endereço = CEP + número: o texto precisa ser o do formato novo E o CEP
  // dele ser o CEP da loja. Só o CEP (loja de antes) ou texto livre antigo
  // ficam pendentes — a tela pede "Confirme pelo CEP".
  const enderecoPronto =
    lerEnderecoConferido(config.storeAddress, config.originCep) !== null;

  return {
    pixOk,
    // `estados.entrega` é o fato que quem chama entregou (`estadoDaEntrega`);
    // aqui só se descobre, com a MESMA função do aviso, QUAL é a pendência.
    entregaAlcanceCurto:
      fatos.entrega === "pendente" && entregaComAlcanceCurto(config),
    estados: {
      marca: daConfig(
        textoPreenchido(config.storeName) && textoPreenchido(config.logoUrl),
      ),
      endereco: daConfig(enderecoPronto),
      whatsapp: daConfig(lojaTemWhatsapp(config.whatsappNumber)),
      recebe,
      entrega: fatos.entrega,
      // `.some(isActive)`, nunca `produtos.length`: o cofre do admin também
      // guarda produto desativado (realtimeSyncEngine.ts seleciona `ativo` e só
      // filtra `deleted_at`).
      //
      // Limitação conhecida (achado do laudo de 08/09/2026, fora desta frente):
      // `produtos` vem de `useStore().products`, que o `StoreContext` busca
      // truncado em, no máximo, 200 itens (ordenados por data_cadastro DESC),
      // sem sinal de truncamento hoje. Numa loja com 200+ produtos em que os 200
      // mais recentes estejam todos inativos e exista um ativo mais antigo fora
      // da janela, este item mostraria falso "pendente". O conserto correto
      // depende do StoreContext expor esse sinal — reservado por outra frente.
      produto: fatos.produtosCarregando
        ? "carregando"
        : produtos.some((produto) => produto.isActive)
          ? "feito"
          : "pendente",
    },
  };
}

/** Os seis passos, na ordem em que a lojista os faz. */
export function seisPassosDaLojaPronta(
  entrada: EntradaDosSeisPassos,
): readonly PassoDaLoja[] {
  const { estados, pixOk, entregaAlcanceCurto = false } = entrada;
  return [
    {
      chave: "marca",
      rotulo: "Nome e logo",
      rotuloFeito: "Nome e logo da loja preenchidos",
      rotuloPendente: "Cadastrar nome e logo da loja",
      estado: estados.marca,
      destino: "admin-about-store",
    },
    {
      chave: "endereco",
      rotulo: "Endereço",
      rotuloFeito: "Endereço da loja preenchido (CEP e número)",
      rotuloPendente: "Cadastrar o endereço da loja (CEP e número)",
      estado: estados.endereco,
      destino: "admin-about-store",
    },
    {
      chave: "whatsapp",
      rotulo: "WhatsApp",
      rotuloFeito: "WhatsApp da loja cadastrado",
      rotuloPendente: "Cadastrar WhatsApp",
      estado: estados.whatsapp,
      destino: "admin-about-store",
    },
    {
      chave: "recebe",
      rotulo: "Como você recebe",
      rotuloFeito: pixOk
        ? "Pagamento PIX configurado"
        : "Pagamento na entrega configurado",
      rotuloPendente: "Configurar como você recebe",
      estado: estados.recebe,
      destino: "admin-settings",
    },
    {
      chave: "entrega",
      rotulo: "Como você entrega",
      rotuloFeito: "Entrega configurada",
      // Com CEP mas alcance curto, o que falta não é "configurar a entrega":
      // é ampliar até onde ela vale (a tela de Frete, no "Alcance por CEP").
      rotuloPendente: entregaAlcanceCurto
        ? "Ampliar o alcance da entrega"
        : "Configurar a entrega",
      ...(entregaAlcanceCurto && {
        explicacaoPendente:
          "Clientes de outros bairros podem não conseguir comprar.",
      }),
      estado: estados.entrega,
      destino: "admin-shipping",
    },
    {
      chave: "produto",
      rotulo: "Primeiro produto",
      rotuloFeito: "Pelo menos 1 produto ativo à venda",
      rotuloPendente: "Cadastrar um produto ativo",
      estado: estados.produto,
      destino: "admin-products",
    },
  ];
}

/**
 * O primeiro passo PENDENTE, ou `null` com tudo pronto. Passo `carregando`
 * não é pendência (ainda não se sabe) e não vira "próximo passo".
 */
export function proximoPasso(
  passos: readonly PassoDaLoja[],
): PassoDaLoja | null {
  return passos.find((passo) => passo.estado === "pendente") ?? null;
}

/** "4 de 6 prontos": `carregando` não conta como pronto. */
export function contagemDosPassos(passos: readonly PassoDaLoja[]): {
  readonly feitos: number;
  readonly total: 6;
} {
  return {
    feitos: passos.filter((passo) => passo.estado === "feito").length,
    total: 6,
  };
}
