# Registro — plano: 2026-11-16-banner-por-dispositivo.md

Execução na worktree cranky-tu-c2c617, base b3f6f488f. Escopo aprovado na conversa: duas imagens/recortes, campanha compartilhada e fallback legado.

## Execução

- Tarefa 1: implementada. RED observado: 9 falhas em 10 testes (mapeamento, payloads, descarte e rascunho); GREEN posterior: 10/10.
- Tarefa 2: implementada. RED do editor (controle ausente) e da vitrine (desktop continuava com imagem de celular); GREEN: 22/22 em quatro arquivos, cobrindo também cancelamento de upload desktop atrasado, gravação incerta e rascunho desktop.
- Vizinhos: primeiro lote 63 testes teve 1 falha de expectativa do default (campo novo nullable); expectativa atualizada, os quatro testes de defaults passaram depois. Lote de vizinhos reexecutado antes do encerramento.
- Typecheck: `npm run typecheck` saiu 0 depois da correção do tipo do preview e novamente no estado final.
- Lint escopado: 0 erros e 22 avisos. Primeiro lint identificou efeito no render da sonda do teste; corrigido para useEffect. Removidos também três avisos novos de acesso dinâmico.
- `git diff --check`: saiu 0.
- Lint da BASE medido por ESLint sobre `git show HEAD:<arquivo>`: 22 avisos (1 prévia, 6 hook, 1 realtime, 14 editor), igual aos 22 do estado alterado. Nenhum aviso novo.
- Tamanho do build fixture passou nos quatro portões sem mudar tetos: cliente 679.605 / 680.000 B; painel 543.827 / 546.000 B; CSS 50.810 / 100.000 B; leitor 334.887 / 400.000 B.
- Build normal recusou por `IDENTITY_PUBLIC_URL: endereço público obrigatório`. Build no modo fixture documentado PASSOU (Vite em 22,17 s e service worker em 227 ms, saída em dist-test; sem configuração real/credencial). Há avisos de anotações PURE do Zod e chunks grandes, não falhas.
- Revisão independente Opus BLOQUEADA: erro HTTP 429 de limite semanal antes de produzir veredito. Não aprovada, não publicar. Segunda leitura GPT solicitada apenas para detectar defeitos, sem substituir o portão Opus.
- Verificações posteriores: 22/22 testes novos/defaults e 44/44 vizinhos passaram (14 arquivos distintos, 66 testes).
- Vizinhos de renderização: 150/151 inicialmente; a única falha era `desktop-home.test.ts` extrair apenas `className="literal"`. A classe mobile continua byte a byte idêntica dentro de `cn`; o teste passou após ajustar só a extração, mantendo a expectativa exata. Lote de 7 arquivos adicionais: 255/255, incluindo esse arquivo, pré-carregamento e navegação.
- Total de arquivos distintos verificados em lotes: 30. Último resultado por arquivo: 465 testes passando; não é uma execução da suíte inteira.
- Diretor também permanece pendente: o modelo Claude exigido está sem cota; não simular o papel com outra família.

## Decisões técnicas

- Reutilizar o leitor de largura único `useTelaDeComputador` (1024px), inclusive na antecipação da imagem; não criar outro listener nem biblioteca.
- Preservar aspecto e apresentação legados onde não há imagem desktop. Banner com desktop dedicado usa 4:1.
- Campo de desktop opcional e NULL, sem UPDATE retroativo; rollback manual recusa apagar a coluna se houver imagens configuradas.
- Sem execução remota. Tipos locais receberam somente a coluna nova nas três formas; regeneração contra banco aplicado continua passo de publicação.
- Não abrir servidor novo por iniciativa própria: não havia preview em execução. Validação visual em navegador e prova do SQL em Postgres seguem pendentes até ambiente apropriado; jsdom não é prova física.

## Correções da segunda leitura

O GPT terminou com dois achados P1, ambos confirmados por testes novos RED→GREEN no componente real:

1. Callback do crop era aceito depois de fechar e abrir outra versão/editor. Corrigido vinculando contexto imutável (campo, geração e identidade da abertura) antes de o canvas processar. Fechar invalida a identidade; o upload que já iniciou continua com sua geração, preservando o comportamento existente de Escape.
2. Recuperar um rascunho depois de salvamento sem resposta voltava a tratar uma imagem possivelmente publicada como descartável. Corrigido: recuperar não transforma marcador persistido em autoridade de exclusão. Só preserva propriedade de upload conhecido desta abertura que não foi substituído. **Custo aceito:** arquivo recuperado e abandonado pode ficar conservado no armazenamento; é preferível a apagar imagem publicada. O teste legado de limpeza foi alterado explicitamente para essa regra de segurança.

Lote das correções: 45/45 em quatro arquivos (11 novos de dispositivo, 18 fluxo/modelos, 9 salvar durante recorte, 7 recorte atrasado). Verificação FINAL após correção e organização de imports: 72/72 em 10 arquivos, incluindo Escape, rascunho antigo e armazenamento bloqueado; typecheck 0; eslint 0 erros/22 avisos preexistentes; Biome dos 5 arquivos novos/ajustados 0; git diff --check 0. Build fixture final passou (Vite 20,86 s, service worker 223 ms). Tamanho FINAL aprovado sem alterar teto: cliente 679.650/680.000 B; painel 543.760/546.000 B; CSS 50.810/100.000 B; leitor 334.887/400.000 B. Sem commit, push, aplicação SQL ou publicação. Todos os auxiliares terminaram; nenhum servidor foi iniciado.

Equipe: 1 Claude (tentativa Opus sem veredito) / 1 GPT (segunda leitura concluída). Nenhum auxiliar de escrita. Não houve nova revisão duplicada.

## Continuidade autorizada em 2026-11-16

Gabriel autorizou **SIGA 100% COM GPT** depois da indisponibilidade de Opus. A exceção é desta tarefa, sem alterar a configuração global. O revisor GPT persistente aprovou o snapshot final de 19 arquivos de código/SQL/testes; manifesto caminho=blobGit (LF final) SHA256 `63ccc6940b848a50e5379d829ddaecb6e778c64d3509a7f866d00a36403214d2`. Os dois P1 foram fechados; a releitura focada executou 7 testes e ignorou 29 pelo filtro, sem achado novo.

### Banco descartável: passou

PostgreSQL 17.11, cluster próprio em scratch, banco `prova_banner_dispositivos`; não usou URL/credencial de loja. Script `provar-banner-pg.cjs` no scratch da sessão executou a migration e o rollback reais contra tabela e papéis fictícios:

- Controle negativo: coluna não existia antes (42703).
- Coluna aditiva preservou a linha antiga (desktop NULL), RLS, ACL e policies.
- Editor gravou cada versão sem alterar a outra.
- Visitante leu a imagem pública, mas não ganhou escrita (42501).
- Rollback recusou coluna preenchida sem perder a imagem.
- Rollback sem imagem removeu somente a coluna, preservando permissões.

A transação foi desfeita e o cluster próprio foi encerrado. Não foi prova contra o esquema completo Supabase nem aplicação remota.

### Navegador real: passou em fixture isolada

Vite existente, envDir:false, identidade fictícia, hooks de dados locais e backend bloqueado; componentes reais AdminBannersView, ImageAdjuster e BannerCarousel com CSS real. Nenhum banco de loja foi acessado.

- 1440×1000: editor alternou as duas artes; recorte de computador ofereceu apenas 4:1 e gerou arquivo real 1600×400. Salvamento local preservou celular.
- Vitrine de computador exibiu a arte dedicada em 1376×344, sem transbordamento horizontal.
- Na mesma montagem, após redimensionar e pintar o frame, 390×844 exibiu a arte original de celular (800×400) em 390×195.
- Recorte de celular ofereceu apenas 2:1 e gerou arquivo real 1200×600; a versão computador 1600×400 continuou intacta.
- Editor e recorte sem transbordamento horizontal no celular.

**Cuidado com a medição:** neste navegador os callbacks de ResizeObserver/matchMedia só foram processados depois de uma captura/pintura do frame. A primeira tentativa sem essa pintura usou o tamanho inicial 400×300 e não vale como prova de proporção. Repetida após medir viewport e estado concordantes, a exportação ficou correta. Não se alterou produção para acomodar o instrumento. O console acumulou erros da montagem inicial do harness (504 de dependência otimizada e Proxy bloqueando React Refresh); não são declarados console limpo nem defeitos do app.

Servidor temporário encerrado; .claude/launch.json restaurado exatamente, sem diff. Harness e backup ficaram apenas em scratch.

Diretor GPT concluiu **SEGUE**: resultado cobre o pedido; pode declarar implementação local verificada, não publicada. Conferência documental, sem duplicar revisão técnica. Equipe desta continuidade: 0 Claude / 2 GPT (revisor persistente e diretor).

Primeiro commit recusou antes de executar os checks: shim compartilhado procura lefthook no node_modules da árvore principal, ausente. Binário já instalado nesta worktree foi confirmado. A chamada seguinte usa o parâmetro nativo LEFTHOOK_BIN somente no processo do git, mantendo todos os hooks e sem editar configuração compartilhada.

## Pendências antes de publicar

Migration aplicada e tipos conferidos no banco-alvo, CI do estado final e publicação conforme procedimento da frota continuam pendentes. Provas locais não são publicação nem prova de produção.
