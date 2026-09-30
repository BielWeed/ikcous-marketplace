/**
 * A regra da configuração do cartão, do lado da tela — REEXPORTA a fonte
 * única que as edge functions usam
 * (`supabase/functions/_shared/configuracao-cartao.ts`). O Payment Brick
 * oferece o que esta regra diz e `criar-pagamento` recusa o que ela não
 * aceita; duas cópias divergiriam (#53).
 */
export {
  aceitaAlgumCartao,
  CHAVE_CONFIGURACAO_CARTAO,
  CONFIGURACAO_CARTAO_PADRAO,
  type ConfiguracaoCartao,
  escreverConfiguracaoCartao,
  lerConfiguracaoCartao,
  PARCELAS_MAXIMO_CONFIGURAVEL,
  type TipoCartao,
} from "../../supabase/functions/_shared/configuracao-cartao";
