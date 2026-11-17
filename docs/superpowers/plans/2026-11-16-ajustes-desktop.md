# Ajustes desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Aplicar a prévia de Ajustes desktop aprovada, sem buracos ao abrir grupos e sem perder rascunhos.
**Architecture:** Um índice local seleciona os grupos existentes, mantidos montados. CSS responsivo troca a apresentação só a partir de 1280px; estados e integrações continuam no componente atual.
**Tech Stack:** React 19, TypeScript, CSS e Vitest existentes, sem dependências novas.
**Spec:** `docs/superpowers/specs/2026-11-16-ajustes-desktop-design.md`

## Global Constraints
- Preservar comportamento móvel e todos os seis grupos/portas.
- Não alterar banco, credenciais, regras de pagamento nem publicar.
- Estado de grupo não desmonta formulários/rascunhos.
- Usar as variáveis dos três temas do painel.

## Review Focus
- Rascunho pendente permanece ao trocar grupo e retornar.
- Gerenciar e Ver PIX revelam Pagamentos antes da rolagem.
- Mudança da largura não fecha nem perde edições.
- Carregamento, falha e offline não mostram estados inventados.
- Navegação por teclado e leitura acessível não alcançam grupo oculto.

### Task 1: Layout responsivo e seleção local
**Files:** modificar `src/views/admin/AdminSettingsView.tsx`, `src/components/admin/settings/ajustes.css`; criar componente local de apresentação em `src/components/admin/settings/NavegacaoDeAjustes.tsx` se necessário; testes em `tests/front/ajustes-desktop-navegacao.test.tsx`; substituir o teste antigo `tests/front/desktop-p11-ajustes.test.ts`, que congela o desenho explicitamente substituído.
**Interfaces:** consumir `GRUPOS_DE_AJUSTES`, os subtítulos existentes e os componentes atuais. Produzir navegação local sem alterar assinatura pública de `AdminSettingsView`.
- [x] Escrever testes: seis grupos no índice, seleção visível, porta Entrega, preservação do formulário e seleção programática de Pagamentos.
- [x] Rodar os testes novos e observar falha antes da implementação.
- [x] Implementar índice e apresentação responsiva, mantendo uma instância por grupo e as guardas existentes. Recebimentos e atalhos de aparência ganham grade CSS no desktop.
- [x] Rodar testes novos e todos os testes que importam/citam AdminSettingsView; corrigir somente contratos antigos de layout substituídos.

### Task 2: Conferência final do desenho aprovado
**Files:** mesmos arquivos, relatório breve em `docs/qa/ajustes-desktop-2026-11-16.md`.
**Interfaces:** consumir Task 1; produzir resultados observados e capturas, com limitações explícitas.
- [x] Rodar lint escopado e typecheck proporcional; não executar suíte inteira local.
- [x] Conferir no navegador real com dados fictícios, sem acessar credenciais/dados reais, nas larguras da spec e nos temas existentes.
- [x] Fazer revisão independente se houver modelo disponível; registrar bloqueio de cota se não houver, sem inventar aprovação.
- [x] Conferir diff final e registrar o que foi e não foi verificado. Não publicar nem fazer efeito externo.
