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

   **O comando pergunta em qual projeto, e vem com o cursor no errado.** A org
   tem três, e o único que hospeda a loja é o `cafkrminfnokvgjqtkle` — é o
   mesmo que está em `VITE_SUPABASE_URL`. Os outros dois
   (`jvgyjlbjhbfrncwbytls`, `lofznuxcvezrhxsgjqyg`) aparecem antes dele na
   lista, e dar Enter direto publica no lugar errado sem erro nenhum. Foi assim
   que o OTP de convidado ficou respondendo 404 por quase um mês (AUTH-020,
   #154). Para pular a escolha: `--project-ref cafkrminfnokvgjqtkle`.

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
