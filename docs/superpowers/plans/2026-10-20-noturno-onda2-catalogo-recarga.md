# Plano — catalogo-recarga

Spec: docs/superpowers/specs/2026-10-20-noturno-onda2-design.md. Manifesto: docs/superpowers/lanes/2026-10-20-noturno-onda2.json. Posse: src/views/admin/AdminProductsView.tsx e tests/front/admin-products-recarga-mais-recente.test.tsx. Nenhuma migration/compartilhado; não alterar hook useProducts nem métricas/cópia/layout.

1. Validar git-CABSOLUTO raiz/branch/HEAD antes de registrar faixa; divergência → PARE. PowerShellCWD+comandoMESMAchamada, nuncaSet-Locationisolado. frente.mjs entrar uma única vez. Ler componente e contrato hook/testes relevantes, executar-tarefa e skills TDD.
2. Teste novo no componente real com fronteiras de catálogo/promessas controladas. Observar RED pela recargaA obsoleta ligar erro depoisBsucesso, incluindo Bvazio. Controlar erro real da tentativa atual e retry de recuperação. Não usar só cópia de callback como teste final.
3. Fix mínimo no dono do estado do consumidor, sem mudar assinatura/contrato do hook. Tratar busy/erro só na geração atual/montada; não esconder falha atual nem converter null em sucesso indiscriminado.
4. GREEN novo + regressões curtas, lint dirigido, diagnóstico de tipo proporcional (Vitest não prova tipos). Só teste local de segundos, semsuitecompleta/heapgrande/servidor/conta real/segredos. Dependências declaradas já resolvidas no ancestral; não instalar/junction na frente. Compartilhado viraPEDIDO.
5. frente.mjs conferir e commitar com hooks. Relatório branch/SHA/worktree, arquivos, RED/GREENsaída, limites/PEDIDOS; sempush/PR/merge. Integrador prova faixa e revisão independente final; diretor factual é última tarefa da integração/entrega.
