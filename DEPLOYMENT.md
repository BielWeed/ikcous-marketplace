# Guia de Deploy - ICKOUS Marketplace

Este documento fornece as instruções necessárias para colocar o Marketplace em produção.

## 1. Deploy do Frontend (Vercel)

O projeto está configurado para o Vite. Recomendamos o deploy via Vercel:

1. Conecte seu repositório ao Vercel.
2. Configure as seguintes variáveis de ambiente no painel da Vercel:
   - `VITE_SUPABASE_URL`: Sua URL do projeto Supabase.
   - `VITE_SUPABASE_ANON_KEY`: Sua chave anônima (anon key).
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

   **Sempre deploye a `send-otp-email` com `--no-verify-jwt`.** Sem a flag, o
   gateway passa a exigir JWT e o trigger — que se autentica com um segredo
   opaco, não com JWT — leva 401. O valor não está versionado em lugar nenhum;
   é o INFRA-310 (#162).

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

   **O que está publicado hoje** — medido em 05/08/2026 com
   `supabase functions list --project-ref cafkrminfnokvgjqtkle`. Esta tabela
   envelhece; rode o comando em vez de confiar nela:

   | Função | Versão | Atualizada em (UTC) |
   | --- | --- | --- |
   | `send-push` | 12 | 2026-08-05 20:03 |
   | `send-otp-email` | 8 | 2026-08-05 12:31 |
   | `calculate-shipping` | 11 | 2026-07-30 08:22 |
   | `send-order-whatsapp` | 8 | 2026-04-20 20:14 |
   | `notify-new-order` | 2 | 2026-08-05 23:41 |

   Ressalvas desta tabela, medidas em 05/08/2026:

   - **`notify-new-order` foi publicada em 05/08/2026**, com `--no-verify-jwt`,
     e respondeu ao smoke test: corpo vazio devolve
     `400 {"erro":"orderId ausente ou fora do formato UUID"}` e UUID inexistente
     devolve `200 {"ignorado":"pedido não encontrado"}`. Ou seja, o gateway
     aceita sem JWT e as guardas funcionam. **O critério 1 da #89 — pedido real
     com o painel fechado — continua não exercitado**, porque testá-lo cria
     pedido em produção.
   - **`send-order-whatsapp` foi versionada em 06/08/2026** (`INFRA-330`, #167).
     Baixada com `supabase functions download` e conferida: o fonte publicado é
     **byte a byte idêntico** à cópia que existia fora do repositório. As cinco
     functions publicadas agora têm fonte aqui.

     Ela **avisa o CLIENTE, não o lojista** — quem avisa o lojista é a
     `notify-new-order`. E está **morta**: consulta três colunas de
     `store_config` que a migration `20260601000001_remove_whatsapp_infrastructure.sql`
     (aplicada) removeu de propósito em 01/06/2026, junto do trigger e da função
     de trigger. Devolve 500 em toda invocação. Ver
     [`supabase/functions/send-order-whatsapp/README.md`](supabase/functions/send-order-whatsapp/README.md).

     **Não edite o `index.ts` dela.** Ele é cópia exata do publicado, e é isso
     que permite provar por `download` + diff se algo mudou no ar sem passar
     pelo repositório.

   - **`supabase functions deploy` sem nome de função publica TODAS as do
     diretório.** Com as cinco versionadas isso deixou de poder apagar uma
     função sem origem — mas continua podendo publicar em massa o que você não
     revisou. **Sempre passe o nome da função.**
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
3. As **credenciais de TESTE** dessa aplicação: *Public Key* e *Access Token*. As duas começam
   com `TEST-`. Se não começarem, são as de produção — não use nesta fase.
4. A **assinatura secreta** do webhook, que aparece em *Detalhes da aplicação → Notificações*
   ao cadastrar a URL de notificação.

A URL a cadastrar é:

```
https://cafkrminfnokvgjqtkle.supabase.co/functions/v1/webhook-mercadopago
```

O código manda `notification_url` dentro de cada cobrança, então o cadastro no painel é
redundante para o roteamento. **Mas a assinatura secreta só existe se a aplicação tiver webhook
configurado** — por isso o passo continua obrigatório.

### 5.2 Onde cada valor vive

Nomes conferidos no código, não de memória (`Deno.env.get` nas functions, `import.meta.env` no
front).

| variável | onde | observação |
| --- | --- | --- |
| `VITE_MP_PUBLIC_KEY` | Vercel → Environment Variables → **só Preview** | `TEST-…`; vai para o bundle, é pública por natureza |
| `VITE_PAGAMENTO_ONLINE` | Vercel → **só Preview** | exatamente a string `true`; qualquer outro valor mantém o checkout antigo |
| `MP_ACCESS_TOKEN` | Supabase → Edge Functions → Secrets | `TEST-…`; **nunca** com prefixo `VITE_`, senão vaza no bundle |
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

### 5.4 O teste de ponta a ponta — e como o PIX de teste é pago

Esta é a parte que o plano não descrevia.

Um QR de teste **não pode ser pago pelo app do seu banco**. O caminho é o `ticket_url` que o
Mercado Pago devolve junto com o QR: em modo de teste ele aponta para o domínio
`mercadopago.com.br/sandbox/…`, que é a página onde o pagamento de teste se conclui.

O código **já carrega esse valor até o front**: `_shared/mercadopago.ts` extrai
`point_of_interaction.transaction_data.ticket_url`, e `criar-pagamento` devolve como
`ticketUrl` nos dois ramos (criação e reconsulta). O que **não** acontece é o componente
renderizar esse link — `PagamentoOnline.tsx` usa só `qrCode` e `qrCodeBase64`.

Então, para o teste, pegue o `ticketUrl` da resposta da rede:

1. Abra o Preview com a flag ligada e monte um pedido.
2. Com o DevTools aberto na aba Rede, escolha PIX e finalize.
3. Na resposta de `criar-pagamento`, copie o campo `ticketUrl`.
4. Abra essa URL e conclua o pagamento de teste.

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
