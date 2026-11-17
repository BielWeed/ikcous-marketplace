# Ajustes desktop — verificação de 16/11/2026

## Entrega
Desenho aprovado aplicado: recebimentos em três cartões; índice local com seis destinos a partir de 1280px; um grupo de edição por vez, sem desmontar os demais. Entrega continua porta direta. Aparência usa duas colunas de atalhos a partir de 1536px, uma nos PCs menores para não apertar descrições. Celular/PC abaixo de1280px conserva os acordeões.

## Resultados locais observados

| Verificação | Resultado |
| --- | --- |
| Testes novos antes da implementação | 4 falhas de navegação ausente; 2 controles móveis já passavam |
| Testes novos após implementar | 6/6 passaram |
| Regressão de foco Ver PIX | RED: foco ficava no botão do grupo oculto; GREEN: foco chega à seção Pagamentos |
| Testes novos/substituídos finais | 2 arquivos, 10/10 passaram, exit0 |
| Testes vizinhos de Ajustes e contratos relacionados | 194/194 passaram, 0 falhas, success true, exit0 |
| Demais contratos que citam a tela (11 arquivos adicionais) | 121/121 passaram, 0 falhas, success true, exit0 |
| Total das duas rodadas relacionadas | 315 testes passaram; não é a suíte inteira |
| `npm run typecheck` no código final | exit0 |
| ESLint escopado nos quatro TS/TSX alterados | exit0, sem erros/avisos |
| Stylelint em ajustes.css | exit0 após adotar sintaxe de media query do projeto |
| Biome nos cinco arquivos de código/teste | Checked5files; no fixes applied, exit0 |
| `git diff --check` | exit0 |
| Build completo com `IKCOUS_IDENTITY_MODE=fixture` | exit0; Vite concluiu em 22,39s, service worker gerado |
| `npm run size` no build fictício | exit0; cliente 679,50/680 kB, painel 543,34/546 kB, CSS 50,82/100 kB, leitor 334,89/400 kB |
| `npm run lint:links` | exit0; 428 links em 141 arquivos, nenhum quebrado |

Os testes vizinhos registraram avisos antigos de dublês incompletos do Supabase, e o Node registra `--localstorage-file` sem caminho válido. Nenhuma falha. O teste novo de foco inicialmente provocou cargas lazy fora de `act`; a fronteira externa MercadoPagoSection foi substituída só nesse teste de navegação, e a rodada final de10testes não tem esse aviso React. Os contratos reais de pagamentos continuam nos testes vizinhos, sem substituição nova.

Comando da rodada relacionada (não é a suíte inteira):

```powershell
npx vitest run tests/front/ajustes tests/front/admin-settings tests/front/admin-ajustes tests/front/desktop-p11-ajustes.test.ts tests/front/app-descartar-e-sair-descarta-a-tela-de-ajustes-montada.test.tsx tests/front/frete-um-lugar-so.test.tsx tests/front/pagamentos-status-uma-vez.test.tsx tests/front/pix-configurado-no-build-contrato.test.tsx tests/front/leitura-da-loja-falhou-nao-deixa-gravar-por-cima.test.tsx --maxWorkers=1
```

## Navegador real, ambiente fictício
Componente real AdminSettingsView, folhas reais de CSS/Tailwind e temas, dentro de shell de ensaio com barra de256px, largura máxima1280px e rolagem interna. Contexto e transportes substituídos por dados fictícios; nenhum .env, login, banco ou dado real consultado. Não é uma prova do app publicado nem do shell AdminLayout inteiro.

-390/768/1024px: overflow horizontal0; sem índice desktop; seis grupos empilhados. Conferido também com Aparência aberta.
-1280/1536/1920px: overflow horizontal0; índice252px; um grupo visível. Na leitura final, os três cartões de recebimentos têm mesma coordenada vertical e altura103,1875px.
-Troca de temas pelas opções reais: Escuro, Claro e Confortável funcionam; contraste de título/descrição selecionados:11,01:1 /13,95:1 /7,87:1. Subtítulo do cabeçalho:9,91:1 /5,98:1 /6,70:1. Todos acima de4,5:1.
-Atalho real Ferramentas → Ver o PIX: grupo Pagamentos visível, Ferramentas oculto, `document.activeElement.id === "grupo-de-ajustes-pagamentos"`.

A conferência encontrou e corrigiu dois defeitos que jsdom não mostrava: a margem Tailwind deixava os recebimentos em tops168/180/180; seletor com especificidade adequada produziu168/168/168. A descrição do índice selecionado tinha contraste4,34:1 no tema Confortável; agora herda o texto principal no selecionado/hover (7,87:1).

**Limite do instrumento:** o Browser pane com composição suspensa manteve animações/transições em currentTime0. Não alteramos animações de produção para compensar. O ensaio desliga animações/transições somente em seu HTML para medir geometria e cores estáticas. Não foi validada fluidez de animação nem aparelho físico.

## Revisão e decisões de execução
Uma revisão independente GPT nativa apontou o problema de foco, confirmado no código e por teste RED/GREEN. Não houve segunda revisão de Opus: cota semanal indisponível(429); não há aprovação Opus do estado final alegada. Equipe da implementação:0Claude/1GPT; a consulta anterior de desenho em Claude falhou por cota.

O teste P11 que congelava hash de toda a fonte foi substituído por teste do comportamento responsivo (troca nos dois sentidos, assinatura única/limpeza e fallback sem matchMedia). Era uma restrição da peça antiga, não uma obrigação de manter o desenho rejeitado pelo usuário.

## Não executado
Suíte inteira, lint ratchet global e CI não foram executados. Build e tamanho foram conferidos em ambiente fictício, sem segredos; o artefato `dist-test` não é publicável. O build informou avisos de anotações PURE em dependência Zod e de chunk grande; terminou com exit0. Sem teste com dados reais ou em aparelho físico. Sem push, PR ou publicação nesta entrega. A primeira tentativa de commit parou antes das verificações porque o hook apontava para uma instalação de Lefthook ausente na raiz; nenhuma guarda foi desativada. O servidor do ensaio foi encerrado e o viewport restaurado; scripts e relatórios detalhados permanecem no scratchpad da sessão, não no código de produção. A captura final do componente real com dados fictícios foi entregue ao usuário por SendUserFile (cabeçalho em y0, overflow horizontal0).

Skills usadas: brainstorming, writing-plans, executing-plans, test-driven-development, vercel-react-best-practices, built-in-browser, systematic-debugging, receiving-code-review e verification-before-completion.
