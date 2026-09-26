-- CANCELAR_DEVOLUCAO BARRA A COMPRA EM VOO (achado A1 da revisão de risco
-- pré-publicação de 26/09/2026 sobre a etiqueta reversa do Melhor Envio —
-- PR #666, commit fe045939; scratchpad
-- revisao-etiqueta-e-checkout.md, achado A1).
--
-- AS MIGRATIONS 20261175–20261178 JÁ FORAM APROVADAS E VÃO SER PUBLICADAS
-- COMO ESTÃO (runbook docs/runbooks/publicar-painel-cartao-devolucoes.md) —
-- por isso a correção entra em arquivo NOVO, redefinindo só a função, em vez
-- de editar a 20261175000000 por cima.
--
-- O DEFEITO: `cancelar_devolucao` (nascida em 20261175000000) só olhava
-- `status IN ('solicitada', 'aprovada')`. Ela não sabia nada sobre
-- `me_reverse_id`/`codigo_postagem` — colunas que a edge
-- `melhor-envio-etiqueta` (action `gerar_devolucao_reversa`) grava por
-- service role, fora do PostgREST. Isso abre dois buracos de dinheiro:
--   * o cliente cancela ENQUANTO a compra do envio reverso está em voo no
--     Melhor Envio (reserva gravada ou vínculo com o id do envio, mas o
--     código de postagem ainda não voltou) — se o checkout da edge confirmar
--     o pagamento um instante depois, a etiqueta sai PAGA para uma devolução
--     já cancelada, e ninguém na loja fica sabendo;
--   * o caso mais comum, sem corrida nenhuma: o código já saiu (a etiqueta
--     está paga) e, dias depois, o cliente cancela a devolução — a etiqueta
--     fica órfã no Melhor Envio e nada avisa o lojista para cancelá-la lá.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. Redefine `public.cancelar_devolucao(p_id uuid)` (MESMA assinatura da
--      20261175000000 — grants de lá continuam valendo, Postgres não perde
--      privilégio num CREATE OR REPLACE que não muda a assinatura): mantém
--      o lock (`FOR UPDATE`), a checagem de dono e o guard de status
--      originais, byte a byte, e insere UM guard novo logo depois do guard
--      de status:
--        `me_reverse_id IS NOT NULL AND codigo_postagem IS NULL` — "compra em
--        voo": a reserva (`reservando:<epoch>:<uuid>`) ou o vínculo com o id
--        real do envio reverso já foi gravado, mas o código de postagem
--        (só a edge grava, depois do checkout pago) ainda não chegou.
--        Cancelar aqui é recusado com uma frase que o cliente entende
--        (`RAISE EXCEPTION ... USING ERRCODE = '22023'`, o mesmo código dos
--        outros guards desta função) — pedir para tentar de novo em
--        instantes, sem prometer prazo. A janela é curta e se fecha sozinha:
--        ou o código sai (cai no passo 2) ou a edge solta o vínculo numa
--        recusa DEFINIDA do Melhor Envio (`me_reverse_id` volta a NULL e
--        este guard nem entra na próxima tentativa).
--   2. Quando o código de postagem JÁ existe (`codigo_postagem IS NOT NULL`
--      no momento do cancelamento — dinheiro já gasto, sem correção possível
--      aqui), grava um evento A MAIS em `devolucao_eventos` (ator 'sistema',
--      nunca dentro da nota do evento 'cliente' que já existia) nomeando o id
--      do envio reverso e pedindo para cancelá-lo no Melhor Envio. Esse
--      evento já aparece para o lojista SEM nenhuma mudança de front: a RPC
--      `devolucao_detalhe` (20261175000000) devolve `eventos` inteiro, e
--      `DetalheDaDevolucao.tsx` já renderiza `evento.nota` de cada linha —
--      inclusive as de ator 'sistema' (`ROTULO_ATOR` já cobre os três
--      atores). A policy de SELECT de `devolucao_eventos` também libera o
--      DONO da devolução — mas `DevolucaoDoPedidoCard.tsx` (tela do cliente)
--      não lê `eventos` em lugar nenhum, então este aviso, que é do lojista,
--      não vaza para o cliente.
--      Verificado: não é cheap estender `useAvisosDoLojista`/
--      `admin_devolucao_listar` (a lista) para uma bolinha própria no sino —
--      exigiria uma sexta fonte no `Promise.allSettled`, um campo novo na
--      RPC (redefinida por cima da 20261175000000) e um mapper de front
--      novo, para o mesmo aviso que a ficha da devolução já mostra. Fica
--      fora do escopo desta correção (ver relatório da tarefa).
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita por esta migration —
-- ela só troca o CORPO da função. Devoluções já canceladas não são
-- revisitadas.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` com a mesma assinatura —
-- reaplicar o arquivo dá exatamente o mesmo corpo.
--
-- FORA DO ESCOPO (achados A2/A3/A4 da mesma revisão, corrigidos em código,
-- sem migration):
--   * a edge `melhor-envio-etiqueta` relê o status da devolução depois do
--     checkout e devolve `aviso` se ela não estiver mais 'aprovada';
--   * `src/lib/devolucao.ts` (leitor de `gerar_devolucao_reversa`) passa a
--     ler `aviso`/`dce_pendente`/`expirado`; o painel mantém a ação de
--     buscar o código enquanto a DC-e não chegou;
--   * `removerDoCarrinho`/`liberarVinculoReverso` (retry e mensagem honesta).
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- supabase/migrations/20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
-- — sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO (rodar à mão depois de aplicar):
--   1. `SELECT prosrc FROM pg_proc WHERE proname = 'cancelar_devolucao'`
--      contém `me_reverse_id IS NOT NULL AND codigo_postagem IS NULL`.
--   2. Com uma devolução 'aprovada' e `me_reverse_id` preenchido (reserva ou
--      id do envio) e `codigo_postagem` NULL: `SELECT
--      cancelar_devolucao('<id>')` autenticado como o dono levanta exceção
--      (SQLSTATE 22023) — não cancela.
--   3. Com a mesma devolução e `codigo_postagem` preenchido: o mesmo
--      `SELECT cancelar_devolucao('<id>')` cancela (`status = 'cancelada'`)
--      e `devolucao_eventos` ganha uma linha nova com `ator = 'sistema'` e
--      `nota` citando "Melhor Envio" e o `me_reverse_id`.
--   4. Devolução sem `me_reverse_id` (o caminho de sempre, sem etiqueta
--      reversa) cancela exatamente como antes, sem evento extra.
--
-- ROLLBACK: `rollback-manual-20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
-- restaura o corpo de `cancelar_devolucao` da 20261175000000 byte a byte
-- (conferido nesta mesma frente por comparação de texto no teste estático
-- `tests/migration_cancelar_devolucao_barra_compra_em_voo_test.ts`, md5
-- ef90f1e3fa72c67a606656aeace10ecf do bloco original) — a única mudança da
-- ordem inversa é essa reescrita, então não há tabela, índice, policy ou
-- trigger para desfazer.

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
  -- Achado A1: compra do envio reverso em voo no Melhor Envio (reserva ou
  -- vínculo já gravados pela edge, código de postagem ainda não voltou).
  -- Cancelar agora arriscaria pagar uma etiqueta para uma devolução que já
  -- não existe mais, sem ninguém na loja saber.
  IF v_d.me_reverse_id IS NOT NULL AND v_d.codigo_postagem IS NULL THEN
    RAISE EXCEPTION 'O código de postagem do envio reverso está sendo gerado no Melhor Envio agora — aguarde alguns instantes e tente cancelar de novo.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes SET status = 'cancelada', encerrada_em = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);
  -- O código já tinha saído (etiqueta PAGA no Melhor Envio) quando o cliente
  -- cancelou: dinheiro já gasto, nada a corrigir aqui — só avisar. Evento
  -- PRÓPRIO, de ator 'sistema' (nunca dentro da nota do evento 'cliente' de
  -- cima): é o que aparece na ficha da devolução para o lojista cancelar o
  -- envio reverso no Melhor Envio antes que os Correios o retirem à toa.
  IF v_d.codigo_postagem IS NOT NULL THEN
    PERFORM public.devolucao__registrar_evento(
      p_id, 'cancelada', 'cancelada', 'sistema',
      'O código de postagem já tinha sido pago no Melhor Envio (envio reverso ' || v_d.me_reverse_id || ') quando o cliente cancelou. Cancele esse envio reverso no Melhor Envio.'
    );
  END IF;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelada');
END;
$$;
