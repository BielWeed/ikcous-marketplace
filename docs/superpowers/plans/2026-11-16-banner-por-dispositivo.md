# Banner por dispositivo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Salvar imagens e recortes independentes para celular e computador no mesmo banner, preservando campanhas antigas.

**Architecture:** `imageUrl` permanece a versão de celular e reserva legada. Acrescentar `desktopImageUrl?: string | null`, persistido em `banners.desktop_image_url`. O editor captura o destino no início de cada operação; a vitrine escolhe a versão pelo mesmo breakpoint `lg` (1024px) do layout. Campos de campanha continuam comuns.

**Tech Stack:** React 19, TypeScript, Supabase/Postgres, Vitest; componentes existentes, sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-11-16-banner-por-dispositivo-design.md`

## Global Constraints

- Nenhuma transformação ou exclusão automática de banners existentes; coluna nova nullable e sem preenchimento retroativo.
- Imagens usadas pela outra versão ou por outro banner não são descartáveis.
- Texto, link, ordem, ativação e programação continuam compartilhados.
- Testes locais escopados; não iniciar publicação, acessar credenciais ou aplicar migration remota neste trabalho sem os portões exigidos.
- Não redesenhar o painel: usar botões e estilos existentes para escolher a versão.

## Review Focus

1. Upload/recorte que termina após mudar versão ou abrir outro editor: resultado fica no destino capturado, nunca na outra versão.
2. Cancelar, trocar modelo ou recuperar rascunho: limpar somente uploads de propriedade desta edição, sem apagar imagens persistidas ou compartilhadas.
3. Cache/realtime e recarga: manter ambas as URLs e o fallback dos registros antigos.
4. Trocar ou remover imagem desktop: nunca apagar a URL mantida no celular, nem a de outro banner.
5. Sem desktop configurado: vitrine e prévia conservam a imagem antiga, sem requisição de URL vazia.

## Tarefa 1 — Persistência e ciclo de vida das duas imagens

**Arquivos:** `src/types/index.ts`, `src/types/database.types.ts`, `src/hooks/useBanners.ts`, `src/lib/banners-da-vitrine.ts`, `src/lib/realtimeSyncEngine.ts`, `src/lib/rascunho-do-banner.ts`; migration aditiva e testes em `tests/front/`.

**Interface:** `Banner.desktopImageUrl?: string | null`; coluna `desktop_image_url text null`. Escrita parcial só envia desktop quando o campo estiver presente. Limpeza compara o conjunto anterior de URLs com o conjunto final e com os demais banners.

- [x] Escrever testes de ida/volta do campo, atualização independente, remoção para null, referências cruzadas e rascunho que só altera desktop.
- [x] Rodar os testes novos e observar falha pelo campo ausente.
- [x] Adicionar migration sem BEGIN/COMMIT e sem mudar RLS/grants. Atualizar os três formatos do tipo de banco (Row/Insert/Update) estritamente nessa tabela.
- [x] Implementar mapeamentos e limpeza segura no hook, inclusive exclusão de banner com duas imagens.
- [x] Executar testes novos e vizinhos de cache, gravação e exclusão; registrar resultado.

## Tarefa 2 — Editor e vitrine por dispositivo

**Arquivos:** `src/views/admin/AdminBannersView.tsx`, `src/components/ui/custom/BannerCarousel.tsx`, `src/components/ui/custom/ImageAdjuster.tsx` apenas se necessário, módulo focado de imagem responsiva se necessário; testes em `tests/front/`.

**Interface:** consumir `Banner.desktopImageUrl`. Controle `Celular` / `Computador` seleciona o campo de upload e a proporção fixa 2:1 / 4:1. Nova operação captura versão e geração antes do primeiro await.

- [x] Escrever testes de upload desktop preservando celular, caminho inverso, recorte por versão, fechamento, falha e conclusão tardia; incluir defaults/dirty-check e recuperação de rascunho.
- [x] Escrever teste de vitrine com duas imagens, breakpoint 1024px e fallback legado.
- [x] Rodar os novos testes e confirmar falhas relevantes.
- [x] Implementar seleção no painel com a linguagem/estilos existentes; prévia e dimensões acompanham a seleção. Avisar quando computador usa a imagem de celular.
- [x] Manter uploads pendentes por campo e proteger limpeza por referência; preservar marcador legado do rascunho para compatibilidade.
- [x] Exibir somente a imagem apropriada na vitrine, sem duplicar campanhas; preservar apresentação legada quando desktop ausente e usar proporção 4:1 para versão desktop dedicada.
- [x] Rodar testes afetados, typecheck e lint escopado. Validar em navegador real se o ambiente permitir; distinguir essa prova de jsdom.

## Tarefa 3 — Revisão de risco e conferência do conjunto

- [x] Revisor independente sobre o diff final: coluna aditiva, tipos/mapeamentos, referências de armazenamento, corridas, isolamento dos campos e testes observados. Sem aplicar SQL remoto.
- [x] Corrigir achados confirmados e refazer somente as verificações afetadas.
- [x] Diretor: confrontar o pedido original e a spec com o resultado e evidências; verificar que não se confundiu código local com migration aplicada ou publicação.
- [x] Registrar o que foi verificado, o que ficou pendente e como publicar com banco antes do frontend.

## Verificação

`npx vitest run <arquivos novos e vizinhos afetados>` deve terminar com todos passando. `npm run typecheck` deve sair com código 0. Lint apenas nos arquivos alterados, sem aumentar avisos. Prova SQL em ambiente descartável se já houver infraestrutura disponível; caso contrário declarar pendência, sem usar banco real como teste. Nenhum commit/publicação é implicitamente pedido pela aprovação do desenho.
