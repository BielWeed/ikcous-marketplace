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

   **O que está publicado hoje** — medido em 05/08/2026 com
   `supabase functions list --project-ref cafkrminfnokvgjqtkle`. Esta tabela
   envelhece; rode o comando em vez de confiar nela:

   | Função | Versão | Atualizada em (UTC) |
   | --- | --- | --- |
   | `send-push` | 12 | 2026-08-05 20:03 |
   | `send-otp-email` | 8 | 2026-08-05 12:31 |
   | `calculate-shipping` | 11 | 2026-07-30 08:22 |
   | `send-order-whatsapp` | 8 | 2026-04-20 20:14 |

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
