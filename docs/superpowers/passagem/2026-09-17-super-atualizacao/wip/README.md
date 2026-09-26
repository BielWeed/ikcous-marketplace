# Trabalho em andamento NÃO revisado (17/09/2026, 07:25 UTC)

Conteúdo desta pasta:

- `arvore.patch`: `git diff` dos arquivos JÁ RASTREADOS que estavam modificados na árvore, gerado
  sobre o commit `e3dd469` (HEAD da branch `claude/app-major-upgrade-wmc8x2` na hora).
- `novos/`: os arquivos NOVOS (não rastreados) que os agentes criaram, com o sufixo `.txt` para não
  serem lidos por tsc/vitest/eslint enquanto moram aqui. O caminho original está no nome
  (`__` no lugar de `/`).

Quem mexeu em quê (para saber o que revisar junto):

| Arquivo | Frente / tarefa | Estado |
| --- | --- | --- |
| `src/views/admin/AdminProductFormView.tsx` | pdv-c5 C5.2 (aprovada com ressalvas) + C5.3 (parcial) | misturados no mesmo arquivo |
| `tests/front/admin-product-form-codigo-de-barras.test.tsx` (novo) | pdv-c5 C5.2 | 10 casos, passavam |
| `tests/front/admin-product-form-ler-com-a-camera.test.tsx` (novo) | pdv-c5 C5.3 | parcial |
| `src/hooks/useOrders.ts` | pedidos-4 | revisão "nao passa" (ver `02`) |
| `tests/front/use-orders-cancelados-janela-de-tempo.test.tsx` (novo) | pedidos-4 | idem |
| `tests/front/cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx` | ajuste do orquestrador para pedidos-4 | acompanha o contrato de pedidos-4 |
| `src/components/pwa/UpdateNotification.tsx`, `src/components/pwa/PWAUpdateGate.tsx` | pwa UpdateNotification-138 | implementada, sem revisão |
| `tests/front/update-notification-tem-saida-e-e-dialogo.test.tsx` (novo) | pwa UpdateNotification-138 | idem |
| `src/lib/realtimeSyncEngine.ts` | pwa realtimeSyncEngine-955 | parcial |
| `tests/front/realtime-catchup-fatia-os-ids.test.ts` (novo) | pwa realtimeSyncEngine-955 | parcial |
| `.size-limit.cjs` | tooling size-limit-16 | parcial, sem revisão |
| `tests/front/portao-de-tamanho-mede-por-arquivo.test.ts` (novo) | tooling size-limit-16 | parcial |

Como aplicar (na branch, com a árvore limpa, a partir de `e3dd469` ou de um commit posterior que não
tenha tocado esses arquivos):

```
git apply --check docs/superpowers/passagem/2026-09-17-super-atualizacao/wip/arvore.patch
git apply         docs/superpowers/passagem/2026-09-17-super-atualizacao/wip/arvore.patch
for f in docs/superpowers/passagem/2026-09-17-super-atualizacao/wip/novos/*.txt; do
  destino=$(basename "$f" .txt | sed 's#__#/#g'); cp "$f" "$destino"; done
```

Se preferir aplicar SÓ uma frente, edite o patch (é texto) ou aplique com
`git apply --include='src/hooks/useOrders.ts' ...`. Nada aqui é commitável como está: cada frente
segue a rotina de revisão do `00-LEIA-PRIMEIRO.md`.
