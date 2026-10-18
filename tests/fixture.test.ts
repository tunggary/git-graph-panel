import { describe, expect, test } from 'claude-code/testing'

import { cellsToText, layoutGraph, MAX_LANES } from '../hooks/lib/lanes'
import { parseLog, parseStatus } from '../hooks/lib/parse'
import { FIXTURE_HEAD, FIXTURE_LOG, FIXTURE_STASH, FIXTURE_STATUS } from './fixtures/fixture-log'

// git's output for the repository scripts/make-fixture-repo.sh builds (git log --all --date-order).
const commits = parseLog(FIXTURE_LOG)
const changes = parseStatus(FIXTURE_STATUS)
const graph = layoutGraph([{ hash: 'uncommitted', parents: [FIXTURE_HEAD], isUncommitted: true }, ...commits])

describe('fixture repository', () => {
  test('the repository has a stash, and the graph leaves it out', () => {
    expect(FIXTURE_STASH).toMatch(/^[0-9a-f]{40}$/)
    expect(commits.map(commit => commit.hash)).not.toContain(FIXTURE_STASH)
    expect(commits.some(commit => /^(On |index on |WIP on )/.test(commit.subject))).toBe(false)
    expect(commits.some(commit => commit.subject.includes('보관한 작업'))).toBe(false)
    expect(changes).toHaveLength(3) // the uncommitted changes were made after the stash
  })

  test('parses every commit, with Korean, pipes and quotes intact', () => {
    expect(commits).toHaveLength(75)
    const subjects = commits.map(commit => commit.subject)
    expect(subjects).toContain('fix: 파이프(|) 문자 파싱 오류 수정')
    expect(subjects).toContain('feat(payment): 결제 | 취소 | 환불 플로우')
    expect(subjects).toContain('fix(search): \'quote\' and "double" 처리')
    expect(commits.every(commit => /^[0-9a-f]{40}$/.test(commit.hash))).toBe(true)
  })

  test('reads branches, remote-only branches and tags off the decorations', () => {
    const labels = commits.flatMap(commit => commit.refs.map(ref => `${ref.kind}:${ref.name}`))
    expect(labels).toContain('branch:develop')
    expect(labels).toContain('remote:origin/develop')
    expect(labels).toContain('remote:origin/feature/remote-only')
    expect(labels).not.toContain('branch:feature/remote-only')
    expect(labels).toContain('tag:v1.0.0')
    expect(commits[0]?.refs).toEqual([{ kind: 'branch', name: 'develop', isCurrent: true }])
    expect(commits.filter(commit => commit.refs.some(ref => ref.isCurrent))).toHaveLength(1)
  })

  test('reads the three uncommitted changes', () => {
    expect(changes).toEqual([
      { code: 'M', path: 'develop.txt' },
      { code: 'A', path: 'staged-new.txt' },
      { code: '??', path: 'untracked-note.txt' },
    ])
  })

  test('lays the history out in 8 lanes', () => {
    expect(graph.laneCount).toBe(MAX_LANES)
    expect(graph.rows).toHaveLength(commits.length + 1)
    expect(graph.rows.every(row => row.cells.length === graph.width)).toBe(true)
  })

  test('every row has exactly one node', () => {
    for (const row of graph.rows) {
      const nodes = row.cells.filter(cell => cell.ch === '●' || cell.ch === '○')
      expect(nodes).toHaveLength(1)
    }
  })

  test('the graph matches the reviewed snapshot', () => {
    const lines = graph.rows.map((row, i) => `${cellsToText(row.cells)} ${i === 0 ? `Uncommitted Changes (${changes.length})` : commits[i - 1]?.subject}`)
    expect(lines).toEqual([
    "○                Uncommitted Changes (3)",
    "●                add: 큰 diff를 만드는 생성 파일 4000줄",
    "●                add: 바이너리 로고 추가",
    "●                refactor: release.txt를 release-notes.txt로 이름 변경",
    "●                feat: 상세 보기용 여러 줄 본문",
    "●                docs: 변경 내역 정리",
    "●                feat: 로컬에만 있는 커밋",
    "│ ●              feat(remote): origin 에만 있는 브랜치",
    "●─┴─╮            merge: main 병합",
    "│ ╭─●            merge: hotfix/1.0.1 병합",
    "│ ● │            fix: 긴급 수정 \"크래시\" 해결",
    "●─┤ │            merge: main 병합",
    "│ ●─┴─╮          merge: release/1.0.0 병합",
    "● │   │          feat: release 중 develop 작업",
    "│ │   ●          fix(release): 버전 문자열 수정",
    "│ │   ●          release: 1.0.0 준비",
    "●─│─┬─┴─┬─╮      merge: feature/oct-1 feature/oct-2 feature/oct-3 병합",
    "│ │ │   │ ●      feat(oct-3): 옥토퍼스 대상 3",
    "│ │ │   ● │      feat(oct-2): 옥토퍼스 대상 2",
    "│ │ ●   │ │      feat(oct-1): 옥토퍼스 대상 1",
    "●─│─┴───┴─╯      chore: onboarding 병합 후 정리",
    "●─│─╮            merge: feature/onboarding 병합",
    "● │ │            chore: i18n 병합 후 정리",
    "●─│─│─╮          merge: feature/i18n 병합",
    "● │ │ │          chore: export 병합 후 정리",
    "●─│─│─│─╮        merge: feature/export 병합",
    "● │ │ │ │        chore: settings 병합 후 정리",
    "●─│─│─│─│─╮      merge: feature/settings 병합",
    "● │ │ │ │ │      chore: dashboard 병합 후 정리",
    "●─│─│─│─│─│─╮    merge: feature/dashboard 병합",
    "● │ │ │ │ │ │    chore: notification 병합 후 정리",
    "●─│─│─│─│─│─│─╮  merge: feature/notification 병합",
    "● │ │ │ │ │ │ │  chore: payment 병합 후 정리",
    "●─│─│─│─│─│─│─│… merge: feature/payment 병합",
    "● │ │ │ │ │ │ │… chore: search 병합 후 정리",
    "●─│─│─│─│─│─│─│… merge: feature/search 병합",
    "● │ │ │ │ │ │ │… chore: profile 병합 후 정리",
    "●─│─│─│─│─│─│─│… merge: feature/profile 병합",
    "● │ │ │ │ │ │ │… chore: login 병합 후 정리",
    "●─│─│─│─│─│─│─│… merge: feature/login 병합",
    "│ │ │ │ │ │ │ │● feat(long): 장기 작업 계속",
    "│ │ │ │ │ │ │ │● feat(long): 장기 작업 시작",
    "●─│─│─│─│─│─│─│… fix: 파이프(|) 문자 파싱 오류 수정",
    "│ │ ● │ │ │ │ │… feat(onboarding): 작업 3",
    "│ │ │ ● │ │ │ │… feat(i18n): 작업 3",
    "│ │ │ │ ● │ │ │… feat(export): 작업 3",
    "│ │ │ │ │ ● │ │… feat(settings): 작업 3",
    "│ │ │ │ │ │ ● │… feat(dashboard): 작업 3",
    "│ │ │ │ │ │ │ ●… feat(notification): 작업 3",
    "│ │ │ │ │ │ │ │● feat(payment): 결제 | 취소 | 환불 플로우",
    "│ │ │ │ │ │ │ │● feat(search): 작업 3",
    "│ │ │ │ │ │ │ │● feat(profile): 작업 3",
    "│ │ │ │ │ │ │ │● feat(login): 작업 3",
    "│ │ ● │ │ │ │ │… feat(onboarding): 작업 2",
    "│ │ │ ● │ │ │ │… feat(i18n): 작업 2",
    "│ │ │ │ ● │ │ │… feat(export): 작업 2",
    "│ │ │ │ │ ● │ │… feat(settings): 작업 2",
    "│ │ │ │ │ │ ● │… feat(dashboard): 작업 2",
    "│ │ │ │ │ │ │ ●… feat(notification): 작업 2",
    "│ │ │ │ │ │ │ │● feat(payment): 작업 2",
    "│ │ │ │ │ │ │ │● fix(search): 'quote' and \"double\" 처리",
    "│ │ │ │ │ │ │ │● feat(profile): 작업 2",
    "│ │ │ │ │ │ │ │● feat(login): \"로그인\" 폼 추가",
    "│ │ ● │ │ │ │ │… feat(onboarding): 초기 구조 | scaffold",
    "│ │ │ ● │ │ │ │… feat(i18n): 초기 구조 | scaffold",
    "│ │ │ │ ● │ │ │… feat(export): 초기 구조 | scaffold",
    "│ │ │ │ │ ● │ │… feat(settings): 초기 구조 | scaffold",
    "│ │ │ │ │ │ ● │… feat(dashboard): 초기 구조 | scaffold",
    "│ │ │ │ │ │ │ ●… feat(notification): 초기 구조 | scaffold",
    "│ │ │ │ │ │ │ │● feat(payment): 초기 구조 | scaffold",
    "│ │ │ │ │ │ │ │● feat(search): 초기 구조 | scaffold",
    "│ │ │ │ │ │ │ │● feat(profile): 초기 구조 | scaffold",
    "│ │ │ │ │ │ │ │● feat(login): 초기 구조 | scaffold",
    "●─│─┴─┴─┴─┴─┴─┴… chore: develop 브랜치 시작",
    "●─╯              docs: README 추가",
    "●                chore: 초기 커밋",
    ])
  })
})

describe('fixture graph with room for every lane', () => {
  test('a wide pane draws all lanes, no `…`', () => {
    const wide = layoutGraph([{ hash: 'uncommitted', parents: [FIXTURE_HEAD], isUncommitted: true }, ...commits], 100)
    expect(wide.laneCount).toBe(13)
    expect(wide.rows.some(row => row.hasOverflow)).toBe(false)
  })
})
