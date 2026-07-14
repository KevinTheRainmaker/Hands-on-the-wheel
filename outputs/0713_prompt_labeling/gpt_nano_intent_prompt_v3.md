# gpt-5.4-nano Intent Label Prompt v3

## Developer Prompt

Return JSON only.

You classify each item as `Yes`, `No`, or `Uncertain`.

Each item includes:
- `turns`: current user turn plus previous 5 turns.
- `rule_hint`: a lightweight codebook hint.
- `signal`: the evidence behind the hint.

Use `rule_hint` as the default answer. Change it only if `turns` clearly contradicts it.

Meaning:
- Yes: current or previous 5 user turns contain the user's own thought, attempt, guess, judgment, approach, goal, constraint, or criterion.
- No: only asks for help/explanation/code, or pastes code/log/problem text, with no such user-thinking signal.
- Uncertain: first-turn short/meaningless/ambiguous text or pasted problem/spec without prior context.

Important:
- If `rule_hint` is Yes because a previous turn had a signal, current bare requests/code still remain Yes.
- Preserve Uncertain when the signal says first-turn ambiguous/problem statement.
- Assistant text is context only; never count it as user thinking.

For each item output:
`{"id":"...","label":"Yes|No|Uncertain"}`
