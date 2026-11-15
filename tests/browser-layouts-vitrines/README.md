# Ensaio local dos layouts da home

Mostra a **HomeView e os cartões reais** com produtos, imagem e hooks de dados fictícios.
Não importa conta/autenticação nem consulta banco. O modo de identidade deve ser `fixture`.
Nenhuma credencial ou configuração de cliente é necessária.

## Executar no PowerShell

Na raiz desta worktree, uma linha por vez:

```powershell
$env:IKCOUS_IDENTITY_MODE = "fixture"
npm run dev -- --config tests/browser-layouts-vitrines/vite.config.ts
```

Abra `http://127.0.0.1:5197/tests/browser-layouts-vitrines/?layout=lateral&qtd=2`.
Parâmetros: `layout=compacto|lateral|lateral-duplo`, `qtd=1|2`,
`semNome=1&id=personalizada` e `atraso=1` (1,5 s com esqueleto antes dos dados).

Em outro terminal, informe uma **pasta temporária absoluta, nova e vazia**:

```powershell
node tests/browser-layouts-vitrines/capturar.mjs "C:\pasta-temporaria-do-ensaio"
```

O capturador usa Chromium descartável (Puppeteer já é dependência do projeto),
bloqueia pedidos externos, tira 18 PNGs e escreve `medidas.json`.
Compara altura da seção e posição do Catálogo antes/depois da chegada dos produtos.
Fecha o navegador ao terminar. Encerre o servidor com Ctrl+C.

## Observado em 15/11/2026

- 390 e 320 px: os três desenhos com 1 e 2 produtos sem desconto, e personalizada sem nome.
- O Padrão antigo preserva também o cabeçalho ausente quando a seção não tinha nome. Nos desenhos
  novos fora de Ofertas, o título de reserva vem do tipo da seção (ou “Produtos selecionados”).
- 18 capturas, 12 trocas esqueleto→real sem deslocamento do Catálogo; nenhum pedido externo
  e nenhum erro de JavaScript no capturador.
- Alturas: Compacto 392 px; Lateral 226 px; Duplo 206 px (1 produto) ou 318 px (2).
- O Lateral sem desconto deixava a linha da economia vazia. Fora de Ofertas, ela agora mostra
  a categoria verdadeira; a altura fixa permanece. Ofertas continua igual.
- A prova inicial detectou salto de 16 px no Compacto com dois produtos a 320 px: o nome
  ocupava três linhas, mas o esqueleto reservava duas. Só fora de Ofertas, cartões estreitos
  limitam o nome a duas linhas. O botão de abrir continua anunciando o nome completo.
- O Compacto com um produto permanece alto e com espaço generoso entre nome e preço;
  o Duplo sem desconto/estoque baixo deixa a linha do preço antigo sem texto. Não inventamos
  desconto, urgência nem estoque baixo para ocupar esses espaços.
- Esta é prova local em Chromium, não teste físico de celular, teste em loja real ou medição
  de CLS em produção. O painel é uma peça separada e não faz parte deste ensaio.

## Tamanho do build

Mesma worktree, `IKCOUS_IDENTITY_MODE=fixture npm run build` seguido de `npm run size`
(com a variável mantida no PowerShell):

| Medida brotli por arquivo | Base | Final |
| --- | ---: | ---: |
| Cliente | 669,54 kB | 669,80 kB |
| Painel | 536,14 kB | 536,03 kB |
| CSS | 47,07 kB | 47,07 kB |
| Leitor | 334,89 kB | 334,89 kB |

Teto do cliente inalterado: 672 kB. Os três módulos alternativos continuam lazy e constam
do precache gerado em `dist-test/sw.js`, como antes. Nenhum arquivo de service worker foi alterado.
