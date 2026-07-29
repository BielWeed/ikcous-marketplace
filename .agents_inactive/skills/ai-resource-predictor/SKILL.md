---
name: "ai-resource-predictor"
description: "Inferência estatística local de peso de recursos no ecossistema OMEGA."
risk: low
---

# AI Resource Predictor

## Use esta habilidade quando
- Otimizar carregamento de páginas e pré-carregamento (prefetch) de arquivos de API ou estáticos (`src/ai-resource-predictor.ts`).
- Ajustar pesos de transição ou adicionar novas telas e recursos rastreáveis.

## Instruções
1. **Rastreamento de Interações**: Sempre acione `trackInteraction(view, resourceUrl)` em transições de página para incrementar pesos no `localStorage`.
2. **Predição**: Use `predictResources(currentView)` para obter os 5 recursos com maior probabilidade estatística de clique.
3. **Persistência**: Mantenha os pesos salvos sob a chave `omega_ai_weights` no localStorage e trate erros de parse com segurança.