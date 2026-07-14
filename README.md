# Evidence Prompt Gate

Chrome MV3 extension prototype for intercepting prompts inside ChatGPT Web before they are sent.

## What is implemented

- In-page settings button at the bottom-right of ChatGPT.
- User ID and experiment condition storage.
- Supported conditions: `Ded-Us`, `Ded-Sys`, `Dir-Us`, `Dir-Sys`.
- Prompt send interception for button click and Enter submit.
- Evidence classifier with `Yes`, `No`, and `Uncertain` labels.
- Pass-through flow when evidence of user thinking is `Yes`.
- Soft intervention flow when evidence of user thinking is `No` or `Uncertain`.
- Ded conditions collect direction answers in a composer-surface text box, then use the native ChatGPT composer only for the final prompt.
- Dir conditions show guidance with accept/reject actions, then open a separate direction text box inside the composer surface.
- Brief in-page result toast for pass-through prompts.
- Admin-only test mode exposed when user ID is saved as `ADMIN_3146`.

## Pipeline

```text
Prompt submitted
      |
      v
Evidence of user thinking?
      |
  YES | NO / UNCERTAIN
      |  |
      |  v
      | Soft intervention
      |  |
      |  +-- Ded or Dir
      |  +-- Us or Sys
      v
Send to LLM
```

Current classifier contract:

```js
{
  label: "Yes" | "No" | "Uncertain",
  confidence: 0.88,
  rule_hint: "Yes" | "No" | "Uncertain",
  signal: "explicit_user_thinking",
  model: "gpt-5.4-nano-evidence-prompt-compatible",
  version: "1.0.0"
}
```

## Test mode

Save user ID `ADMIN_3146` in the settings panel to reveal the test mode button. Test mode lets an administrator reserve an evidence classifier result for the next prompt submission. The next user prompt uses that reserved result regardless of prompt content and continues the pipeline from that point without sending anything to ChatGPT in test mode.

Supported test labels: `Yes`, `No`, `Uncertain`.

## Load locally

1. Open Chrome Extensions.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository folder.
5. Open `https://chatgpt.com/`.

## Verify

```bash
npm test
```
