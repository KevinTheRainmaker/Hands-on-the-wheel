# gpt-5.4-nano Intent Label Prompt v2

## Developer Prompt

Classify coding-help user turns. Output JSON only.

Task: decide if the user expressed their own thinking in the current turn or any previous 5 turns.

Labels:
- Yes = any explicit user thought/attempt/guess/judgment/approach/goal/criterion appears in current or previous 5 user turns.
- No = only asks for explanation/code/help, pastes code/log/problem text, or gives simple confirmation, and no previous-5 user turn has a Yes signal.
- Uncertain = no prior context and the current first turn is too short/meaningless/ambiguous, or it is just a pasted problem statement/spec.

Use this priority:
1. If ANY Yes signal appears in current or previous 5 user turns, label Yes.
2. Else if first-turn ambiguous/meaningless/problem-statement, label Uncertain.
3. Else label No.

Yes signals include even short or wrong expressions:
- Korean: 같아/같은데/듯/아마/왜/안돼/안됨/틀렸/오류/에러/막혀/모르겠/헷갈/되나/되려나/해야하나/좋을까/아닌가/맞나/잖아
- attempts: 해봤/해보나/했는데/했더니/했어/수정했/만들었/써봤/실행했/입력했
- approach/criteria: 일단/먼저/기준/목표/하려고/할거야/할꺼야/하고 싶/만들자/해보자/로 풀/로 만들/적용/사용/입력받/저장/출력/누르면/없으면/있으면/해야/되도록/경우
- English: I think/guess/tried/did/maybe/seems/should/need to/inefficient/Does this...
- Concrete behavior specs are Yes: "1을 누르면 저장", "없는 이름이면 기록 없음", "문자열로 비교".
- A bare follow-up such as "해줘", "코드 줘", "출력 알려줘" is Yes when any previous 5 user turn has a Yes signal.

No examples:
- "문제 구조화 해줘", "풀이 흐름 알려줘", "strip은 어떤 함수인가요?", "arr.sort desc 정렬하는법", "수정한 코드 부탁해" with no previous Yes signal.
- code only, error log only, expected/actual/failed/Traceback only.

Uncertain examples:
- first turn: "응", "vv", "gma", "아이디어 제시", "3줄 요약"
- first turn pasted full problem/spec with no user's own thinking.

Ignore assistant content except to understand whether a user reply is a bare follow-up. Never treat assistant text as user thinking.

For each item return exactly:
`{"id":"...","label":"Yes|No|Uncertain"}`
