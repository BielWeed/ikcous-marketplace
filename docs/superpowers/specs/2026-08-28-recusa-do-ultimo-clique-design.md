# A recusa do último clique deixa de ser um beco

**Data:** 2026-08-28 · **Item 3** do caminho aprovado pelo Gabriel em 27/08/2026,
com escopo corrigido e aprovado por ele em 28/08 ("segue com os 11").

## O defeito, medido

A fila de prioridade diz "os **quatro** becos, todos terminando em *Os valores do pedido
mudaram*". **Não bate com o código.** Medido na função viva do banco
(`create_marketplace_order_v23` e `v24`, via `pg_get_functiondef` em 28/08/2026):

| # | Mensagem exata que o banco levanta | O que a pessoa precisaria fazer |
|---|---|---|
| 1 | `Endereço inválido ou não pertence ao usuário.` | escolher outro endereço |
| 2 | `Quantidade inválida para um dos itens.` | corrigir a quantidade |
| 3 | `Escolha uma variação para o produto %.` | abrir o produto e escolher |
| 4 | `Produto % não disponível.` | tirar do carrinho |
| 5 | `Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)` | baixar para o disponível |
| 6 | `Entrega local não disponível para o CEP informado.` | trocar entrega ou endereço |
| 7 | `A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.` | recotar o frete |
| 8 | `Cupom % inválido ou expirado.` | tirar o cupom |
| 9 | `Os valores do pedido mudaram. Atualize o carrinho e tente novamente.` | reconferir o carrinho |
| 10 | `Estoque insuficiente para o produto %` (corrida no débito, variação) | baixar para o disponível |
| 11 | `Estoque insuficiente para o produto %` (corrida no débito, produto) | baixar para o disponível |

São **11 pontos de recusa**, não quatro, e só **um** produz a frase da fila.

**O defeito é o mesmo nos onze:** `src/views/customer/CheckoutView.tsx:1023` faz
`toast.error(...)` e acaba. O aviso some sozinho e **nenhuma ação é oferecida**. A pessoa
fica parada no último clique, com o endereço preenchido e o frete escolhido.

Dois casos em que isso é cruel, porque a mensagem manda fazer algo que o app não tem:

- **#9** manda "Atualize o carrinho" — `grep -rn "refreshCart" src/` volta **vazio**. Não
  existe atualizar o carrinho no app.
- **#7** manda "Calcule o frete novamente" — não há essa ação na tela de recusa.

E para quem **não tem conta**, o carrinho nunca é reconferido: `CartContext.tsx:190`
(`"No user detected. Preserving local cart."`) sai antes de revalidar. Quem está logado
ganha releitura na abertura; o visitante, nunca. É por isso que #9 acerta principalmente
quem ainda não é cliente.

## O que NÃO muda, e é o bem maior

**Nenhuma das 11 recusas é afrouxada. Nenhuma migration, nenhuma RPC.** A trava
anti-adulteração de preço (`ABS(v_calculated_total - p_total_amount) > 0.05`) é o que impede
comprar pelo preço velho, e ela fica intocada. O backend está certo; quem está errado é o
que a tela oferece **depois** da recusa.

Isso também mantém o risco baixo: o caminho do dinheiro no servidor não é editado.

## O desenho

Três peças, todas novas, mais duas linhas de fiação:

1. **`src/lib/recusaDoPedido.ts`** — função pura que recebe o erro do Supabase e devolve
   qual das ações de recuperação serve. Só classifica; não executa nada.
2. **`src/lib/reconferirCarrinho.ts`** — a ação que hoje não existe: relê preço, estoque e
   disponibilidade de cada item contra o banco e devolve o que mudou. **Serve visitante e
   logado igual** — é aí que o beco #9 fecha.
3. **`src/components/ui/custom/SaidaDaRecusa.tsx`** — o painel que substitui o toast: mostra
   a frase que o banco escreveu e **o botão da ação correspondente**.

### Por que arquivos novos, e não editar `useOrders.ts` / `CartContext.tsx`

Duas razões, e as duas valem sozinhas:

- **Coordenação:** o mural acusou COLISÃO nos dois arquivos com frentes de outras sessões
  (`timer-orfao-do-sync-offline` e `caca-defeitos-cacador-a`). Não se assume arquivo de outra
  frente por silêncio.
- **Desenho:** classificador e reconferência são funções puras. Em módulo próprio elas são
  testáveis sem montar tela nenhuma, e é isso que permite ancorar o teste nas 11 strings.

A fiação (uma linha em cada arquivo compartilhado) é a **última** tarefa, feita quando
aquelas frentes encerrarem.

### A fragilidade deste desenho, e como ela é contida

Classificar por **texto** quebra se alguém mudar a mensagem no banco. A contenção é um teste
que lê os arquivos `.sql` de migration e exige que as 11 frases continuem existindo, palavra
por palavra. Se alguém trocar uma mensagem, o teste reprova **nomeando qual**, em vez de o
app silenciosamente cair no caso genérico. O teste roda no CI, que não tem banco — por isso
a âncora é o arquivo de migration, não o `pg_get_functiondef`.

Alternativa descartada: dar `ERRCODE` próprio a cada recusa. É mais robusto, mas mexe na
RPC — no caminho do dinheiro — e `mensagemAmigavelErroPedido` trata `P0001` de forma
especial, então mudar o código quebraria a peça que hoje funciona. Não paga.
