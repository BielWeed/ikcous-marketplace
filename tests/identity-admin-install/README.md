# Instalação sem baixar o editor

Execute `node tests/identity-admin-install/run.mjs` na raiz, com `dist-test`
reservado. Requer dependências e Chrome do Puppeteer já instalados, sem baixar
nada. Recusa arquivos `.env*` além de `.env.example` e usa somente fixture.

O runner chama buildStore real, observa o grafo principal e lê o manifesto do
SW com Acorn sem executar JavaScript gerado no Node. Os cinco facades são
exatos; exclusividade é medida cortando apenas entradas da área administrativa.

Cada execução constrói duas medições atuais, em sequência, com as mesmas
fontes. O controle usa um único plugin de teste que troca apenas
`build.rollupOptions.output.chunkFileNames` pelo padrão Vite
`assets/[name]-[hash].js`. O candidato usa a configuração real sem esse plugin.
A configuração resolvida é registrada e comparada; módulos, entradas, fontes
consumidas e metadados de identidade precisam coincidir. Cada build cria seu
próprio publicDir temporário: os caminhos são registrados e o conteúdo dessas
pastas é comparado por caminho relativo e SHA-256. Mudanças concorrentes
nas fontes interrompem a prova. Reserve também essas fontes durante o ensaio.

O controle deve emitir e incluir os cinco facades no precache; o candidato deve
emitir os mesmos módulos e excluir somente esses cinco. O comparador preserva
a cobertura por facade, moduleIds, isEntry e isDynamicEntry. Remover vendor-react
apenas da cópia em memória do manifesto precisa reprovar.

O controle pareado é um experimento presente, **não um RED histórico**.
O RED original anterior ao patch e a falha posterior RED_BASELINE_REQUIRED
continuam preservados nas suas evidências. Nenhum relatório anterior é lido:
o comando funciona após outro commit ou em outro checkout sem buscar um
resultado antigo com o mesmo HEAD. Usa duas compilações reais; somente o
candidato final é servido ao Chrome.

Evidências novas ficam em
`C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A6c1-*`,
com controle em `paired-control/` e candidato em sua pasta pai. Guardam
grafo, precache, SW e hashes, sem copiar a árvore compilada.
As pastas são exclusivas e a escrita usa `wx`; nada histórico é sobrescrito.

Chrome usa perfil novo curto em TEMP (preservado e registrado na evidência),
para evitar falha de CacheStorage nos caminhos profundos do Windows,
proxy local que recusa destinos externos e
página neutra que apenas registra o SW emitido. A instalação deve ativar e
preencher CacheStorage sem buscar os cinco alvos. O HTML da loja é baixado como
recurso de cache, mas nunca executado. Servidor e navegador fecham em finally.

Limites: não prova abertura/offline/update de cliente ou administrador, nem
Auth/GoTrue/Storage/produção. Não publica, não usa banco nem credenciais.

A guarda pura exportada `assertStaticPrecache(graph, precache)` encontra a única
entrada com `src/main.tsx` e exige todo o fechamento transitivo de imports
estáticos no grafo e no precache. Não exige imports somente dinâmicos e termina
mesmo com ciclos. Entrada ausente/duplicada, chunk duplicado, dependência ausente
do grafo e falta no precache reprovam. Controles em memória cobrem dependência
indireta, ciclo, import repetido e dinâmico; cada chunk obrigatório é retirado
individualmente do precache para exigir reprovação nos dois builds.

A exclusão explícita de vendor-charts foi removida porque o grafo real o exige
na entrada. Os nomes não fazem parte da guarda: `staticPrecache` registra os
chunks obrigatórios com bytes, SHA-256 e contraprovas. As medições acontecem
após buildStore concluir seus fechamentos. Importar o runner não inicia build.
O RED anterior à correção foi medido separadamente no artefato A5d3c1 preservado;
a execução normal continua independente de evidência histórica. Instalar o SW
na página neutra ainda não certifica o primeiro reload offline da loja.
