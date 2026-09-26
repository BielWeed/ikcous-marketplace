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
-- O QUE ESTA MIGRATION FAZ, NA ORDEM (já com a rodada 2 aplicada):
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
--   3. Cria `public.admin_devolucao_liberar_vinculo_reverso(p_id uuid)`
--      (nova, achado R1): só admin; trava a linha (`FOR UPDATE`); recusa se
--      não houver vínculo (`me_reverse_id IS NULL`) ou se o código já tiver
--      saído (nesse caso não há nada para "destravar" — a etiqueta já existe
--      e o caminho é cancelar direto no Melhor Envio); solta
--      `me_reverse_id` (reserva OU id real, tanto faz) e grava um evento
--      'sistema' com texto neutro contando o que foi liberado. Não mexe em
--      `status`, `codigo_postagem` nem em nada além do vínculo — é
--      estritamente a "saída" para um vínculo preso, nada mais.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita por esta migration —
-- ela só troca o CORPO de uma função e cria outra. Devoluções já canceladas
-- não são revisitadas.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` com a mesma assinatura para as
-- duas funções — reaplicar o arquivo dá exatamente o mesmo corpo e não
-- recria a função nova (`CREATE OR REPLACE` também tolera reaplicação).
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
--   5. `SELECT public.admin_devolucao_liberar_vinculo_reverso('<id>')`
--      autenticado como admin, numa devolução com `me_reverse_id` preenchido
--      e `codigo_postagem` NULL: solta o vínculo (`me_reverse_id` volta a
--      NULL) e grava o evento 'sistema' correspondente. Chamado por quem não
--      é admin: `42501`. Sem vínculo: `22023`. Com código já emitido:
--      `22023` (nada para destravar).
--
-- ROLLBACK: `rollback-manual-20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
-- restaura o corpo de `cancelar_devolucao` da 20261175000000 byte a byte
-- (conferido nesta mesma frente por comparação de texto no teste estático
-- `tests/migration_cancelar_devolucao_barra_compra_em_voo_test.ts`, md5
-- ef90f1e3fa72c67a606656aeace10ecf do bloco original) e derruba
-- `admin_devolucao_liberar_vinculo_reverso` (função nova, sem corpo anterior
-- para restaurar).

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
CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
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
  UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;
  -- Texto neutro pelo mesmo motivo do evento de cancelar_devolucao (achado
  -- R2): o dono da devolução também pode ler esta nota.
  PERFORM public.devolucao__registrar_evento(
    p_id, v_d.status, v_d.status, 'sistema',
    'O vínculo desta devolução com um envio reverso no Melhor Envio (id ' || v_d.me_reverse_id || ') foi liberado manualmente pela loja. Convém conferir se esse envio precisa ser cancelado por lá.'
  );
  RETURN jsonb_build_object('id', p_id, 'me_reverse_id_liberado', v_d.me_reverse_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid) TO authenticated;
