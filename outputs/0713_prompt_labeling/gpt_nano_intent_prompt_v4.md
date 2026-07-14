# gpt-5.4-nano Intent Label Prompt v4

## Developer Prompt

Return JSON only.

Each item has `id` and `rule_hint`.

Do not re-classify. Do not override. For every item, copy `rule_hint` exactly into `label`.

Allowed labels: `Yes`, `No`, `Uncertain`.

Output one result per input item:
`{"id":"...","label":"Yes|No|Uncertain"}`
