import { lerEnderecoConferido } from "@/lib/endereco-da-loja";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import type { View } from "@/types";

/**
 * Lista "sua loja está pronta para vender?" do Início, como função PURA:
 * recebe os fatos já lidos (config, produtos, flags de build) e devolve os
 * passos com o estado de cada um. Sem hook, sem `import.meta.env`, sem React
 * — o cartão só desenha o que esta função decide.
 *
 * Dois jeitos convivem até o cartão do Início passar para a lista nova (E3):
 *  - `passosDaLojaPronta`: os 3 passos de hoje (recebe, CEP, produto), que o
 *    cartão atual usa. Sai quando o cartão mudar.
 *  - `seisPassosDaLojaPronta` & cia. (mais abaixo): os SEIS passos do painel
 *    simples (spec §8) — marca, endereço, WhatsApp, recebe, entrega, produto.
 *    São exports NOVOS; nada da lista de 3 mudou, salvo o destino do item CEP.
 */

export type EstadoDoItem = "carregando" | "feito" | "pendente";

export type ChaveDoPasso = "recebe" | "cep" | "produto";

export interface ItemDoChecklist {
  readonly chave: ChaveDoPasso;
  /** Nome neutro do passo — usado na linha "Conferindo…", para dizer QUAL
   * item está sendo conferido (leitor de tela não adivinha por posição). */
  readonly rotulo: string;
  readonly rotuloFeito: string;
  readonly rotuloPendente: string;
  readonly estado: EstadoDoItem;
  readonly destino: View;
}

export interface EntradaDaLojaPronta {
  /** `config.originCep` da loja. */
  readonly originCep: string | undefined;
  /** PIX online pronto: flag de build ligada E chave pública no deploy. */
  readonly pixOk: boolean;
  /** `config.formasPagamentoEntrega`: o que a loja aceita receber na entrega. */
  readonly formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  /** Catálogo da loja — só o campo que a lista precisa. */
  readonly produtos: readonly { readonly isActive: boolean }[];
  /** A config da loja (CEP, formas de pagamento) ainda não chegou. */
  readonly configCarregando: boolean;
  /** A lista de produtos ainda não chegou. */
  readonly produtosCarregando: boolean;
}

/** CEP completo: oito dígitos, com ou sem o hífen após o quinto. */
function cepCompleto(cep: string | undefined): boolean {
  return /^\d{5}-?\d{3}$/.test(cep?.trim() ?? "");
}

export function passosDaLojaPronta(
  entrada: EntradaDaLojaPronta,
): ItemDoChecklist[] {
  const {
    originCep,
    pixOk,
    formasNaEntrega,
    produtos,
    configCarregando,
    produtosCarregando,
  } = entrada;

  // "Como você recebe": PIX pronto OU alguma forma na entrega. Uma loja que
  // só recebe na entrega está pronta — antes ela ficava com "Configurar
  // pagamento PIX" pendente para sempre.
  //
  // O PIX vem de constantes de build (mesma fonte de AdminSettingsView): a
  // resposta já é conhecida no mount, então com PIX ok o passo é `feito`
  // mesmo com a config carregando. Sem PIX, a resposta depende das formas na
  // entrega — e antes de a config chegar elas são o PADRÃO do app
  // (defaultStoreConfig: pix, cartão e dinheiro), não a escolha da loja.
  // Contar esse padrão marcaria "feito" falso e depois viraria "pendente";
  // por isso, enquanto a config carrega, "não sei" (mesma ordem do CEP).
  const recebeNaEntrega = formasNaEntrega.length > 0;
  const estadoRecebe: EstadoDoItem = pixOk
    ? "feito"
    : configCarregando
      ? "carregando"
      : recebeNaEntrega
        ? "feito"
        : "pendente";

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
  const existeProdutoAtivo = produtos.some((produto) => produto.isActive);

  return [
    {
      chave: "recebe",
      rotulo: "Como você recebe",
      // Não diz "PIX configurado" de uma loja que só recebe na entrega.
      rotuloFeito: pixOk
        ? "Pagamento PIX configurado"
        : "Pagamento na entrega configurado",
      rotuloPendente: "Configurar pagamento PIX",
      estado: estadoRecebe,
      destino: "admin-settings",
    },
    {
      chave: "cep",
      rotulo: "Endereço da loja (CEP)",
      rotuloFeito: "Endereço da loja (CEP) preenchido",
      rotuloPendente: "Cadastrar o endereço da loja (CEP)",
      estado: configCarregando
        ? "carregando"
        : cepCompleto(originCep)
          ? "feito"
          : "pendente",
      // O CEP só se edita em Minha loja (fonte única do endereço); o Frete
      // passou a apenas lê-lo.
      destino: "admin-about-store",
    },
    {
      chave: "produto",
      rotulo: "Primeiro produto à venda",
      rotuloFeito: "Pelo menos 1 produto ativo à venda",
      rotuloPendente: "Cadastrar um produto ativo",
      estado: produtosCarregando
        ? "carregando"
        : existeProdutoAtivo
          ? "feito"
          : "pendente",
      destino: "admin-products",
    },
  ];
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
   * "Como você entrega" chega como FATO pronto: a régua (sem CEP, local,
   * nacional com ou sem transportadora) é `status-da-entrega`, do Frete — esta
   * lista não a reimplementa.
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
      // `.some(isActive)`, nunca `produtos.length` (o cofre guarda produto
      // desativado também). Mesma ressalva da lista de 3 sobre o truncamento
      // do StoreContext em 200 itens.
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
