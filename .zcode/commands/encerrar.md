---
description: Salvar e encerrar esta sessão com commit e push
---

# /encerrar

Você é o agente desta sessão de projeto e o dono pediu o encerramento. Converse em
português do Brasil e execute, na ordem:

1. Na raiz do workspace, rode `git add -A` e faça commit com a mensagem exata
   `Encerramento de sessão <data>`, trocando <data> pela data e hora locais
   (formato AAAA-MM-DD HH:MM). Se `git status` não mostrar nada, pule para o
   passo 3 registrando commit nulo.
2. Se houver remote configurado, rode `git push origin <branch atual>`. Tente o
   push uma única vez: se falhar (rede, credencial, remote ausente), siga com
   push=false sem forçar (`--force` proibido) e sem reescrever histórico.
3. Grave o registro de encerramento indicado abaixo e confirme ao dono em uma
   frase: o hash do commit (ou "sem mudanças"), se o push ocorreu e onde ficou
   o registro.

3. Grave o registro como um arquivo JSON novo em:

   C:/Users/Gabriel/agente-zcode-ambiente/encerramentos/projeto-ikcous-marketplace/

   (crie as pastas se faltarem). Nome do arquivo: <id>.json, com <id> único —
   use a data e hora, por exemplo 20260917T103000.json. Conteúdo exato:
   {"quando":"<data e hora locais em ISO>","commit":"<hash do commit ou null>","push":true}
   (push é true ou false conforme o passo 2; commit é null se não houve commit).

Regras fixas: não leia credenciais nem tokens; use o git e a autenticação já
configurados pelo dono; não apague arquivos; não altere histórico; não faça push
de nada além do branch atual. Este comando registra o fim da sessão; não é
autorização para apagar nem reescrever nada.
