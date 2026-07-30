# GitFlow — cola

Uma página, na ordem em que as coisas acontecem. O porquê está no
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Ponto de partida: `develop`. A `main` é só o que está no ar.

---

## Começar uma task

```bash
git switch develop
git pull
git switch -c feat/cupom-progressivo
```

Prefixos: `feat/` `fix/` `chore/` `docs/` `refactor/`

---

## Commitar

```bash
git add -p
git commit -m "feat(checkout): aplica cupom progressivo por faixa de valor"
```

`tipo(escopo): assunto imperativo, minúsculo, até 100 caracteres`

Tipos: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`

Escopos: `account` `admin` `auth` `brand` `cart` `catalog` `checkout` `ci` `db`
`deps` `edge` `lib` `notifications` `orders` `pwa` `shipping` `tooling` `ui`

---

## Antes de abrir o PR

```bash
npm run typecheck
npm test
```

O `pre-push` roda o typecheck de novo. Rode antes para não descobrir tarde.

---

## Abrir o PR

```bash
git push -u origin feat/cupom-progressivo
gh pr create --base develop --fill
```

Sempre `--base develop`. `--base main` só em release e hotfix.

---

## Depois da revisão

```bash
gh pr merge --squash --delete-branch
git switch develop && git pull
```

Squash em PR de feature. **Merge commit** em release e hotfix.

---

## Release

```bash
git switch develop && git pull
git switch -c release/1.2.0
npm version 1.2.0 --no-git-tag-version
# escreva o CHANGELOG.md
git commit -am "chore(tooling): prepara release 1.2.0"
git push -u origin release/1.2.0

gh pr create --base main --title "release 1.2.0"
gh pr merge --merge                      # merge commit, NÃO squash

git switch main && git pull
git tag -a v1.2.0 -m "release 1.2.0"
git push origin v1.2.0

gh pr create --base develop --head release/1.2.0 \
  --title "chore: volta a release 1.2.0 para develop"
```

---

## Hotfix (loja parada)

```bash
git switch main && git pull
git switch -c hotfix/frete-zerado
# corrija o mínimo
git commit -am "fix(shipping): volta o frete a calcular quando o CEP vem sem hífen"
git push -u origin hotfix/frete-zerado

gh pr create --base main --title "hotfix: frete zerado"
gh pr merge --merge

git switch main && git pull
git tag -a v1.2.1 -m "hotfix frete zerado" && git push origin v1.2.1

gh pr create --base develop --head hotfix/frete-zerado \
  --title "fix: leva o hotfix do frete para develop"
```

**Não pule o último comando.** Sem ele o bug volta no próximo release.

---

## Quando dá errado

```bash
# commitei na main sem querer (o hook devia ter pego)
git branch fix/meu-trabalho          # salva
git reset --hard origin/main         # devolve a main
git switch fix/meu-trabalho

# minha branch ficou velha em relação a develop
git switch develop && git pull
git switch minha-branch
git rebase develop                   # rebase, não merge, antes do PR

# o hook reclamou e eu preciso passar por cima
git commit --no-verify               # AVISE NO DISCORD depois

# esqueci o escopo / errei a mensagem, ainda não enviei
git commit --amend

# quero desfazer um merge que já está na develop
git revert -m 1 <sha-do-merge>       # revert, nunca reset em branch publicada
```

---

## Estado dos hooks

```bash
npx lefthook validate
npx lefthook install     # se .git/hooks estiver vazio
```

Não existe branch protection neste repositório — os hooks são locais e caem com
`--no-verify`. Ver "A trava que não existe" no `CONTRIBUTING.md`.
