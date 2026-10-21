# Catálogo de ícones de categoria

Desenhos originais (nenhum path copiado de biblioteca) para o dono escolher no painel
(Gerenciar categorias). Este diretório é a FONTE de revisão (dado e prova visual); o painel serve a cópia
`public/icons/categorias.json`, que se gera com `node docs/design/icones-de-categoria/publicar.mjs` (valida e
copia sem espaços; `tests/front/catalogo-de-icones-publicado.test.ts` reprova se as duas divergirem).

## Formato

`catalogo.json` é uma lista de objetos:

```json
{ "chave": "blusa", "nome": "Blusa", "grupo": "Roupas", "palavras": ["camiseta"], "d": "M9 3 ..." }
```

- `chave`: kebab-case ascii, única. Identifica o ícone no catálogo (não é gravada no banco).
- `nome`: rótulo em pt-BR mostrado ao dono.
- `grupo`: um dos 11 grupos fixos (lista em `validar.mjs`).
- `palavras`: termos pt-BR minúsculos, sem acento, para busca e para sugerir o ícone pelo
  nome da categoria.
- `d`: UMA string de path SVG, só traço. É isto que o painel grava em `categorias.icone_forma` (migration
  20261351000000, CHECK: alfabeto `MmLlHhVvCcSsQqTtAaZz0-9 .,-`, começa por M, até 400 caracteres); a vitrine desenha a
  forma gravada na própria categoria e nunca baixa o catálogo.

## Regras do desenho

- `viewBox` 24x24, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"`,
  `stroke-linecap/linejoin="round"` (mesmo estilo de `src/lib/icones-de-categoria.tsx`).
- Caixa útil de cerca de 20px, respiro de 2px.
- Só o atributo `d`: círculos viram arcos (`A`/`a`), pontos viram `M x y h.01`.
- Alfabeto: `MmLlHhVvCcSsQqTtAaZz`, dígitos, `.`, `-`, vírgula e espaço (o mesmo da CHECK do banco; sem `+`).
- No máximo 1 casa decimal por número e no máximo 360 caracteres por `d`.
- Sem texto, gradiente, estilo ou script: o dado vai para o banco e é desenhado em `<path d>`.

## Como validar

```
node docs/design/icones-de-categoria/validar.mjs
```

Falha (código 1) se houver chave duplicada ou inválida, `d` vazio, fora do alfabeto ou acima de
360 caracteres, grupo ausente ou sem ícone, ou menos de 90 ícones.

`folha-de-contato.html` mostra todos (72 px com nome e uma fileira em 24 px);
`folha-de-contato.png` é a mesma folha renderizada em Chromium headless.
