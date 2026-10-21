# Plano — banner-upload

Spec: docs/superpowers/specs/2026-10-20-banner-upload-design.md. Manifesto: docs/superpowers/lanes/2026-10-20-banner-upload.json.
Posse exclusiva: src/views/admin/AdminBannersView.tsx e tests/front/admin-banners-upload-durante-salvar.test.tsx. Nada da frente financeira.

1. Validar raiz/branch/SHA pelo git -C absoluto. Divergência significa PARAR antes de entrar ou editar. Cada PowerShell usa CWD absoluto e comando na MESMA chamada. Registrar frente uma única vez, não apagar/refazer lane ou âncora. Ler AGENTS, spec e testes U1/U2/rascunho existentes.
2. Escrever teste novo no componente real. Observar RED causal na base antes de produção. Promessas controladas e seletor/handlers reais: input bloqueado durante salvar; callback atrasado não inicia upload; upload e salvar no mesmo lote não publicam imagem anterior; fluxos normais e falha continuam funcionais. Refutar a hipótese se não alcançar a trajetória real, em vez de forçar teste artificial.
3. Corrigir exclusão mútua mínima de upload normal e salvar, com guarda síncrona por geração, sem refactor de passagem ou efeitos dentro de updater. Preservar U1/U2 e edição textual durante envio.
4. GREEN dirigido com um worker e regressões próximas. Biome check em TODOS os arquivos alterados, inclusive a tela, e não só no teste. ESLint proporcional comparado à base, tipos proporcionais da fixture sem heap grande; não suíte completa/tsc/build local. Fonte só Edit/Write, nunca formatter --write, tetos, suppressions ou casts para esconder erro.
5. Conferir faixa e commitar com frente.mjs e hooks. Executor não faz push/merge/PR. Entregar SHA, RED/GREEN realmente observados e limites. Integrador confere fonte e pede Opus independente no SHA final; achados voltam ao mesmo autor. Depois integração e CI do topo.
6. Última tarefa: diretor factual sobre escopo, evidências e pendências antes de promover a entrega. Sem produção por executor e sem misturar caixa ainda sem GREEN.
