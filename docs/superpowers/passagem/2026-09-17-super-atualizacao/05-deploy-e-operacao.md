# Deploy e operação (estado em 17/09/2026, 07:30 UTC)

## Supabase (projeto da loja: `cafkrminfnokvgjqtkle`)

Functions publicadas (saída de `supabase functions list` no job do workflow, 05:00 UTC):

| Function | Versão | Atualizada em (UTC) | Observação |
| --- | --- | --- | --- |
| credenciais-mercado-pago | 2 | 2026-09-17 05:00:30 | publicada DESTA branch (commit 63c0b9c) pelo workflow; v1 era o primeiro deploy de 14/09, com o defeito que fazia todo teste de conexão falhar |
| criar-pagamento | 22 | 2026-09-08 | ANTERIOR à chave do lojista: cobra pelo `MP_ACCESS_TOKEN` da plataforma |
| webhook-mercadopago | 24 | 2026-09-13 | idem |
| reconciliar-pagamentos | 23 | 2026-09-13 | idem |
| estornar-pagamento | 3 | 2026-09-08 | idem |
| send-push | 29 | 2026-09-11 | a versão desta branch (paginação) NÃO está publicada |
| calculate-shipping | 36 | 2026-09-09 | a versão desta branch (filtro por chave, cache) NÃO está publicada |
| melhor-envio-etiqueta | 3 | 2026-09-11 | a versão desta branch NÃO está publicada |
| send-otp-email | 27 | 2026-09-11 | |
| notify-new-order | 18 | 2026-09-11 | |
| send-order-confirmation | 4 | 2026-08-26 | a versão desta branch ("Compra na loja") NÃO está publicada |

Migrations desta branch (`20261160000000` a `20261163000000`) NÃO estão aplicadas em produção. Sem
elas, o PDV e o código de barras não funcionam no preview nem em produção (as RPCs não existem lá).

Como publicar functions sem CLI na máquina: GitHub → Actions → "Publicar edge functions (Supabase)"
→ Run workflow → branch, `functions` (nomes separados por vírgula, ou `cobranca` = as cinco do
Mercado Pago) e `projeto` (`loja` ou `sandbox`). Detalhes em `DEPLOYMENT.md` §5.3.2. Publicar as
cinco JUNTAS quando for a hora (a §5.3 explica o estrago de publicar só parte).

Fatura do Supabase: o painel mostrava "Faturas em aberto" e o dono disse que está atrasada e sem
previsão de pagamento neste mês. Pela documentação do Supabase, fatura vencida leva a pausa dos
projetos e rebaixamento para o plano Free até quitar. Sugerido ao dono: dump do banco enquanto o
projeto está de pé (`npx supabase db dump --project-ref cafkrminfnokvgjqtkle -f esquema.sql` e
`--data-only -f dados.sql`) e falar com o suporte.

## Mercado Pago

- Teste de conexão em 17/09 05:15 UTC: "Conectado! Conta JOAOGABRIELVIEIRADEOLIVEIRA no ambiente de
  TESTE" → as chaves salvas são de TESTE (`live_mode=false`): nunca recebem dinheiro de verdade. Para
  vender: colar as credenciais de PRODUÇÃO, salvar, testar até ver "produção".
- O interruptor "Receber PIX no app" apareceu LIGADO no print do dono. O front de PRODUÇÃO
  (`main`, 1.35.0) já obedece a esse interruptor, e `criar-pagamento` em produção é a v22 (token da
  plataforma). Recomendação dada: DESLIGAR até publicar as cinco functions e colar credenciais de
  produção. Confirmar com o dono se desligou.
- O aviso amarelo "A ficha da loja ainda não carrega esta Public Key" some ao clicar "Salvar chaves"
  (o token vazio mantém o salvo; o salvar republica a Public Key na ficha).

## GitHub e Vercel

- PR #624 (rascunho): <https://github.com/BielWeed/ikcous-marketplace/pull/624>.
  PR #625 (mesclado em `develop`): o workflow de publicação.
- Preview da branch (front apenas; sem as migrations o PDV não funciona lá):
  <https://ickous-marketplace-git-claude-531c6a-gabriels-projects-5a19f6ee.vercel.app>
- Segredo `SUPABASE_ACCESS_TOKEN` cadastrado em Settings → Secrets and variables → Actions (17/09).
- A sessão anterior mantinha uma checagem horária do PR (estado, CI, comentários); quem assumir deve
  fazer o mesmo enquanto o PR estiver aberto.
