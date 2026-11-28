/**
 * Mensagem do Service Worker às janelas abertas quando o NAVEGADOR troca a
 * inscrição de push sozinho (`pushsubscriptionchange`: no Android e no
 * computador o endereço muda sem ninguém tocar em nada).
 *
 * O SW reinscreve com a mesma chave, mas não consegue GRAVAR a inscrição
 * nova: `push_subscriptions` só aceita a linha com a sessão da conta dona
 * (RLS), e a sessão mora no armazenamento da página, fora do alcance do SW.
 * Quem grava é a página aberta (`usePushNotifications`), pelo mesmo caminho
 * do religar sozinho. Sem página aberta, a inscrição nova fica só no
 * navegador até o app abrir.
 *
 * O texto é contrato entre versões (SW novo + app velho ignora; o inverso
 * nunca chega).
 */
export const TIPO_INSCRICAO_DE_PUSH_TROCOU = "ikcous:inscricao-de-push-trocou";
