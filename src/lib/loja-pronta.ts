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
 */
export function estadoDaEntrega(
  config: { readonly originCep?: string | null },
  configCarregando: boolean,
): EstadoDoItem {
  if (configCarregando) return "carregando";
  return cepCompleto(config.originCep) ? "feito" : "pendente";
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
}

/** Só o que os seis passos leem da config da loja. */
export interface ConfigDosSeisPassos {
  readonly storeName?: string | null;
  readonly logoUrl?: string | null;
  readonly originCep?: string | null;
  readonly storeAddress?: string | null;
  readonly whatsappNumber?: string | null;
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
   * parte barata da entrega — o CEP completo da loja —, calculada por
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
  const { estados, pixOk } = entrada;
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
      rotuloPendente: "Configurar a entrega",
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
