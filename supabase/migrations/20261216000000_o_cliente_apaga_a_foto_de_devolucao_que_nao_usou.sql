-- ============================================================================
-- Migration 20261216000000 — o cliente apaga a foto de devolução que não usou
-- (pendência da passagem de 26/09, §6: "foto de devolução órfã se a solicitação
-- for recusada depois do upload")
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: a tela de solicitação de devolução sobe
-- cada foto direto para o bucket PRIVADO `devolucoes` (pasta do próprio cliente)
-- e só depois chama `solicitar_devolucao` com os caminhos. A política do bucket
-- (20261175) deixa o cliente INSERIR e LER na própria pasta, mas não apagar.
-- Resultado: a foto que o cliente tira da lista depois de enviada, a que sobra
-- quando a solicitação falha e ele desiste, e a de uma falha parcial de envio
-- ficam guardadas no bucket para sempre, sem nenhuma devolução que as use.
-- São imagens de cliente guardadas sem finalidade.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Cria a política `devolucoes_cliente_delete_policy` em `storage.objects`:
--      DELETE para `authenticated`, só no bucket `devolucoes`, só na própria
--      pasta (`split_part(name, '/', 1) = auth.uid()`), e SÓ do objeto que
--      nenhuma devolução referencia (`NOT EXISTS ... name = ANY (d.fotos)`).
--      A foto de uma devolução em andamento, concluída ou recusada é a
--      evidência da loja: o cliente nunca consegue apagá-la.
--
--   A subconsulta em `public.devolucoes` roda com a RLS de quem pergunta. O
--   cliente só enxerga as próprias devoluções, e `solicitar_devolucao` só
--   aceita foto da pasta dele, então toda foto referenciada na pasta dele
--   está em devolução dele: a subconsulta enxerga exatamente as que importam.
--   Admin e `service_role` não mudam (nenhum deles ganha ou perde nada aqui).
--
-- DADOS EXISTENTES: nenhuma linha é lida nem reescrita, e nenhum objeto é
-- apagado ao aplicar. As fotos órfãs que JÁ existem continuam lá: esta
-- migration só dá ao app o direito de apagar as próximas (e as antigas, se o
-- cliente voltar à tela). Varrer as antigas no servidor é um passo à parte.
--
-- IDEMPOTÊNCIA: `DROP POLICY IF EXISTS` seguido de `CREATE POLICY` (objeto desta
-- própria migration). Reaplicar deixa o mesmo estado.
--
-- FORA DO ESCOPO: varredura periódica no servidor (função de borda com segredo
-- por loja e agendamento); política de retenção das fotos de devoluções
-- recusadas ou concluídas (decisão do dono); mexer nas políticas de INSERT e de
-- SELECT do bucket.
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- supabase/migrations/20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql`
-- — sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa); quem abre
-- a transação é o aplicador.
--
-- ORDEM DE PUBLICAÇÃO: o banco primeiro, depois o front. O front novo chama o
-- `remove` do Storage para as fotos que não usou; sem esta política a chamada
-- é negada e o app a ignora (a limpeza é "o melhor possível"), então front novo
-- com banco velho só deixa as fotos como estavam. Banco novo com front velho
-- não muda nada.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação:
--   1. Deve dar 1 linha, cmd = DELETE, roles = {authenticated}:
--        SELECT policyname, cmd, roles FROM pg_policies
--         WHERE schemaname = 'storage' AND tablename = 'objects'
--           AND policyname = 'devolucoes_cliente_delete_policy';
--   2. As políticas de INSERT e de SELECT do bucket seguem iguais:
--        SELECT policyname, cmd FROM pg_policies
--         WHERE schemaname = 'storage' AND tablename = 'objects'
--           AND policyname LIKE 'devolucoes%' ORDER BY policyname;
--
-- ROLLBACK: `rollback-manual-20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql`
-- apaga a política (o cliente volta a não poder apagar foto nenhuma).

DROP POLICY IF EXISTS devolucoes_cliente_delete_policy ON storage.objects;
CREATE POLICY devolucoes_cliente_delete_policy ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'devolucoes'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND NOT EXISTS (
      SELECT 1 FROM public.devolucoes d WHERE storage.objects.name = ANY (d.fotos)
    )
  );
