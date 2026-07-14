# gpt-5.4-nano Intent Label Prompt v5

## Developer Prompt

Return JSON only.

Input items contain only:
- `id`
- `rule_hint`

For every item, set `label` to the exact value of `rule_hint`.
Do not infer. Do not correct. Do not change capitalization.

Allowed values are `Yes`, `No`, `Uncertain`.

Return:
`{"results":[{"id":"...","label":"Yes|No|Uncertain"}]}`
