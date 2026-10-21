# Plano — banner-recorte

Spec: docs/superpowers/specs/2026-10-20-noturno-onda1-design.md. Manifesto: docs/superpowers/lanes/2026-10-20-noturno-onda1.json.
Posse: src/views/admin/AdminBannersView.tsx e tests/front/admin-banners-recorte-nao-troca-editor.test.tsx. Nenhuma migration ou arquivo compartilhado. Risco: dados/imagem e escrita assíncrona; revisão Opus obrigatória antes de integrar.

1. Registrar faixa e ler caminhos de recorte, Escape/fechar/abrir/desativar e geração já existente. Teste novo deve demonstrar a corrida com promessa controlada e controle de sucesso atual; observar vermelho antes de editar produção. Fronteiras de upload/delete/storage sempre dubladas, sem serviço/arquivo remoto real.
2. Guardar identidade/geração do upload em seu dono; não usar estado novo para decidir conclusão antiga. Cobrir reset de carregamento/avisos da geração errada e falha. Se limpar upload órfão, provar que nunca apaga URL publicada/antiga/de B e que falha da limpeza é inofensiva. Não alterar ImageAdjuster ou hooks compartilhados.
3. Verde no teste novo e regressões de fechamento/rascunho/envio de banner; lint escopado e checagem de tipos proporcional. Não rodar várias suítes inteiras em paralelo.
4. frente.mjs conferir e commitar; sem push/PR/merge. Relatório com branch/SHA, diferença, vermelho/verde, comandos/saídas, PEDIDOS e riscos remanescentes. Não editar planos canônicos.
5. Integrador prova faixa e solicita revisão Opus do SHA final desta frente. Última tarefa da onda após revisão/integração: diretor factual. Nenhum deploy faz parte da autorização desta frente.
