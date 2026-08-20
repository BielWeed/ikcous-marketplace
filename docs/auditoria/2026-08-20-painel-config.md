# Auditoria do painel do lojista — Clientes, Ajustes, Cupons, Frete e Push

**Data:** 20/08/2026 · **Escopo:** só as telas **Clientes** (mais a ficha do cliente),
**Ajustes**, **Cupons** (mais o formulário de cupom), **Frete** e **Push** do painel admin
· **Natureza:** auditoria somente leitura. Os achados **1 a 5** foram corrigidos no mesmo dia, 20/08/2026 — estão marcados com ✅, e o **4** ficou pela metade (leia o bloco dele). Os achados **6, 7 e 12** foram corrigidos em seguida, também em 20/08/2026.

**Como foi medido.** O app foi aberto no navegador com sessão de admin e cada tela foi usada
de verdade; o que apareceu na tela foi conferido contra o banco de desenvolvimento por
consulta direta (só `SELECT`), inclusive lendo o corpo vivo das funções do Postgres com
`pg_get_functiondef`. Onde a tela e o banco divergem, os dois números estão escritos abaixo.
Achado que eu não consegui reproduzir não entrou — o que ficou de fora está em
*Pendências minhas*, no fim.

**Estado do banco no momento da medição:** 16 perfis de cliente, 84 pedidos (72 cancelados),
2 cupons ativos com **0 usos em toda a história**, 8 inscrições de push pertencentes a
**1 cliente identificado**, loja em `flat_fee` com frete grátis a partir de R$ 100 e taxa
fixa de R$ 10.

---

## Resumo — ordenado por quanto dói

| # | O que a pessoa vê | O que é verdade | Quem sente | Quanto dói |
|---|---|---|---|---|
| 1 ✅ | Cupom com "**∞ usos**", aceito no checkout, desconto aplicado no total | O pedido é **recusado** na hora de finalizar com "Cupom X inválido ou expirado". Todo cupom criado sem preencher "Limite de Uso" nasce assim | quem compra e quem vende | **Alto** |
| 2 ✅ | "Frete grátis desativado. **Todos os pedidos terão cobrança de entrega**" | Com a Taxa Padrão também desligada, o app cota **R$ 0,00 para o Brasil inteiro** — e a tela chama isso de "Sem taxa fixa configurada" | quem vende | **Alto** |
| 3 ✅ | "✨ Frete grátis ativo para pedidos a partir de R$ 100" | Só para quem está **logado**. Quem compra como convidado paga o frete mesmo passando de R$ 100, e a tela de Frete não diz isso em lugar nenhum | quem compra e quem vende | **Alto** |
| 4 ✅ | Clientes → "**Ticket Médio R$ 28,16**" | Ticket médio é R$ 40,95. A conta da tela é receita ÷ **clientes**, não ÷ pedidos — e o Dashboard, na mesma sessão, mostra R$ 40,95 com o mesmo rótulo | quem vende | **Médio-alto** |
| 5 ✅ | Na lista: "João Gabriel — **Pedidos 6**". Abrindo o mesmo cliente: "**Cesta / Pedidos 16**" | Duas contagens do mesmo cliente, na mesma tela, com 10 de diferença. Nenhuma das duas explica a outra | quem vende | **Médio-alto** |
| 6 ✅ | Push → "Clientes Frequentes **3**", "Sem comprar há 30d **2**", "Novos Clientes **3**" | Os reais são **2, 0 e 0**. Os números não selecionados são 30%, 25% e 45% do total de aparelhos, calculados no próprio componente | quem vende | **Médio** |
| 7 ✅ | Push → "**iOS: 3 · Android: 5**" | Não existe coluna de plataforma no banco. É `total × 0,4` e `total × 0,6` escrito no componente | quem vende | **Médio** |
| 8 ✅ | No menu do cliente: "**Notificação Push**" | Funciona para **1 dos 16** clientes. Para os outros 15 o envio para e nem a notificação dentro do app é criada | quem vende e quem compra | **Médio** |
| 9 | No menu do cliente: "**Congelar Acesso**", em vermelho | Não congela nada. Mostra "Funcionalidade em desenvolvimento" | quem vende | **Médio** |
| 10 | Cupons → "Após esse prazo, o cupom é **desativado automaticamente pelo sistema**" | Não existe nada que desative. O cupom vencido continua com o selo verde "ATIVO" e continua contando no KPI "Cupons Ativos" | quem vende | **Médio** |
| 11 ✅ | Histórico de Push → selo verde "**ENVIADA**" em toda linha | O selo é texto fixo. Um envio em que ninguém recebeu grava 0 e ainda aparece "0 clientes · ENVIADA" | quem vende | **Médio-baixo** |
| 12 ✅ | Push → "Receberão: **8 clientes**" e "Enviar Notificação Agora (8 clientes)" | São 8 **aparelhos**, de 1 cliente identificado e 6 inscrições sem dono. Um cliente com três aparelhos conta como três | quem vende | **Baixo** |
| 13 | Frete → "Histórico de Cotações & Audit Logs / Exibindo as 15 consultas mais recentes" | Com o provedor Taxa Única Fixa — o padrão e o atual — **nada é registrado ali, nunca**. A tela diz "Nenhuma cotação registrada recentemente" | quem vende | **Baixo** |
| 14 | No extrato do cliente, a situação "**pending**" | É o único status sem tradução da tabela. Os outros dizem Cancelado, Entregue, Enviado | quem vende | **Baixo** |
| 15 | Cupom → "Mínimo Compra **R$ 50**" | O valor é exibido sem centavos. Um mínimo de R$ 49,90 aparece como R$ 50 no card e na pré-visualização | quem compra e quem vende | **Baixo** |
| 16 | Cupons → "Permitir que clientes usem cupons **no carrinho**" e "receber **discounts** especiais" | O campo de cupom fica no checkout, não no carrinho; e "discounts" está em inglês no meio da frase | quem vende | **Baixo** |

---

## 1. O cupom que a tela diz ser ilimitado derruba o pedido no fechamento

**O que a pessoa vê.** Na tela de Cupons, o cupom `CUPOM10` aparece assim, hoje:

> CUPOM10 · **ATIVO** · Desconto Percentual · **10% OFF** · Mínimo Compra **R$ 50** ·
> Aproveitamento **0 / ∞ usos**

Quem compra digita `CUPOM10` no checkout, o app aceita, mostra "−R$ 10,00 aplicado" e abate
o valor do total. Ao tocar em finalizar, o pedido é recusado com **"Cupom CUPOM10 inválido
ou expirado."**

**O que é verdade.** Existem duas regras diferentes lendo o mesmo campo, e elas discordam
sobre o que significa "limite de uso = 0":

- A validação do checkout (`validate_coupon_secure_v2`, viva no banco) trata 0 como
  ilimitado: `usage_limit IS NOT NULL AND usage_limit > 0`.
- A criação do pedido (`create_marketplace_order_v23` e `v24`, as duas que o app chama)
  exige `usage_count < usage_limit`. Com limite 0, isso é `0 < 0` — **falso sempre**. O
  cupom nunca é encontrado e a função levanta a exceção.

E o formulário empurra a loja exatamente para esse valor: o campo "Limite de Uso" nasce em
`0` e tem o texto de apoio **"0 = Ilimitado"**. Quem cria um cupom sem mexer nesse campo cria
um cupom quebrado.

**Evidência.** Consulta única no banco, com a mesma entrada nas duas regras:

```
validacao_no_carrinho : { "is_valid": true, "discount_value": 10, "error_message": "" }
achado_pelo_create_order : 0
```

- Regra do checkout: `validate_coupon_secure_v2` — `SELECT ... WHERE UPPER(code)=UPPER(p_code) AND active = true`, teste de limite `(usage_limit IS NOT NULL AND usage_limit > 0)`.
- Regra do pedido: `create_marketplace_order_v23` e `create_marketplace_order_v24` — `AND (usage_limit IS NULL OR usage_count < usage_limit)` seguido de `RAISE EXCEPTION 'Cupom % inválido ou expirado.'`.
- Estado do cupom no banco: `CUPOM10 · usage_limit = 0 · usage_count = 0 · active = true`.
- O campo que gera esse 0: [AdminCouponFormView.tsx:430](../../src/views/admin/AdminCouponFormView.tsx#L430) (`placeholder="0 = Ilimitado"`) e [AdminCouponFormView.tsx:35](../../src/views/admin/AdminCouponFormView.tsx#L35) (`usageLimit: 0` no estado inicial).
- O "∞" da tela: [AdminCouponsView.tsx:637](../../src/views/admin/AdminCouponsView.tsx#L637) — `{coupon.usageLimit || "∞"}`.
- O caminho do checkout até a RPC: [CheckoutView.tsx:789](../../src/views/customer/CheckoutView.tsx#L789) (valida) → [CheckoutView.tsx:930](../../src/views/customer/CheckoutView.tsx#L930) (manda o código) → [useOrders.ts:1077](../../src/hooks/useOrders.ts#L1077) (`p_coupon_code`).

**Quem sente.** Quem compra: perde a compra na última tela, com uma mensagem que acusa o
cupom que o próprio app tinha acabado de aceitar. Quem vende: a campanha não converte e o
painel não mostra nada de errado — o cupom continua "Ativo" com "0 usos", que é o mesmo que
uma campanha que ninguém aproveitou.

**Quanto dói.** Alto. É venda perdida no último passo, e o padrão do formulário produz o
defeito por omissão. Em 5 meses o banco tem **zero** pedidos com cupom.

> ### ✅ CORRIGIDO E APLICADO NO BANCO em 20/08/2026
>
> [supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql](../../supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql)
> alinhou a criação de pedido com a validação do checkout: `usage_limit` nulo ou `<= 0` passa a
> significar ilimitado nas duas funções (`v23` e `v24`). Uma linha em cada; nenhum dado mudou e
> nenhum cupom já existente ficou inválido.
>
> Provada por [scripts/db-prove-cupom-sem-limite.cjs](../../scripts/db-prove-cupom-sem-limite.cjs)
> — 30 asserções em transação terminada em `ROLLBACK`, com o defeito reproduzido **antes** e o
> limite de verdade continuando a bloquear **depois**. A prova foi sabotada duas vezes para
> confirmar que ela tem dente: predicado que aceita sempre → 6 falhas; predicado antigo de volta
> → 7 falhas.
>
> Conferido contra o banco já aplicado, com o `CUPOM10` real (o mesmo que este achado pegou
> quebrado): produto de R$ 59,90, checkout diz válido com R$ 5,99 de desconto, o pedido é criado
> com `discount = 5,99` e `total = 63,91`, e o uso é contado. Tudo desfeito por `ROLLBACK` —
> nenhum pedido de teste ficou no banco.
>
> Registrada no ledger como `20260821000200`. Ponto de retorno em
> `rollback-20260821000200_cupom_sem_limite_e_ilimitado.sql`, na raiz do projeto.

---

## 2. Desligar a taxa de entrega vira frete grátis para o Brasil inteiro, e a tela diz o contrário

**O que a pessoa vê.** Na tela de Frete, com os dois interruptores desligados:

> **Frete Grátis** — *Frete grátis desativado. Todos os pedidos terão cobrança de entrega.*
> **Taxa Padrão de Entrega** — *Sem taxa fixa configurada.*

**O que é verdade.** Desligar o interruptor da Taxa Padrão grava `shipping_fee = 0`, não
"vazio". E zero é um valor válido: a função de cotação trata "taxa 0 escolhida pela loja"
como frete grátis de verdade, de propósito — há teste no repositório dizendo isso com todas
as letras. Resultado: toda cotação nacional volta como "Entrega Padrão · R$ 0,00", e a
criação do pedido confirma esse zero. Nenhum pedido tem cobrança de entrega — o oposto
exato da frase na tela.

**Evidência.**

- A frase: [AdminShippingView.tsx:548](../../src/views/admin/AdminShippingView.tsx#L548) — "Frete grátis desativado. Todos os pedidos terão cobrança de entrega." e [AdminShippingView.tsx:696](../../src/views/admin/AdminShippingView.tsx#L696) — "Sem taxa fixa configurada."
- O interruptor grava zero: [AdminShippingView.tsx:594](../../src/views/admin/AdminShippingView.tsx#L594) — `shippingFee: checked ? 15 : 0`, salvo em [AdminShippingView.tsx:307](../../src/views/admin/AdminShippingView.tsx#L307) como `Math.max(0, formData.shippingFee)`.
- Zero é aceito como taxa: [calculate-shipping/index.ts:145-147](../../supabase/functions/calculate-shipping/index.ts#L145) — `flatFeeConfigurada` só rejeita `null`, `undefined` e `NaN`; e o teste [index_test.ts:209](../../supabase/functions/calculate-shipping/index_test.ts#L209) — *"zero CONFIGURADO pela loja e utilizavel (frete gratis de verdade)"*.
- O banco confirma o mesmo zero no fechamento: `create_marketplace_order_v23`, ramo `p_shipping_option_id LIKE 'flat-fee-%'` → `v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0)`.

**Quem sente.** Quem vende. É dinheiro saindo: a loja passa a pagar a entrega de todo
pedido, para qualquer CEP do país, achando que desligou uma promoção.

**Quanto dói.** Alto. O comportamento é intencional e correto; o texto da tela é que descreve
o inverso do que vai acontecer.

> ### ✅ CORRIGIDO em 20/08/2026 (junto com o achado 3)
>
> Nenhum comportamento mudou — mudou o que a tela **afirma**. As frases saíram dos
> condicionais dentro do markup e viraram
> [src/utils/regra-de-frete.ts](../../src/utils/regra-de-frete.ts), que recebe os quatro campos
> da regra e devolve o que dizer. A causa era estrutural: cada card olhava só o próprio
> interruptor, e a regra depende dos dois — nenhum card isolado conseguia dizer a verdade.
>
> O que a tela mostra agora, medido no navegador com a loja real:
>
> - Com os dois ligados: *"Quando nenhuma regra de frete grátis se aplica, a entrega custa R$ 10."*
> - Com os dois desligados: *"A taxa está em R$ 0 — quando nenhuma outra regra se aplica, a
>   entrega sai sem custo para quem compra."* — e um aviso destacado aparece na hora, antes de
>   salvar: *"Atenção: com a taxa em R$ 0 e a cotação nacional pela taxa fixa, todo pedido sai
>   com entrega grátis, para qualquer CEP do país. Quem paga a entrega é a loja."*
>
> O aviso só aparece onde a taxa fixa realmente governa o preço. Com cobertura "Apenas Local"
> ou cotação por transportadora ele some — avisar ali seria repetir o defeito, afirmando um
> efeito que não acontece.
>
> Provado por [tests/front/admin-shipping-frases-da-regra.test.ts](../../tests/front/admin-shipping-frases-da-regra.test.ts)
> (11 casos, incluindo uma varredura dos 24 estados possíveis que reprova qualquer frase
> prometendo cobrança com a taxa em zero) e
> [tests/front/admin-shipping-tela-nao-promete-cobranca.test.tsx](../../tests/front/admin-shipping-tela-nao-promete-cobranca.test.tsx)
> (6 casos que montam a tela de verdade — sem eles, escrever a regra certa e esquecer de
> ligá-la no markup passaria despercebido; foi exatamente isso que a mutação A confirmou).

---

## 3. O frete grátis só vale para quem está logado — e a tela de Frete não diz isso

**O que a pessoa vê.** Na tela de Frete, com a regra ligada:

> ✨ **Frete grátis ativo para pedidos a partir de R$ 100**

Sem ressalva nenhuma.

**O que é verdade.** A regra tem uma segunda condição, que aparece em três lugares do código
e em nenhum da tela: **o cliente precisa estar autenticado**. Quem compra como convidado —
caminho que o app suporta e que já produziu pedido neste banco — passa de R$ 100 e paga
frete assim mesmo.

**Evidência.**

- A frase da tela: [AdminShippingView.tsx:540](../../src/views/admin/AdminShippingView.tsx#L540).
- Front: [CartContext.tsx:751-755](../../src/contexts/CartContext.tsx#L751) — `config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin && user`; o mesmo em [StoreContext.tsx:609-614](../../src/contexts/StoreContext.tsx#L609).
- Banco: `create_marketplace_order_v23` — `IF v_has_free_shipping_item = true OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)`.
- Checkout de convidado ativo: [useOrders.ts:1049](../../src/hooks/useOrders.ts#L1049) ("O login não é mais obrigatório no frontend") e 1 pedido de convidado no banco (`user_id IS NULL`, R$ 22,90).

**Quem sente.** Quem compra como convidado: vê a promessa de frete grátis na vitrine e paga
frete no fim. Quem vende: configura a regra e não entende por que parte dos pedidos continua
com frete.

**Quanto dói.** Alto. A tela que define a regra é a única que não conta a condição que a
governa.

> ### ✅ CORRIGIDO em 20/08/2026 (mesma correção do achado 2)
>
> A tela agora diz, com a regra ligada em R$ 100:
>
> *"✨ Quem entrou na conta não paga entrega a partir de R$ 100. Quem compra sem entrar na conta
> não recebe esse desconto."*
>
> Medido no navegador com a configuração real da loja. A condição de estar autenticado
> continua exatamente como estava no código e no banco — o que mudou é que a tela passou a
> contá-la.

---

## 4. "Ticket Médio" na tela de Clientes não é ticket médio — e o Dashboard mostra outro número

**O que a pessoa vê.** Dois cartões com o mesmo nome, na mesma sessão, no mesmo painel:

| Tela | Card | Valor |
|---|---|---|
| Geral (Dashboard) | TICKET MÉDIO · Média por transação | **R$ 40,95** |
| Clientes | TICKET MÉDIO · Consumo médio | **R$ 28,16** |

**O que é verdade.** Ticket médio é receita ÷ pedidos. Com R$ 450,50 em 11 pedidos válidos,
são **R$ 40,95** — o número do Dashboard. A tela de Clientes divide a mesma receita pelo
número de **clientes** (16), o que dá R$ 28,16. Isso é LTV médio por cliente, não ticket
médio — e o próprio guia de ajuda dessa tela explica o conceito de LTV separadamente, o que
mostra que os dois nomes não são sinônimos ali.

Há ainda uma mistura na conta: o numerador inclui pedido de convidado (R$ 22,90, sem dono) e
o denominador só conta perfis cadastrados.

**Evidência.**

- A conta: [AdminCustomersView.tsx:219-220](../../src/views/admin/AdminCustomersView.tsx#L219) — `global_ltv / total_customers`, rotulado `"Ticket Médio"`.
- Os insumos vêm de `get_admin_customers_paged` (viva no banco): `v_global_ltv = SUM(total) WHERE status NOT IN ('cancelled','returned')` e `v_global_total_customers = COUNT(id) FROM profiles`.
- Banco: `total_clientes = 16`, `pedidos_validos = 11`, `receita = 450.50`, `pedidos_de_convidado = 1` (R$ 22,90). → 450,50 ÷ 16 = **28,16**; 450,50 ÷ 11 = **40,95**.
- Confirmado nas duas telas do navegador com sessão de admin.

**Quem sente.** Quem vende — é número que decide preço, frete grátis e valor mínimo de
cupom. E o painel mostra dois valores diferentes com o mesmo nome, sem dizer qual vale.

**Quanto dói.** Médio-alto.

> ### ✅ CORRIGIDO em 20/08/2026, em duas etapas — a primeira fechou metade
>
> O card passou a dividir a receita por **pedidos**, não por clientes, e o rótulo de apoio
> mudou de "Consumo Médio" para "Média por pedido". Uma linha em
> [AdminCustomersView.tsx:234](../../src/views/admin/AdminCustomersView.tsx#L234).
>
> As duas telas mostraram o mesmo número, medido no navegador na mesma sessão:
> **Clientes → TICKET MÉDIO R$ 40,95 · MÉDIA POR PEDIDO** e
> **Dashboard → TICKET MÉDIO R$ 40,95 · MÉDIA POR TRANSAÇÃO**.
>
> 🔴 **Mas isso foi coincidência dos dados, não da conta** — achado do `revisor` em
> 20/08/2026, confirmado na fonte. O divisor foi consertado; a **base** não. A tela de
> Clientes soma todo pedido não cancelado; o Dashboard soma só o dinheiro reconhecido
> (`payment_status` nulo, `pago` ou `pago_apos_expirar`, desde a migration
> `20260822000100`). Os dois bateram porque, naquele instante, **nenhum pedido não
> cancelado estava aguardando pagamento** — a limpeza automática já havia cancelado
> todos. Com um PIX de R$ 89,90 em aberto, Clientes diria **R$ 45,03** e o Dashboard
> **R$ 40,95**: o mesmo rótulo, R$ 4,08 de diferença, que é este achado de volta.
>
> E o teste chamado *"bate com o Dashboard para outro conjunto de números"* nunca
> renderizou nada do Dashboard — o nome afirmava uma paridade que o corpo não
> exercitava.
>
> **A segunda etapa fechou (commit `6bbdc7c`).** O card **parou de ter conta própria**: passou a
> ler `executive.avgTicket`, a mesma fonte que o Dashboard e a tela de Pedidos já leem. Não é
> mais um caso de alinhar duas calculadoras — a segunda deixou de existir. Nada no banco mudou.
>
> Junto veio a regra que o resto desta linha de trabalho já seguia: número que não chegou **não
> vira zero**. O card mostra um traço. A cadeia usa `??` terminando em `null`, e não `||`
> terminando em `0` — com `||`, um ticket médio medido como zero (loja sem pedido nenhum) cairia
> no ramo seguinte, e um resumo restaurado do cache em disco sem o bloco `executive` imprimiria
> "R$ 0,00" afirmando um fato que ninguém mediu.
>
> O teste que mentia no nome foi refeito: agora prova **leitura da fonte**, no cenário do PIX
> pendente, onde a conta antiga e a nova dão números diferentes (R$ 45,03 contra R$ 40,95). São
> 5 casos, e duas mutações provaram que caem.
>
> **O vizinho foi junto (commit `3305ea8`).** O `revisor` desta correção olhou para o lado e
> achou o cartão "Pedidos Totais" com a mesma raiz: vinha de `global_orders`, que conta pedido
> sem olhar cobrança, enquanto o Dashboard conta "Total de Pedidos" com o filtro. Com o mesmo
> PIX de R$ 89,90 aguardando: Dashboard **11**, Clientes **12**. Agora lê
> `executive.totalOrders`, que sai do **mesmo `SELECT`** do `avgTicket` — os dois concordam por
> construção. Dois testes novos, provados por mutação.
>
> ⚠️ **O que este achado NÃO cobre:** a coluna "LTV Total" de cada cliente continua vindo da
> fonte sem filtro de cobrança. É o [achado 17](#17-achado-novo-o-ltv-total-de-cada-cliente-conta-pedido-que-ninguém-pagou).
> Com ele, são **três cartões da mesma tela com a mesma raiz** — sinal de que a tela inteira
> bebia os números globais de uma fonte que conta dinheiro por outra regra.
>
> A troca conserta de graça o segundo erro que este achado registrava: como `global_ltv` soma
> todos os pedidos, inclusive os de convidado, dividir por `total_customers` misturava dois
> conjuntos diferentes. Com `global_orders` no divisor, os dois lados falam da mesma coisa.
>
> Provado por [tests/front/admin-customers-ticket-medio.test.tsx](../../tests/front/admin-customers-ticket-medio.test.tsx)
> — 5 casos, incluindo um segundo conjunto de números (R$ 1.000 em 8 pedidos com 40 clientes)
> para o teste não passar por coincidência de um valor só, e duas bordas: loja sem pedido
> mostra R$ 0,00, e receita com zero pedidos não imprime "Infinity" nem "NaN" no painel.
> Sabotado duas vezes para confirmar que tem dente: divisor antigo de volta → caem os 2 testes
> de valor; guarda de divisão por zero quebrada → caem as 2 bordas.

---

## 5. O mesmo cliente tem 6 pedidos na lista e 16 na ficha

**O que a pessoa vê.**

Na lista de Clientes:

> João Gabriel Vieira de Oliveira · admin · #5256DC84 · LTV Total **R$ 217,00** · **Pedidos 6**

Clicando nesse mesmo cliente:

> LTV TOTAL **R$ 217,00** · **CESTA / PEDIDOS 16** · aba **PEDIDOS (16)**

**O que é verdade.** As duas telas contam coisas diferentes e nenhuma avisa:

- A lista conta só pedido que não foi cancelado nem devolvido (`status NOT IN ('cancelled','returned')`) → **6**.
- A ficha conta **tudo que a RPC devolveu**, cancelados incluídos → **16**. O extrato logo abaixo confirma: 10 das 16 linhas dizem "Cancelado".

O LTV bate nas duas (R$ 217,00) porque ali a ficha filtra cancelados — só a contagem ficou de
fora do filtro.

**Evidência.**

- Lista: `get_admin_customers_paged` — `COUNT(o.id)` com `LEFT JOIN marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled','returned')`.
- Ficha: [AdminUserDetailView.tsx:582](../../src/views/admin/AdminUserDetailView.tsx#L582) e [:621](../../src/views/admin/AdminUserDetailView.tsx#L621) — `{orders.length}`, sem filtro; contra [AdminUserDetailView.tsx:315-317](../../src/views/admin/AdminUserDetailView.tsx#L315) — `totalSpent` filtra `o.status !== "cancelled"`.
- Banco, para esse cliente: 6 pedidos não cancelados, 16 no total. Confirmado nas duas telas.

**Quem sente.** Quem vende, ao decidir quem é cliente bom. Com 72 dos 84 pedidos do banco
cancelados, a divergência aparece em quase todo cliente com histórico.

**Quanto dói.** Médio-alto.

> ### ✅ CORRIGIDO em 20/08/2026
>
> O card passou a contar com a **mesma regra do servidor** (`status NOT IN
> ('cancelled','returned')`) e diz na própria tela quantos ficaram de fora. Na ficha do cliente
> da auditoria, medido no navegador: lista **6**, card **6**, e abaixo dele
> *"10 cancelados fora da conta"*.
>
> A **aba continua mostrando 16**, de propósito: é o número de linhas que a tabela abaixo dela
> lista, e trocar por 6 faria a aba mentir sobre o próprio conteúdo. Os dois números continuam
> existindo — o que sai é o mistério.
>
> Junto veio um terceiro número que este achado não tinha visto: o LTV da ficha filtrava só
> `cancelled` e esquecia `returned`, então dentro da **mesma tela** o dinheiro e a contagem de
> pedidos falavam de conjuntos diferentes. Agora os dois usam a mesma regra.
>
> Provado por [tests/front/admin-user-detail-pedidos-que-contam.test.tsx](../../tests/front/admin-user-detail-pedidos-que-contam.test.tsx)
> — 5 casos com o cenário real (16 pedidos, 10 cancelados). O primeiro deles foi **reescrito**:
> a versão original afirmava que o card "contém 6" e passava contra o código defeituoso, porque
> "16" contém "6". Teste decorativo. Agora compara o número exato, e a mutação confirma: com o
> card voltando a contar tudo, 2 dos 5 caem.
>
> ⚠️ **Conserto separado, anotado aqui:** `OrderStatus` (`src/types/index.ts`) não inclui
> `returned`, mas `mappers.ts:247` faz `row.status as OrderStatus` — um cast, não uma validação.
> O tipo mente sobre o que pode chegar em execução. Alinhar o tipo ao banco mexeria em todo
> `switch` sobre `OrderStatus`, então ficou fora desta correção.

---

## 6. Os contadores dos segmentos de push são percentuais inventados

**O que a pessoa vê.** Na tela de Push, os quatro botões de público:

> TODOS OS CLIENTES **8** · CLIENTES FREQUENTES **3** · SEM COMPRAR HÁ 30D **2** · NOVOS CLIENTES **3**

**O que é verdade.** Só o número do segmento **selecionado** é real — ele vem da função
`get_segmented_push_targets`. Os outros três são fabricados a partir do total de aparelhos:
30%, 25% e 45%. Medindo os mesmos segmentos no banco com a lógica da própria função:

| Segmento | Tela | Banco |
|---|---|---|
| Clientes Frequentes (LTV ≥ 150) | 3 | **2** |
| Sem comprar há 30d | 2 | **0** |
| Novos Clientes (7 dias) | 3 | **0** |

Dois dos três segmentos estão **vazios** e a tela anuncia 2 e 3 pessoas. Quem clicar neles
recebe "Nenhum destinatário encontrado para este segmento".

**Evidência.**

- [AdminPushView.tsx:717](../../src/views/admin/AdminPushView.tsx#L717) — `Math.ceil(subCount * 0.3)`; [:725](../../src/views/admin/AdminPushView.tsx#L725) — `Math.floor(subCount * 0.25)`; [:733](../../src/views/admin/AdminPushView.tsx#L733) — `Math.floor(subCount * 0.45)`.
- Contagem real, replicando os predicados de `get_segmented_push_targets`: `total = 8`, `vip = 2`, `inativos = 0`, `novos = 0`.
- Confirmado na tela.

**Quem sente.** Quem vende: escolhe o público por um número que não existe.

**Quanto dói.** Médio.

---

> ### ✅ CORRIGIDO em 20/08/2026 — achados 6, 7 e 12 na mesma correção
>
> Os quatro contadores de segmento passaram a ser **medidos** pela mesma RPC
> (`get_segmented_push_targets`) que já media o selecionado. Com os 8 aparelhos do banco, os
> botões que diziam "3, 2, 3" passaram a dizer **"2, 0, 0"** — dois dos três segmentos estão
> vazios, e agora a tela admite isso.
>
> Número que ainda não chegou, ou cuja medição falhou, mostra **um traço**, nunca zero: zero é
> uma afirmação forte e só aparece quando foi medido de verdade.
>
> Os selos `iOS:` e `Android:` **saíram da tela**. Não há coluna de plataforma em
> `push_subscriptions` — os dois números eram 40% e 60% do total, e não existe de onde derivar
> o certo. Sem dado, a saída honesta é não afirmar. Aprovado pelo Gabriel em 20/08/2026.
>
> No caminho apareceu um quarto número inventado que esta auditoria não tinha visto:
> `Math.floor(subCount * 0.45)` no contador de "Novos Clientes". Foi junto.
>
> E os dois textos de alcance passaram a dizer **"aparelhos"**, com singular e plural certos —
> é contagem de linhas de `push_subscriptions`, e das 8 medidas 6 não têm dono e as outras 2
> são do mesmo cliente.
>
> **O quarto número da mesma tela fechou depois (commit `d2c4a67`)**, achado pelo `revisor`
> desta correção: `subCount`, o total de aparelhos, nascia em `useState(0)` e, se a consulta
> falhasse, ficava em 0 para sempre — "0 Celulares Cadastrados" indistinguível de uma loja sem
> ninguém inscrito. **A trava não mudou:** o botão de enviar continua desabilitado quando o
> total é desconhecido, porque desconhecido cai no mesmo caminho que já desabilitava para zero.
> Falhar fechado. Provado por mutação, inclusive fora do subagente: fazer o desconhecido
> habilitar o botão derruba o teste.
>
> Commit `6e406b4`. Provado por
> [tests/front/admin-push-view-contadores.test.tsx](../../tests/front/admin-push-view-contadores.test.tsx)
> (7 casos, montando a tela de verdade) e
> [tests/front/push-contadores-de-segmento.test.ts](../../tests/front/push-contadores-de-segmento.test.ts)
> (6 casos nas funções puras). Quatro mutações aplicadas: voltar a multiplicação → caem 3
> testes; "clientes" no lugar de "aparelhos" → caem 5; traço virando `0` → caem 4; selo de
> plataforma de volta → cai 1. Revisado em contexto limpo.

---

## 7. "iOS: 3 · Android: 5" é conta em cima do total, não medição

**O que a pessoa vê.** No cartão "Clientes Prontos para Receber":

> **8** Celulares e Computadores Cadastrados — `iOS: 3` `Android: 5`

**O que é verdade.** Não existe informação de plataforma em lugar nenhum. A tabela
`push_subscriptions` tem exatamente seis colunas: `id`, `endpoint`, `p256dh`, `auth`,
`user_id`, `created_at`. Os dois números são 40% e 60% do total, arredondados.

**Evidência.**

- [AdminPushView.tsx:1096](../../src/views/admin/AdminPushView.tsx#L1096) — `iOS: {Math.floor(subCount * 0.4)}` e [:1099](../../src/views/admin/AdminPushView.tsx#L1099) — `Android: {Math.ceil(subCount * 0.6)}`.
- Colunas de `push_subscriptions` no banco: nenhuma de plataforma, dispositivo ou user-agent.
- 8 × 0,4 = 3 e 8 × 0,6 = 5 — exatamente o que a tela mostrou.

**Quem sente.** Quem vende, se algum dia usar isso para decidir onde investir.

**Quanto dói.** Médio. É o tipo de número que ninguém desconfia porque parece medição.

---

## 8. "Notificação Push" para um cliente funciona em 1 dos 16 — e falha em silêncio até no app

**O que a pessoa vê.** No menu de cada cliente, na lista de Clientes, existe a opção
**"Notificação Push"**. Ela abre a tela de Push já com "Mensagem para Cliente Específico" e
o nome da pessoa.

**O que é verdade.** Se aquele cliente não tiver um aparelho inscrito, o envio para logo no
começo, com "Nenhum destinatário encontrado para este segmento" — e **nada mais acontece**:
a mensagem dentro do app (o registro em `notificacoes`, que o cliente veria ao abrir a loja)
também não é criada, porque o `return` vem antes de qualquer gravação.

Hoje, dos 16 perfis, **1** tem aparelho inscrito. Ou seja: o recurso oferecido em 16 menus
funciona em um.

**Evidência.**

- Entrada: [AdminCustomersView.tsx:901](../../src/views/admin/AdminCustomersView.tsx#L901) e [:994](../../src/views/admin/AdminCustomersView.tsx#L994) — `onNavigate("admin-push", customer.id)`.
- A parada precoce: [AdminPushView.tsx:323-326](../../src/views/admin/AdminPushView.tsx#L323) — `if (finalRecipientCount === 0) { toast.error(...); return; }`, antes do insert em `push_notifications_log` e antes do insert em `notificacoes`.
- Banco: `total_perfis = 16`, `com_aparelho = 1`.

**Quem sente.** Quem vende, que acha que mandou recado. Quem compra, que nunca recebe — nem
o aviso dentro do app, que não dependia de push nenhum.

**Quanto dói.** Médio.

---

> ### ✅ CORRIGIDO em 20/08/2026 — achados 8 e 11, em duas etapas
>
> **O achado 11** era o mais simples e o mais enganoso: o selo verde "ENVIADA" era texto fixo,
> sem condição nenhuma. Agora ele lê o registro — "Entregue" com entrega confirmada, "Não
> confirmada" com zero. E o histórico parou de dizer "N clientes" para o que são entregas em
> **aparelho** (o achado 12, sobrevivendo no único canto da tela que ninguém tinha varrido).
>
> **O achado 8** levou duas etapas, e a primeira nasceu errada. O `return` de "nenhum
> destinatário" engolia também o insert em `notificacoes` — o aviso que o cliente vê ao abrir a
> loja, e que **não depende de push nenhum**. Corrigir isso foi a primeira etapa; e ela nasceu
> **inalcançável**, porque com o cliente sem aparelho o botão de enviar já nascia desabilitado.
> Os 15 clientes sem aparelho encontravam um botão morto, sem explicação — e *esse* era o defeito
> real, não o que a auditoria descreveu.
>
> A segunda etapa abriu o botão **só** nesse caso: exige cliente específico **e** alcance medido
> como zero. Desconhecido continua desabilitando; segmento vazio continua desabilitando. Um aviso
> em âmbar explica, antes do clique, que não haverá push e que a mensagem ficará registrada no
> app.
>
> ⚠️ **Uma quinta rodada encontrou defeito que a quarta criou** e está em avaliação de orçamento:
> o aviso de "o aviso no app falhou" tem texto fixo dizendo *"O push saiu"*, e dispara sem olhar
> se o push saiu. Com os dois falhando juntos, a tela se contradiz. A raiz não é a frase: é
> `handleSend` anunciar vários fatos independentes com vários `if`, **cada frase escrita à mão**
> — cada fato novo multiplica as combinações, e cada combinação é uma chance de afirmar coisa
> falsa. Foi assim cinco vezes seguidas nesta tela.
>
> Commits `8292d27`, `1703b19` e `03a62b8`, com revisão de contexto limpo em cada etapa.

---

## 9. "Congelar Acesso" não congela nada

**O que a pessoa vê.** No mesmo menu do cliente, em vermelho, com ícone de floco de neve:
**"Congelar Acesso"**. É a única ação destrutiva oferecida ali, e tem toda a aparência de um
bloqueio de conta.

**O que é verdade.** O clique mostra o aviso "Funcionalidade em desenvolvimento". Nenhuma
chamada é feita, nenhum campo muda.

**Evidência.** [AdminCustomersView.tsx:908](../../src/views/admin/AdminCustomersView.tsx#L908) e
[AdminCustomersView.tsx:1002](../../src/views/admin/AdminCustomersView.tsx#L1002) —
`onClick={() => toast.info("Funcionalidade em desenvolvimento")}`.

**Quem sente.** Quem vende. Uma opção de bloquear cliente que não bloqueia é pior que
opção nenhuma: só se descobre no dia em que ela precisava ter funcionado.

**Quanto dói.** Médio.

---

## 10. Cupom vencido continua "Ativo", contando como disponível

**O que a pessoa vê.** No guia de ajuda da tela de Cupons, sobre a Validade:

> "Defina uma data limite. Após esse prazo, o cupom é **desativado automaticamente pelo
> sistema**."

**O que é verdade.** Não existe nada que desative. O banco tem exatamente **dois** trabalhos
agendados, e nenhum toca em cupom: expirar pedidos vencidos (a cada 5 min) e a reconciliação
de pagamentos (a cada 10 min).

O que acontece de fato: o cupom vencido para de funcionar na validação (que compara
`valid_until < NOW()`), mas o campo `active` continua `true`. Na tela ele segue com o selo
verde piscando **ATIVO**, segue contando no KPI "Cupons Ativos · Disponíveis para uso", e
mostra "Expira em: <data no passado>" logo abaixo do selo de ativo.

**Evidência.**

- A promessa: [AdminCouponsView.tsx:732](../../src/views/admin/AdminCouponsView.tsx#L732).
- Os agendamentos vivos no banco (`cron.job`): `expirar_pedidos_vencidos()` e a chamada HTTP da reconciliação. Nada de cupom.
- O selo é o campo cru: [AdminCouponsView.tsx:557](../../src/views/admin/AdminCouponsView.tsx#L557) — `coupon.active ? "Ativo" : "Inativo"`, sem olhar `validUntil`.
- O KPI: [AdminCouponsView.tsx:161](../../src/views/admin/AdminCouponsView.tsx#L161) — `coupons.filter((c) => c.active).length`, também sem olhar a validade.

**Quem sente.** Quem vende: conta com uma limpeza automática que não existe e lê um painel
que apresenta cupom morto como campanha no ar.

**Quanto dói.** Médio. Hoje nenhum dos dois cupons tem validade preenchida, então não dá para
ver na tela — mas basta preencher uma data para o defeito aparecer.

---

## 11. O histórico de Push diz "ENVIADA" mesmo quando ninguém recebeu

**O que a pessoa vê.** Cada linha do "Histórico de Mensagens Enviadas" termina com o selo
verde **ENVIADA**, ao lado da contagem de clientes.

**O que é verdade.** O selo é texto fixo no componente — não olha nada. E o registro nasce
com `recipient_count: 0` de propósito ("o padrão honesto: entrega não confirmada", diz o
próprio comentário do código), só subindo quando a função de envio confirma entregas. Um
envio em que todos os aparelhos falharam fica gravado com 0 e é exibido como
**"0 clientes · ENVIADA"**.

Os toasts do momento do envio já foram corrigidos e dizem a verdade ("Nenhum dos N
dispositivos recebeu"). O histórico, que é onde se olha depois, não.

**Evidência.**

- O selo fixo: [AdminPushView.tsx:1166-1168](../../src/views/admin/AdminPushView.tsx#L1166) — `<span ...>Enviada</span>`, sem condição.
- O registro nasce zerado: [AdminPushView.tsx:339](../../src/views/admin/AdminPushView.tsx#L339) — `recipient_count: 0`; só é corrigido em [:416](../../src/views/admin/AdminPushView.tsx#L416) se `entregues > 0`.
- Banco: os 5 registros existentes têm `recipient_count = 1`, então o caso ainda não aconteceu aqui — o achado é do caminho de código, não de uma linha gravada.

**Quem sente.** Quem vende, ao revisar uma campanha depois.

**Quanto dói.** Médio-baixo.

---

## 12. "Receberão: 8 clientes" conta aparelhos, não clientes

**O que a pessoa vê.** No cabeçalho do formulário de envio, "Receberão: **8** clientes"; no
botão, "Enviar Notificação Agora (**8** clientes)".

**O que é verdade.** São 8 linhas em `push_subscriptions`, que são **inscrições de
aparelho/navegador**. Delas, **6 não têm dono** (`user_id` nulo — visitante que aceitou
notificações sem estar logado) e as outras 2 pertencem ao **mesmo** cliente. Cliente
distinto: **1**.

O próprio cartão ao lado usa a palavra certa — "8 Celulares e Computadores Cadastrados". É
só o texto de alcance que promove aparelho a cliente.

**Evidência.**

- [AdminPushView.tsx:656](../../src/views/admin/AdminPushView.tsx#L656) e [:957](../../src/views/admin/AdminPushView.tsx#L957).
- Origem do número: [AdminPushView.tsx:219-224](../../src/views/admin/AdminPushView.tsx#L219) — `count` de `push_subscriptions`.
- Banco: `aparelhos = 8`, `clientes_distintos = 1`, `sem_dono = 6`.

**Quem sente.** Quem vende, ao medir alcance.

**Quanto dói.** Baixo hoje, cresce junto com a base.

---

## 13. O "Audit Log" de frete nunca terá uma linha enquanto a loja usar Taxa Fixa

**O que a pessoa vê.** Na tela de Frete, a seção **"Histórico de Cotações & Audit Logs"**,
que ao expandir mostra "Nenhuma cotação registrada recentemente" e, no rodapé, "Exibindo as
15 consultas mais recentes".

**O que é verdade.** A função de cotação só grava em `shipping_calculation_logs` nos ramos
que chamam transportadora (sucesso, contingência e cache). Nos três ramos que respondem
direto — **taxa fixa**, entrega apenas local e carrinho todo com frete grátis — ela devolve a
resposta **antes** de qualquer gravação. Como a loja está em `flat_fee` (o padrão), a tabela
está e continuará em zero: não é "pouco movimento", é registro que não existe.

**Evidência.**

- Retorno antecipado: [calculate-shipping/index.ts:589-594](../../supabase/functions/calculate-shipping/index.ts#L589) — `if (provider === 'flat_fee' || ...) return new Response(...)`. Os inserts de log só aparecem depois, nas linhas 615, 854 e 879.
- Banco: `shipping_calculation_logs` → `total = 0`, `ultima = null`. Config atual: `shipping_provider = 'flat_fee'`.
- Confirmado na tela: seção expandida, "Nenhuma cotação registrada recentemente".

**Quem sente.** Quem vende, quando for diagnosticar por que um cliente não conseguiu calcular
frete — e encontrar um diário em branco que parece dizer "ninguém tentou".

**Quanto dói.** Baixo.

---

## 14. "pending" é o único status que aparece em inglês

**O que a pessoa vê.** No extrato do cliente, a coluna SITUAÇÃO mistura os dois idiomas:

> #CBBD2DF9 · 18 agosto, 26 · **pending** · R$ 1,00
> #96C81D5F · 17 agosto, 26 · **Cancelado** · R$ 1,00
> #2E3C99BE · 30 julho, 26 · **Entregue** · R$ 111,60

**O que é verdade.** A tradução é feita por uma lista de casos que cobre `new`, `processing`,
`shipping`, `delivered` e `cancelled`. `pending` não está lá e cai no caso padrão, que
imprime o valor cru. E `pending` é justamente o status que **toda** criação de pedido
carimba: é o estado inicial de todo pedido do app.

**Evidência.**

- A lista sem `pending`: [AdminUserDetailView.tsx:268-309](../../src/views/admin/AdminUserDetailView.tsx#L268) — o `default:` devolve `{status}`.
- O carimbo inicial: `create_marketplace_order_v23`/`v24` gravam `'pending'` no INSERT do pedido.
- Banco: 6 pedidos em `pending`. Confirmado na tela do cliente #5256DC84.

**Quem sente.** Quem vende.

**Quanto dói.** Baixo.

---

## 15. O mínimo de compra do cupom é exibido sem centavos

**O que a pessoa vê.** No card do cupom e na pré-visualização do formulário: **"Mínimo
Compra R$ 50"**.

**O que é verdade.** O valor é arredondado para exibição. Um cupom com mínimo de R$ 49,90
aparece como "R$ 50" nos dois lugares — e um de R$ 50,40 também. A coluna no banco é
`numeric`, aceita centavos, e o desconto em reais no mesmo card é mostrado com duas casas.

**Evidência.**

- [AdminCouponsView.tsx:604](../../src/views/admin/AdminCouponsView.tsx#L604) — `R$ ${Number(coupon.minPurchase).toFixed(0)}`.
- [AdminCouponFormView.tsx:243](../../src/views/admin/AdminCouponFormView.tsx#L243) — mesma conta na pré-visualização.
- Contraste, no mesmo card: [AdminCouponsView.tsx:595](../../src/views/admin/AdminCouponsView.tsx#L595) — o desconto fixo usa `.toFixed(2)`.
- Banco: `min_purchase` é `numeric` sem escala fixa. Hoje os dois cupons têm valor inteiro (50 e 100), então o defeito não está visível.

**Quem sente.** Quem vende, ao conferir a campanha; quem compra, se o valor divulgado vier
desse card.

**Quanto dói.** Baixo.

---

## 16. Dois textos errados na tela de Cupons

**O que a pessoa vê.**

> *Permitir que clientes usem cupons **no carrinho**.*
> (expandindo "Saiba mais") *...poderão digitar códigos de cupom (ex: GANHE10) no carrinho
> para receber **discounts** especiais.*

**O que é verdade.**

- O campo de cupom não fica no carrinho: existe **um só** `CouponInput` no app inteiro, e ele está na tela de checkout. O próprio guia de ajuda dessa mesma tela diz o certo — "O texto digitado pelo cliente **no checkout**".
- "discounts" está em inglês no meio de uma frase em português.

**Evidência.**

- [AdminCouponsView.tsx:340](../../src/views/admin/AdminCouponsView.tsx#L340) e [:381-382](../../src/views/admin/AdminCouponsView.tsx#L381) contra [:710](../../src/views/admin/AdminCouponsView.tsx#L710).
- Único uso do componente: [CheckoutView.tsx:1561](../../src/views/customer/CheckoutView.tsx#L1561), dentro de `config.enableCoupons &&` ([CheckoutView.tsx:1550](../../src/views/customer/CheckoutView.tsx#L1550)). Nenhuma ocorrência no carrinho.

**Quem sente.** Quem vende, ao procurar o campo no lugar errado para testar.

**Quanto dói.** Baixo.

---

## Resposta à sessão par: as três views apontadas NÃO têm o buraco

Em 20/08/2026 a sessão que auditou o lado de quem compra avisou que
`sales_overview`, `v_store_config` e `vw_questions_with_answers_count` teriam a mesma falha da
`vw_produtos_public` — visitante anônimo escrevendo pela view — e disse não ter testado
nenhuma das três. Testei, porque são do terreno deste relatório. **Não têm.**

Uma rodada só, em transação terminada em `ROLLBACK`, com controle positivo e negativo:

```
controle positivo: ok — o instrumento escreve quando tem direito

v_store_config                     0 linhas afetadas como anon
sales_overview                     PROTEGIDA (view não atualizável)
vw_questions_with_answers_count    0 linhas afetadas como anon
vw_produtos_public                 ABERTA — escreveu 19 linhas como anon
```

A última linha é o controle negativo: a view que está mesmo aberta escreveu 19 linhas na
mesma rodada, então o "0 linhas" nas outras não é o instrumento falhando.

**O que decide é o `security_invoker`.** As três têm `security_invoker = on` e rodam com o RLS
de quem chama; `vw_produtos_public` e `vw_produtos_admin` não têm, e por isso rodam como o
dono da tabela, isento de RLS. Nenhuma das tabelas base — `store_config`, `marketplace_orders`,
`questions`, `answers` — tem política de INSERT, UPDATE ou DELETE para `anon`: todas exigem
`authenticated` com `is_admin()`.

E confirmei que a proteção não é acidental: `anon` **enxerga** as linhas (1 em
`v_store_config`, 6 em `vw_questions_with_answers_count`) e mesmo assim não escreve. Se o
bloqueio viesse de o conjunto estar vazio, o `SELECT` também teria voltado zero.

---

## O que eu conferi e estava certo

Vale registrar, porque foram candidatos a achado que caíram na verificação:

- **Localização da Loja (Ajustes) faz o que promete.** Cidade e estado estão vazios no banco e o app realmente omite — o título da Home vira só "IKCOUS - imports", sem vírgula solta. Quando preenchidos, aparecem na Home, no produto, no checkout, no login e no bloco de frete grátis.
- **Diagnóstico de Conexão é medição de verdade.** Quatro consultas reais ao Supabase; mediu 250 ms de média (225/274) e 0% de perda, e classificou como "Conexão Lenta" — coerente com o que mediu.
- **Faixa de CEPs locais tem a mesma regra nos dois lados.** A função do banco (`is_local_cep`) e a da edge function (`isLocalCep`) são espelhos, incluindo o padrão de "mesmos 5 primeiros dígitos" quando a faixa está vazia. Não há o risco de cotar entrega local e recusar o pedido depois.
- **Frete e Ajustes batem com o banco, campo a campo.** CEP 38500-000, frete grátis 100, taxa 10, provedor `flat_fee`, cobertura nacional — a tela mostra exatamente o que está gravado.
- **"Novos (30d): 0"** está correto: nenhum perfil criado nos últimos 30 dias.
- **"Nenhuma cotação registrada"** não é falha de permissão: a tabela está mesmo vazia (é o achado 13, que é sobre a causa, não sobre o número).
- **O interruptor "Cupons de Desconto" funciona:** desligado, o campo some do checkout de verdade.

---

## 17. Achado novo: o "LTV Total" de cada cliente conta pedido que ninguém pagou

Não estava nesta auditoria. Nasceu em 20/08/2026, do `diretor` da frente de coordenação, e eu
confirmei na fonte antes de registrar.

**O que a pessoa vê.** Na lista de Clientes, cada linha traz **LTV Total R$ X** — e a tela
chama isso, em outro ponto, de "Maior LTV (Gasto Total)" e "LTV (Lifetime Value)".

**O que é verdade.** O número vem de `total_spent`, calculado em `get_admin_customers_paged`
por um `LEFT JOIN ... ON o.user_id = p.id AND o.status NOT IN ('cancelled','returned')` —
**sem nenhum filtro de cobrança**. Um cliente que gerou um PIX e nunca pagou entra na soma
como se tivesse gasto. O painel analítico, desde a migration `20260822000100`, conta só
dinheiro reconhecido (`payment_status` nulo, `pago` ou `pago_apos_expirar`).

É a mesma raiz do achado 4, num lugar que a correção do achado 4 não alcança: ali eu pude
mandar o card **ler** a fonte compartilhada, porque o Dashboard já publica um ticket médio.
Aqui não existe fonte compartilhada — ninguém mais calcula gasto **por cliente**. Fechar isto
exige mexer na própria `get_admin_customers_paged`, ou seja, uma migration numa função
consumida pela tela inteira.

**Evidência.**

- [baseline, corpo de `get_admin_customers_paged`](../../supabase/migrations/20260806000000_baseline_do_schema_vivo.sql#L1134) — `COALESCE(SUM(o.total::numeric), 0) as total_spent` sobre um join filtrado só por `status`.
- Onde aparece na tela: [AdminCustomersView.tsx:880](../../src/views/admin/AdminCustomersView.tsx#L880) e [:1106](../../src/views/admin/AdminCustomersView.tsx#L1106), ambos lendo `customer.total_spent`.
- A regra do outro lado: [`20260822000100`, linha 170](../../supabase/migrations/20260822000100_analitico_conta_so_dinheiro_reconhecido.sql#L170).

**Quem sente.** Quem vende: decide quem é bom cliente por um número que inclui dinheiro que
não entrou.

**Quanto dói.** Hoje, nada — o pg_cron já cancelou todos os pedidos que estavam aguardando, e
cancelado já sai da conta pelo filtro de `status`. Dói no primeiro PIX que ficar em aberto, e
dói de novo em toda loja clonada a partir daqui.

**⚠️ E há um efeito de conjunto que este achado agora carrega.** A correção do "Pedidos Totais"
(commit `3305ea8`) alinhou a **lista** de Clientes ao Dashboard, e com isso **desalinhou a lista
da ficha do cliente**, que ainda conta por `status`. Cliente com um pedido pago de R$ 100 e um
PIX pendente de R$ 50: a lista diz **"Pedidos Totais: 1"** e a ficha do mesmo cliente diz
**2 pedidos** — e como nenhum dos dois é cancelado, não aparece a linha "fora da conta" que
explicaria a diferença. O total do painel fica menor que a contagem de um cliente só, a um
clique de distância.

Isso **não é defeito da correção do "Pedidos Totais"** — escolher o Dashboard como fonte foi
certo. É a mesma raiz deste achado 17 aparecendo do outro lado, e é o motivo de a migration e a
ficha do cliente terem de andar **no mesmo pacote, nunca separadas**.

**Por que não corrigi junto.** É migration numa função consumida pela tela inteira, e não é um
dos 16 achados que o Gabriel mandou corrigir por ordem de dor. Fica para ele decidir se pula a
fila.

---

## 18. Achado novo: a tela de Push baixa credencial de envio para contar gente

Não estava nesta auditoria. Nasceu do `revisor` da frente irmã sobre o commit `6e406b4` — ou
seja, **é consequência da correção do achado 6**, e por isso entra aqui em vez de virar
pendência de outra pessoa.

**O que acontece.** Para saber quantas pessoas há em cada segmento, a tela chama
`get_segmented_push_targets` três vezes ao abrir e lê o tamanho da lista. Essa função devolve
`auth`, `endpoint` e `p256dh` de **cada** inscrição — as credenciais que o servidor usa para
enviar a notificação. A tela precisa de um inteiro e recebe o material de envio inteiro.

**Quanto pesa.** Estimado em ~380–450 bytes por inscrição em JSON (o endereço de entrega tem
200–300 caracteres, a chave pública 88, o segredo 24). Hoje são **8 inscrições, uns 3 KB, e
ninguém sente**. Com 1.000 seriam ~1,3 MB **a cada abertura da tela**, mesmo que o lojista não
clique em segmento nenhum; com 10.000, ~13 MB.

**Não é escalada de privilégio:** a função exige `is_admin()` e quem abre a tela já alcança
essas linhas. É dado sensível trafegando sem necessidade, não dado exposto a quem não devia.

**Por que não corrigi.** A correção natural é uma função de contagem no banco, devolvendo
quatro inteiros. Mas uma função de contagem com **os próprios** critérios de "cliente
frequente" pode discordar da função que escolhe o destinatário real — e isso recria o achado 6
numa forma pior, porque o número voltaria a ser fabricado com cara de medição. Existe desenho
que elimina o risco (a contagem chamar a mesma função de alvo em vez de repetir os critérios),
mas continua sendo mudança de banco que se replica para toda loja clonada, por um problema que
loja nenhuma tem hoje.

**O gatilho para voltar:** a primeira loja com centenas de inscrições de push.

**Quanto dói.** Hoje, nada. Cresce linearmente com a base.

---

## Pendências minhas

Coisas que eu não consegui verificar e que, por isso, **não** viraram achado:

1. **O painel do navegador ficou oculto durante toda a auditoria.** Sem ele, a página não
   compõe quadros e o `requestAnimationFrame` não roda — medido: um laço de 500 ms nunca
   completou. Isso congela as animações do `framer-motion` e faz listas inteiras (a de
   cupons, por exemplo) parecerem nunca carregar. Cheguei a tratar isso como defeito e
   derrubei o próprio achado desligando as animações em tempo de execução: com elas
   desligadas, os cupons apareceram normalmente. **Não há defeito ali** — mas também não
   consegui tirar nenhuma captura de tela desta auditoria.
2. **Não disparei push de verdade.** O envio manda notificação para aparelhos reais, o que é
   ação para fora. Então não verifiquei se a função `send-push` está com as chaves VAPID
   configuradas neste ambiente — se não estiver, todo envio falha e cai no caso do achado 11.
3. **Não criei pedido para provar o achado 1 na tela.** Provei pela regra: rodei a validação
   do checkout e o predicado exato da criação de pedido contra o mesmo cupom, na mesma
   consulta, e eles discordam. Fechar um pedido de teste para ver a mensagem de erro criaria
   linha no banco, o que estava fora do meu papel aqui.
4. **Não testei a divergência de status `returned`.** A lista de clientes exclui `returned` e
   a ficha não; hoje não existe nenhum pedido nesse status no banco, então o defeito é
   possível mas não observável. O mesmo vale para pedido com `status` nulo: existe um, mas é
   de convidado, então não aparece em ficha de cliente nenhuma.
5. **Achado NOVO, nascido em 20/08/2026 e que não estava nesta auditoria: a tela de Clientes e
   o Dashboard passaram a contar receita por regras diferentes.** Outra sessão aplicou no banco
   a migration `20260822000100_analitico_conta_so_dinheiro_reconhecido.sql`, que faz o painel
   analítico ignorar cobrança pendente ou fracassada
   (`payment_status IS NULL OR payment_status IN ('pago','pago_apos_expirar')`). Ela aplicou
   essa regra em nove pontos de `get_admin_analytics_v2`, mas **não** em
   `get_admin_customers_paged`, que alimenta a tela de Clientes. Hoje os dois dão o mesmo
   resultado (11 pedidos, R$ 450,50) porque o pg_cron já cancelou os pedidos que estavam
   aguardando — então a divergência não aparece na tela ainda. Ela vai aparecer no primeiro
   pedido de PIX em aberto: o Dashboard não vai contar, a tela de Clientes vai. Não ampliei a
   minha correção até lá de propósito, porque é trabalho em andamento de outra sessão e mexer
   ali criaria conflito. Fica registrado para quem for fechar.
6. **O banco mudou durante o trabalho, por outra mão.** Na hora da medição havia 84 pedidos;
   ao fechar o relatório, 83. O que sumiu foi exatamente o pedido de `status` nulo (R$ 105,00,
   de convidado) — o mesmo que a auditoria irmã de Pedidos e Produtos aponta como achado 1.
   Não fui eu: tudo que rodei ficou em transação com `ROLLBACK`, e não dei `DELETE` em nada.
   Registro porque os números deste relatório valem para o momento em que foram medidos.
7. **A coluna `used_count` existe em `coupons` além de `usage_count`.** A tela lê
   `used_count || usage_count`, e quem incrementa é `usage_count`. Hoje as duas estão em 0,
   então o `||` esconde o problema. Se `used_count` receber qualquer valor, a tela passa a
   mostrar o número errado de usos. Não consegui provar sem escrever no banco.
