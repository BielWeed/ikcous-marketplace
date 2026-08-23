# Laudo — CACA-LOJA · entrada do cliente, cliente logado, carrinho, busca, PWA

**Frente:** `caca-defeitos-loja` · **Sessão:** `local_7f87d84c-d073-426f-a2ae-b4a8c7a2eb3a`
**Data:** 20/08/2026 · **Árvore:** `3479eb3` (origin/develop integrada)
**Natureza:** auditoria SOMENTE LEITURA. Zero arquivo do repositório tocado, zero commit,
zero escrita de dado no banco.

> **Por que este arquivo existe:** o `fila-unica-de-dor.md` avisa que retrato escrito envelhece e
> vira instrução para refazer trabalho pronto. **Este documento carrega EVIDÊNCIA, não estado.**
> Ele não diz o que está aberto ou fechado — diz o que foi medido, quando, e com qual instrumento.
> Antes de pegar qualquer item daqui, **confira no código**: neste mesmo dia eu quase reportei
> como defeito uma busca que já estava consertada, porque um documento de auditoria dizia que
> estava quebrada e a minha medição concordava com ele. As duas evidências estavam erradas.

---

## Régua usada

Os degraus são os do `docs/auditoria/2026-08-20-fila-unica-de-dor.md`. O que decide o degrau é
**se quem usa consegue perceber o problema sozinho** — não a gravidade sentida por quem lê.

| Degrau | O que caracteriza |
|---|---|
| **1** | Mente em silêncio. Nada denuncia; a pessoa decide em cima achando que está certo |
| **2** | Promete o que não cumpre. Oferece função que não existe, ou afirma comportamento que não acontece |
| **3** | Atrapalha, e se vê. Custa tempo, não custa decisão errada |
| **4** | É feio, e não engana |

---

# OS 12 ACHADOS (13 numerados — **o 12 foi RETRATADO**)

*A numeração é ordem de DESCOBERTA, não de gravidade — os degraus é que ordenam. Os achados 12 e
13 vieram do lote 4 (`CheckoutView`), acrescentado depois do fechamento original.*

⚠️ **O achado 12 foi RETIRADO por medição minha, e o número foi mantido de propósito** — ele já
tinha circulado no time, e apagar deixaria as mensagens antigas apontando para o vazio. **Ele está
lá marcado como falso, com a medição que o derruba.** Se alguém te mandar consertar o achado 12,
a resposta é: não há o que consertar.

## 1 · 🔴 Degrau 1 — O cliente pagou e a tela diz que a loja está esperando o pagamento

**O que a pessoa vê.** Abre o pedido. No topo: *"Pedido Recebido — Aguardando confirmação de
pagamento para iniciar a separação."* Logo abaixo, na mesma tela: *"pix · ● Confirmado via
Gateway"*. Duas frases que se contradizem, e a pessoa já pagou.

**O que está errado.** As duas telas do cliente leem **só** `order.status`. A coluna
`payment_status` — a única que sabe se o dinheiro entrou — não é lida em lugar nenhum fora de
`src/views/admin/`. E o selo "Confirmado via Gateway" é **texto fixo no JSX**, sem condição
nenhuma: aparece igual em pedido pago, expirado e nunca pago.

**Não é caso de borda — é o caminho feliz.** `confirmar_pagamento` não avança o `status` no ramo
do pagamento, por desenho: quem avança é o lojista, à mão, no painel. Então **toda venda paga**
atravessa essa janela.

**Quem sente.** Quem compra lê que o pagamento não entrou — e a leitura natural é "falhou": paga
de novo, abre disputa, ou desiste. Quem vende recebe "meu pagamento caiu?", ou um pagamento em
dobro, ou um estorno.

**Evidência**
- `src/views/customer/OrderDetailsView.tsx:51` — o texto do estado `pending`
- `src/views/customer/OrderDetailsView.tsx:644` — o selo fixo
- `src/components/ui/custom/OrderList.tsx:23-29` — a lista tem o mesmo buraco
- `src/lib/mappers.ts:246` — **o dado JÁ chega ao cliente**: `payment_status → paymentStatus`,
  e o fetch do cliente é `select("*")`. A tela só ignora. Isso torna o conserto pequeno.
- `grep -rn "paymentStatus" src/` → **todos** os acertos em `admin/`. Nenhum na área do cliente.
- Banco, cruzamento `status × payment_status`:
  `pending×pago = 3` · `cancelled×expirado = 27` · `cancelled×pago_apos_expirar = 1`
  Os 3 são `payment_method='online'`, de cliente com conta, parados 2/3/4 dias.
- Corpo VIVO de `confirmar_pagamento` (`pg_get_functiondef`, 11.811 caracteres): no ramo
  `p_status='pago'`, os três UPDATE escrevem **só** `payment_status`.
- `marketplace_order_history`: `pending→processing` = 5 transições, **`sem_autor = 0`**.
  Nunca houve avanço automático.

⚠️ **Precisão que custou uma retratação, e que precisa sobreviver a este documento:**
`confirmar_pagamento` **escreve `status`** em dois outros ramos — `estornado` e `recusado`,
ambos para `'cancelled'`. A frase *"ela nunca toca em status"* circulou no time e é **falsa**;
nasceu de um `grep -c "SET status"` num **arquivo de migration** (não no corpo vivo) que não
casava por causa do espaçamento de alinhamento. Quem "consertar" acrescentando avanço automático
de status atropela dois ramos deliberados e as guardas contra creditar estoque duas vezes.

---

## 2 · 🟠 Degrau 2 — O app promete avisar sobre o pedido, e nada cria esse aviso

**O que a pessoa vê.** Ao fechar a compra: *"Você receberá atualizações em breve."* Na aba
Pedidos das Notificações: *"Suas atualizações de entrega, confirmações e status de rastreamento
aparecerão nesta aba."*

**O que está errado.** Nunca aparecem.

**Evidência**
- `src/views/customer/OrderSuccessView.tsx:26-28` · `src/views/customer/NotificationsView.tsx:221-224`
- `SELECT count(*) FROM notificacoes` → **0**, em 5 meses e 83 pedidos
- `SELECT proname FROM pg_proc WHERE prosrc ~* 'notificacoes'` → **0 funções**
- 0 triggers em `marketplace_orders` (denominador: 8 triggers vivos em `public`)
- `push_notifications_log` → 5 · `push_subscriptions` → 8, para 16 perfis

---

## 3 · 🟠 Degrau 2 — O aviso "para todos" não sai da caixa por NENHUM caminho

**O que a pessoa vê.** Crachá vermelho no sino. Toca em "Lidas": some. Reabre o app: voltou.
Para sempre. E não consegue apagar o aviso também.

**O que está errado.** O broadcast é gravado com `usuario_id = NULL`. O RLS deixa **ler** e não
deixa **marcar como lido** nem **apagar**:
```
SELECT : uid = usuario_id OR usuario_id IS NULL OR is_admin()
UPDATE : uid = usuario_id OR is_admin()      ← falta OR usuario_id IS NULL
DELETE : uid = usuario_id OR is_admin()      ← falta também
```
`auth.uid() = NULL` avalia para NULL → a linha é filtrada. **RLS em UPDATE filtra em silêncio:**
0 linhas, **sem erro**. O código faz `if (error) throw` — o erro nunca vem — e pinta tudo como
lido na tela.

**Metade deste achado é do CACA-PAINEL** (o `DELETE`; eu só tinha mapeado o `UPDATE`).

**Evidência:** `src/contexts/NotificationContext.tsx:76-88` e `:167` →
`src/components/ui/custom/Header.tsx:363-365`; `src/views/admin/AdminPushView.tsx:479-489`
(o insert com `usuario_id: null`); `pg_policies` sobre `notificacoes`.

⚠️ **DORMENTE.** `notificacoes` tem **0 linhas**, logo **0 broadcasts**. Isto é certo pela leitura
da policy e **nunca foi observado acontecer**. Merece conserto pelo custo (duas linhas de policy),
não por estar doendo hoje.
⚠️ **Ordem de conserto (do CACA-FUNDO, e é melhor que a minha leitura):** consertar a policy
sozinha **não** faz o crachá funcionar, porque não há o que marcar como lido. Vai junto com o
achado 2 ou o conserto parece feito e não é.

---

## 4 · 🟠 Degrau 2 — O app ensina uma regra de senha que o servidor recusa

**O que a pessoa vê.** No campo de nova senha: **"Mínimo 6 caracteres"**. Digita 6, confia no que
leu, e leva em inglês: *"Password should be at least 8 characters."* No cadastro é pior: nenhuma
regra é dita, e o único aviso é o inglês.

**Evidência — medido na tela, com o app rodando, e nenhuma conta foi criada:**
```
senha de 3 caracteres → "Password should be at least 8 characters. Password is known to be
                         weak and easy to guess, please choose a different one."
senha de 7, FORTE (Xk7#pQz) → "Password should be at least 8 characters."   → o servidor exige 8
```
- `src/views/customer/AccountSettingsView.tsx:632` (placeholder) e `:294-295` (valida `< 6`)
- `src/views/shared/AuthView.tsx:222-223` (valida `< 6`)
- `src/views/shared/AuthView.tsx:185-199` — o cadastro **não** valida tamanho nenhum

---

## 5 · 🟠 Degrau 2 — O visitante fica travado no último passo, com uma instrução impossível

**O que a pessoa vê.** Sem conta, põe no carrinho, volta dias depois, preenche endereço, escolhe
frete, toca em finalizar: *"Os valores do pedido mudaram. Atualize o carrinho e tente novamente."*
Vai ao carrinho: está igual. Recarrega: igual. **Não existe "atualizar o carrinho" no app.**

**O que está errado — três peças, nenhuma delas sozinha é o defeito:**
1. O carrinho guarda o **objeto do produto inteiro, com preço**, no localStorage
   (`src/contexts/CartContext.tsx:20` → `product: z.any()`, serializado em `:173`)
2. Para quem **não tem conta**, esse objeto **nunca é reconferido** —
   `CartContext.tsx:189-195`: `if (!userId) { "Preserving local cart"; return; }`.
   Quem está logado ganha releitura na abertura (`:230-240`); o visitante, nunca.
3. O banco confere e recusa, **corretamente**: `IF ABS(v_calculated_total - p_total_amount) > 0.05`
   no corpo vivo de `create_marketplace_order_v24`.

**O backend está certo** — a guarda é o que impede fraude de preço, e a mensagem até vem em
português e diz o que fazer. **O defeito é o front não ter a ação que a mensagem manda executar:**
`grep -rn "Atualize o carrinho\|refreshCart" src/` → **vazio**. A única saída é remover e
re-adicionar o item, que a mensagem não diz.

**Quem sente.** Quem compra e **ainda não tem conta** — o cliente novo, o mais caro de conseguir e
o que some sem reclamar. Quem vende perde a venda sem nunca saber: não há pedido, nem registro,
nem aviso no painel.

⚠️ **Alcance:** mecanismo completo e provado no código; **disparo não observado**. O gatilho é o
preço mudar enquanto um carrinho de visitante espera. Medi o que dá: **3 de 23** produtos foram
editados em dia diferente do cadastro, 1 nos últimos 30 dias — o que mostra que edição acontece,
mas **não isola mudança de preço** (a coluna também mexe com estoque, nome e imagem).

---

## 6 · 🟠 Degrau 2 — "Quero Receber!" não faz nada e não diz nada

**O que a pessoa vê.** O banner sobe: *"IKCOUS Novidades 🔔 — promoções, novidades e ofertas
exclusivas direto no seu celular!"*. Toca em **"Quero Receber!"**. O botão pulsa "Ativando...",
volta ao normal, e **nada acontece**: sem erro, sem pedido de permissão do navegador, banner ainda
lá. Toca de novo: mesmo nada.

**O que está errado.** `subscribe()` tem **três** saídas e só duas falam:
```
sucesso              → toast.success + devolve a inscrição
erro                 → toast.error + relança
chave VAPID ausente  → console.warn + return seco     ← usePushNotifications.ts:39-42
```
E quem chamou faz `const result = await subscribe(); if (result) setIsVisible(false);` — **sem
else** (`PushNotificationBanner.tsx:70-79`; o `catch` ali é só `console.error`).

**É a mesma função que avisa no sucesso e no erro.** A saída muda é descuido, não desenho.

⚠️ **Alcance:** `VITE_VAPID_PUBLIC_KEY` existe no `.env` (87 caracteres, chave real) e **não**
existe no `.env.production` nem no `.env.local`. Os dois são **gitignored** (`.gitignore:4` e `:8`).
Em ambiente sem a variável configurada por fora, o botão nasce morto. **Se está firing em produção
hoje eu não sei** — a variável viria do painel da Vercel, que não é meu terreno e não fui ler.
O defeito de código vale independente: uma saída de três que não fala.
*(Variáveis conferidas por script que só mede presença e comprimento, sem imprimir a chave.)*

---

## 7 · 🟡 Degrau 2 — **LATENTE** — "Max: 8" e "Max: 10" não fazem nada no carrossel de Novidades

> 🔴 **CORREÇÃO (20/08/2026, depois de o CACA-PAINEL apontar e eu medir):** eu reportei este achado
> como **vivo** — *"o lojista escolhe Max: 10, salva, e a loja mostra 6"*. **Esse "salva" não
> acontece, e o defeito não atinge ninguém hoje.** Ele é **latente**, da mesma família do achado 9.
>
> **Duas medições minhas, independentes do aviso dele:**
> ```
> coluna home_sections em store_config  →  NÃO EXISTE (0 colunas)
> defaultStoreConfig.homeSections (StoreContext.tsx:40-44) → 3 seções, NENHUMA com maxItems
> ```
> **O mecanismo real é o segundo, e ninguém o tinha nomeado:** como o objeto padrão não traz
> `maxItems`, `HomeView.tsx:313` resolve `section.maxItems ?? 6` para **6, sempre**. E `6` é
> exatamente o corte prévio. **Os dois números coincidem, então o defeito é invisível** — não
> porque não exista, mas porque o valor que o expõe nunca chega lá.
>
> ⚠️ *Reparo no enquadramento do CACA-PAINEL:* ele escreveu que `config.homeSections` é "sempre
> `undefined`". Não é — é o **array padrão**, então o `?? []` de `HomeView.tsx:302` nunca dispara.
> A conclusão dele está certa; o mecanismo é outro.
>
> **Consequência para quem consertar, e é o que importa:** o alcance deste achado **aumenta
> depois** que a persistência de `home_sections` for consertada. Quem fechar aquilo destrava o
> seletor e, no mesmo instante, este defeito ganha vítima. **As duas coisas têm de ir na mesma
> cabeça**, ou este é fechado medindo só as 3 seções fixas e reabre depois.

**O que a pessoa veria** (quando o seletor passar a salvar). O lojista escolhe "Max: 10" em
Novidades. A loja continua mostrando **6**. Escolhe 8: continua 6.

**O que está errado.** `HomeView.tsx:180` corta em `.slice(0, 6)` **antes** de o `maxItems` ser
aplicado em `:327`. Cortar 6 em 10 dá 6.

**O corte prévio é DIFERENTE por seção — e isso importa para não consertar o que não quebrou:**

| Seção | corte prévio | produtos hoje | Max 4 | Max 6 | Max 8 | Max 10 |
|---|---|---|---|---|---|---|
| **Novidades** | `.slice(0,6)` `:180` | **19** | ✔ | ✔ | ✘ dá 6 | ✘ dá 6 |
| Ofertas | `.slice(0,10)` `:191` | **4** | ✔ | ✔ | ✔ | ✔ |
| Mais Vendidos | `.slice(0,10)` `:203` | **0** | seção não renderiza | | | |
| Lista manual (`productIds`) | nenhum | — | ✔ | ✔ | ✔ | ✔ |
| **Vitrine personalizada em modo automático** | cai no `else` `:327` → `newArrivals`, `.slice(0,6)` | — | ✔ | ✔ | ✘ dá 6 | ✘ dá 6 |

*A quinta linha é do CACA-PAINEL e não apareceu na minha medição por um motivo legítimo: **não
existe nenhuma vitrine personalizada para medir hoje**, porque a persistência de `home_sections`
não existe. Ela entra na conta no dia em que aquilo for consertado.*

**A ironia que decide a prioridade:** o defeito acerta **exatamente a única seção que tem produtos
suficientes** para 8 e 10 significarem alguma coisa.

*Origem: CACA-PAINEL (o seletor é a tela dele). Assumido por mim porque o corte é meu terreno.
O enquadramento original dele — "não têm efeito nenhum" — era largo demais; esta tabela é a
medição.*

---

## 8 · 🟡 Degrau 2 — A tela de login do painel aceita a senha de um cliente comum, calada

**O que a pessoa vê.** Em `/admin-login`, sob *"Acesso exclusivo à gestão do lojista"*, digita
e-mail e senha de uma conta de cliente. **Nenhum erro.** O spinner para e ela é jogada na home,
sem explicação. E fica logada como cliente.

**O que está errado.** `AdminLoginView` só olha `success` do `login()`, que é verdadeiro para
**qualquer** conta válida; nunca consulta `isAdmin`. A mensagem *"Email ou senha administrativos
incorretos"* nunca dispara no caso exato que ela nomeia.

**NÃO é buraco de segurança** — conferi as duas guardas e elas funcionam: `src/App.tsx:775-782`
(`handleNavigate`) e `:1597-1612` (`syncWithUrl`) barram qualquer view `admin*` para quem não é
admin. O painel está protegido. O defeito é a tela nunca dizer "não".

**Quem sente.** Quem vende — o caso provável é o próprio lojista errando qual conta usou.

**Evidência:** `src/views/admin/AdminLoginView.tsx:29-36`; `src/contexts/AuthContext.tsx:605-622`.

---

## 9 · 🟡 Degrau 3 (latente) — A tela do pedido quebra inteira num status que o banco aceita

**O que a pessoa veria.** Tela branca em vez do pedido.

**O que está errado.** O CHECK do banco aceita **6** status
(`pending, processing, shipping, delivered, cancelled, new`); o `statusConfig` da tela tem **5**
(falta `new`), e o tipo `OrderStatus` também — então o typecheck não enxerga o buraco.

**O que fecha o caso: a tela irmã já tem a proteção.**
```
OrderList.tsx:200         statusConfig[order.status] || statusConfig.pending
OrderDetailsView.tsx:280  statusConfig[order.status]        ← sem o fallback, e :281 lê .icon
```
Não é escolha de desenho: é o `||` que faltou num dos dois arquivos. **O conserto é copiar o
vizinho**, não decidir nada.

⚠️ **Latente.** `new` é status legado: a migration `20260327000003` migrou os antigos para
`pending` (linhas 20-24) mas **manteve `new` no CHECK** (linha 16), e funções vivas de analytics
ainda contam `status IN ('new','processing')`. Hoje **0 pedidos** têm `new`. Porta aberta, não
incêndio.

---

## 10 · ⚪ Degrau 4 — Todo erro de login aparece duas vezes, uma em inglês

**Medido na tela:** senha errada devolve, juntos —
banner *"E-MAIL OU SENHA INCORRETOS. VERIFIQUE SUAS CREDENCIAIS."* + torrada *"Erro ao entrar:
Invalid login credentials"*.

`AuthView.tsx:137-180` tem um bloco de tradução escrito de propósito (#200), e o `AuthContext`
dispara antes dele um toast com o `error.message` cru. Vale para entrar, cadastrar, reenviar
confirmação e trocar senha: `src/contexts/AuthContext.tsx` linhas **597, 616, 675, 786**.

**O caminho de "Esqueci a senha" NÃO tem o problema** (`AuthContext.tsx:721-725`) — alguém já
resolveu ali de propósito. Existe precedente na casa; isto é o descuido.

---

## 11 · ⚪ Degrau 4 — Miudezas

- `src/views/customer/AddressFormView.tsx:60` — *"seu produto da **ICKOUS**"* (letras trocadas)
- `src/views/customer/OrderDetailsView.tsx:637-639` — forma de pagamento crua quando não é cartão:
  "Pix", "Cash", "Online". Só `card` foi traduzido.
- `src/hooks/useUpdateCheck.ts:216-219` — `pwa_reload_reason` é gravado **antes** de tentar
  atualizar, e o reload acontece de qualquer jeito (fallback de 1200 ms, incondicional); na volta
  `App.tsx:1236-1242` mostra "Sistema Atualizado". Sucesso que não depende de ter dado certo.
  **Não reproduzi uma atualização falhando** — suspeita, não achado.

---

# LOTE 4 — `CheckoutView.tsx` (cupom · convidado · falha no meio)

*Acrescentado em 21/08/2026, depois de a CENTRAL liberar o arquivo com escopo. **Sem frete e sem
cotação**, de propósito: o conserto do frete vai reescrever aquela fronteira, e auditar alvo em
movimento gasta o trabalho à toa. O resto das 2.412 linhas continua **não aberto**.*

## 12 · ❌ RETRATADO — ~~A tela manda o convidado "entrar na conta" para cancelar~~

> 🔴 **ACHADO RETIRADO em 21/08/2026, por medição minha. Não é latente como o 11 — é FALSO, e
> falso nos dois sentidos. NÃO CONSERTAR NADA POR CAUSA DELE.**
>
> **(1) A tela não renderiza para convidado.** `CheckoutView.tsx:523-527` tem um efeito que expulsa
> `paymentMethod` de `"online"` sempre que não há sessão:
> ```js
> if (!authLoading && !user && paymentMethod === "online") setPaymentMethod("pix");
> ```
> E a cadeia até a tela do achado é: `:936 ehOnline = paymentMethod === "online"` →
> `:957 if (ehOnline) setAguardandoPagamento(true)` → `:1142 {user ? <botão> : <a mensagem>}`.
> **Sem conta, `ehOnline` nunca é verdadeiro, a tela nunca abre.** Confirmado também no backend:
> `criar-pagamento/index.ts:459` recusa com `PAGAMENTO_ONLINE_EXIGE_CONTA`.
>
> **(2) No único caminho em que a mensagem aparece, ela está CERTA.** É o caso que o próprio
> comentário do código nomeia: cliente **logado** escolhe pagamento online, o pedido é criado, e a
> **sessão expira** com a tela aberta. Aí `user` cai para `null` e o ramo vira a mensagem de
> convidado — **mas o pedido dele tem dono** (`user_id = auth.uid()`, gravado quando havia sessão).
> Então *"entre na sua conta"* é exatamente o conselho certo para a única pessoa que lê aquilo.
>
> **O que a versão anterior afirmava:** que a frase era mentirosa, degrau 2, atingindo 57% dos
> compradores (47 de 83 pedidos de convidado).
>
> **Por que eu errei, e não foi falta de medição.** O fato estava no relatório que eu li **no
> começo desta sessão**: *"PIX de convidado: não é buraco (…) o pagamento online **exige conta**
> (`PAGAMENTO_ONLINE_EXIGE_CONTA`), então não existe convidado esperando confirmação de PIX."*
> Medi tudo o que estava dentro do arquivo que abri, e **não medi a premissa de que aquela tela
> era alcançável**. O que me convenceu foi o `user ? … : …` no código — **ramo defensivo não é
> prova de alcance.** Mesma família do resto do dia: instrumento certo, pergunta errada.
>
> **O que sobra de pé, medido e útil para OUTRAS frentes:** o pedido de convidado nasce sem dono e
> nada o adota depois (**0 funções** em `pg_proc` escrevem `user_id` em `marketplace_orders`);
> **47 de 83 pedidos (57%) são de convidado**; e, pela guarda acima, **todo pedido de convidado é
> "na entrega"** — o que o CACA-FUNDO usou para agravar um achado dele sobre a varredura de
> expiração. **Do lado da tela, não sobra achado nenhum.**

<details>
<summary>Texto original do achado retratado (mantido para quem já o leu)</summary>

**O que a pessoa vê.** Comprou **sem conta**, o pagamento online falhou. Na tela de erro:

> *"Como você não está com a conta aberta, não é possível cancelar por aqui. Se o pagamento não
> sair em 30 minutos, o pedido é cancelado automaticamente e os itens voltam para o estoque.
> **Para cancelar agora, entre na sua conta.**"*

Ela entra na conta. **O pedido não está lá.** Não aparece em "Meus Pedidos", não há o que cancelar,
não existe caminho para chegar nele. E ir para o login **desmonta a tela de pagamento** — ela perde
também o que tinha na mão.

**O que está errado.** O pedido de convidado nasce **sem dono, para sempre**:
- `create_marketplace_order_v24` grava `user_id := auth.uid()` **no instante da criação**. Sem
  sessão, grava `NULL`.
- **Nenhuma função do banco adota pedido de convidado para uma conta depois** — varri `pg_proc`
  inteiro procurando quem escreva `user_id` em `marketplace_orders`: **0 funções**.
- Logo, entrar na conta não muda nada: a policy de leitura é `auth.uid() = user_id`, e `NULL` nunca
  casa; `update_order_status_atomic` recusa com *"Você não tem permissão para alterar este pedido"*,
  porque `NULL IS DISTINCT FROM <uuid>` é verdadeiro.

**As duas primeiras frases são VERDADEIRAS** — a varredura de 30 minutos existe e funciona (27
pedidos `expirado`, todos `cancelled`). **Só a última é falsa, e é a única que pede ação.** Não é
uma tela mentirosa: é **uma frase mentirosa dentro de um aviso honesto**.

**Quem sente, e o tamanho:** quem compra **sem conta** — que aqui é a maioria.
```
pedidos sem dono (convidado): 47
pedidos com conta:            36
                       total: 83     → 57% do historico e convidado
```

**Evidência:** `src/views/customer/CheckoutView.tsx:1160-1170` (o texto) e `:1142` (o botão real,
condicionado a `user`); corpo vivo de `create_marketplace_order_v24`; `pg_policies` de
`marketplace_orders`.

⚠️ **A intenção está documentada em cima do defeito** — o comentário do código diz que o convidado
*"precisa saber (…) que entrar na conta é a única forma de cancelar antes disso"*. **Quem escreveu
acreditava que resolvia.** Um conserto anterior, feito para não deixar o convidado no escuro, criou
a instrução falsa — e ela passou despercebida porque *parece* cuidadosa.

~~**Escopo do conserto (decidido pela CENTRAL):** trocar a frase.~~ — **CANCELADO junto com o
achado. Não há o que consertar.**

</details>

## 13 · ⚪ Degrau 4 — Na hora do pedido, todo motivo de recusa de cupom vira "inválido ou expirado"

O `WHERE` de `create_marketplace_order_v24` junta código inexistente, inativo, vencido, limite
estourado **e abaixo do mínimo** — e todos saem como
`RAISE EXCEPTION 'Cupom % inválido ou expirado.'`. Na hora de **aplicar**, as mensagens são
distintas (`validate_coupon_secure_v2` tem ramo próprio para `min_purchase`). Então um cupom
perfeitamente válido que falhe por carrinho abaixo do mínimo é anunciado como inválido.

⚠️ **Janela estreita, declarada:** sair do checkout desmonta a tela e zera o cupom aplicado, então
o subtotal quase não muda entre aplicar e enviar. Por isso degrau 4 e não mais.

---

# O QUE FOI CONFERIDO E ESTÁ CERTO

**Esta seção é o que impede o próximo de refazer.** Cada item abaixo foi uma hipótese que eu
persegui e **derrubei com evidência**.

| # | Hipótese perseguida | Por que caiu |
|---|---|---|
| 1 | Cache de endereços envelhece | `addAddress`/`updateAddress`/`deleteAddress` gravam o localStorage nas três — `useAddresses.ts:143, 201, 230` |
| 2 | Favoritos somem por paginação do catálogo | A busca pagina de 10 (`useProducts.ts:308`), mas o `StoreContext` carrega com `.limit(200)` (`StoreContext.tsx:400-404`), e é dele que o favorito é resolvido |
| 3 | Cliente não consegue cancelar pedido / valida só no cliente | `validateStatusUpdate` (`useOrders.ts:18-37`) só deixa `cancelled` em `pending` — e o corpo VIVO de `update_order_status_atomic` **repete as duas travas no banco**, mais a de dono. O estoque volta no cancelamento |
| 4 | O telefone do cadastro se perde (tela manda `phone`, tabela tem `whatsapp`) | O gatilho vivo `handle_new_user` mapeia `raw_user_meta_data->>'phone' → whatsapp`. Cruzamento: **0** usuários com phone no cadastro e whatsapp vazio |
| 5 | `variant_id` como string vazia quebra o sync do carrinho | A coluna é `text NOT NULL DEFAULT ''`. A string vazia **é o desenho** |
| 6 | Carrinhos com item órfão | 14 itens, 5 usuários: produto inexistente **0**, fora da vitrine **0**, variante inexistente **0** |
| 7 | Carrinho acima do estoque | 14 conferidos, `quantidade > estoque` = **0** (maior qtd: 4; menor estoque: 2) |
| 8 | `addToCart` não respeita estoque | Trava em `availableStock` **e** `MAX_ITEM_QUANTITY`, barra esgotado, avisa quando corta — `CartContext.tsx:544-600` |
| 9 | **A busca da loja não trata acento** | **Ela trata.** Ver o alerta abaixo — este quase virou achado falso |
| 10 | E-mail editável em Configurações da Conta fingindo que salva | É `disabled` com cadeado — `AccountSettingsView.tsx:594-604` |
| 11 | **Cupom: furo de dinheiro no checkout** | **Não existe.** Ver o bloco abaixo — esta é a verificação mais valiosa do laudo, porque REBAIXOU um achado de outra frente |
| 12 | Duplo toque cria dois pedidos | Trava **síncrona por ref ANTES do primeiro `await`** (`CheckoutView.tsx:846`) — `disabled={isSubmitting}` só vale no render seguinte. O comentário registra o dano que a motivou: estoque debitado 2×, cupom de uso único consumido 2× |
| 13 | Pagamento online anunciado como sucesso antes de confirmar | Não é: `if (ehOnline) { setAguardandoPagamento(true); return; }` — sem confete, sem "sucesso". Quem confirma é o webhook |
| 14 | Pedido criado + pagamento falho perde os itens do carrinho | Não perde: snapshot **antes** do `onClearCart()` (`:945`), restaurado no cancelamento *(só para quem tem conta — é o achado 12)* |
| 15 | `onClearCart()` faz o Brick cobrar valor diferente do gravado | Não faz: o valor é **congelado no submit** (`valorDoPedido`) |
| 16 | A tela confia no retorno do cancelamento para dizer "cancelado" | Não confia: **relê o status real** do pedido depois da RPC e só navega se a releitura disser `cancelled` — porque o ramo offline resolve sem lançar e a mensagem de guarda é a mesma para dois casos opostos |

## 💰 O cupom: fui atrás de furo de dinheiro no checkout e NÃO existe

Vale um bloco próprio porque esta verificação **rebaixou um achado de outra frente** — o
CACA-FUNDO tinha medido que qualquer visitante lê todos os cupons ativos, e aquilo estava no
degrau 1, competindo com o frete e o PIX.

**O cliente NUNCA manda o valor do desconto** — manda só o código
(`CheckoutView.tsx:930` → `couponCode`). O `discount` da tela é enfeite: entra no `p_total_amount`,
que é **checksum**, não fonte.

| Onde | O que faz |
|---|---|
| `validate_coupon_secure_v2` (ao aplicar) | ramo próprio para `min_purchase`; **limita o desconto ao subtotal** (comentário literal: `-- Cap discount at subtotal`) |
| `create_marketplace_order_v24` (ao pedir) | **reconfere tudo do zero** contra o subtotal que ela mesma calcula — `AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)` —, recalcula o desconto, **limita de novo**, e fecha com `GREATEST(0, subtotal + frete - desconto)`. Só então incrementa `usage_count` |

**Conclusão:** quem descobre um código só consegue usar cupom **genuinamente válido**. O dano do
vazamento é **comercial** (o código promocional que a loja não anunciou), **não financeiro**.

**Efeito na fila:** aquele achado saiu do degrau 1 e foi para o degrau 2. Continua valendo
conserto; parou de competir com dinheiro de verdade. **Achado que encolhe por medição vale tanto
quanto achado novo** — e vale mais quando encolhe no próprio terreno de quem mediu.

## 🔴 O quase-erro que vale mais que os achados

Eu tinha **duas evidências concordando** de que a busca da loja estava quebrada:
- medição no banco: `ILIKE` sem acento devolvia **0** para todos os termos, com controle positivo
  (com acento: 2, 1, 1, 1, 1) e controle negativo (`escova`, sem acento no nome: 3) — instrumento
  provado;
- o `docs/auditoria/2026-08-20-cliente-e-backend.md` dizendo, por escrito, *"Busca — cobertura
  RASA (...) só olha nome e descrição (...) não olhei o comportamento com acento"*.

**As duas estavam erradas.** Fui digitar "eletrica" na tela antes de escrever o achado: **acha os
2 produtos**, e a sugestão ainda normaliza para "Elétrica". A busca já tinha sido consertada —
`normalizeText` (`src/lib/utils.ts:58-63`), aplicada nos dois lados da comparação.

Eu tinha medido **o ingrediente** (`ILIKE` no banco), não **o prato** (a busca que roda). O
caminho cego a acento existe, mas é o do **painel** (`useProducts.ts:356`, chamado só por
`AdminLayout`, `AdminProductsView` e `AdminPushView`) — entregue ao CACA-PAINEL, com a medição.

**A regra que sobra: documento de auditoria não é fonte sobre o estado do código. Só o código é.**

## Pista aberta (NÃO é achado — a confirmação ao vivo ficou bloqueada)

Existem **dois** caminhos de busca no lado do cliente e eles **não cobrem os mesmos campos**:

| Caminho | Usado por | Campos que casam com o texto digitado |
|---|---|---|
| `SearchBar.tsx` | `Header.tsx:259` (sugestões) | nome, descrição, categoria, tags |
| `useSearch.ts:25-31` | `SearchView.tsx:99` (página de resultados) | **só** nome e descrição |

Em `useSearch`, categoria não é campo de busca — é filtro separado por igualdade
(`matchesCategory`), servido pelos chips da tela. **Consequência esperada:** digitar o nome de uma
categoria sugere produtos no menu suspenso e pode não trazê-los na lista de resultados abaixo.

⚠️ **Não confirmei na tela**, e por isso isto **não** é achado: o servidor de dev quebrou no meio
do teste (`node_modules/@vitejs/plugin-react` sumiu durante um `npm ci` de outra sessão; o Vite
registrou `server restart failed`). O servidor é compartilhado e eu não o reiniciei por cima de
quem estava trabalhando. **Depois do que está escrito acima, eu não vou transformar leitura de
código em comportamento afirmado.** Fecha em minutos quando o servidor voltar.
*Pista levantada pela CENTRAL ao aplicar a rasura no documento de auditoria.*

---

# MÉTODO, E UM INCIDENTE QUE EU CAUSEI

**O que sustenta cada achado:** `arquivo:linha` **e** uma segunda fonte — consulta ao banco, ou
teste na tela com o app rodando. Onde só houve leitura de código, está escrito.

**Limites declarados**
- **Não testei logado como cliente.** Não tenho credencial e não pedi nenhuma. Os achados 1, 2, 3
  e 9 se sustentam em código + estado do banco.
- **Não entrei** em: interior das edge functions, migrations, telas de admin fora do login,
  vitrine e produto (cobertos pela auditoria de 20/08), e **`CheckoutView.tsx`** — 2.412 linhas,
  das quais só quatro trechos foram lidos por aquela auditoria. **É o maior arquivo não varrido
  desta superfície.** A CENTRAL mandou não abrir agora: o conserto do frete vai reescrever a
  fronteira checkout↔frete↔RPC, e auditar arquivo que vai ser reescrito é medir alvo em movimento.

## ⚠️ Incidente: eu envenenei o pool de conexões do banco de dev

**O que eu fiz de errado.** Minhas sondas abriam com
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, achando que era só uma trava minha. A
`DATABASE_URL` aponta para a **porta 6543** — Supavisor em *transaction mode*, que **reaproveita
a conexão entre clientes diferentes**. O `SET SESSION` **gruda na conexão do pool** e vaza para
quem pegar aquela conexão depois — **inclusive o app**.

**Não era risco teórico. Medido:**
```
rodada 1: SUJAS 2 | curadas 2
rodada 2: SUJAS 0 | curadas 0
rodada 3: SUJAS 0 | curadas 0
```
**Havia 2 conexões envenenadas de verdade**, e foram curadas (devolvidas a `READ WRITE`).
Qualquer escrita do app que pegasse uma delas teria morrido com `cannot execute UPDATE in a
read-only transaction`, com a causa num script meu que já tinha terminado.

### 🔴 E o meu PRIMEIRO instrumento de limpeza também estava errado — no denominador

Eu relatei ao time **"60 amostras limpas"**. **Esse número não existia.** A v1 abria 20 conexões e
consultava **uma de cada vez**; em transaction mode o backend é emprestado **por transação**, então
consultas em série voltam ao **mesmo** backend. A v1 relatava 20 amostras tendo olhado
provavelmente **uma**.

*(A correção do procedimento apareceu em `~/.claude/memoria/set-session-vaza-no-pooler-do-supabase.md`
— outra sessão mediu e registrou: 25 conexões em série → **1 backend distinto de 25**.)*

**Procedimento correto:** `BEGIN` em TODAS as conexões ao mesmo tempo, medir com as transações
**ainda abertas** (é a transação aberta que prende o backend), e só então `ROLLBACK`. E imprimir
sempre **backends distintos / N**.

**Refeito com o instrumento certo:**
```
N = 10 conexoes, com BEGIN simultaneo
rodada 1: conexoes 10/10 | backends DISTINTOS 10/10 | sujas 0
rodada 2: conexoes 10/10 | backends DISTINTOS 10/10 | sujas 0
rodada 3: conexoes 10/10 | backends DISTINTOS 10/10 | sujas 0
backends DISTINTOS alcancados: 10
```
**O que isto autoriza dizer:** *"limpo nos **10** backends que eu alcancei"*. **Nunca** "o pool
está limpo" — o tamanho do pool não é observável daqui. Se o erro aparecer para alguém, é resíduo
meu; me chamem.

*(N modesto de propósito: prender backends do pooler de dev pode deixar o app das outras sessões
sem conexão. Amostra menor e honesta vale mais que amostra grande que atrapalha.)*

**A cura dos 2 continua válida** — achar conexão suja é evidência positiva. O que estava
superestimado era a **ausência**: "0 sujas em 20" e "0 sujas em 1" têm exatamente a mesma cara sem
o denominador de backends distintos.

**Corrigido, e a correção foi provada com os dois controles:**
```
BEGIN READ ONLY por consulta + ROLLBACK no finally + asserção SHOW transaction_read_only='on'

CONTROLE POSITIVO: SELECT count(*) FROM vw_produtos_public  → 19            ✔ leitura passa
CONTROLE NEGATIVO: UPDATE produtos SET nome=nome WHERE false
                   → ERRO: cannot execute UPDATE in a read-only transaction  ✔ escrita morre
```

**A lição, e ela é minha:** a lição já estava escrita em
`~/.claude/memoria/set-session-vaza-no-pooler-do-supabase.md` **desde antes desta sessão**. Eu
tinha o registro no disco e não abri antes de escrever a sonda. Quem me pegou foi o CACA-FUNDO.
**Ter a memória não é usar a memória.**

---

# ENTREGAS DE FRONTEIRA

| Para | O quê |
|---|---|
| **CACA-FUNDO** | RLS de `notificacoes` (assimetria de policy); 0 funções escrevem notificação; **retratação** da minha inferência sobre os pedidos pagos |
| **CACA-PAINEL** | Busca do painel cega a acento (**7 de 19** produtos com acento; `unaccent` **já instalada** no Postgres); correção do enquadramento do carrossel |
| **CONSERTO** | Aviso do vazamento no pool; e o mapa de "o arquivo irmão já tem a guarda" nos achados 6 e 9 — conserto é copiar, não decidir |

**Push ficou sem dono, por decisão da CENTRAL:** o CACA-PAINEL recusou por escrito (a tela já foi
auditada) e eu recusei (não é minha superfície). Nenhum dos dois errou; ela decidiu deixar parado
porque o gargalo do time é conserto, não descoberta.
