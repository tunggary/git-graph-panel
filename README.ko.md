[English](README.md) | 한국어

# git-graph-panel

[Git Graph](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) 스타일의 커밋 그래프를 Claude Code 세션 옆 터미널 패널에 띄워 주는 Claude Code mod입니다. Claude Code를 떠나지 않고 히스토리를 보고, diff를 읽고, 자주 쓰는 git 동작을 실행할 수 있습니다.

![색깔 lane, 브랜치 알약, 커밋 행이 보이는 Git Graph 패널](docs/images/graph.png)

![데모: 커서 이동, 커밋 펼치기, 파일 diff 열기, 그래프로 돌아가기](docs/images/demo.gif)

## 요구 사항

- Claude Code (2.1.302에서 테스트됨)
- git
- 곡선으로 그려지는 이미지 그래프: kitty, Ghostty, WezTerm. 그 외 터미널과 tmux 안에서는 글자 그래프로 자동 대체됩니다.
- 데스크톱 앱에서는 그래프가 항상 글자로 나옵니다. 모바일 앱에는 입력 칸이 없어서 Find와 이름을 입력받는 동작(Add Tag, Create Branch, Rename, Stash)이 나오지 않습니다.

## 설치

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install git-graph-panel --marketplace tunggary/git-graph-panel
```

셸에서:

```
claude plugin install git-graph-panel --marketplace tunggary/git-graph-panel
```

데스크톱 앱에서는 **+** → **Plugins** → **Add marketplace**를 눌러 `tunggary/git-graph-panel`을 입력한 뒤, 그 마켓플레이스에서 `git-graph-panel`을 설치합니다.

설치하는 동안 마켓플레이스를 추가할지(`y`), 어느 scope에 설치할지 묻습니다. user scope로 설치하면 모든 세션에서 로드됩니다.

## 빠른 시작

1. git 레포 안에서 `claude`를 실행합니다.
2. 패널이 자동으로 열립니다. 열리지 않았다면 `/graph`를 실행하세요. `/graph`를 한 번 더 실행하면 패널이 닫힙니다.
3. `ctrl+x tab`을 눌러 키보드 포커스를 패널로 옮깁니다.
4. `j` / `k`로 커밋 사이를 이동하고, `o`로 커서가 있는 커밋의 상세를 엽니다.
5. `a`를 눌러 그 행의 동작 메뉴(checkout, cherry-pick, 태그 등)를 엽니다.

## 기능

### 툴바

패널 맨 위는 `키: 이름` 형태의 버튼 줄입니다: `l: Branches: develop`, `b: ☑ remote`, `s: Find`, `f: Fetch`, `r: Refresh`, `g: Graph style: image`, 그리고 `j: ↓`, `k: ↑`, `o: Details`, `a: Actions`. 버튼은 그 키와 같은 일을 하므로 아래 기능은 모두 마우스로도 쓸 수 있습니다.

- 이름은 열려 있는 것에 따라 바뀝니다: Branches 목록이 열려 있으면 `o`가 `Pick`, 동작 메뉴가 열려 있으면 `o`가 `Run`, `a`가 `Close`가 됩니다.
- `x: Compare`는 커밋 상세가 열려 있을 때만, `n: Next` / `p: Prev`는 Find에 일치 항목이 있을 때만 나옵니다.
- 패널 너비가 100칸보다 좁으면 버튼이 여러 줄로 나뉘고, 스타일 버튼은 `image`나 `text`만 표시합니다.

### 그래프

- **행**: `git log --branches --remotes --tags HEAD --date-order`의 커밋마다 한 행이고, 위에 `Graph  Description  Date  Author  Commit` 헤더가 있습니다. 처음엔 50개를 불러오고, **Load more**(`m`)를 누를 때마다 50개씩 더 불러옵니다. 커밋이 없는 레포에서는 `No commits yet.`이 나옵니다.
- **두 가지 스타일**: `image`는 행마다 작은 PNG를 그립니다(직선, 부드러운 곡선, 채운 노드, 체크아웃된 커밋은 빈 고리). `text`는 박스 드로잉 문자를 씁니다. `g`로 전환하며 선택은 기억됩니다. 기본값은 kitty·Ghostty·WezTerm에서 `image`, 그 외에서는 `text`이고, tmux 안에서는 항상 `text`입니다.
- **Lane**은 Git Graph와 같은 색을 씁니다. 패널 너비의 40% 안에 들어가는 만큼(lane당 2칸, 최소 8개) 그리고, 넘치는 lane은 오른쪽 끝의 `…`로 접힙니다.
- **라벨**은 커밋의 lane 색으로 칠한 알약입니다. 원격에만 있는 브랜치(`origin/x`)는 더 어두운 색, 태그는 호박색, detached `HEAD`는 보라색이고, 체크아웃된 브랜치는 굵게 표시됩니다. 로컬 브랜치와 같은 이름의 원격 브랜치가 같은 커밋에 있으면 알약 하나로 합쳐집니다: `develop │ origin`.
- **merge 커밋**은 설명이 흐리게 표시됩니다.
- **열**은 그래프, 라벨과 메시지, 날짜(`10-18 16:25`, 로컬 시간), 작성자, 짧은 해시입니다. 패널이 좁아지면 해시, 작성자, 날짜 순으로 숨겨집니다.
- **Uncommitted Changes (n)**는 `HEAD` 위에 붙는 행이며, 작업 트리가 깨끗하면 보이지 않습니다. 누르거나 `c`를 누르면 파일과 상태(`M` `A` `D` `R` `??`)가 펼쳐집니다. 파일을 누르거나(상세·메뉴가 닫혀 있으면 앞 9개는 `1`-`9`) `HEAD` ↔ 작업 트리 diff가 열리고, `n` / `p`로 변경된 파일을 넘겨 봅니다. 추적하지 않는 파일은 빈 파일과 비교합니다.
- **원격 토글** `☑ remote`(`b`)는 기본으로 켜져 있습니다. 끄면 그래프와 Branches 목록에 로컬 브랜치만 나옵니다. Branches에서 원격 브랜치를 골라 둔 상태였다면 필터는 `Show All`로 돌아갑니다.
- **stash**와 다른 도구의 비공개 ref(`refs/cmux/*` 등)는 Git Graph처럼 그래프에서 제외됩니다.
- **갱신**: 패널을 열 때, `r`을 누를 때, 그리고 명령에 `git`이 들어 있는 Bash 도구 호출이 끝날 때마다 다시 읽습니다. polling은 없으므로 다른 터미널에서 바꾼 내용은 다음 갱신 때 반영됩니다.

### 커밋 상세와 diff

![행 아래에 펼쳐진 커밋 상세와 변경 파일 목록](docs/images/details.png)

`o`(또는 설명 클릭)로 커밋을 행 아래에 펼칩니다. 한 번에 커밋 하나만 열립니다.

- 전체 해시와 부모, 작성자(이메일 포함)와 날짜, committer가 다르면 committer도 표시합니다.
- 커밋 메시지 전체.
- 변경 파일: `3 files changed  +15 -4` 같은 요약 줄 아래에 `M src/app.ts +12 -3`처럼 표시하고, 바이너리는 `bin`, 이름 변경은 `R old → new`입니다. merge 커밋은 첫 번째 부모와, 루트 커밋은 빈 트리와 비교합니다. 200개를 넘으면 나머지는 한 줄로 요약합니다.

파일을 누르면(클릭, 또는 앞 9개는 숫자 `1`-`9`) diff가 열립니다. diff는 패널 전체를 차지하며, `h: ← Back`, 파일명, `(2/5)`, `p: Prev`, `n: Next`가 있는 바, 범위(`abc1234 (vs def5678)`), 파일 목록 줄, 색이 입혀진 unified diff 순서로 나옵니다. `n` / `p`로 파일을 넘기고, `h`를 누르면 커서, 열어 둔 상세, Find 상태가 그대로인 그래프로 돌아갑니다.

![추가·삭제 줄이 색으로 표시된 src/cart.ts의 diff 화면](docs/images/diff.png)

2500줄 또는 90000자를 넘는 diff는 줄 단위로 잘리고 생략된 줄 수가 표시됩니다. 바이너리 파일이나 내용 변경 없는 이름 변경은 한 줄 안내만 나옵니다. 갱신하면 열려 있는 diff도 그 자리에서 다시 읽고, 그 파일이 범위에서 사라졌다면 그래프로 돌아갑니다.

### 비교(Compare)

커밋 상세를 연 상태에서 커서를 다른 커밋(또는 Uncommitted Changes)으로 옮기고 `x`를 누르세요. 상세 영역이 `Comparing <older> ↔ <newer>`로 바뀌고 두 지점 사이에 달라진 파일이 나옵니다(`git diff -M older newer`). Uncommitted Changes와 비교할 때는 작업 트리가 새 쪽이고 추적하지 않는 파일은 추가된 파일로 나옵니다. 파일을 누르면 같은 두 지점 사이의 그 파일 diff가 열립니다. 다른 행에서 `x`를 누르면 비교 대상이 바뀌고, 열려 있는 커밋 자신에서 `x`를 누르면 상세로 돌아갑니다.

### Branches, Find, Fetch

- **Branches**(`l`, 버튼 이름은 `Branches: <현재>`)는 툴바 아래에 목록을 엽니다: `Show All` 또는 로컬·원격 브랜치 하나. `j` / `k`로 하이라이트를 옮기고, `o`로 고르고, `1`-`9`로 앞 9개를 바로 고르고, `l`로 닫습니다. 항목을 클릭해도 됩니다. 목록을 열면 열려 있던 상세, 비교, 동작 메뉴는 닫힙니다. 고르면 그 브랜치에서 도달할 수 있는 커밋만 그래프에 나옵니다. 브랜치가 사라지면(예: fetch로 prune) 필터는 `Show All`로 돌아갑니다. 고른 브랜치가 `HEAD`를 포함하지 않으면 Uncommitted Changes 행은 숨겨집니다.
- **Find**(`s`)는 입력 칸을 엽니다. 입력하는 동안 불러온 커밋의 메시지·작성자·해시에서 일치하는 부분이 강조되고, 이름이 일치하는 브랜치와 태그에는 밑줄이 그어집니다. `3/12 matches`처럼 현재 위치를 보여 줍니다. Enter를 누르면 강조를 유지한 채 첫 일치 항목으로 커서가 이동하고, `n` / `p`로 일치 항목을 순환합니다. 입력을 비우거나 `✕ Clear`를 누르면 해제됩니다. 이미 불러온 커밋만 검색합니다.
- **Fetch**(`f`)는 확인 없이 `git fetch --all --prune`을 실행합니다. 상태 줄에 `Fetching…`이 보이고, 끝나면 결과가 toast로 나오며 그래프가 갱신됩니다.

### 동작(Actions)

![커밋 행 아래에 열린 동작 메뉴](docs/images/actions.png)

`a`를 누르면 커서가 있는 행(커서가 없으면 맨 위 행) 아래에 동작 목록이 열립니다. 목록은 커밋 섹션과, 그 행에 붙은 라벨별 섹션으로 나뉩니다. 열려 있는 동안 `j` / `k`로 하이라이트를 옮기고, `o`로 실행하고, `1`-`9`로 앞 9개 항목을 바로 실행하고, `a`로 닫습니다. 항목을 클릭해도 됩니다. 다른 행을 클릭하면 목록은 닫힙니다.

| 대상 | 동작 |
| --- | --- |
| 커밋 | Add Tag…, Create Branch…, Create Branch and check out…, Checkout (detached HEAD), Cherry Pick, Revert, Merge into current branch, Rebase current branch onto this, Reset current branch to this (soft / mixed / hard), Copy hash, Copy subject |
| 로컬 브랜치 | Checkout, Rename…, Delete, Merge into current branch, Rebase current branch onto this, Push, Force push (with lease), Pull, Copy name |
| 원격 브랜치 (`origin/x`) | Checkout, Fetch into local branch, Merge into current branch, Pull into current branch, Delete remote branch, Copy name |
| 태그 | Push tag, Delete tag, Delete tag (also on origin), Copy name |
| Uncommitted Changes | Stash all changes…, Stash all changes, untracked included…, Discard all changes, Discard all changes and remove untracked files, Clean untracked files, 그리고 merge / rebase / cherry-pick / revert가 진행 중일 때 Abort |

해당하지 않는 항목은 목록에서 빠집니다.

- 체크아웃된 브랜치에는 Checkout, Delete, Merge, Rebase가 없고, Pull은 그 브랜치에만 있습니다.
- `HEAD` 커밋 행에는 Cherry Pick, Merge, Rebase, Reset, detached Checkout이 없습니다.
- 로컬 이름이 체크아웃된 브랜치와 같은 원격 브랜치에는 Checkout과 Fetch into local branch가 없습니다.

참고:

- merge 커밋의 Cherry Pick과 Revert는 `-m 1`을 씁니다.
- 원격 브랜치 Checkout은 그것을 추적하는 로컬 브랜치를 만들거나, 이미 있으면 그 브랜치로 전환합니다.
- Pull은 `git pull --no-rebase --no-edit`이고, Merge는 `--no-edit`를 씁니다.
- Push는 브랜치의 upstream으로 가고, upstream이 없으면 새 `origin/<이름>`을 만들어 추적하게 합니다.
- Copy는 터미널의 클립보드(클립보드 도구 또는 OSC 52)를 씁니다. 복사되지 않으면 toast에 값이 표시됩니다.
- 명령이 도는 동안 상태 줄에 `Running git …`이 나옵니다. 끝나면 toast로 결과(예: `Deleted feature/x`)를 알리고, 목록을 닫고, 그래프를 갱신합니다.

## 키

패널에 키보드 포커스가 있어야 합니다(`ctrl+x tab` 또는 클릭).

### 그래프

| 키 | 동작 |
| --- | --- |
| `j` / `k` | 커서를 한 행 아래 / 위로 이동. 처음 누르면 맨 위 행에 놓임 |
| `o` | 커서가 있는 커밋의 상세를 열고 닫음. Uncommitted 행에서는 파일을 펼침 |
| `a` | 커서 행의 동작 메뉴를 열고 닫음 |
| `x` | 상세가 열려 있을 때, 그 커밋과 커서가 있는 커밋을 비교 |
| `l` | Branches 목록을 열고 닫음 |
| `s` | Find |
| `n` / `p` | Find에 일치 항목이 있을 때 다음 / 이전 일치 항목 |
| `f` | Fetch |
| `r` | 새로 고침 |
| `b` | 원격 브랜치 표시 토글 |
| `g` | 그래프 스타일 전환 (`image` / `text`) |
| `c` | Uncommitted Changes 파일 펼치기 / 접기 |
| `m` | 커밋 더 불러오기 |
| `1`-`9` | 상세나 비교가 열려 있을 때 그 파일의 diff 열기 |

### 커밋 상세

| 키 | 동작 |
| --- | --- |
| `o` | 상세 닫기 |
| `x` | 커서가 있는 커밋과 비교. 열려 있는 커밋 자신에서는 상세로 돌아감 |
| `1`-`9` | 앞 9개 파일의 diff 열기 |

### Diff 화면

| 키 | 동작 |
| --- | --- |
| `h` | 그래프로 돌아가기 |
| `n` / `p` | 다음 / 이전 파일 (끝에서 멈춤) |
| `1`-`9` | 해당 번호의 파일로 이동 |

### 동작 메뉴

| 키 | 동작 |
| --- | --- |
| `j` / `k` | 하이라이트 이동 (섹션 제목은 건너뜀) |
| `o` | 하이라이트된 항목 실행 |
| `1`-`9` | 앞 9개 항목 바로 실행 |
| `a` | 메뉴 닫기 |

### 확인

| 키 | 동작 |
| --- | --- |
| `y` | 실행 |
| `q` | 취소하고 동작 목록으로 돌아감 |
| `a` | 메뉴 닫기 |

### 브랜치 목록

| 키 | 동작 |
| --- | --- |
| `j` / `k` | 하이라이트 이동 |
| `o` | 하이라이트된 항목 선택 |
| `1`-`9` | 앞 9개 항목 바로 선택 |
| `l` | 목록 닫기 |

### 입력 칸

이름과 메시지(Add Tag, Create Branch, Rename, Stash)는 메뉴 자리를 대신하는 입력 칸에 입력합니다. Rename은 현재 이름이 채워진 채로 열립니다. 입력 칸이 열리면 키보드를 가져가므로, `q`를 포함한 다른 단축키는 입력 칸을 벗어난 뒤에야 패널에 닿습니다.

| 키 | 동작 |
| --- | --- |
| `Enter` | 동작 실행. 브랜치·태그 이름이 올바르지 않으면 오류를 보여 주고 그대로 머뭄 |
| 빈 칸에서 `Enter` | 취소하고 메뉴로 돌아감 (stash 메시지는 선택 사항이라 빈 칸 Enter도 진행됨) |
| `q` 또는 `✕ Cancel` | 메뉴로 돌아감 (입력 칸을 벗어난 뒤) |

### 공통

| 키 | 동작 |
| --- | --- |
| `/graph` | 패널 열기 / 닫기 (프롬프트에서 입력) |
| `ctrl+x tab` | 패널 잡기 / 놓기 |
| 화살표 | 패널 스크롤 |
| `Esc` | 패널에서 프롬프트로 돌아감 |

## 설정

옵션은 `protectedBranches` 하나입니다. 쉼표로 구분한 브랜치 이름이며 기본값은 `main,develop`입니다. 이름이 정확히 일치해야 하고 `release/*` 같은 glob은 지원하지 않습니다. 빈 값이면 보호하는 브랜치가 없습니다.

설치할 때나 설치한 뒤에 설정할 수 있습니다.

```
claude plugin install git-graph-panel --marketplace tunggary/git-graph-panel --config protectedBranches=main,develop,release/1.0
claude plugin configure git-graph-panel
```

`/plugin` 메뉴에서도 바꿀 수 있습니다. 플러그인이 다시 로드될 때 반영됩니다.

보호된 브랜치에 대해서는 다음이 거부됩니다. toast에 `protected branch: use a pull request (main)`가 나오고 확인 질문도 하지 않습니다.

- 그 브랜치의 Push와 Force push. Push는 브랜치의 upstream으로 가므로, upstream이 보호된 로컬 브랜치도 거부됩니다.
- Delete remote branch.

로컬 작업(checkout, merge, reset, 로컬 브랜치 삭제)은 제한하지 않습니다.

## 안전 장치

- 로컬이고 되돌리기 쉬운 빠른 동작은 확인 없이 바로 실행됩니다: Add Tag, Create Branch, Create Branch and check out, Checkout(커밋·로컬 브랜치·원격 브랜치), Rename, Stash(둘 다). Copy도 바로 실행됩니다. 그 밖의 쓰기 동작은 동작 목록 자리에 전체 명령을 패널 안에 보여 주고 `y: Run` / `q: Cancel`을 둡니다.
- 되돌릴 수 없는 동작은 그 확인이 `⚠`와 잃게 되는 내용으로 시작하고, 버튼이 `Cancel`, `Run` 순서로 나옵니다. 해당 동작은 Reset (hard), Discard all changes, Discard and remove untracked files, Clean untracked files, Delete remote branch, Delete tag (also on origin), Force push, 그리고 merge되지 않은 브랜치 삭제(`-D`)입니다. merge된 브랜치는 `-d`로 삭제합니다.
- `Cancel`은 아무것도 실행하지 않고 동작 목록으로 돌아가므로, 다른 항목을 고를 수 있습니다.
- 브랜치·태그 이름은 동작을 실행하기 전에 `git check-ref-format`으로 검사합니다.
- 명령은 인자 배열로 실행하며 셸 문자열로 이어 붙이지 않으므로, 이름이나 메시지가 다른 의미로 해석되지 않습니다.
- 명령은 `GIT_TERMINAL_PROMPT=0`(git이 자격 증명을 묻지 않음)과 `GIT_EDITOR=true`로 실행합니다. 네트워크 명령은 120초, 나머지는 30초 뒤에 중단됩니다.
- merge, rebase, cherry-pick, revert, pull이 충돌로 멈추면 toast에 `conflict: resolve then continue`가 나옵니다.

## 문제 해결

**패널이 열리지 않아요.**
터미널이 좁으면 Claude Code는 mod가 스스로 연 패널을 열지 않고 대기합니다. `/graph`를 실행하거나 창을 넓히세요. git 레포가 아닌 곳이면 패널에 그렇다고 표시되니, 레포로 `cd`한 뒤 `/graph`를 다시 실행하세요.

**키가 먹히지 않아요.**
`ctrl+x tab`으로 패널에 포커스를 주세요. 글자가 프롬프트 입력창에 들어간다면 입력창을 비우고 `ctrl+x tab`을 다시 누르세요.

**그래프가 글자로 나와요.**
이미지는 kitty, Ghostty, WezTerm에서만 쓰이고 tmux 안에서는 쓰이지 않습니다. 지원하는 터미널이라면 `g`로 스타일을 바꿔 보세요.

**원이 타원으로 보여요.**
이미지는 한 칸이 너비의 두 배 높이(10 x 20 px)라고 가정하고 그립니다. 비율이 다른 터미널에서는 찌그러져 보입니다. `g`로 글자 그래프를 쓰세요.

**`git failed: …`가 나와요.**
git이 낸 오류를 그대로 보여 주는 것입니다. toast로 나오거나 그래프·상세·diff 자리에 나옵니다. 셸에서 원인을 해결한 뒤 `r`을 누르세요.

**입력 칸에서 나갈 수 없어요.**
빈 칸에서 `Enter`를 누르세요. 입력 칸이 키보드를 가져가는 동안에는 `q` 같은 단축키가 패널에 닿지 않습니다.

**설치할 때 "userConfig option not yet set"이 나와요.**
기본값(`main,develop`)이 이미 적용되어 있습니다. 바꾸고 싶다면 `claude plugin configure git-graph-panel`을 실행하세요.

**플러그인이 두 번 로드돼요.**
개발 폴더(`--plugin-dir` 또는 `CLAUDE_CODE_PLUGIN_DIRS`)와 마켓플레이스 설치가 동시에 켜져 있는 경우입니다. 하나만 쓰세요.

**merge나 rebase가 충돌로 멈췄어요.**
셸에서 파일을 고친 뒤 `git <operation> --continue`를 실행하세요(예: `git rebase --continue`). 패널에는 Continue가 없습니다. 중단하려면 Uncommitted Changes 행의 `Abort …`를 쓰세요.

## VS Code Git Graph와 다른 점

| Git Graph | git-graph-panel |
| --- | --- |
| 우클릭 컨텍스트 메뉴 | `a`로 동작 메뉴를 엽니다 |
| 커밋 두 개를 Ctrl+클릭해 비교 | 커밋 하나를 열고 다른 커밋으로 이동한 뒤 `x` |
| 여러 브랜치를 고를 수 있는 드롭다운 | `l`로 목록을 열고 한 번에 브랜치 하나만 선택 |
| diff가 에디터 탭에서 열림 | diff가 패널 전체를 대체하고 `h`로 돌아옴 |
| 그래프에 stash 목록 표시 | stash는 표시하지 않음 |
| 멈춘 merge·rebase 뒤 Continue | 없음. 셸에서 `git <operation> --continue` 실행. Abort는 메뉴에 있음 |
| 검색 | 불러온 커밋만 검색 (`m`으로 더 불러옴) |

## 업데이트와 삭제

```
claude plugin marketplace update git-graph-panel
claude plugin update git-graph-panel@git-graph-panel
claude plugin uninstall git-graph-panel@git-graph-panel
```

업데이트를 적용하려면 Claude Code를 다시 시작하세요. `/plugin` 메뉴에서도 같은 작업을 할 수 있습니다.

## 개발

```
scripts/make-fixture-repo.sh /tmp/graph-fixture            # 테스트 레포: Git Flow 모양, 열린 lane 10개 이상, 태그, octopus merge
(cd /tmp/graph-fixture && claude --plugin-dir "$OLDPWD")   # 저장하면 hot reload
```

`--plugin-dir` 대신 `CLAUDE_CODE_PLUGIN_DIRS`를 써도 됩니다. `scripts/make-demo-repo.sh`는 README 스크린샷용 데모 레포를 만듭니다.

### 구조

| 경로 | 역할 |
| --- | --- |
| `hooks/register.tsx` | 훅, `/graph` 명령, 패널 렌더링 |
| `hooks/actions.ts` | 버튼과 키가 하는 일 |
| `hooks/state.ts` | 훅들이 공유하는 id와 크기 |
| `hooks/lib/commands.ts` | 동작 메뉴 데이터, git argv, 위험 동작·보호 브랜치 규칙 |
| `hooks/lib/git.ts` | 레포 읽기 (`git log`, `status`, `diff`, `fetch`) |
| `hooks/lib/parse.ts` | git 출력 파싱 |
| `hooks/lib/lanes.ts` | 그래프의 lane 배치 |
| `hooks/lib/raster.ts`, `png.ts` | 이미지 그래프 |
| `hooks/lib/labels.ts` | 라벨 알약 |
| `hooks/lib/terminal.ts` | 이미지 지원 판별 |
| `hooks/lib/columns.ts` | 좁은 패널의 열 숨김과 lane 상한 |
| `hooks/lib/text.ts` | 셀 너비 계산과 자르기 |
| `hooks/lib/diff.ts` | 긴 diff 자르기 |
| `hooks/lib/search.ts` | Find |
| `scripts/dump-fixture-log.mjs` | fixture 레포에서 `tests/fixtures/fixture-log.ts`를 다시 생성 |

`claude plugin validate`는 state 참조를 그것을 쓰는 파일 안에서만 읽으므로, state atom은 `hooks/register.tsx`와 `hooks/actions.ts` 양쪽에 선언되어 있습니다.

### 검증

```
claude plugin validate .
npx -p typescript@5.6.3 tsc -p .     # .claude-plugin/types/가 필요합니다. Claude Code가 플러그인을 처음 로드할 때 만듭니다
claude plugin test .
```

### 알려진 터미널 제약

- hotkey는 소문자 한 글자 또는 숫자 하나여야 합니다. Find가 `/`가 아니라 `s`인 이유입니다.
- 사람이 패널을 잡고 있는 동안에는 플러그인이 다른 패널을 앞으로 띄울 수 없습니다. 그래서 diff 화면이 같은 패널 안에 있습니다.
- 훅의 시간 예산은 10초입니다. 그래서 오래 걸리는 작업(네트워크 git)은 시작한 핸들러에서 떼어 내(detach) 실행합니다.
- 패널 하나에 실을 수 있는 이미지는 2 MiB입니다. 위에서부터 1.5 MiB까지만 이미지로 그리고, 그 아래 행은 글자로 그립니다.

### 작업 방식

- 브랜치는 Git Flow를 따릅니다: `develop`에서 `feature/*`를 분기해 PR로 `develop`에 머지하고, `release/*`는 `main`과 `develop`에 머지합니다. `main`과 `develop`에는 직접 push하지 않습니다.
- 커밋 메시지는 `<type>: <제목>` 형식이며 type은 `feat`, `add`, `fix`, `build`, `style`, `refactor`, `docs`, `test`, `etc` 중 하나입니다. 커밋 하나에는 논리적 변경 하나만 담습니다.

## 라이선스

MIT
