# Ensaio integrado da seção de identidade

Executar da raiz, sem argumentos: `node tests/browser-identity-editor/run.mjs`.

A seção, hook, modelo, preparador, TUS, conferidor, SDK administrativo e SQL são reais.
Somente useAuth e StoreContext são substituídos. O servidor TUS é uma fixture de protocolo,
não prova Storage/RLS, login, CDN, implantação ou PWA instalado.

Usa a API revisada de identity-admin-http/environment.mjs. Cria banco e containers próprios
em rede interna, sem publicar portas Docker. A leitura guardada do ambiente anterior copia
somente o esquema. Ao terminar para recursos próprios, preserva volumes e perfil Chrome curto.
O CSS real congelado é conferido por SHA; nenhum build global ou arquivo env é carregado.

Cada execução cria evidência em controle/tarefa-A5e2-<timestamp>. Um caso incompleto impede
o aceite integral; consultar expectedCases, resultado individual, HTTP/SQL/TUS e encerramento.
