import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import type { View } from "@/types";

/**
 * Lista "sua loja está pronta para vender?" do Início, como função PURA:
 * recebe os fatos já lidos (config, produtos, flags de build) e devolve os
 * passos com o estado de cada um. Sem hook, sem `import.meta.env`, sem React
 * — o cartão só desenha o que esta função decide.
 *
 * Hoje são 3 passos. A lista final do painel simples terá 6 (spec §8); isso
 * é de uma onda futura e não entra aqui.
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
      destino: "admin-shipping",
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
