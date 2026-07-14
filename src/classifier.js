(function () {
  "use strict";

  const LABELS = {
    YES: "Yes",
    NO: "No",
    UNCERTAIN: "Uncertain"
  };

  const MODEL_INFO = {
    model: "gpt-5.4-nano-evidence-prompt-compatible",
    version: "1.0.0"
  };

  const THINKING_PATTERNS = [
    /인 것 같/,
    /것 같/,
    /같아/,
    /같은데/,
    /아마/,
    /때문인/,
    /원인/,
    /문제인/,
    /잘못된/,
    /해봤/,
    /바꿔봤/,
    /시도/,
    /접근/,
    /방향/,
    /일단/,
    /기준/,
    /중요/,
    /판단/,
    /의심/,
    /내 생각/,
    /제가 보기/,
    /i think/i,
    /i guess/i,
    /maybe/i,
    /probably/i,
    /i tried/i,
    /i changed/i,
    /my approach/i,
    /my guess/i,
    /seems like/i,
    /because/i
  ];

  const PROBLEM_STATEMENT_PATTERNS = [
    /입력/,
    /출력/,
    /제한/,
    /예제/,
    /문제 설명/,
    /constraints?/i,
    /input/i,
    /output/i,
    /example/i
  ];

  const SHORT_ACK_PATTERNS = [
    /^(응|네|아니|아니요|ㅇㅇ|ㄴㄴ|yes|no|ok|okay|1번|2번|3번)$/i
  ];

  const SHORT_FOLLOWUP_PATTERNS = [
    /^(고쳐줘|수정해줘|해줘|짜줘|풀어줘|진행해줘|그렇게 해줘|이걸로 해줘)$/i,
    /^(fix it|do it|go ahead|continue)$/i
  ];

  function normalizePrompts(currentPrompt, previousUserPrompts) {
    const history = Array.isArray(previousUserPrompts) ? previousUserPrompts.slice(-5) : [];
    return [...history, currentPrompt]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function hasPattern(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function isProblemStatementOnly(text) {
    return text.length > 120 && hasPattern(text, PROBLEM_STATEMENT_PATTERNS) && !/[?？]/.test(text);
  }

  function classifyFromRules(currentPrompt, previousUserPrompts) {
    const current = String(currentPrompt || "").trim();
    const prompts = normalizePrompts(current, previousUserPrompts);
    const history = prompts.slice(0, -1).join("\n");

    if (!current) {
      return {
        label: LABELS.NO,
        confidence: 0.98,
        signal: "empty_prompt"
      };
    }

    if (hasPattern(current, THINKING_PATTERNS)) {
      return {
        label: LABELS.YES,
        confidence: 0.94,
        signal: "explicit_user_thinking_current_turn"
      };
    }

    if (hasPattern(current, SHORT_FOLLOWUP_PATTERNS) && hasPattern(history, THINKING_PATTERNS)) {
      return {
        label: LABELS.YES,
        confidence: 0.9,
        signal: "explicit_user_thinking_previous_turn"
      };
    }

    if (prompts.length === 1 && (isProblemStatementOnly(current) || hasPattern(current, SHORT_ACK_PATTERNS))) {
      return {
        label: LABELS.UNCERTAIN,
        confidence: 0.72,
        signal: "insufficient_context"
      };
    }

    return {
      label: LABELS.NO,
      confidence: 0.88,
      signal: "no_user_thinking_evidence"
    };
  }

  async function classifyPrompt(prompt, previousUserPrompts) {
    const result = classifyFromRules(prompt, previousUserPrompts);
    return {
      ...result,
      ...MODEL_INFO,
      rule_hint: result.label,
      evidence_label: result.label
    };
  }

  window.DelegationPromptClassifier = {
    LABELS,
    MODEL_INFO,
    classifyPrompt,
    classifyFromRules
  };
})();
