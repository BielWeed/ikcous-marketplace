# Volta da loja IKCOUS de desenvolvimento ao banco original — continuidade

Sessão de 01–02/10/2026, checkout isolado `codex/retorno-banco-original`.
Banco original: `cafkrminfnokvgjqtkle` (restaurado). Banco novo: `dekxabvqdsuukijblazl`.
Autorização do dono: voltar a loja de testes ao original; pedidos fictícios do novo podem ser perdidos.

## Estado medido (antes de qualquer escrita)

- **Mercado Pago (MCP):** 1 aplicação (`ikcous`). Avisos do último mês: 2, ambos `order`, ambos
  HTTP 200; 0 falhos, 0 pendentes. O MCP não lê as URLs do Webhook (só grava).
- **PIX real pendente:** nenhum em aberto nos dois bancos. O último PIX de produção criado no
  banco novo (30/09, R$ 1,00) expirou sem pagamento.
- **R$ 1,00 pago depois de vencer:** um pedido de produção de 28/09 está com
  `payment_status = pago_apos_expirar`, pedido cancelado, **sem estorno registrado**
  (`order_refunds` e histórico vazios). Identificável no banco novo por
  `payment_status = 'pago_apos_expirar'`. Não trava a volta (o pagamento vive no Mercado Pago);
  devolver ou não é decisão de dinheiro do dono.
- **Estrutura dos bancos:** idêntica (funções, colunas, políticas, gatilhos, tarefas agendadas —
  270 grupos comparados por hash). Única diferença: texto da tarefa `reconciliar-pagamentos`
  (lê a URL do cofre; no original o cofre aponta para o próprio original).
- **Ficha da loja (`store_config`):** idêntica nos dois (mesma chave pública MP `APP_USR-`,
  `pagamento_online = true`, cartão desligado).
- **Chaves do Mercado Pago gravadas pela loja (`app_settings.pagamentos_mercado_pago`):** no novo
  tem token + chave pública + **assinatura do Webhook** (salvas 29/09, PIX ligado); no original
  tem token + chave pública, **sem assinatura do Webhook** e sem PIX ligado.
  Com o código atual isso significa: no original o PIX é **recusado** (409, "a loja precisa
  cadastrar a chave de assinatura") e o Webhook responde 500 (o Mercado Pago reenvia) até o dono
  salvar as três chaves em Ajustes → Pagamentos → Mercado Pago. Nenhum dinheiro se move antes.
- **Segredos do original:** tem todos os que o código atual lê (`MP_CHAVES_ENCRYPTION_KEY`,
  `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RECONCILIACAO_SECRET`, `SMTP_*`, `SUPABASE_*`,
  `VAPID_*`). Faltam só os opcionais `VAPID_SUBJECT` (tem padrão) e `MP_SANDBOX_PAYER_EMAIL`.
  `RECONCILIACAO_SECRET` do ambiente = o do cofre (comparado por digest); reconciliação 200.
- **Vercel:** `ickous-marketplace.vercel.app` está amarrado ao ramo `production` (deployment
  PREVIEW `ickous-marketplace-6tt1st4k0-…`, banco novo assado no build, caderneta `ausente`).
  As 4 clientes servem o deployment de PRODUÇÃO `ickous-marketplace-g38cca4oc-…`, **mesmo código
  d031c53**, que escolhe o banco pelo cadastro central (`frota_lojas` no banco NOVO — o cadastro
  que a produção consulta é o do banco novo; a Almeida só existe nele).

## Feito nesta sessão (com prova)

1. **Funções de pagamento do original atualizadas para o commit 9c3c8c6d** (PR #740, CI verde no
   SHA, 11 verificações, a mesma versão já no ar no banco novo, Savy e Almeida). As 5:
   `webhook-mercadopago` v29, `criar-pagamento` v27, `reconciliar-pagamentos` v28,
   `estornar-pagamento` v6, `credenciais-mercado-pago` v4 (antes: commit 9b132bc5, 27/09).
   Publicado por `supabase functions deploy … --use-api` a partir de `git archive` do SHA
   (53/53 arquivos idênticos ao commit). **Prova pela saída:** o código baixado do ar
   (`functions download`) = commit, 13/13 arquivos byte a byte. `verify_jwt` igual ao
   `config.toml`. Reconciliação rodou 03:00Z com o código novo: HTTP 200.
2. **Cadastro central (`frota_lojas` no banco novo):** as 3 linhas da IKCOUS (`principal`,
   `principal-git-main`, `principal-team`) agora apontam para o original (URL + chave publishable
   do original, prefixo `sb_publishable_oQVY`, testada: REST 200). Trava no próprio SQL:
   exatamente 3 linhas e hash das 4 outras lojas inalterado (`dcec2573…`). **No ar nada mudou:**
   IKCOUS seguiu no banco novo (o endereço ainda servia o preview), as 4 clientes
   `caderneta=hit`, cada uma no seu banco.

## Desfazer o que foi feito

- **Cadastro** (no banco novo). Antes: pegar a chave publishable do banco novo no HTML do preview
  `ickous-marketplace-6tt1st4k0-…` e conferir que começa com `sb_publishable_07V7N`. Rodar com a
  chave no lugar de `<CHAVE>`; o bloco só altera se as 3 linhas estiverem no original e se as
  outras lojas não mudarem:

  ```sql
  do $$
  declare n int; h text; k text := '<CHAVE>';
  begin
    if left(k, 20) <> 'sb_publishable_07V7N' then raise exception 'chave errada'; end if;
    update public.frota_lojas
       set project_ref = 'dekxabvqdsuukijblazl',
           supabase_url = 'https://dekxabvqdsuukijblazl.supabase.co',
           publishable_key = k, updated_at = now()
     where id in ('principal','principal-git-main','principal-team')
       and project_ref = 'cafkrminfnokvgjqtkle';
    get diagnostics n = row_count;
    if n <> 3 then raise exception 'esperava 3 linhas, alterou %', n; end if;
    select md5(string_agg(to_jsonb(f)::text, '|' order by id)) into h
      from public.frota_lojas f where id not like 'principal%';
    if h <> 'dcec2573bd5d19dbb994768a459b077a' then raise exception 'outras lojas mudaram: %', h; end if;
  end $$;
  ```

  Conferir depois: as 3 linhas com `project_ref = dekxab…` e as outras 4 iguais às de antes.
- **Funções:** mesmo procedimento com `git archive` do commit `9b132bc5` e deploy no original.

## Bloqueios encontrados (02/10/2026)

- **Troca do endereço (`vercel alias set`):** recusada duas vezes pelo classificador de
  segurança do Claude Code ("Production Deploy"), inclusive depois da autorização escrita.
  Não houve contorno por outra ferramenta. Os Webhooks dependem dela (regra: só com o site no
  original) e o desvínculo do Git Branch tem o mesmo efeito (troca qual publicação o domínio
  serve), então os dois também ficaram parados.
- **Migrar as chaves cifradas do Mercado Pago do banco novo para o original:** recusada pelo
  classificador ("Credential Materialization") já na leitura da linha cifrada. Nada foi lido nem
  gravado. Teste sem dinheiro e sem revelar valor, já calibrado: POST no `webhook-mercadopago` com
  `x-signature` falso e `data.id` fictício. **401 "Assinatura inválida"** = token e assinatura
  da loja decifrados (banco novo, hoje). **500 "não configurada"** = loja sem assinatura (original,
  hoje). **500 "indisponível"** = cifra não abre (chave de cifra diferente entre os bancos).
- Para destravar: a autorização de Gabriel já foi dada, mas a revisão automática continuou
  bloqueando as ações. Não repetir por outra ferramenta. Gabriel precisa executar a troca do
  domínio no painel da Vercel e cadastrar as credenciais na tela de Pagamentos da loja, sem
  enviá-las pelo chat. Depois disso, conferir o domínio e as quatro outras lojas antes de
  alterar os Webhooks; qualquer alteração via MCP continua sujeita à revisão automática.

## Troca do domínio — CONCLUÍDA e validada (02/10/2026)

Feita pelo dono no painel da Vercel: `ickous-marketplace.vercel.app` conectado a **Production**,
sem vínculo de Git Branch (igual às clientes). Isso cobre os antigos passos 1 e 2 (troca + tornar
durável): envio ao ramo `production` não leva mais o domínio de volta ao banco novo.
Desfazer: no painel, religar o domínio ao ramo `production` (volta a servir o preview com o banco
novo assado).

Validado por leitura pública independente (curl), no mesmo instante, nas **5 lojas ativas**:

| Endereço | HTTP | Caderneta | Banco no HTML | codeSha |
|---|---|---|---|---|
| ickous-marketplace.vercel.app | 200 | hit | `cafkrm…` (original) | d031c53 |
| almeidastore.vercel.app | 200 | hit | `cuemaf…` | d031c53 |
| savycollection.vercel.app | 200 | hit | `gnjsru…` | d031c53 |
| brandmeliz.vercel.app | 200 | hit | `htblgv…` | d031c53 |
| spacelojadoskit.vercel.app | 200 | hit | `bgwpxp…` | d031c53 |

Endereços **antigos**, que não são lojas ativas — separados de propósito:

- **503 `sem-loja` (caderneta `miss`), esperado:** `teste-frota-a-0911`, `teste-frota-ikcous-0911`,
  `savy-collection`, `loja-savy-collection` e a URL crua do deployment de produção
  (`ickous-marketplace-g38cca4oc-…`). Não estão no cadastro central.
- **308 para o domínio público (caderneta `hit`):** `ickous-marketplace-gabriels-projects-…`
  e `ickous-marketplace-git-main-…` (apelidos da principal no cadastro).
- **ATENÇÃO — ainda servem a loja com o banco NOVO (200, caderneta `ausente`):** o preview
  `ickous-marketplace-6tt1st4k0-…` e o apelido de ramo `ickous-marketplace-git-production-…`.
  No banco novo o PIX segue ligado e os Webhooks ainda apontam para ele, então hoje uma compra ali
  confirmaria normalmente. Depois que os Webhooks mudarem, uma compra ali perderia o aviso (só a
  reconciliação do banco novo, a cada 10 min, ainda a pegaria). Decidir antes de mudar os Webhooks
  como fechar esses dois endereços.

## Webhooks — PARADO por regra do dono (02/10/2026)

- O MCP do Mercado Pago **não tem leitura** da configuração atual (URLs de teste/produção e
  tópicos): só `save_webhook`, que grava tudo de uma vez. `notifications_history` (lido agora):
  2 avisos `order` no último mês, ambos 200, 0 falhos, 0 pendentes.
- A doc oficial (MLB, pt) diz que ao **salvar a configuração** "uma chave secreta exclusiva será
  gerada" e que renovar é pelo botão **Redefinir**; não diz se gravar pela API numa aplicação que
  já tem chave preserva a assinatura vigente, e depois de gravar não há como provar isso sem
  pagamento real.
- Regra do dono: sem leitura ou gravação segura pelo MCP, parar. `save_webhook` **não foi chamado**.
- Estado coerente enquanto isso: no domínio principal (original) o PIX é recusado (sem assinatura
  da loja) e o cartão está desligado — nenhum pagamento nasce ali; os Webhooks seguem no banco novo,
  que é onde o PIX ainda pode nascer (pelos dois endereços antigos acima).
- Caminho seguro proposto: o dono, no painel do Mercado Pago (Suas integrações → ikcous →
  Webhooks → Configurar notificação), troca só a URL das abas de teste e produção para
  `https://cafkrminfnokvgjqtkle.supabase.co/functions/v1/webhook-mercadopago`, mantém só **Order**
  marcado, **não** clica em Redefinir e salva — o painel mostra o estado antes e depois.

## Pausar o PIX no banco novo (endereços antigos) — PARADO na autenticação (02/10/2026)

Conferido no instante, no banco novo: 0 pagamentos online em aberto, 0 pedidos nas últimas 24 h
(último 30/09), `pagamento_online = true`, formas na entrega `pix, card, cash`.

- **A regra de "pelo menos uma forma de pagamento" NÃO impede:** o gatilho
  `store_config_exige_forma_de_pagamento` só recusa quando `formas_pagamento_entrega` fica vazia
  E `pagamento_online` falso — a ficha tem três formas na entrega.
- **Ação suportada:** botão **"Pausar"** em Ajustes → Pagamentos → Mercado Pago (ação
  `desligar_pix` da edge `credenciais-mercado-pago`, versão 9c3c8c6d no banco novo). Apaga só
  `store_config.pagamento_online` e anota `pagamento_pausado` no registro de `app_settings`;
  chaves e pedidos ficam intactos. A pausa vence salvar e testar. **Desfazer:** "Retomar"
  (`ligar_pix`), na mesma tela. A vitrine reflete em até 1 minuto. Só a ficha do banco novo muda:
  o domínio principal lê a ficha do original e as 4 clientes leem a sua.
- **Bloqueio concreto:** a edge exige JWT de um usuário com `role = admin` (verify_jwt + checagem
  de perfil). O agente não tem sessão de administrador e não deve obter uma (login é credencial
  do dono). O único outro caminho seria SQL cru na ficha, vetado pelo dono. Nada foi alterado.
- **Para executar (dono, sem comando):** abrir
  `https://ickous-marketplace-git-production-gabriels-projects-5a19f6ee.vercel.app` (endereço
  ANTIGO, que ainda usa o banco novo — não o principal), entrar com a conta de administrador,
  Ajustes → Pagamentos → Mercado Pago → **Pausar**.
- **Validação depois (leitura):** no banco novo, `pagamento_online = false` e o registro com
  `pagamento_pausado`; os hashes das máscaras das chaves iguais aos de antes (token `ac61c20a…`,
  assinatura `70d72ded…`, chave pública `3ad39ce3…`); HTML dos dois endereços antigos com
  `"pagamentoOnline":false`; domínio principal e 4 clientes inalterados.

### Pausa FEITA e validada (02/10/2026 03:41Z)

O dono pausou pelo botão "Pausar", com sessão de administrador, no endereço antigo (a tela mostra
"Pausado por você"). Conferido por leitura no banco novo, sem ler campo de credencial e sem
escrita: `store_config.pagamento_online = false`, `formas_pagamento_entrega` intacta
(`pix, card, cash`), registro com `pagamento_pausado = true`, `pausado_em = 2026-10-02T03:41:20Z`
e `pausado_por` presente.

Leitura pública (curl) no mesmo instante:

| Endereço | HTTP | Caderneta | Banco | `pagamentoOnline` | codeSha |
|---|---|---|---|---|---|
| ickous-marketplace.vercel.app (principal) | 200 | hit | original | true | d031c53 |
| almeidastore / savycollection / brandmeliz / spacelojadoskit | 200 | hit | cada uma no seu | false | d031c53 |
| …-git-production-… (antigo) | 200 | ausente | novo | **false** (antes true) | d031c53 |
| …-6tt1st4k0-… (antigo) | 200 | ausente | novo | **false** (antes true) | d031c53 |

- As 4 clientes leem a ficha do próprio banco, que a pausa não toca; banco, caderneta e codeSha
  iguais aos de antes. O `pagamentoOnline` delas não tinha sido medido antes desta sessão, então
  o `false` delas é registro do estado de agora, não comparação.
- No domínio principal (original) a ficha diz `pagamentoOnline = true`, mas o `criar-pagamento`
  recusa o PIX (409) enquanto a loja não tiver a assinatura do Webhook cadastrada no original.

**Desfazer a pausa:** no endereço antigo, com sessão de administrador, Ajustes → Pagamentos →
Mercado Pago → **Retomar** (`ligar_pix`). Ele recusa (409, nada gravado) se faltar alguma chave;
senão tira a pausa e liga `pagamento_online` de novo. Não retomar enquanto os Webhooks não
estiverem decididos.

## Próximo passo (nesta ordem)

1. ~~Pausar o PIX no banco novo~~ — feito e validado (acima).
2. **Webhooks (teste e produção) → original**, pelo caminho seguro acima.
3. **Dono salva as três chaves** (token, chave pública, assinatura do Webhook) na loja já no
   original — por último, para pegar a assinatura vigente. Só aí o PIX volta.
   **Validar a assinatura:** 401 no aviso = assinatura errada. Um 500 NÃO prova nada (é também a
   resposta de loja sem chave e de falha depois da assinatura). A prova é o próximo aviso real
   `order` entregue com 200 no histórico de notificações do MCP.
4. **R$ 1,00 tardio:** decisão do dono (devolver pelo painel do Mercado Pago ou manter).
