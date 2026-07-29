---
name: "state-worker"
description: "Lógica pesada de negócios e filtragem em Web Worker assíncrono."
risk: low
---

# State Worker

## Use esta habilidade quando
- Implementar processamento de dados intensivo, ordenação pesada de catálogo de produtos ou cálculos de impostos/totais em `src/state-worker.ts`.
- Evitar lag ou lentidão (jank) na UI Thread.

## Instruções
1. **Mensagens**: Utilize `postMessage` para enviar comandos de dados (como `INIT_PRODUCTS`, `PROCESS_FILTERS`, `CALC_TOTALS`) e ouça os retornos na thread principal.
2. **Offload**: Mantenha a interface do usuário responsiva delegando filtragem de milhares de itens e cálculos financeiros ao worker.
3. **Isolamento**: Lembre-se que o worker não tem acesso ao DOM, `window` ou `document`. Use transferíveis de forma otimizada.