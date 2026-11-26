# Modo manutenção da loja — o que ele faz e o que NÃO faz

Decisão do sócio em 24/11/2026 (semana da Black Friday), a pedido do dono.

## O que ele faz hoje

Com `store_config.manutencao = true` a vitrine mostra a tela "Servidor em
Manutenção" para quem abre ou recarrega o app. Só a ferramenta de
administração das lojas liga e desliga esse valor (não existe botão no painel).

Não confunda com o **estado de vida** da loja (adormecida ou encerrada, na caderneta da frota): ali a
loja inteira sai do ar com a página de "fechada", sem tocar o banco dela. Esse é outro caminho, com
roteiro próprio: [estado de vida da loja](estado-de-vida-da-loja.md).

## O que ele NÃO faz (leia antes de ligar numa emergência)

**Manutenção esconde a vitrine, mas NÃO para pedidos de quem já está com o app
aberto ou com a página guardada no celular.** A ficha da loja é lida uma vez
por carregamento e nada no servidor recusa pedido quando `manutencao` é
verdadeiro. Essas pessoas continuam vendo a loja e podem finalizar a compra.

Se a emergência é "parar de vender agora" (por exemplo, preço errado):
desative os produtos afetados no painel (isso vale na hora para quem abre o
app; a vitrine já aberta atualiza ao voltar à aba) e confira os pedidos que
entraram depois da hora em que decidiu parar.

## Depois de 30/11/2026 (decidido, ainda não feito)

Passa a significar "a loja não aceita pedido novo", recusado pelo servidor em
TODAS as versões vivas da função que cria pedido, com a frase "a loja está em
manutenção, volte em instantes". Pedido já criado, PIX já gerado e pagamento
já feito seguem normais; venda de balcão da lojista usa outro caminho. Exige
revisão Opus (mexe na criação de pedido) e conferir no banco de cada loja
quais versões da função estão no ar. No mesmo lote: tirar da tela de
manutenção o cabeçalho, a barra de baixo e o aviso de carrinho, que hoje não
fazem nada.
