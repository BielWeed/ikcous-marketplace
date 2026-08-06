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
