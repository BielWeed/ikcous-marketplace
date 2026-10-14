# E-mail da loja no painel — publicar, usar e desfazer

> Escrito em 14/10/2026 com a function `credenciais-email`. A tela do painel
> ("Ajustes > E-mail da loja") vem em outro PR; sem ela, a function sobe
> sem efeito visível (só responde ao painel).

## O que muda para quem usa

A lojista cadastra o Gmail da loja (e a senha de app do Google) no painel dela.
Os e-mails do pedido e o código de login por e-mail passam a sair desse Gmail.
Nós nunca vemos a senha: ela digita no painel, a function confere o login no
Google e a guarda cifrada.

Quem já envia pelos segredos do servidor (`SMTP_USER` e `SMTP_PASSWORD`, loja
IKCOUS) **não muda nada** enquanto não cadastrar no painel. Se o Gmail do painel
for recusado pelo Google depois (a lojista trocou a senha da conta e o Google
cancelou a senha de app), o envio tenta uma vez pelo servidor e a tela avisa.

## Como cada peça escolhe o remetente (uma regra só)

1. Registro do painel (`app_settings`, chave `email_da_loja`) que dá para
   decifrar: vale ele.
2. Qualquer outra coisa (sem registro, sem cofre, chave trocada, banco fora ou
   lento por mais de 3 s): os segredos do servidor, como sempre.
3. Nenhum dos dois: `sem_remetente` — o código de login NÃO é gerado e o
   comprovante NÃO reserva o aviso.

A saúde do envio (último envio ok, última falha e a causa em palavra fixa) mora
em `app_settings`, chave `email_da_loja_saude`.

## Publicação (o conjunto vai junto, nas duas lojas)

O `smtp.ts` é compartilhado, então estas functions precisam subir **no mesmo
commit e nas duas lojas (IKCOUS e Savy)**: `credenciais-email` (nova),
`send-otp-email`, `send-order-confirmation`, `criar-pagamento`,
`webhook-mercadopago` e `reconciliar-pagamentos`.

- Pelo `publicar-functions.yml`, uma a uma, com `expected_sha`. A
  `credenciais-email` só tem rota na IKCOUS e na Savy (Almeida recusa).
- `verify_jwt = true` (está no `supabase/config.toml`). **Nunca** `--no-verify-jwt`
  nesta function: ela só atende o admin.
- Nenhuma migration: `app_settings` já é fechada a visitante e a conta logada
  (migration `20261218000100`); só o servidor lê e grava.
- Pré-requisito por loja: a variável `MP_CHAVES_ENCRYPTION_KEY` (o cofre) existe
  no projeto. Sem ela a tela avisa "esta loja ainda não está preparada".
- Depois de publicar, conferir em cada loja que a function responde 401 sem
  sessão e 200 com a sessão do admin (ação `status`).

## Depois de publicado: o que a lojista faz

Painel > Ajustes > E-mail da loja > seguir o passo a passo (Gmail só da loja,
verificação em duas etapas, senha de app, colar, **Salvar**, **Enviar e-mail de
teste**). O Gmail não mostra na Caixa de Entrada o e-mail que a conta manda para
ela mesma: olhar em **Enviados** (e em Spam).

## Como desfazer

- Pela lojista: botão **Remover** (apaga o registro; volta ao servidor se
  houver).
- Pelo código: reverter o PR (o resolvedor volta a ler só o servidor). Os
  registros `email_da_loja` e `email_da_loja_saude` em `app_settings` ficam sem
  uso e podem ser apagados à mão.
