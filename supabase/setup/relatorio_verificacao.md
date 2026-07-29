# Relatorio de Verificacao do Backend (IKCOUS)
**Data/Hora:** 2026-07-10 20:14:50

## Diagnostico do Ambiente
- **Node.js:** v25.8.2
- **Deno:** deno 2.9.2 (stable, release, x86_64-pc-windows-msvc)
- **Supabase CLI:** 2.90.0
- **Docker:** Inativo (Docker Desktop nao iniciado)

## Resumo dos Testes e Validacoes

| Etapa | Status | Observacao |
| :--- | :--- | :--- |
| **ESLint (Frontend)** | Falhou | Analise estatica do projeto React |
| **Typecheck (TypeScript)** | Sucesso | Validacao de tipos estaticos |
| **Deno Lint (Edge Functions)** | Sucesso | Analise estatica do codigo TypeScript Deno |
| **Deno Test (Edge Functions)** | Sucesso | Testes unitarios de frete/regras de negocio |
| **Supabase DB Lint** | Ignorado | Validacao de integridade de esquema Postgres |
| **Supabase pgTAP Tests** | Ignorado | Testes unitarios de banco de dados e politicas RLS |

## Detalhes das Execucoes

### ESLint Output (Primeiras 30 linhas se houver erro)
```text

C:\Users\Gabriel\Downloads\app_mkt\src\App.tsx
   620:12  warning  Generic Object Injection Sink  security/detect-object-injection
   620:36  warning  Generic Object Injection Sink  security/detect-object-injection
   631:12  warning  Generic Object Injection Sink  security/detect-object-injection
   631:28  warning  Generic Object Injection Sink  security/detect-object-injection
   808:9   warning  Generic Object Injection Sink  security/detect-object-injection
   814:7   warning  Generic Object Injection Sink  security/detect-object-injection
  1173:5   warning  Generic Object Injection Sink  security/detect-object-injection
  1188:25  warning  Generic Object Injection Sink  security/detect-object-injection

C:\Users\Gabriel\Downloads\app_mkt\src\components\admin\PhoneSimulator.tsx
   69:60  warning  Generic Object Injection Sink  security/detect-object-injection
  301:32  warning  Generic Object Injection Sink  security/detect-object-injection
  306:31  warning  Generic Object Injection Sink  security/detect-object-injection
  487:31  warning  Generic Object Injection Sink  security/detect-object-injection

C:\Users\Gabriel\Downloads\app_mkt\src\components\admin\dashboard\ProductBanners.tsx
  14:7  error  Visible, non-interactive elements with click handlers must have at least one keyboard listener                                                                                                     jsx-a11y/click-events-have-key-events
  14:7  error  Avoid non-native interactive elements. If using native HTML is not possible, add an appropriate role and support for tabbing, mouse, keyboard, and touch inputs to an interactive content element  jsx-a11y/no-static-element-interactions
  42:7  error  Visible, non-interactive elements with click handlers must have at least one keyboard listener                                                                                                     jsx-a11y/click-events-have-key-events
  42:7  error  Avoid non-native interactive elements. If using native HTML is not possible, add an appropriate role and support for tabbing, mouse, keyboard, and touch inputs to an interactive content element  jsx-a11y/no-static-element-interactions

C:\Users\Gabriel\Downloads\app_mkt\src\components\admin\dashboard\StrategicIntelligenceBlocks.tsx
  208:23  warning  Generic Object Injection Sink                                                                                                                                                                      security/detect-object-injection
  414:31  warning  Generic Object Injection Sink                                                                                                                                                                      security/detect-object-injection
  415:35  warning  Generic Object Injection Sink                                                                                                                                                                      security/detect-object-injection
  453:23  warning  Generic Object Injection Sink                                                                                                                                                                      security/detect-object-injection
  461:23  error    Visible, non-interactive elements with click handlers must have at least one keyboard listener                                                                                                     jsx-a11y/click-events-have-key-events
  461:23  error    Avoid non-native interactive elements. If using native HTML is not possible, add an appropriate role and support for tabbing, mouse, keyboard, and touch inputs to an interactive content element  jsx-a11y/no-static-element-interactions

```

### Typecheck Output (Primeiras 30 linhas se houver erro)
```text

```

### Deno Lint Output
```text

```

### Deno Test Output
```text
[0m[38;5;245mrunning 6 tests from ./supabase/functions/calculate-shipping/index_test.ts[0m
calculateSmartFallback - same region ... [0m[32mok[0m [0m[38;5;245m(611µs)[0m
calculateSmartFallback - neighboring region group ... [0m[32mok[0m [0m[38;5;245m(60µs)[0m
calculateSmartFallback - remote regions ... [0m[32mok[0m [0m[38;5;245m(47µs)[0m
getCartHash - empty cart ... [0m[32mok[0m [0m[38;5;245m(74µs)[0m
getCartHash - null or invalid cart ... [0m[32mok[0m [0m[38;5;245m(52µs)[0m
getCartHash - stable sorting and hashing ... [0m[32mok[0m [0m[38;5;245m(18ms)[0m

[0m[32mok[0m | 6 passed | 0 failed [0m[38;5;245m(25ms)[0m


```

> [!WARNING]
> O Docker Desktop nao estava em execucao. As validacoes dinamicas de banco de dados foram puladas.

