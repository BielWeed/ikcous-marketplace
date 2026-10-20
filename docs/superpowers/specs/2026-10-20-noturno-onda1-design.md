# Correções noturnas — onda 1

Autorização: Gabriel pediu corrigir os achados confirmados depois de 08:01 de 20/10/2026, com testes e revisão. Base conferida: 5942fc3e4b2f747821c9cfed56eaee0c5ab5777d, produção 1.5.42. PR1027 e seu simulador rejeitado não entram.

## Objetivo
Corrigir duas corridas locais já reproduzidas, sem redesenhar telas, alterar hooks de persistência, preço, banco, autorização, dependências ou configuração.

### Q1 — rascunhos de perguntas e respostas
No ProductQA, sucesso do envio A não pode apagar texto B digitado depois. O mesmo vale para resposta oficial: a conclusão de A não pode limpar/fechar rascunho de outro alvo ou texto posterior. Texto/target enviados devem continuar sendo os capturados no envio. Sucesso limpa o rascunho apenas se ele ainda corresponde à submissão concluída. Falha preserva a digitação e o alvo. A entrada continua editável; não esconder o defeito bloqueando a próxima digitação.
Critérios: pergunta A pendente/digitar B/resolver A preserva B; pergunta inalterada limpa; falha preserva; resposta oficial A pendente/digitar B preserva B e editor; alvo trocado durante espera preserva o novo alvo; resposta inalterada limpa/fecha normalmente. Preservar rótulos e comportamento do hook useQuestions, sem novos avisos longos.

### U1 — recorte de banner
O upload recortado iniciado no editor A só pode atualizar A enquanto a mesma geração continua válida. Fechar, reabrir outro banner ou desativar a tela invalida o retorno antigo. Controle: recorte atual ainda atualiza normalmente; falha não grava URL nem desmonta editor errado. Retorno antigo não deve modificar imagem, título, avisos ou estado de upload do editor novo. Se houver limpeza de upload não adotado, usar somente deleteStorageFile existente, apenas a URL que esse upload acabou de criar, nunca imagem anterior/publicada/de outro editor; falha dessa limpeza não pode afetar B.
Critérios: uploadA pendente, Escape do ajustador, cancelar A, abrir B, resolver A mantém B; desativação também invalida; sucesso da geração atual funciona; falha preserva dados; geração antiga não desliga indicador de upload de geração nova. Teste deve exercitar componente real quando proporcional, ou justificar limite. Não mudar ImageAdjuster compartilhado para mascarar a ausência da guarda no dono.

## Faixas
Manifesto canônico: docs/superpowers/lanes/2026-10-20-noturno-onda1.json. Um arquivo de produção e um teste por frente. Compartilhados só por pedido; nenhuma migration nesta onda. Caixa CX1/CX2 continua em planejamento independente, sem escritor nesta onda.

## Evidência e fechamento
Sondas prévias são sintéticas: Q1 em React/JSDOM real, U1 por callbacks reais AST. Não são aparelho físico nem produção. Cada executor faz TDD vermelho/verde e teste escopado, prova a faixa e commita. Integrador confere diff/commit/faixa, revisão independente; U1 recebe revisão Opus por risco de perda de imagem. Última tarefa da onda é diretor factual: conferir pedido, SHAs, testes realmente executados e ausência de publicação indevida. Sem declarar produção corrigida por commit local.
