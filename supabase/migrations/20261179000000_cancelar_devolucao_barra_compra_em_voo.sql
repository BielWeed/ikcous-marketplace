-- CANCELAR_DEVOLUCAO BARRA A COMPRA EM VOO (achado A1 da revisão de risco
-- pré-publicação de 26/09/2026 sobre a etiqueta reversa do Melhor Envio —
-- PR #666, commit fe045939; scratchpad
-- revisao-etiqueta-e-checkout.md, achado A1).
--
-- AS MIGRATIONS 20261175–20261178 JÁ FORAM APROVADAS E VÃO SER PUBLICADAS
-- COMO ESTÃO (runbook docs/runbooks/publicar-painel-cartao-devolucoes.md) —
-- por isso a correção entra em arquivo NOVO, redefinindo só a função, em vez
-- de editar a 20261175000000 por cima. ESTA MIGRATION AINDA NÃO FOI
-- PUBLICADA EM LUGAR NENHUM (nem sequer aplicada uma vez) — por isso a
-- RODADA 2 abaixo edita o mesmo arquivo em vez de nascer numa 20261180.
--
-- O DEFEITO ORIGINAL (rodada 1): `cancelar_devolucao` (nascida em
-- 20261175000000) só olhava `status IN ('solicitada', 'aprovada')`. Ela não
-- sabia nada sobre `me_reverse_id`/`codigo_postagem` — colunas que a edge
-- `melhor-envio-etiqueta` (action `gerar_devolucao_reversa`) grava por
-- service role, fora do PostgREST. Isso abria dois buracos de dinheiro:
--   * o cliente cancela ENQUANTO a compra do envio reverso está em voo no
--     Melhor Envio (reserva gravada ou vínculo com o id do envio, mas o
--     código de postagem ainda não voltou) — se o checkout da edge confirmar
--     o pagamento um instante depois, a etiqueta sai PAGA para uma devolução
--     já cancelada, e ninguém na loja fica sabendo;
--   * o caso mais comum, sem corrida nenhuma: o código já saiu (a etiqueta
--     está paga) e, dias depois, o cliente cancela a devolução — a etiqueta
--     fica órfã no Melhor Envio e nada avisa o lojista para cancelá-la lá.
--
-- RODADA 2 (revisão independente sobre o resultado da rodada 1 — achados
-- R1/R2/N3, scratchpad rev79/): a rodada 1 fechou os dois buracos de dinheiro
-- acima, mas abriu um problema NOVO e trocou um vazamento por outro:
--   R1. O guard `me_reverse_id IS NOT NULL AND codigo_postagem IS NULL`
--       bloqueava TAMBÉM a fase de RESERVA (`reservando:<epoch>:<uuid>`,
--       gravada ANTES de qualquer chamada ao Melhor Envio) — e essa fase não
--       precisa de guard nenhum: o vínculo seguinte da edge já é
--       condicionado a `status = 'aprovada'` (se o cliente cancelou durante
--       a reserva, o vínculo pega 0 linhas e a edge desfaz sozinha, sem
--       gastar nada — provado com duas conexões concorrentes, cenários T1 e
--       T4 do scratchpad). Pior: o guard também prendia o cliente para
--       SEMPRE quando o `me_reverse_id` REAL ficava travado sem código por
--       qualquer motivo que não se resolve sozinho — a edge morreu entre a
--       reserva e o vínculo, uma liberação falhou, um checkout ficou
--       indeterminado, ou a loja usa o Sandbox do Melhor Envio (que NUNCA
--       gera o código de postagem da reversa — `AVISO_SANDBOX_REVERSA` no
--       index.ts). Nesses casos o cliente lia "aguarde alguns instantes" por
--       dias, sem prazo nenhum, e sem a loja ter como destravar (cenário T5b).
--       CORREÇÃO: o guard só barra quando `me_reverse_id` é um id REAL do
--       Melhor Envio (`NOT LIKE 'reservando:%'` — o mesmo prefixo
--       `PREFIXO_RESERVA_REVERSA` do index.ts); a mensagem não promete prazo
--       (fala em pedir ajuda à loja, não em tentar de novo sozinho); e a
--       loja ganha uma RPC nova, `admin_devolucao_liberar_vinculo_reverso`,
--       para destravar um vínculo real sem código (a "saída" que faltava).
--   R2. O evento que a rodada 1 gravava (ator 'sistema', quando o código já
--       tinha saído) tinha o texto ERRADO para o público que de fato pode
--       lê-lo: `devolucao_eventos` libera o DONO da devolução por RLS (não
--       só o admin — `devolucao_eventos_dono_ou_admin_select_policy`,
--       20261175000000), e `devolucao_detalhe` (que `useDevolucaoCliente`
--       também chama) devolve `eventos` inteiro. A rodada 1 comentava "não
--       vaza para o cliente" — falso: o comentário confundia "o CARD do
--       cliente não RENDERIZA a lista de eventos" com "o cliente não pode
--       LER a lista de eventos" (prova com `SET LOCAL ROLE authenticated` +
--       GUC do dono, cenário T6 do scratchpad — e a prova viva agora tem
--       essa checagem, em vez de rodar como superusuário e não provar nada).
--       Um texto endereçado à loja ("cancele você") não é uma instrução
--       incorreta para o cliente ler, mas soa deslocado. CORREÇÃO: o texto
--       do evento fica NEUTRO e seguro para qualquer leitor (constata o
--       fato, não dá ordem a ninguém) — documentado aqui que o cliente PODE
--       ler esta nota.
--   N3. `'...' || v_d.me_reverse_id || '...'` quebra em silêncio se
--       `me_reverse_id` for NULL (estado que a edge não produz, mas que o
--       banco não impede de outro jeito — cenário T8): a concatenação com
--       `||` em Postgres devolve NULL inteiro, e a nota do evento nasce
--       NULL, sem avisar nada. CORREÇÃO: `COALESCE`.
--
-- RODADA 3 (revisão independente sobre o resultado da rodada 2 — achado R5,
-- de DINHEIRO, e N-a, scratchpad rev79/):
--   R5. `admin_devolucao_liberar_vinculo_reverso` (a "saída" da rodada 2) não
--       tinha como distinguir um vínculo REAL morto (o caso que ela foi
--       criada para destravar) de um vínculo que acabou de ser PAGO no
--       Melhor Envio, mas cujo código de postagem ainda não voltou — o
--       checkout paga (`pagoConfirmado = true` na edge) ANTES de o código
--       existir, e até a rodada 2 nada no banco registrava esse fato.
--       Chamar a RPC nessa janela soltava um vínculo PAGO do mesmo jeito que
--       um morto: a gravação do código, lá na frente, filtra por
--       `me_reverse_id = <id solto>` e bate 0 linhas SEM ERRO — a edge
--       tratava isso como "já gravado por outra chamada" e respondia 200
--       `ok: true` com o código, sem ele estar salvo em lugar nenhum. O
--       próximo "Gerar" comprava um SEGUNDO envio reverso (prova de duas
--       conexões concorrentes, cenário T10 do scratchpad). CORREÇÃO em duas
--       pontas:
--         (a) a edge grava um evento 'sistema' — o MARCADOR — assim que
--             `pagoConfirmado` vira true (`gravarPagamentoConfirmadoReverso`,
--             index.ts), e esta RPC passa a RECUSAR soltar o vínculo quando
--             esse marcador existir para o `me_reverse_id` atual (o texto do
--             `LIKE` é o contrato entre as duas pontas — comentado no corpo
--             da função);
--         (b) `concluirComCodigoDePostagem` (index.ts) para de tratar "0
--             linhas, sem erro" como sinônimo de "já gravado": relê a
--             devolução, e só segue pelo caminho feliz se o vínculo ainda for
--             o mesmo id — senão responde erro honesto (nunca `ok: true`)
--             dizendo que o código já existe, pertence a outro vínculo, e não
--             deve ser gerado de novo.
--   N-a. A nota gravada pela RPC também soltava RESERVAS ativas
--       (`reservando:<epoch>:<uuid>`, ainda dentro dos 10 min) chamando-as de
--       "envio reverso no Melhor Envio (id reservando:...)" — confuso (não é
--       um id do Melhor Envio) apesar de SEGURO soltar (a edge relê o status
--       antes de vincular e desfaz sozinha se a reserva sumiu no meio do
--       caminho). CORREÇÃO: a nota distingue os dois casos.
--
-- RODADA 4 (revisão independente sobre o resultado da rodada 3 — achados 1
-- (lacunas do marcador R5, dinheiro), 3 (atalho de service_role/postgres) e
-- 4 (contrato textual sem teste), scratchpad rev79/ataque3.cjs + fn5/):
--   1. O marcador de pagamento confirmado (rodada 3) só era gravado em UM
--      ponto — logo após o CHECKOUT desta mesma chamada. Três lacunas:
--        (a) o caminho "vinculado" (chamada seguinte, que já pula reserva e
--            checkout porque o vínculo real já existe) provava pagamento do
--            mesmo jeito (`generate` aceito, ou o código já existir — o ME só
--            gera/emite código de envio pago) mas NUNCA gravava o marcador —
--            F4 do scratchpad: RPC soltava um vínculo pago sem código, sem
--            nenhum aviso.
--        (b) a gravação do marcador era "melhor esforço" sem aviso NENHUM se
--            falhasse — o vínculo ficava sem proteção, e nem o log do
--            servidor (que a loja não vê) bastava.
--        (c) checkout 5xx ou uma exceção de rede não gravavam nada — o
--            Melhor Envio pode ter debitado com a resposta perdida, e essa
--            dúvida não ficava registrada.
--      CORREÇÃO: (a) o caminho vinculado grava o marcador (idempotente,
--      `garantirMarcadorDePago`) quando prova pagamento; (b) a gravação
--      tenta 2x, e se as duas falharem a RESPOSTA avisa explicitamente que
--      o pagamento não ficou registrado e a liberação manual não deve
--      acontecer sem conferir o Melhor Envio antes; (c) um marcador
--      DIFERENTE ("Pagamento indeterminado...") é gravado nesses casos — a
--      RPC abaixo recusa por padrão, mas aceita liberar com
--      `p_conferi_no_melhor_envio = true`, só depois de o admin já ter
--      olhado "Meus envios" (o marcador CONFIRMADO nunca aceita esse
--      parâmetro — dinheiro confirmado não se destrava por auto-declaração).
--   3. `is_admin()` (baseline, `20260806000000`) aceita a conexão rodando
--      como `postgres`/`service_role` — correto para outras RPCs (automações
--      internas de confiança), mas ERRADO aqui: esta RPC é uma decisão
--      HUMANA pós-checagem manual no Melhor Envio (o runbook, §7.6, dizia
--      que não havia atalho — falso: F3 do scratchpad soltou o vínculo com
--      `SET ROLE service_role`, sem JWT nenhum). CORREÇÃO: a RPC também
--      exige `auth.uid() IS NOT NULL` — só uma sessão de verdade (JWT ou GUC
--      de teste) tem isso; `SET ROLE` sozinho não.
--   4. O contrato textual do marcador (a frase que a edge grava e que esta
--      RPC procura) vivia copiado sem nenhum teste ligando os dois lados, e
--      o `LIKE` usava `_`/`%` do PRÓPRIO id como curinga sem querer (F5 do
--      scratchpad: um id manipulado à mão contendo `_` casava com o
--      marcador de OUTRO id — na direção segura, "recusa a mais", mas
--      ainda impreciso). CORREÇÃO: `strpos` (substring literal, sem
--      curingas) no lugar de `LIKE`, e um teste novo
--      (`tests/marcador_pagamento_reverso_contrato_test.ts`) que lê o texto
--      de `index.ts` e desta migration e confere que as duas âncoras batem.
--
-- RODADA 5 (revisão independente sobre o resultado da rodada 4 — achados 1
-- (dinheiro, "negar por padrão") e 3 (texto do marcador indeterminado visível
-- ao cliente), scratchpad rev79/ataque4.cjs + fn8/; os achados 2, 4 e 5 da
-- mesma rodada são só edge/runbook, index.ts e docs/runbooks/ — nada muda
-- aqui por causa deles):
--   1. O guard da rodada 4 (achado 1c) só recusava soltar o vínculo quando o
--      marcador INDETERMINADO existia — um vínculo REAL sem NENHUM marcador
--      (edge derrubada no meio do caminho, um link de produção gravado antes
--      de esta proteção nascer, ou qualquer outra falha que nunca chegou a
--      gravar nada) não caía em guard nenhum e saía solto sem pedir
--      confirmação (achado G5 do scratchpad: `ataque4.cjs` prova um vínculo
--      real com zero eventos 'sistema' liberado sem
--      `p_conferi_no_melhor_envio`). CORREÇÃO: o guard vira "negar por
--      padrão" — para QUALQUER `me_reverse_id` REAL (`NOT LIKE
--      'reservando:%'`, mesma isenção de sempre para a fase de reserva —
--      achados R1/N-a intactos), a RPC agora EXIGE
--      `p_conferi_no_melhor_envio = true`, com ou sem marcador nenhum. O
--      marcador indeterminado deixa de decidir sozinho e vira só informação
--      na MENSAGEM da recusa (avisa que há um registro de pagamento
--      indeterminado, se houver). O marcador CONFIRMADO continua recusando
--      sem NENHUMA exceção possível (achado R5, rodada 3 — intocado).
--   3. O texto do marcador indeterminado (`notaPagamentoIndeterminadoReverso`,
--      index.ts) mudou de "Pagamento indeterminado do envio reverso ..." para
--      "Pagamento do envio reverso ... em verificação;" — achado G7 do
--      scratchpad: o texto antigo carregava uma instrução ("convém conferir
--      ... antes de liberar o vínculo manualmente") dirigida à LOJA, mas
--      `devolucao_eventos` também libera o DONO por RLS (mesmo motivo do
--      achado R2, rodada 2) — o cliente lia uma instrução de admin sem
--      sentido nenhum para ele. O `strpos` desta RPC muda junto (a âncora é o
--      contrato com `tests/marcador_pagamento_reverso_contrato_test.ts`,
--      achado 4 da rodada 4).
--
-- RODADA 6a (revisão independente sobre o resultado da rodada 5 — achado 2,
-- scratchpad rev79/ataque5.cjs, G8):
--   2. O guard "negar por padrão" (rodada 5) escrevia `AND NOT
--      p_conferi_no_melhor_envio` — em SQL, `NOT NULL` é `NULL`, não `TRUE`,
--      e um `IF` com condição `NULL` nunca entra no corpo. Um `NULL`
--      EXPLÍCITO (`p_conferi_no_melhor_envio: null` no corpo JSON de uma
--      chamada PostgREST — diferente de simplesmente omitir o parâmetro, que
--      usaria o `DEFAULT false`) passava pelo guard e soltava o vínculo sem
--      confirmação nenhuma, do mesmo jeito que o achado G5 da rodada 5 que
--      esta rodada corrigiu. CORREÇÃO: `p_conferi_no_melhor_envio IS NOT
--      TRUE` — só `true` de verdade não recusa; `false` e `NULL` recusam
--      igual.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM (já com as rodadas 2-6a aplicadas):
--   1. Redefine `public.cancelar_devolucao(p_id uuid)` (MESMA assinatura da
--      20261175000000 — grants de lá continuam valendo, Postgres não perde
--      privilégio num CREATE OR REPLACE que não muda a assinatura): mantém
--      o lock (`FOR UPDATE`), a checagem de dono e o guard de status
--      originais, byte a byte, e insere UM guard novo logo depois do guard
--      de status:
--        `me_reverse_id IS NOT NULL AND me_reverse_id NOT LIKE
--        'reservando:%' AND codigo_postagem IS NULL` — "compra em voo": o
--        vínculo com o id REAL do envio reverso já foi gravado, mas o código
--        de postagem (só a edge grava, depois do checkout pago) ainda não
--        chegou. Cancelar aqui é recusado com uma frase que não promete
--        prazo e manda falar com a loja — quem tem a RPC de liberar (item 3)
--        para os casos em que isso não se resolve sozinho.
--   2. Quando o código de postagem JÁ existe (`codigo_postagem IS NOT NULL`
--      no momento do cancelamento — dinheiro já gasto, sem correção possível
--      aqui), grava um evento A MAIS em `devolucao_eventos` (ator 'sistema',
--      nunca dentro da nota do evento 'cliente' que já existia), com texto
--      NEUTRO (achado R2 — o cliente também pode ler esta nota, por RLS).
--      Esse evento já aparece para o lojista SEM nenhuma mudança de front: a
--      RPC `devolucao_detalhe` (20261175000000) devolve `eventos` inteiro, e
--      `DetalheDaDevolucao.tsx` já renderiza `evento.nota` de cada linha —
--      inclusive as de ator 'sistema' (`ROTULO_ATOR` já cobre os três
--      atores).
--      Verificado: não é cheap estender `useAvisosDoLojista`/
--      `admin_devolucao_listar` (a lista) para uma bolinha própria no sino —
--      exigiria uma sexta fonte no `Promise.allSettled`, um campo novo na
--      RPC (redefinida por cima da 20261175000000) e um mapper de front
--      novo, para o mesmo aviso que a ficha da devolução já mostra. Fica
--      fora do escopo desta correção (ver relatório da tarefa).
--   3. Cria `public.admin_devolucao_liberar_vinculo_reverso(p_id uuid,
--      p_conferi_no_melhor_envio boolean DEFAULT false)` (nova, achado R1;
--      2º argumento novo na rodada 4, achado 1c): só admin AUTENTICADO
--      (achado 3, rodada 4: `is_admin() AND auth.uid() IS NOT NULL` — o
--      baseline sozinho aceita `service_role`/`postgres` sem sessão nenhuma,
--      o que esta RPC não pode aceitar); trava a linha (`FOR UPDATE`); recusa
--      se não houver vínculo (`me_reverse_id IS NULL`), se o código já tiver
--      saído (nesse caso não há nada para "destravar" — a etiqueta já existe
--      e o caminho é cancelar direto no Melhor Envio), se o pagamento já
--      tiver sido CONFIRMADO no Melhor Envio para este `me_reverse_id`
--      (achado R5, rodada 3 — marcador gravado pela edge, SEM exceção
--      possível pelo 2º argumento) OU, achado 1 (rodada 5, "negar por
--      padrão"), sempre que `me_reverse_id` for um id REAL (não uma reserva)
--      e `p_conferi_no_melhor_envio` não vier `true` — com ou sem marcador
--      INDETERMINADO gravado (a rodada 4 só recusava quando esse marcador
--      existia; a rodada 5 fechou o buraco de um vínculo real SEM marcador
--      nenhum sair solto de graça — achado G5 do scratchpad); solta
--      `me_reverse_id` (reserva OU id real, tanto faz) e grava um evento
--      'sistema' com texto neutro
--      contando o que foi liberado (achado N-a: o texto distingue reserva de
--      vínculo real). Não mexe em `status`, `codigo_postagem` nem em nada
--      além do vínculo — é estritamente a "saída" para um vínculo preso,
--      nada mais.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita por esta migration —
-- ela só troca o CORPO de uma função e cria outra. Devoluções já canceladas
-- não são revisitadas.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` com a mesma assinatura para
-- `cancelar_devolucao`; `admin_devolucao_liberar_vinculo_reverso` leva um
-- `DROP FUNCTION IF EXISTS` do overload de 1 argumento (rodadas 2/3) logo
-- antes do `CREATE OR REPLACE` de 2 argumentos (rodada 4) — sem isso, um
-- `CREATE OR REPLACE` com assinatura DIFERENTE criaria um segundo overload
-- ao lado do antigo, em vez de substituí-lo (Postgres despacha função por
-- nome + tipos dos argumentos). Reaplicar o arquivo (idempotente: o DROP é
-- `IF EXISTS`, o CREATE OR REPLACE tolera reaplicação) sempre deixa as duas
-- funções com o mesmo corpo final e só um overload de cada uma.
--
-- FORA DO ESCOPO (achados A2/A3/A4 da mesma revisão original, e R3/R4/N1/N2
-- da rodada 2, todos corrigidos em código, sem migration):
--   * a edge `melhor-envio-etiqueta` relê o status da devolução depois do
--     checkout e devolve `aviso` se ela não estiver mais 'aprovada', e agora
--     (N2) também grava um evento 'sistema' com o mesmo fato (não só o
--     toast de 15s do painel);
--   * `src/lib/devolucao.ts` (leitor de `gerar_devolucao_reversa`) lê
--     `aviso`/`dce_pendente`/`expirado`; o painel mantém a ação de buscar o
--     código enquanto a DC-e não chegou;
--   * `removerDoCarrinho`/`liberarVinculoReverso` (retry, mensagem honesta,
--     e agora — R3 — uma tentativa de "degradar" um vínculo preso por falha
--     de liberação para uma reserva já vencida, que a PRÓXIMA chamada retoma
--     sozinha pelo mesmo mecanismo que já existe para reserva expirada);
--   * (R4) a frase sobre o carrinho em `tratarVinculoNaoConfirmado` também
--     passa a depender do resultado real do DELETE, como no ramo "recusado";
--   * (N1) o toast de sucesso do painel não afirma mais "o cliente já vê no
--     pedido" quando a edge também mandou avisar que a devolução mudou.
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- supabase/migrations/20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
-- — sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO (rodar à mão depois de aplicar):
--   1. `SELECT prosrc FROM pg_proc WHERE proname = 'cancelar_devolucao'`
--      contém `me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE
--      'reservando:%' AND v_d.codigo_postagem IS NULL`.
--   2. Devolução 'aprovada' com `me_reverse_id` = id REAL (não
--      'reservando:...') e `codigo_postagem` NULL: `SELECT
--      cancelar_devolucao('<id>')` autenticado como o dono levanta exceção
--      (SQLSTATE 22023) — não cancela.
--   3. A MESMA devolução, mas com `me_reverse_id` = 'reservando:...' (fase
--      de reserva): `cancelar_devolucao` CANCELA normalmente.
--   4. Devolução com `codigo_postagem` preenchido: `cancelar_devolucao`
--      cancela e `devolucao_eventos` ganha uma linha nova com `ator =
--      'sistema'`, `nota` citando "Melhor Envio" e o `me_reverse_id`, em
--      texto NEUTRO (sem imperativo dirigido a alguém).
--   5. Achado 1 (rodada 5, "negar por padrão"): `SELECT
--      public.admin_devolucao_liberar_vinculo_reverso('<id>')` (SEM o 2º
--      argumento), autenticado como admin, numa devolução com
--      `me_reverse_id` REAL preenchido e `codigo_postagem` NULL, agora
--      RECUSA sempre com `22023` — com ou sem marcador nenhum gravado (antes
--      da rodada 5, sem marcador algum o vínculo saía solto direto, achado G5
--      do scratchpad). Só `SELECT
--      public.admin_devolucao_liberar_vinculo_reverso('<id>', true)` solta
--      (`me_reverse_id` volta a NULL, evento 'sistema' gravado) — e só quando
--      não houver marcador CONFIRMADO (ver abaixo). Uma RESERVA
--      (`me_reverse_id` = 'reservando:...') continua soltando SEM o 2º
--      argumento, sem mudança nenhuma (achados R1/N-a). Chamado por quem não
--      é admin: `42501`. Sem vínculo nenhum: `22023`. Com código já emitido:
--      `22023` (nada para destravar). Achado R5 (rodada 3): com um evento
--      'sistema' de pagamento CONFIRMADO gravado para o `me_reverse_id`
--      atual (a edge grava um assim que o checkout paga), a RPC recusa com
--      `22023` MESMO com `p_conferi_no_melhor_envio = true` — nada é solto, o
--      vínculo continua como estava, e NENHUM segundo argumento contorna
--      isso. Achado 1c (rodada 4) + 1 (rodada 5): com um evento 'sistema' de
--      pagamento INDETERMINADO gravado (checkout 5xx ou exceção), a mensagem
--      de recusa avisa que há esse registro — mas a exigência do 2º
--      argumento é a MESMA, com ou sem esse marcador. Achado 3 (rodada 4):
--      `SET ROLE service_role` (ou `postgres`) SEM uma sessão de verdade
--      (sem `auth.uid()`) recebe `42501`, mesmo sendo admin pelo
--      `is_admin()` baseline — só uma sessão autenticada de fato libera.
--      Chamar SEMPRE (antes de passar `true`, não só "antes do código
--      chegar"): confira o envio em "Meus envios" na conta do Melhor Envio
--      da loja ANTES de chamar esta RPC com o 2º argumento — se já foi pago,
--      não solte (a RPC recusa sozinha se o marcador CONFIRMADO chegou a ser
--      gravado, mas a checagem manual continua sendo a primeira linha de
--      defesa); se ainda está no carrinho sem pagar, remova-o de lá
--      primeiro. Ver o procedimento completo no runbook
--      (`docs/runbooks/publicar-painel-cartao-devolucoes.md`, §7.6).
--
-- ROLLBACK: `rollback-manual-20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
-- restaura o corpo de `cancelar_devolucao` da 20261175000000 byte a byte
-- (conferido nesta mesma frente por comparação de texto no teste estático
-- `tests/migration_cancelar_devolucao_barra_compra_em_voo_test.ts`, md5
-- ef90f1e3fa72c67a606656aeace10ecf do bloco original) e derruba
-- `admin_devolucao_liberar_vinculo_reverso` nas DUAS assinaturas possíveis
-- (1 e 2 argumentos — função nova em toda rodada, sem corpo anterior para
-- restaurar; `IF EXISTS` cobre quem só chegou até a rodada 2/3).

CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_d.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN
    RAISE EXCEPTION 'Esta devolução não pode mais ser cancelada.' USING ERRCODE = '22023';
  END IF;
  -- Achado A1 (rodada 1) + R1 (rodada 2): só barra com um id REAL do Melhor
  -- Envio (a fase de RESERVA, prefixo 'reservando:', não precisa de guard —
  -- o vínculo seguinte da edge já é condicionado a status = 'aprovada' e
  -- desfaz sozinho se o cliente cancelou nesta janela). Sem prazo prometido:
  -- quem destrava um vínculo real preso é a loja
  -- (admin_devolucao_liberar_vinculo_reverso, criada abaixo), não o relógio.
  IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE 'reservando:%' AND v_d.codigo_postagem IS NULL THEN
    RAISE EXCEPTION 'A loja está gerando o código de postagem desta devolução. Se precisar cancelar, fale com a loja.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes SET status = 'cancelada', encerrada_em = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);
  -- O código já tinha saído (etiqueta PAGA no Melhor Envio) quando o cliente
  -- cancelou: dinheiro já gasto, nada a corrigir aqui — só registrar o fato.
  -- Evento PRÓPRIO, de ator 'sistema' (nunca dentro da nota do evento
  -- 'cliente' de cima). Achado R2 (rodada 2): texto NEUTRO de propósito —
  -- `devolucao_eventos` libera o DONO por RLS e `devolucao_detalhe` devolve
  -- `eventos` inteiro para o cliente também, então esta nota pode ser lida
  -- por ele; não é uma instrução dirigida à loja. Achado N3: COALESCE — sem
  -- ele, `me_reverse_id` NULL (estado que a edge nunca produz, mas que o
  -- banco não impede sozinho) faria a concatenação `||` devolver a nota
  -- INTEIRA como NULL, calada.
  IF v_d.codigo_postagem IS NOT NULL THEN
    PERFORM public.devolucao__registrar_evento(
      p_id, 'cancelada', 'cancelada', 'sistema',
      'O código de postagem gerado para esta devolução (envio reverso ' || COALESCE(v_d.me_reverse_id, 'sem id registrado') || ' no Melhor Envio) ficou sem uso depois do cancelamento. Convém conferir se esse envio também precisa ser cancelado por lá.'
    );
  END IF;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelada');
END;
$$;

-- Achado R1 (rodada 2): a "saída" para um vínculo real preso sem código —
-- edge que morreu entre a reserva e o vínculo, liberação que falhou (achado
-- A3), checkout indeterminado, ou Sandbox do Melhor Envio (nunca gera o
-- código da reversa). Só admin; nunca mexe num vínculo que já tem código
-- (aí o caminho é cancelar direto no Melhor Envio, não apagar o rastro
-- daqui); registra o que fez.
-- Rodada 4: a assinatura ganhou `p_conferi_no_melhor_envio` (achado 1c) — uma
-- CREATE OR REPLACE não troca a assinatura de uma função (Postgres trataria
-- como um OVERLOAD novo, deixando a versão de 1 argumento das rodadas 2/3
-- viva ao lado dela, sem NENHUM dos guards novos). O DROP abaixo é
-- idempotente (`IF EXISTS`) e limpa esse overload antigo se ele existir.
DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid);

CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  -- Achado 3 (rodada 4): `is_admin()` (baseline) aceita a conexão rodando
  -- como `postgres`/`service_role` (`current_setting('role') IN (...)`) —
  -- correto para as OUTRAS RPCs do app (automações internas de confiança),
  -- mas esta RPC é uma decisão humana pós-checagem manual no Melhor Envio, e
  -- nenhuma automação deveria tomá-la. `auth.uid() IS NOT NULL` garante que
  -- alguém está DE FATO logado (JWT ou GUC de sessão) além de ser admin —
  -- `SET ROLE service_role`/`postgres` sem login nenhum não tem `auth.uid()`
  -- e cai aqui (prova viva: `mutante F3_service_role_sem_jwt`).
  IF NOT public.is_admin() OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.me_reverse_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não está vinculada a nenhum envio reverso no Melhor Envio.' USING ERRCODE = '22023';
  END IF;
  IF v_d.codigo_postagem IS NOT NULL THEN
    RAISE EXCEPTION 'O código de postagem já foi emitido — não há vínculo preso para liberar; cancele o envio reverso direto no Melhor Envio, se for o caso.'
      USING ERRCODE = '22023';
  END IF;
  -- Achado R5 (rodada 3, dinheiro): o pagamento pode já ter sido CONFIRMADO
  -- no Melhor Envio sem o código de postagem ter voltado ainda — a janela
  -- real entre o checkout (paga) e a gravação do código, que é a única prova
  -- no banco de que foi pago. Sem este guard a RPC soltava esse vínculo do
  -- mesmo jeito que um morto: a gravação do código lá na frente batia 0
  -- linhas SEM erro (o `me_reverse_id` não bate mais) e a edge respondia 200
  -- `ok: true` sem nada salvo — o próximo "Gerar" comprava um SEGUNDO envio
  -- (T10 do scratchpad da revisão). O marcador é um evento 'sistema' que a
  -- própria edge grava assim que `pagoConfirmado` vira true
  -- (`gravarPagamentoConfirmadoReverso`, index.ts) — o texto do `strpos`
  -- abaixo É O CONTRATO com aquela função (conferido em
  -- `tests/marcador_pagamento_reverso_contrato_test.ts`, achado 4 da rodada
  -- 4): mudar um lado sem atualizar o outro quebra esta proteção em
  -- silêncio. Este marcador (CONFIRMADO) NUNCA aceita `p_conferi_no_melhor_envio`
  -- — dinheiro confirmado não se destrava por auto-declaração.
  IF EXISTS (SELECT 1 FROM public.devolucao_eventos WHERE devolucao_id = p_id AND ator = 'sistema' AND strpos(nota, 'confirmou o pagamento do envio reverso ' || v_d.me_reverse_id || ';') > 0) THEN
    RAISE EXCEPTION 'O Melhor Envio já confirmou o pagamento deste envio reverso — aguarde o código de postagem chegar ou cancele o envio direto no Melhor Envio antes de liberar o vínculo aqui.'
      USING ERRCODE = '22023';
  END IF;
  -- Achado 1 (rodada 5, dinheiro — "negar por padrão"): o guard da rodada 4
  -- só recusava quando o marcador INDETERMINADO existia — mas um vínculo
  -- REAL sem NENHUM marcador (edge derrubada no meio do caminho, um link de
  -- produção gravado antes de esta proteção nascer, ou qualquer outra falha
  -- que nunca chegou a gravar nada) não caía em guard nenhum e saía solto
  -- sem pedir confirmação (achado G5 do scratchpad `ataque4.cjs`: vínculo
  -- real, zero eventos 'sistema', liberado sem `p_conferi_no_melhor_envio`).
  -- CORREÇÃO: para QUALQUER `me_reverse_id` REAL (a fase de reserva continua
  -- isenta — achados R1/N-a intactos), a RPC agora EXIGE
  -- `p_conferi_no_melhor_envio = true` sempre, com ou sem marcador. O
  -- marcador indeterminado deixa de decidir sozinho e vira só informação na
  -- MENSAGEM da recusa (avisa que há um registro de pagamento indeterminado,
  -- quando existir); sem marcador nenhum, a mensagem diz isso também. O
  -- marcador CONFIRMADO (guard acima) continua recusando sem NENHUMA
  -- exceção — inalterado pela rodada 5.
  --
  -- Achado 2 (rodada 6a, scratchpad rev79/ataque5.cjs, G8): `NOT
  -- p_conferi_no_melhor_envio` deixa passar um `NULL` EXPLÍCITO — em SQL,
  -- `NOT NULL` é `NULL` (não `TRUE`), e um `IF` com condição `NULL` nunca
  -- entra no corpo, então a RPC soltava o vínculo do mesmo jeito que com
  -- `false`. Isso é alcançável de fora: PostgREST aceita `{"p_id": "...",
  -- "p_conferi_no_melhor_envio": null}` no corpo JSON e passa `NULL` pra
  -- valer (o `DEFAULT false` só vale quando o parâmetro nem aparece na
  -- chamada). CORREÇÃO: `IS NOT TRUE` — únicos que NÃO recusam são `true` de
  -- verdade; `false` e `NULL` recusam igual.
  IF v_d.me_reverse_id NOT LIKE 'reservando:%' AND p_conferi_no_melhor_envio IS NOT TRUE THEN
    IF EXISTS (SELECT 1 FROM public.devolucao_eventos WHERE devolucao_id = p_id AND ator = 'sistema' AND strpos(nota, 'Pagamento do envio reverso ' || v_d.me_reverse_id || ' em verificação;') > 0) THEN
      RAISE EXCEPTION 'Há registro de pagamento indeterminado para este envio reverso no Melhor Envio — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.'
        USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Não há nenhum registro de pagamento para este envio reverso no banco — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;
  -- Texto neutro pelo mesmo motivo do evento de cancelar_devolucao (achado
  -- R2): o dono da devolução também pode ler esta nota. Achado N-a (rodada
  -- 3): esta RPC também pode soltar uma RESERVA ativa (prefixo
  -- 'reservando:', ainda não vencida) — seguro (a edge relê o status antes de
  -- vincular e desfaz sozinha se a reserva sumiu), mas chamar isso de "envio
  -- reverso (id reservando:...)" confundia quem lesse; a nota agora distingue
  -- os dois casos.
  PERFORM public.devolucao__registrar_evento(
    p_id, v_d.status, v_d.status, 'sistema',
    CASE
      WHEN v_d.me_reverse_id LIKE 'reservando:%' THEN
        'Uma reserva em andamento desta devolução com o Melhor Envio foi liberada manualmente pela loja.'
      ELSE
        'O vínculo desta devolução com um envio reverso no Melhor Envio (id ' || v_d.me_reverse_id || ') foi liberado manualmente pela loja. Convém conferir se esse envio precisa ser cancelado por lá.'
    END
  );
  RETURN jsonb_build_object('id', p_id, 'me_reverse_id_liberado', v_d.me_reverse_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean) TO authenticated;
