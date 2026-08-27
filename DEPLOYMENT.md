# Guia de Deploy - ICKOUS Marketplace

Este documento fornece as instruções necessárias para colocar o Marketplace em produção.

## 1. Deploy do Frontend (Vercel)

O projeto está configurado para o Vite. Recomendamos o deploy via Vercel:

1. Conecte seu repositório ao Vercel.
2. Configure as seguintes variáveis de ambiente no painel da Vercel:
   - `VITE_SUPABASE_URL`: Sua URL do projeto Supabase.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Sua chave publishable (`sb_publishable_...`,
     INFRA-260/#126). Alternativa: `VITE_SUPABASE_ANON_KEY` — chave legada
     (formato JWT), usada como fallback só se a publishable acima faltar.
3. O comando de build deve ser: `npm run build`.
4. O diretório de saída será: `dist`.

## 2. Configuração do Backend (Supabase)

### Edge Functions

O sistema utiliza a Edge Function `send-push` para notificações. Certifique-se de:

1. Fazer o deploy da função via CLI:

   ```bash
   supabase functions deploy send-push
   ```

   **O comando pergunta em qual projeto, e vem com o cursor no errado.** Desde
   05/08/2026 a org tem **dois** projetos — o `jvgyjlbjhbfrncwbytls` foi
   excluído (#85). O que hospeda a loja é o `cafkrminfnokvgjqtkle`, o mesmo que
   está em `VITE_SUPABASE_URL`; o outro é o `lofznuxcvezrhxsgjqyg`
   (`ikcous-mkt-priemira-cliente`), que aparece **antes** dele na lista. Dar
   Enter direto publica no lugar errado sem erro nenhum. Para pular a escolha:
   `--project-ref cafkrminfnokvgjqtkle`.

   O `lofznuxcvezrhxsgjqyg` é o **sandbox do MCP** — apesar do nome, não é loja
   de cliente. É para onde os `mcp.json` das IDEs apontam, para o servidor MCP
   do Supabase não tocar na loja. Ele já tem os três functions em v1, de 15/07,
   e é justamente por isso que publicar nele por engano não dá erro nenhum.
   Detalhe em [`docs/onboarding/03-SETUP-AMBIENTE.md`](docs/onboarding/03-SETUP-AMBIENTE.md),
   seção 6.

   Correção do que este parágrafo dizia antes: o 404 do OTP de convidado
   (AUTH-020, #154) **não** veio de um deploy no projeto errado. A
   `send-otp-email` sempre esteve publicada no projeto certo; quem apontava para
   o lugar errado era o `net.http_post` dentro de
   `handle_new_otp_verification`, editado à mão pelo SQL Editor. Publicar no
   projeto errado teria feito a função funcionar lá — o sintoma foi o oposto.
   O risco de errar o projeto neste prompt é real e continua valendo o aviso;
   só não foi essa a causa daquele defeito.

   **A `send-otp-email` deploya SEM flag nenhuma, desde 19/08/2026.** Este
   parágrafo dizia o contrário — "sempre com `--no-verify-jwt`" — e estava certo
   até a inversão do envio (#161 + #86). O que mudou:

   - **Antes:** quem chamava era o gatilho `handle_new_otp_verification`, que se
     autentica com um segredo opaco do Vault, não com JWT. Com o gateway
     exigindo JWT, ele levava 401 e nenhum código chegava ao cliente.
   - **Agora:** quem chama é o navegador de quem compra, com a chave anon do
     projeto, que passa pelo gateway. O gatilho foi apagado pela migration
     `20260820000100_otp_sem_fila_nem_gatilho.sql`.

   O valor vive em `supabase/config.toml` (`verify_jwt = true`), então o deploy
   sem flag aplica o certo. **Digitar `--no-verify-jwt` aqui hoje é que seria o
   erro:** a flag ganha do arquivo, e reabriria a função para quem não tem
   nenhuma chave do projeto. O INFRA-310 (#162), que pedia versionar esse valor,
   está resolvido pelo `config.toml`.

   **A `notify-new-order` também exige `--no-verify-jwt`** (PEDIDO-020, #89):

   ```bash
   supabase functions deploy notify-new-order --no-verify-jwt --project-ref cafkrminfnokvgjqtkle
   ```

   Ela é chamada pelo navegador do CLIENTE logo depois do pedido — muitas vezes
   um convidado sem sessão nenhuma. Com `verify_jwt` ligado, o gateway recusa
   antes de a função rodar e o lojista simplesmente não é avisado, **sem erro
   visível no checkout**, porque o disparo é fire-and-forget de propósito.

   Sem `verify_jwt`, quem protege é a própria função: o corpo só aceita
   `orderId`, todo o texto da notificação é lido do banco, e o pedido precisa
   ter sido criado nos últimos 15 minutos. O pior caso de um id vazado é
   duplicar o aviso de um pedido que acabou de entrar.

   **O que está publicado hoje** — medido em 11/08/2026, depois da
   despublicação da `send-order-whatsapp`, com
   `supabase functions list --project-ref cafkrminfnokvgjqtkle`. Esta tabela
   envelhece; rode o comando em vez de confiar nela:

   | Função | Versão | Atualizada em (UTC) |
   | --- | --- | --- |
   | `send-push` | 18 | 2026-08-05 20:03:54 |
   | `calculate-shipping` | 17 | 2026-07-30 08:22:07 |
   | `send-otp-email` | 15 | 2026-08-05 20:24:02 |
   | `notify-new-order` | 8 | 2026-08-05 23:25:40 |
   | `criar-pagamento` | 5 | 2026-08-11 02:43:51 |
   | `webhook-mercadopago` | 5 | 2026-08-11 02:44:10 |
   | `reconciliar-pagamentos` | 5 | 2026-08-11 02:44:22 |

   São sete — as quatro antigas mais as três do checkout (§5.3). A
   `send-order-whatsapp`, despublicada em 11/08/2026, não aparece mais.

   Ressalvas desta tabela, cada uma com sua própria data:

   - **`notify-new-order` foi publicada em 05/08/2026**, com `--no-verify-jwt`,
     e respondeu ao smoke test: corpo vazio devolve
     `400 {"erro":"orderId ausente ou fora do formato UUID"}` e UUID inexistente
     devolve `200 {"ignorado":"pedido não encontrado"}`. Ou seja, o gateway
     aceita sem JWT e as guardas funcionam. **O critério 1 da #89 — pedido real
     com o painel fechado — continua não exercitado**, porque testá-lo cria
     pedido em produção.
   - **`send-order-whatsapp` foi DESPUBLICADA em 11/08/2026** (#167, rastreada
     pela #187):

     ```
     supabase functions delete send-order-whatsapp --project-ref cafkrminfnokvgjqtkle --yes
     Deleted Function send-order-whatsapp from project cafkrminfnokvgjqtkle.
     ```

     Ela avisava o CLIENTE, não o lojista — quem avisa o lojista é a
     `notify-new-order` — e estava **morta**: consultava três colunas de
     `store_config` que a migration `20260601000001_remove_whatsapp_infrastructure.sql`
     (aplicada) removeu de propósito em 01/06/2026, junto do trigger e da função
     de trigger. Devolvia 500 em toda invocação, e nada a chamava.

     O código continua no repositório, em
     [`supabase/functions/send-order-whatsapp/`](supabase/functions/send-order-whatsapp/README.md)
     — não é para reativar, é o único registro do que esteve publicado e por
     quê. Não edite o `index.ts` dela.

   - **`supabase functions deploy` sem nome de função publica TODAS as do
     diretório.** Continua podendo publicar em massa o que você não revisou,
     mesmo com as funções restantes versionadas. **Sempre passe o nome da
     função.** Isso tem uma consequência específica para a
     `send-order-whatsapp`: a pasta continua no repositório de propósito (é
     o único registro do que esteve publicado — ver o README dela), então um
     deploy sem nome a republica junto com as outras, e a contagem volta a 8.
     Verificado: **não há regressão de segurança nisso.** Sem entrada em
     `supabase/config.toml` e sem a flag `--no-verify-jwt` (que é opt-in), o
     pior caso de uma republicação acidental é a verificação de JWT ficar
     **ligada**, nunca `false`.
   - **Há um Cloudflare na frente do `functions.supabase.co`.** Um payload de
     teste com cara de SQL injection leva `403` do WAF antes de chegar na
     função — o corpo é uma página HTML da Cloudflare, não JSON. Se um teste
     devolver HTML, é isso, não a função.

   A v12 da `send-push` é a primeira que **entrega de verdade**: até a v11 ela
   chamava `webpush.sendNotification`, que não existe na biblioteca, e
   respondia `{ success: true }` para 100% de falha (PUSH-010, #80).

2. Configurar os segredos (Secrets) no Supabase Dashboard para a função:
   - `VAPID_PUBLIC_KEY`: Gerada no `vapid_keys.json`. **Tem de ser a mesma chave
     que o front usa em `VITE_VAPID_PUBLIC_KEY`** — se as duas divergirem, o
     navegador aceita a inscrição e o push service devolve 403 na entrega.
   - `VAPID_PRIVATE_KEY`: Gerada no `vapid_keys.json`.
   - `VAPID_SUBJECT` (opcional): contato que o push service usa para avisar de
     problema com a aplicação, no formato `mailto:...` ou `https://...`. Sem
     ela, a função usa `mailto:admin@example.org`, que é o valor que estava
     fixo no código.
   - `SUPABASE_SERVICE_ROLE_KEY`: Sua Service Role Key para bypass de RLS em envios administrativos.

   **Formato das chaves VAPID.** A função aceita os dois que podem estar no
   ambiente hoje: base64url cru (saída do `web-push generate-vapid-keys`, 65
   bytes na pública e 32 na privada) ou JWK serializado. As duas variáveis
   precisam estar no mesmo formato — misturar é recusado com mensagem
   explícita, em vez de falhar depois com erro de curva.

   **Como saber se está certo sem mandar notificação para cliente:** dispare uma
   campanha para o seu próprio usuário pela tela de push do admin. Desde a
   PUSH-010 (#80) a resposta traz `enviados` e `falharam`, e a tela mostra o
   número real — antes disso o toast era verde mesmo com zero entrega.

### Banco de Dados (RLS)

As políticas de Row Level Security (RLS) foram configuradas para:

- **Produtos/Categorias**: Leitura pública.
- **Reviews/Perguntas**: Leitura pública, escrita apenas por usuários autenticados.
- **Pedidos**: Leitura/escrita apenas pelo dono do pedido (baseado em `user_id`).

## 3. Notificações Push

Para que as notificações funcionem:

- O domínio deve ser HTTPS.
- O arquivo `public/sw.js` deve estar acessível na raiz do domínio.

## 4. ICKOUS Marketplace - Monte Carmelo, MG

## 5. Cobrança online (Mercado Pago)

Esta seção existe porque o `DEPLOYMENT.md` não mencionava Mercado Pago em lugar nenhum, e o
plano da Fase 3 terminava com "um PIX de teste percorrendo pagamento → webhook → pago → push"
sem dizer **como o PIX de teste é pago** — que é a única parte não óbvia do processo.

### 5.1 O que precisa existir na conta antes de qualquer deploy

1. **Chave PIX cadastrada na conta do Mercado Pago.** A documentação do MP é explícita: o PIX
   só aparece como meio de pagamento se houver chave cadastrada. **Se isto faltar, nada abaixo
   funciona** — comece por aqui.
2. Uma **aplicação** criada em <https://www.mercadopago.com.br/developers/panel> →
   *Suas integrações*.
3. As **credenciais de TESTE** dessa aplicação, na aba **"Credenciais de teste"** do painel —
   *Public Key* e *Access Token*. **Nenhuma das duas é discriminável pelo prefixo na Orders
   API**: medido nesta sessão, a aplicação criada escolhendo "API de Orders" entrega uma Public
   Key de teste com prefixo `APP_USR-` (ex.: `APP_USR-80eca126-8b37-4667-bbd0-49715e5532fd`) e um
   Access Token de teste também com prefixo `APP_USR` (75 caracteres) — os dois iguais aos de
   produção no formato. A doc oficial da Orders API confirma: o prefixo do Access Token de teste
   varia conforme a solução, e nenhuma página promete prefixo `TEST-` para a Public Key de teste.
   Foi essa não-discriminância que derrubou a heurística `startsWith("TEST-")` que
   `criar-pagamento` chegou a usar para decidir ambiente (CHECKOUT-070); ambiente virou
   configuração explícita (`MP_SANDBOX_PAYER_EMAIL`, ver 5.2), não dedução do formato da
   credencial. O que garante que você pegou as credenciais de teste é estar na aba certa do
   painel, não o texto delas.
4. A **assinatura secreta** do webhook, que aparece em *Detalhes da aplicação → Notificações*
   ao cadastrar a URL de notificação.

A URL a cadastrar é:

```
https://cafkrminfnokvgjqtkle.supabase.co/functions/v1/webhook-mercadopago
```

**Isto mudou com a migração para a Orders API.** Com `montarCorpoPix` (clássico) o código mandava
`notification_url` dentro de cada cobrança, e o cadastro no painel era redundante para o
roteamento. `montarCorpoPixOrders` **não tem esse parâmetro** — a Orders API não aceita o campo
(o teste `criar-pagamento/index_test.ts:430` trava a ausência) — então **o cadastro da URL no
painel passou a ser a única rota de notificação**. Sem ele, o pagamento só é alcançado pela
reconciliação (§5.6), que roda de 10 em 10 minutos e é rede de segurança, não caminho principal:
um cliente pode pagar o PIX e o pedido ficar sem confirmar até 10 minutos, ou expirar antes disso
e devolver o estoque. A consequência operacional disso para cada loja clonada — garantir que o
cadastro aconteça — é a issue #212, não resolvida aqui.

### 5.2 Onde cada valor vive

Nomes conferidos no código, não de memória (`Deno.env.get` nas functions, `import.meta.env` no
front).

| variável | onde | observação |
| --- | --- | --- |
| `VITE_MP_PUBLIC_KEY` | Vercel → Environment Variables → **só Preview** | o prefixo não indica ambiente (ver 5.1); pegue-a na aba "Credenciais de teste" do painel. Vai para o bundle, é pública por natureza |
| `VITE_PAGAMENTO_ONLINE` | Vercel → **só Preview** | exatamente a string `true`; qualquer outro valor mantém o checkout antigo |
| `MP_ACCESS_TOKEN` | Supabase → Edge Functions → Secrets | o prefixo NÃO indica ambiente na Orders API (teste e produção começam com `APP_USR`, ver 5.1) — pegue-o na aba "Credenciais de teste" do painel; **nunca** com prefixo `VITE_`, senão vaza no bundle |
| `MP_SANDBOX_PAYER_EMAIL` | Supabase → Edge Functions → Secrets | **opcional**, só faz sentido em ambiente de TESTE. Presente (e não vazia), `criar-pagamento` troca o e-mail do pagador do PIX por este valor e liga `payer.first_name = "APRO"` — o valor mágico que a doc de teste de PIX do MP exige para a order simular o fluxo completo. Desde 13/08/2026 uma string vazia já se comporta como ausente (achado de revisão: CHECKOUT-070), mas a forma CERTA de desligar o sandbox continua sendo **apagar o secret**, não deixar o campo em branco — é a única sem margem para engano |
| `MP_WEBHOOK_SECRET` | Supabase → Secrets | a assinatura secreta do 5.1 |
| `RECONCILIACAO_SECRET` | Supabase → Secrets | **tem de bater** com o segredo homônimo no Vault |

Os dois segredos do Vault (`reconciliacao_url` e `reconciliacao_secret`) foram criados em
10/08/2026 pela migration `20260808000100`, **fora** dela, com `vault.create_secret`. Se o
`RECONCILIACAO_SECRET` do ambiente das functions não bater com o do Vault, a
`reconciliar-pagamentos` devolve `401` a cada 10 minutos, em silêncio.

### 5.3 Deploy das três functions

**Sempre com o nome da função** — sem nome, publica todas as do diretório (ver §2).

O `verify_jwt` de cada uma está versionado em `supabase/config.toml`, mas **a flag da linha de
comando ganha do arquivo**. Então os três comandos abaixo não são intercambiáveis:

```bash
supabase functions deploy criar-pagamento --project-ref cafkrminfnokvgjqtkle
```

```bash
supabase functions deploy webhook-mercadopago --no-verify-jwt --project-ref cafkrminfnokvgjqtkle
```

```bash
supabase functions deploy reconciliar-pagamentos --no-verify-jwt --project-ref cafkrminfnokvgjqtkle
```

- `criar-pagamento` vai **sem** `--no-verify-jwt`: quem chama é o cliente com sessão.
- As outras duas vão **com**: o Mercado Pago não manda JWT, e o `pg_cron` chama por `pg_net`
  com segredo próprio. Quem autentica ali é o `x-signature` e o `RECONCILIACAO_SECRET`.

Trocar isso é o erro que já derrubou o OTP uma vez (#162).

### 5.3.1 A ordem de deploy entre `criar-pagamento` e o front (CHECKOUT-080, #213)

A partir da CHECKOUT-080, `criar-pagamento` fala o vocabulário FECHADO do banco no campo
`statusPagamento` ('aguardando'/'pago'/'recusado'/'expirado'/'estornado') — o campo `status`
(vocabulário cru do Mercado Pago) que a versão anterior devolvia **deixou de existir na resposta**.
A function e o front sobem por pipelines diferentes (Supabase CLI x Vercel), então há uma janela
em que um está na versão nova e o outro na antiga.

**Medido nesta correção, e não como foi suposto ao abrir a tarefa:** as duas direções da janela
falham FECHADO, e da MESMA forma — não há uma ordem que "evita" a incompatibilidade, porque nas
duas o campo que o lado desatualizado espera vem `undefined`:

- **Function nova + front antigo.** O front antigo lê `r.status`, que a function nova não manda
  mais — `undefined` não bate em nenhum valor do vocabulário clássico que o front antigo conhece
  (`"rejected"`/`"cancelled"`/`"pending"`/`"in_process"`/`"approved"`/`"authorized"`), e ele cai no
  `throw new ErroPagamentoTerminal("Não foi possível confirmar o pagamento.")` — a mesma rede de
  segurança do CHECKOUT-080, já existente antes desta tarefa.
- **Front novo + function antiga.** O front novo lê `r.statusPagamento`, que a function antiga
  nunca mandou (ela só tinha `status`) — `undefined` de novo, e o front novo cai na MESMA rede de
  segurança (`statusConhecido` falso, nenhum dos três terminais nomeados bate, vira
  `"Não foi possível confirmar o pagamento."`), verificada em `tests/front/pagamento-online.test.tsx`
  ("statusPagamento AUSENTE").

Ou seja: **a premissa de que "o front velho ignora o campo novo e continua lendo `status`" está
errada** — a function nova não manda mais `status`, então o front velho não tem o que ler, e
também cai em erro terminal. O resultado final (falha fechada, nada cobrado sem registro, cliente
vê a mesma mensagem) é o mesmo dos dois lados; a ordem de deploy não encurta essa janela, porque
as duas direções são igualmente seguras — só mudam qual metade do par (front ou function) fica
momentaneamente "desatualizada".

**Ainda assim, deploye `criar-pagamento` antes do front**, por convenção (a API sobe antes de quem
a consome) e porque é a ordem que os outros passos deste documento já seguem (§5.3) — não porque
ela feche uma janela que a ordem inversa deixaria aberta. Durante a janela, seja qual for a ordem,
o cliente que tentar pagar vê "Não foi possível confirmar o pagamento." e o pedido continua
'aguardando' até expirar sozinho em 30 minutos — nenhum pagamento é perdido, nenhum pedido fica
marcado como pago sem o webhook/reconciliação terem confirmado.

**Mesmo assim, faça os dois deploys em sequência, na mesma sessão, e prefira horário de baixo
movimento.** "Falha fechada" não quer dizer "sem custo": `criar_pedido_seguro` decrementa o estoque
já na CRIAÇÃO do pedido, e ele só volta quando o pg_cron chama `devolver_estoque` — então cada
tentativa frustrada durante a janela segura aquele item por até 30 minutos. Nenhum pagamento se
perde; o inventário é que fica preso enquanto a janela durar.

**Isto vale para CADA loja clonada deste molde**, em todo upgrade que cruze uma versão de
`criar-pagamento` que mude o vocabulário do campo `statusPagamento`/`status` — não só nesta
migração específica.

### 5.4 O teste de ponta a ponta — e como o PIX de teste é pago

Esta é a parte que o plano não descrevia.

Um QR de teste **não pode ser pago pelo app do seu banco**. O caminho é o `ticket_url` que o
Mercado Pago devolve junto com o QR: em modo de teste ele aponta para o domínio
`mercadopago.com.br/sandbox/…`, que é a página onde o pagamento de teste se conclui.

O código **já carrega esse valor até o front**: `_shared/mercadopago.ts` extrai
`point_of_interaction.transaction_data.ticket_url`, `criar-pagamento` devolve como `ticketUrl`
nos dois ramos (criação e reconsulta), e `PagamentoOnline.tsx` já renderiza esse link — o texto
**"Pagar pelo Mercado Pago"**, logo abaixo do botão "Copiar código PIX" e acima do "Vence às".

Então, para o teste, é só clicar nele:

1. Abra o Preview com a flag ligada e monte um pedido.
2. Escolha PIX e finalize.
3. Na tela do PIX, clique em **"Pagar pelo Mercado Pago"**.
4. Conclua o pagamento de teste na página que abrir.

**Higiene, não contenção:** o Supabase deste repositório é de desenvolvimento (ver *Onde o risco
realmente mora*, no `CLAUDE.md`). Ainda assim, use um produto de teste com nome óbvio e estoque
controlado, e limpe o pedido depois — senão a massa vira lixo que confunde a próxima medição.

### 5.5 O que confirma que funcionou

Nesta ordem, e todos os quatro:

1. `marketplace_orders.payment_status` do pedido vira `pago`, com `paid_at` carimbado.
2. O push "Pedido pago" chega ao dispositivo inscrito.
3. Os logs da `webhook-mercadopago` mostram `200` — se mostrarem `500`, o MP vai reenviar, e é
   isso que você quer enquanto o problema não for resolvido.
4. O estoque **não** foi devolvido (o pedido foi pago, não cancelado).

Se o pedido virar `pago_apos_expirar` em vez de `pago`, não é bug: significa que a varredura de
expiração chegou antes do webhook. O pedido cai na fila de atenção do admin de propósito.

**Ainda não verificado na prática:** o passo 4 do 5.4 — concluir o pagamento na página de
sandbox — só pode ser confirmado com credenciais de teste reais em mãos, o que depende do 5.1.
Se a página se comportar diferente do descrito aqui, **corrija esta seção no mesmo PR** em vez
de descobrir de novo na próxima vez.

### 5.6 Como saber se a reconciliação está viva

A reconciliação é a única parte do sistema que **roda sozinha e não fala com ninguém**: o
`pg_cron` chama a edge function a cada 10 minutos pelo `pg_net`, e o resultado não aparece em
tela nenhuma. Se ela parar, o sintoma é a ausência de algo — pedido pago que o webhook perdeu e
que ninguém foi buscar.

O registro fica em `net._http_response`, que o `pg_net` preenche. Esta é a consulta:

```sql
SELECT created, status_code, timed_out, left(coalesce(content, ''), 200) AS corpo
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 5;
```

Como ler o que voltar:

| resposta | significa |
| --- | --- |
| `200` + `{"ok":true,"verificados":N,...}` | funcionando. `verificados: 0` é normal e frequente — só há candidato quando um PIX expira **tendo** cobrança criada |
| `401` | **o caso silencioso.** O `RECONCILIACAO_SECRET` do ambiente das functions não bate com o `reconciliacao_secret` do Vault. Ver §5.2 |
| `404` | a função não está publicada. É o estado entre aplicar a migration e fazer o deploy |
| `timed_out = true`, corpo vazio | o lote passou de 2 min. Ver o comentário sobre `timeout_milliseconds` na migration `20260808000100` — esse número e o `LIMIT 100` da `pagamentos_a_reconciliar` mudam juntos |

**Medido em 11/08/2026, no deploy desta fase**, e serve de referência do que "funcionando"
parece:

```
02:50:00  HTTP 200  {"ok":true,"verificados":0,"confirmados":0,"ignorados":0,"falhas":0}
02:40:00  HTTP 404  {"code":"NOT_FOUND","message":"Requested function was not found"}
```

A virada de `404` para `200` é o deploy. E o `200` prova mais do que parece: para chegar nele, o
`pg_cron` disparou, o `pg_net` leu URL **e segredo** do Vault, e a função **aceitou o segredo** —
se ele divergisse, seria `401`. É o teste de ponta a ponta da autenticação da reconciliação, e
sai de graça a cada 10 minutos.

Para desligar o job, se ele se comportar mal:

```sql
SELECT cron.unschedule('reconciliar-pagamentos');
```
