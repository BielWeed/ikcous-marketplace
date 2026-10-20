# Onda 2 — intenção do caixa e recarga administrativa

## Base e objetivo
Base examinada5942fc3e, planosonda1em505c6ea6. Correções autorizadas por Gabriel após20/10/2026 08:01America/Sao_Paulo, marco observado11:01:11UTC. Não incluir proposta rejeitadaPR1027/84e4, simulador manual, texto longo ou decisão de produto nova.
Duas faixas independentes: caixa-db (contrato SQL, testes e passo CI explicitamente liberado); catalogo-recarga (somente consumidor administrativo e teste). Não dependem entre si. Nenhuma aplicação em banco real/deploy por executor.

## CX1/CX2 — contrato aprovado conceitualmente por Opus, ainda sem prova PostgreSQL
As RPCs atuais escolhem o caixa aberto mais recente. Fechamento deS1 com resposta perdida, aberturaS2 e retry pode fecharS2; sangria50/saldo300 repetida grava duas transferências. A evidência até aqui é estática; não alegar incidente ou ensaio PG já executado.

### RPCs novas e aditivas
- fin_caixa_fechar_sessao(p_sessao_id uuid,p_valor_contado numeric,p_observacao text DEFAULT NULL).
- fin_caixa_movimentar_com_chave(p_sessao_id uuid,p_chave uuid,p_tipo text,p_valor numeric,p_descricao text,p_conta_contrapartida uuid DEFAULT NULL).
- Nomes novos evitam sobrecarga/ambiguidade; RPCs antigas, seus hashes e grants ficam intactos nesta fase. Clientes antigos continuam com risco nomeado, não considerar correção universal nem aposentar funções por efeito colateral.
- Gates is_admin() e is_admin_atual(), nesta ordem e ANTES de replay. SECURITY DEFINER com search_path public. Revoke de PUBLIC/anon; permissões authenticated e service_role conforme contrato existente medido no efêmero, nunca deduzir grant vivo pela ausência de arquivo.
- Entradas nulas/ID ausente recusadas22023; admin rebaixado42501 inclusive replay. Recusar NaN/infinito, negativos/zero indevido e teto9999999999.99 antes de cast tipado que explodiria fora da validação. Descrição normalizada máximo140; observação máximo500. Não afrouxar validações existentes.

### Fechamento
Travar sessão pelo ID informado, nunca última aberta. Aberta executa os efeitos atuais uma vez. Já fechada pelo mesmo autor e mesmo contado/observação normalizados devolve colunas gravadas sem recalcular/INSERT/UPDATE. Divergência retorna22023 e marcador fechamento_divergente. Resposta id/esperado/contado/diferenca mais replay booleano. RetryS1 não lê nem alteraS2.

### Movimento
Tabela fin_caixa_movimento_tentativas: chave uuidPK, sessao_idFK, autor, tipo, valor numeric(12,2), descricao normalizada, contrapartida_id resolvida, lancamento_idFK DEFERRABLE INITIALLY DEFERRED, criado_em; campos necessários NOT NULL. RLS ligada, sem políticas, REVOKE ALL de PUBLIC/anon/authenticated/service_role, fora de publicação; conferência ACL/forma equivalente20261246. Não guardar hash textual de numeric: comparar colunas IS NOT DISTINCT FROM.
Ordem: gates; validação pura/normalização; lock de sessão porID; reservar chave via INSERT ON CONFLICT DO NOTHING (id do lançamento gerado antes); replay compara sessão/autor/conteúdo e devolve original id/replay/status atual; divergência22023 DETAIL tentativa_divergente. Somente chave nova segue checagens sessão aberta/contrapartida ativa e diferente/limite de sangria, INSERT do lançamento com id reservado. Qualquer RAISE desfaz reserva e lançamento na mesma transação. Reserva precede status/saldo/conta ativa para replay continuar após fechamento/esgotamento/desativação. Unicidade global da chave cobre sessões diferentes, não apenas lock de sessão. Chaves diferentes permitem movimentos legítimos iguais.

### Cliente em onda posterior (NÃO posse da frente DB)
O id é da sessão mostrada. Movimento conserva chave após erro ambíguo MESMO editando campos. Persistir só UUID em localStorage por(autor,sessão,tipo), SEM expirar intenção pelo relógio. Apagar só confirmação/replay/divergência reconciliada (mostrar original,recarregar,fechar folha,sem reenvio automático)/sessão deixa de ser atual; gerar próxima intenção depois. Fechar usa id da sessão como chave natural. Armazenamento indisponível conserva identidade em memória enquanto folha vive; não prometer proteção entre aparelhos/armazenamento limpo/outro autor. Contrato precisa de testes front e tipos GERADOS antes de publicar cliente novo.

### Prova e rollback
PG17 efêmero do workflow RPC-CI, sem secrets/produção. Docker engine local indisponível; não iniciá-lo nem conectar banco real por inferência. Prévia de prova pode ir somente a branch própria/rascunho autorizado, nunca integrar RED à linha de trabalho. RED precisa falhar pela conta/sessão errada em RPC antiga real, não por função nova ausente. Depois GREEN do contrato novo e controles/mutantes. Locks observados por pg_blocking_pids em duas conexões, sem sleep como única prova.
Migration não leva BEGIN/COMMIT próprios; aplicador controla transação. Rollback manual não destrutivo remove RPCs novas somente após reverter consumidor; tabela/tentativas ficam preservadas. Não criar nem executar rollback que apaga dados.

## L1 — resultado obsoleto não pode sobrescrever estado de recarga atual
Em AdminProductsView, recargaA cancelada retorna null após recargaB ter sucesso e liga loadError indevido. Hook protege os produtos, mas o consumidor não protege seu estado. Corrigir apenas propriedade/generation do callback de recarga administrativo; não mudar contrato de useProducts nem campos financeiros/labels/layout. Cada tentativa deve concluir busy/erro somente se continua atual e montada. Preservar falha real e resultado vazio legítimo.
Teste componente real com promessas controladas: Bsucesso seguidoAnull não vira erro (lista com itens e vazia); erro real da tentativa atual aparece e retry posterior recupera; Aconclui antesB continua normal; desmontagem invalida conclusão. Nenhuma rede/conta real.

## Fechamento obrigatório
Cada frente TDD, faixa conferida e commit com hooks. Revisão independente por SHA final; caixa exige Opus diferente de quem escreveu, sem deduzir segurança por suite verde. Compartilhados não liberados são PEDIDOS. Última tarefa de cada integração/release é diretor factual sobre planos, evidências, CI no SHA final e limites externos. Nada aqui autoriza produção sem prova, apagar rascunho rejeitado, alterar guardas/configuração ou contornar uma recusa.
