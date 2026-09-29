/**
 * Janela padrão (em dias) da varredura de cancelados do painel — frente
 * pedidos-4, migration 20261164000000. O recorte é sobre a data do
 * CANCELAMENTO (última linha 'cancelled' no marketplace_order_history,
 * legado cai no updated_at) e a fonte da verdade é o DEFAULT 90 da RPC
 * get_admin_orders_cancelados_recentes: este número só diz o que o front
 * pede e o que o aviso da tela (AlertasCancelados) escreve. Mudar aqui sem
 * mudar lá — ou vice-versa — faz o texto mentir sobre o recorte real.
 */
export const JANELA_PEDIDOS_CANCELADOS_DIAS = 90;
