# Plano — qa-rascunho

Spec: docs/superpowers/specs/2026-10-20-noturno-onda1-design.md. Manifesto: docs/superpowers/lanes/2026-10-20-noturno-onda1.json.
Posse: src/components/ui/custom/ProductQA.tsx e tests/front/productqa-nao-apaga-rascunho-novo.test.tsx. Nenhuma migration ou arquivo compartilhado.

1. Registrar faixa com frente.mjs entrar. Ler componente, hook como contrato somente leitura e testes relevantes. Reproduzir com teste novo no componente real os casos da spec; observar vermelho pela asserção certa antes de editar produção. Mockar apenas fronteiras, sem rede/conta real.
2. Correção mínima da propriedade do rascunho/target na conclusão assíncrona. Preservar entrada editável, falha, sucesso normal e contrato de addQuestion/addAnswer. Evitar efeitos colaterais dentro de updater React. Não refatorar fora do necessário.
3. Rodar teste novo escopado, regressões de perguntas/respostas relevantes e lint dos dois arquivos; conferir diagnóstico de tipo proporcional sem confundir Vitest com typecheck. Colar comando, resultado e limites.
4. frente.mjs conferir e commitar; sem push/PR/merge. Relatório com branch, SHA, arquivos, vermelho/verde, comandos e PEDIDOS. Não editar os planos canônicos.
5. Integrador faz revisão independente e prova de faixa; achado volta à mesma frente. Última tarefa da onda, depois das duas revisões/integração: diretor factual, conforme spec. Executor não dá a própria revisão como independente.
