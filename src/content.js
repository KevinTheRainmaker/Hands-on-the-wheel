(function () {
  "use strict";

  const ROOT_ID = "delegation-prompt-gate-root";
  const SETTINGS_KEY = "delegationPromptGateSettings";
  const HISTORY_KEY = "delegationPromptGatePromptHistory";
  const HISTORY_LIMIT = 6;
  const ADMIN_PARTICIPANT_ID = "ADMIN_3146";
  const CONDITIONS = ["Ded-Us", "Ded-Sys", "Dir-Us", "Dir-Sys"];
  const TEST_PROMPTS = {
    noEvidence: "이 코드 뭐가 문제인지 알아서 고쳐줘",
    yesEvidence: "validateInput 함수에서 빈 문자열일 때 에러가 나는 것 같아. 기존 반환 타입은 유지해서 고쳐줘.",
    uncertainEvidence: "응"
  };
  const TEST_EVIDENCE_RESULTS = [
    {
      id: "yes",
      label: "Yes",
      prompt: TEST_PROMPTS.yesEvidence,
      classification: {
        label: "Yes",
        confidence: 0.94,
        model: "test-mode",
        version: "1.0.0",
        rule_hint: "Yes",
        signal: "explicit_user_thinking"
      },
      next: "pass_through"
    },
    {
      id: "no",
      label: "No",
      prompt: TEST_PROMPTS.noEvidence,
      classification: {
        label: "No",
        confidence: 0.88,
        model: "test-mode",
        version: "1.0.0",
        rule_hint: "No",
        signal: "no_user_thinking_evidence"
      },
      next: "intervention"
    },
    {
      id: "uncertain",
      label: "Uncertain",
      prompt: TEST_PROMPTS.uncertainEvidence,
      classification: {
        label: "Uncertain",
        confidence: 0.72,
        model: "test-mode",
        version: "1.0.0",
        rule_hint: "Uncertain",
        signal: "insufficient_context"
      },
      next: "intervention"
    }
  ];
  const DEFAULT_SETTINGS = {
    participantId: "",
    condition: "Ded-Us",
    model: "gpt-5.5",
    enabled: true
  };
  let settings = { ...DEFAULT_SETTINGS };
  let promptHistory = [];
  let bypassNextSubmit = false;
  let latestIntercept = null;
  let latestClassification = null;
  let latestAnalysis = null;
  let testModePanel = null;
  let pendingTestOverride = null;
  let activeDedFlow = null;
  let activeFinalComposerFlow = null;

  function isValidCondition(condition) {
    return CONDITIONS.includes(condition);
  }

  function isAdminMode() {
    return settings.participantId === ADMIN_PARTICIPANT_ID;
  }

  function normalizeSettings(value) {
    const candidate = value && typeof value === "object" ? value : {};
    return {
      participantId:
        typeof candidate.participantId === "string"
          ? candidate.participantId.trim()
          : "",
      condition: isValidCondition(candidate.condition)
        ? candidate.condition
        : DEFAULT_SETTINGS.condition,
      model:
        typeof candidate.model === "string" && candidate.model.trim()
          ? candidate.model.trim()
          : DEFAULT_SETTINGS.model,
      enabled:
        typeof candidate.enabled === "boolean"
          ? candidate.enabled
          : DEFAULT_SETTINGS.enabled
    };
  }

  function normalizePromptHistory(value) {
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string" && item.trim()).slice(-HISTORY_LIMIT)
      : [];
  }

  function getSyncStorageArea() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
      return chrome.storage.sync;
    }
    return null;
  }

  function getLocalStorageArea() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  async function loadSettings() {
    const syncStorage = getSyncStorageArea();
    if (!syncStorage) {
      settings = { ...DEFAULT_SETTINGS };
    } else {
      const result = await syncStorage.get(SETTINGS_KEY);
      settings = normalizeSettings(result[SETTINGS_KEY]);
    }

    const localStorage = getLocalStorageArea();
    if (!localStorage) {
      promptHistory = [];
    } else {
      const result = await localStorage.get(HISTORY_KEY);
      promptHistory = normalizePromptHistory(result[HISTORY_KEY]);
    }

    return settings;
  }

  async function saveSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    const syncStorage = getSyncStorageArea();
    if (syncStorage) {
      await syncStorage.set({ [SETTINGS_KEY]: settings });
    }
    return settings;
  }

  async function rememberPrompt(prompt) {
    const normalizedPrompt = String(prompt || "").trim();
    if (!normalizedPrompt) return;

    promptHistory = normalizePromptHistory([...promptHistory, normalizedPrompt]);
    const localStorage = getLocalStorageArea();
    if (localStorage) {
      await localStorage.set({ [HISTORY_KEY]: promptHistory });
    }
  }

  function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  }

  function getPromptInput() {
    const active = document.activeElement;
    if (isPromptInput(active)) return active;

    const candidates = [
      ...document.querySelectorAll(
        "textarea, [contenteditable='true'], div.ProseMirror"
      )
    ];

    return candidates.reverse().find(isPromptInput) || null;
  }

  function isPromptInput(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest(".dpg-root, .dpg-review, .dpg-intervention, .dpg-composer-surface, .dpg-test-panel")) return false;
    if (element.matches("textarea")) return true;
    if (element.isContentEditable) return true;
    return element.matches("div.ProseMirror");
  }

  function getPromptText(input) {
    if (!input) return "";
    if (input instanceof HTMLTextAreaElement) return input.value.trim();
    return input.innerText.trim();
  }

  function setPromptText(input, text) {
    if (!input) return;
    input.focus();

    if (input instanceof HTMLTextAreaElement) {
      input.value = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }

    const selection = window.getSelection();
    input.textContent = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));

    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function getComposerMount(input) {
    if (!input) return null;
    return input.closest("form") || input.parentElement;
  }

  function removeComposerNotice() {
    const existing = document.querySelector(".dpg-composer-surface");
    if (existing) existing.remove();
  }

  function renderComposerNotice(message, detail) {
    renderComposerSurface({
      title: message,
      detail
    });
  }

  function renderComposerSurface(options) {
    removeComposerNotice();
    const input = getPromptInput();
    const mount = getComposerMount(input);
    if (!mount || !mount.parentElement) {
      showClassificationToast({ label: "안내", confidence: 1 }, options.title || "안내");
      return;
    }

    const surface = createElement("section", `dpg-composer-surface ${options.variant || ""}`.trim());
    if (options.originalPrompt) {
      surface.append(createElement("p", "dpg-composer-original", options.originalPrompt));
    }

    const titleRow = createElement("div", "dpg-composer-title-row");
    if (options.loading) {
      titleRow.append(createElement("span", "dpg-spinner"));
    }
    titleRow.append(createElement("p", "dpg-composer-title", options.title || ""));
    surface.append(titleRow);

    if (options.body) {
      surface.append(createElement("p", "dpg-composer-body", options.body));
    }
    if (options.detail) {
      surface.append(createElement("p", "dpg-composer-detail", options.detail));
    }
    let textInput = null;
    if (options.textInput) {
      const label = createElement("label", "dpg-composer-input-label");
      label.append(createElement("span", null, options.textInput.label || "입력"));
      textInput = createElement("textarea", "dpg-composer-textarea");
      textInput.placeholder = options.textInput.placeholder || "";
      textInput.value = options.textInput.value || "";
      label.append(textInput);
      surface.append(label);
    }
    if (Array.isArray(options.actions) && options.actions.length > 0) {
      const actions = createElement("div", "dpg-composer-actions");
      options.actions.forEach((action) => {
        const button = createElement(
          "button",
          action.primary ? "dpg-primary-button" : "dpg-secondary-button",
          action.label
        );
        button.type = "button";
        button.addEventListener("click", () => {
          action.onClick(textInput ? textInput.value : undefined);
        });
        actions.append(button);
      });
      surface.append(actions);
    }
    mount.parentElement.insertBefore(surface, mount);
  }

  function isDedCondition(condition) {
    return condition === "Ded-Us" || condition === "Ded-Sys";
  }

  function getAnalysisLabel(analysis) {
    return analysis && (analysis.final_label || analysis.decision || "no_delegation");
  }

  function getAnalysisReasoning(analysis) {
    return analysis && (analysis.reasoning || analysis.rationale || "");
  }

  function getAnalysisConfidenceText(analysis) {
    if (!analysis) return "";
    if (typeof analysis.confidence === "number") return analysis.confidence.toFixed(2);
    return String(analysis.confidence || "");
  }

  function inferRequestType(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/error|bug|fix|debug|exception|traceback|에러|버그|고쳐|수정/.test(text)) {
      return "debugging";
    }
    if (/evaluate|judge|compare|decide|판단|평가|비교|맞는지/.test(text)) {
      return "evaluating";
    }
    if (/implement|write|create|build|refactor|구현|작성|만들|리팩터/.test(text)) {
      return "delegation";
    }
    return "delegation";
  }

  function getSendButton() {
    const selectors = [
      "button[data-testid='send-button']",
      "button[data-testid='fruitjuice-send-button']",
      "form button[type='submit']",
      "button[aria-label*='Send']",
      "button[aria-label*='보내기']"
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLButtonElement) return button;
    }

    return null;
  }

  function triggerNativeSend() {
    const button = getSendButton();
    if (button && !button.disabled) {
      bypassNextSubmit = true;
      button.click();
      return true;
    }

    const input = getPromptInput();
    if (!input) return false;

    bypassNextSubmit = true;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      })
    );
    return true;
  }

  async function classifyPrompt(prompt) {
    if (pendingTestOverride && pendingTestOverride.classification) {
      return {
        ...pendingTestOverride.classification,
        testOverride: true
      };
    }

    const classifier = window.DelegationPromptClassifier;
    if (!classifier || typeof classifier.classifyPrompt !== "function") {
      return {
        label: "Uncertain",
        confidence: 0.5,
        model: "missing-classifier-fallback",
        version: "0.0.0"
      };
    }

    return classifier.classifyPrompt(prompt, promptHistory);
  }

  function buildEvidenceAnalysis(prompt, classification) {
    const hasEvidence = classification.label === "Yes";
    return {
      final_label: hasEvidence ? "thinking_evidence_present" : "thinking_evidence_absent",
      evidence_label: classification.label,
      intent_expressed: hasEvidence,
      intent_evidence: hasEvidence ? classification.signal || null : null,
      intent_turn: hasEvidence ? 0 : null,
      confidence: classification.confidence,
      reasoning: classification.signal || "",
      request_type: inferRequestType(prompt),
      evidence: classification.signal ? [classification.signal] : []
    };
  }

  function buildIntercept(prompt, classification, analysis) {
    return {
      prompt,
      classification,
      analysis,
      previousUserPrompts: [...promptHistory],
      participantId: settings.participantId,
      condition: settings.condition,
      capturedAt: new Date().toISOString(),
      source: "chatgpt-web"
    };
  }

  function shouldInterceptPrompt(prompt) {
    return settings.enabled && prompt.length > 0;
  }

  function startDedComposerFlow(intercept) {
    const intervention = getInterventionApi();
    const requestType = inferRequestType(intercept.prompt);
    const guidance = intervention.getDedQuestion(requestType);
    activeDedFlow = {
      phase: "answer",
      mode: intercept.condition.endsWith("Sys") ? "Sys" : "Us",
      intercept,
      guidance,
      userAnswer: ""
    };

    const input = getPromptInput();
    setPromptText(input, "");
    renderComposerSurface({
      variant: "dpg-ded",
      originalPrompt: intercept.prompt,
      title: guidance,
      detail: "아래 입력칸에 답변을 작성해주세요. 아직 GPT에는 전달되지 않습니다.",
      textInput: {
        label: "방향 답변",
        placeholder: "예: 에러가 발생한 위치, 의심되는 이유, 기대하는 결과를 적어주세요."
      },
      actions: [
        {
          label: "취소",
          onClick: () => {
            activeDedFlow = null;
            removeComposerNotice();
            setPromptText(input, intercept.prompt);
          }
        },
        {
          label: "계속",
          primary: true,
          onClick: (value) => {
            continueDedComposerFlow(value || "");
          }
        }
      ]
    });
  }

  function continueDedComposerFlow(answer) {
    const input = getPromptInput();
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      renderComposerSurface({
        variant: "dpg-ded",
        originalPrompt: activeDedFlow.intercept.prompt,
        title: activeDedFlow.guidance,
        detail: "내용을 입력한 뒤 계속해주세요.",
        textInput: {
          label: "방향 답변",
          placeholder: "질문에 대한 답변을 적어주세요.",
          value: answer
        },
        actions: [
          {
            label: "계속",
            primary: true,
            onClick: (value) => {
              continueDedComposerFlow(value || "");
            }
          }
        ]
      });
      return;
    }

    const intervention = getInterventionApi();
    activeDedFlow.userAnswer = trimmedAnswer;
    const wasTestMode = Boolean(activeDedFlow.intercept.testMode);

    if (activeDedFlow.mode === "Sys") {
      const rewrittenPrompt = intervention.rewritePrompt({
        originalPrompt: activeDedFlow.intercept.prompt,
        guidance: activeDedFlow.guidance,
        userAnswer: activeDedFlow.userAnswer
      });
      setPromptText(input, rewrittenPrompt);
      activeFinalComposerFlow = { testMode: wasTestMode };
      renderComposerSurface({
        variant: "dpg-ded",
        originalPrompt: activeDedFlow.intercept.prompt,
        title: "시스템이 재작성한 초안입니다.",
        body: activeDedFlow.guidance,
        detail: "GPT 입력창에서 수정한 뒤 전송하면 최종 프롬프트만 GPT로 전달됩니다."
      });
      activeDedFlow = null;
      return;
    }

    setPromptText(input, activeDedFlow.intercept.prompt);
    activeFinalComposerFlow = { testMode: wasTestMode };
    renderComposerSurface({
      variant: "dpg-ded",
      originalPrompt: activeDedFlow.intercept.prompt,
      title: "이제 직접 프롬프트를 재작성해주세요.",
      body: activeDedFlow.guidance,
      detail: `방금 답변: ${activeDedFlow.userAnswer}`
    });
    activeDedFlow = null;
  }

  function startDirComposerFlow(intercept) {
    const intervention = getInterventionApi();
    const guidance = intervention.buildDirectionGuidance({
      originalPrompt: intercept.prompt,
      analysis: intercept.analysis,
      previousUserPrompts: intercept.previousUserPrompts
    });
    const input = getPromptInput();

    renderComposerSurface({
      variant: "dpg-dir",
      originalPrompt: intercept.prompt,
      title: "다음 방향을 반영해 프롬프트를 다듬어보세요.",
      body: guidance,
      detail: "수락하면 GPT 입력창에서 최종 프롬프트를 이어서 작성할 수 있습니다.",
      actions: [
        {
          label: "거절",
          onClick: () => {
            removeComposerNotice();
            setPromptText(input, intercept.prompt);
          }
        },
        {
          label: "수락",
          primary: true,
          onClick: () => {
            acceptDirGuidance(intercept, guidance);
          }
        }
      ]
    });
  }

  function acceptDirGuidance(intercept, guidance) {
    renderComposerSurface({
      variant: "dpg-dir",
      originalPrompt: intercept.prompt,
      title: "방향을 수락했습니다.",
      body: guidance,
      detail: "아래 입력칸에 이 방향을 프롬프트에 어떻게 반영할지 적어주세요.",
      textInput: {
        label: "반영할 내용",
        placeholder: "예: 어떤 함수/조건/판단 기준을 포함할지 적어주세요."
      },
      actions: [
        {
          label: "취소",
          onClick: () => {
            removeComposerNotice();
            setPromptText(getPromptInput(), intercept.prompt);
          }
        },
        {
          label: "계속",
          primary: true,
          onClick: (value) => {
            continueDirComposerFlow(intercept, guidance, value || "");
          }
        }
      ]
    });
  }

  function continueDirComposerFlow(intercept, guidance, directionInput) {
    const intervention = getInterventionApi();
    const input = getPromptInput();
    const isSys = intercept.condition.endsWith("Sys");
    const trimmedDirection = directionInput.trim();

    if (!trimmedDirection) {
      renderComposerSurface({
        variant: "dpg-dir",
        originalPrompt: intercept.prompt,
        title: "방향을 수락했습니다.",
        body: guidance,
        detail: "반영할 내용을 입력한 뒤 계속해주세요.",
        textInput: {
          label: "반영할 내용",
          placeholder: "프롬프트에 반영할 내용을 적어주세요.",
          value: directionInput
        },
        actions: [
          {
            label: "계속",
            primary: true,
            onClick: (value) => {
              continueDirComposerFlow(intercept, guidance, value || "");
            }
          }
        ]
      });
      return;
    }

    if (isSys) {
      const rewrittenPrompt = intervention.rewritePrompt({
        originalPrompt: intercept.prompt,
        guidance,
        userAnswer: trimmedDirection
      });
      setPromptText(input, rewrittenPrompt);
      activeFinalComposerFlow = {
        testMode: Boolean(intercept.testMode)
      };
      renderComposerSurface({
        variant: "dpg-dir",
        originalPrompt: intercept.prompt,
        title: "방향 안내를 반영한 초안입니다.",
        body: guidance,
        detail: "GPT 입력창에서 수정한 뒤 전송하면 최종 프롬프트만 GPT로 전달됩니다."
      });
      return;
    }

    setPromptText(input, intercept.prompt);
    activeFinalComposerFlow = {
      testMode: Boolean(intercept.testMode)
    };
    renderComposerSurface({
      variant: "dpg-dir",
      originalPrompt: intercept.prompt,
      title: "방향 안내를 반영해 직접 재작성해주세요.",
      body: guidance,
      detail: `반영할 내용: ${trimmedDirection}`
    });
  }

  async function handleFinalComposerSubmit(prompt) {
    if (!activeFinalComposerFlow) return false;

    const finalPrompt = prompt.trim();
    if (!finalPrompt) {
      renderComposerNotice("최종 프롬프트를 입력한 뒤 전송해주세요.");
      return true;
    }

    const wasTestMode = activeFinalComposerFlow.testMode;
    activeFinalComposerFlow = null;
    removeComposerNotice();

    if (wasTestMode) {
      showClassificationToast({ label: "테스트 완료", confidence: 1 }, "테스트 모드라 GPT로 전송하지 않았습니다.");
      return true;
    }

    await rememberPrompt(finalPrompt);
    window.setTimeout(triggerNativeSend, 0);
    return true;
  }

  async function interceptSubmission(event) {
    if (bypassNextSubmit) {
      bypassNextSubmit = false;
      return;
    }

    const input = getPromptInput();
    const prompt = getPromptText(input);
    if (activeDedFlow) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      renderComposerSurface({
        variant: "dpg-ded",
        originalPrompt: activeDedFlow.intercept.prompt,
        title: activeDedFlow.guidance,
        detail: "위 안내 영역 안의 입력칸과 계속 버튼을 사용해주세요.",
        textInput: {
          label: "방향 답변",
          placeholder: "질문에 대한 답변을 적어주세요.",
          value: ""
        },
        actions: [
          {
            label: "계속",
            primary: true,
            onClick: (value) => {
              continueDedComposerFlow(value || "");
            }
          }
        ]
      });
      return;
    }

    if (activeFinalComposerFlow) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await handleFinalComposerSubmit(prompt);
      return;
    }

    if (!shouldInterceptPrompt(prompt)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const usingTestOverride = Boolean(pendingTestOverride);
    const classification = await classifyPrompt(prompt);
    latestClassification = classification;
    pendingTestOverride = null;

    const analysis = buildEvidenceAnalysis(prompt, classification);
    latestAnalysis = analysis;
    latestIntercept = buildIntercept(prompt, classification, analysis);
    if (usingTestOverride) latestIntercept.testMode = true;

    if (classification.label === "Yes") {
      removeComposerNotice();
      showClassificationToast(classification, "Evidence of user thinking: Yes. 메시지가 전달됩니다.");
      if (usingTestOverride) {
        showClassificationToast(classification, `${classification.label} · 테스트 예약 결과`);
        return;
      }
      await rememberPrompt(prompt);
      window.setTimeout(triggerNativeSend, 0);
      return;
    }

    if (isDedCondition(latestIntercept.condition)) {
      startDedComposerFlow(latestIntercept);
      return;
    }
    startDirComposerFlow(latestIntercept);
  }

  function installSubmitInterceptors() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest("button");
        if (!button) return;

        const isSendButton =
          button.matches("button[data-testid='send-button']") ||
          button.matches("button[data-testid='fruitjuice-send-button']") ||
          button.matches("form button[type='submit']") ||
          (button.getAttribute("aria-label") || "").toLowerCase().includes("send") ||
          (button.getAttribute("aria-label") || "").includes("보내기");

        if (isSendButton) {
          void interceptSubmission(event);
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        if (!isPromptInput(event.target)) return;
        void interceptSubmission(event);
      },
      true
    );
  }

  function injectUi() {
    if (document.getElementById(ROOT_ID)) return;

    const root = createElement("div", "dpg-root");
    root.id = ROOT_ID;

    const settingsButton = createElement("button", "dpg-settings-button");
    settingsButton.type = "button";
    settingsButton.setAttribute("aria-label", "Delegation Prompt Gate settings");
    settingsButton.textContent = "설정";

    const panel = createElement("section", "dpg-panel dpg-hidden");
    panel.setAttribute("aria-label", "Delegation Prompt Gate settings panel");

    const title = createElement("h2", "dpg-title", "실험 설정");
    const idLabel = createElement("label", "dpg-field");
    const idText = createElement("span", null, "사용자 ID");
    const idInput = createElement("input", "dpg-input");
    idInput.type = "text";
    idInput.placeholder = "예: P001";
    idInput.autocomplete = "off";

    idLabel.append(idText, idInput);

    const conditionLabel = createElement("label", "dpg-field");
    const conditionText = createElement("span", null, "컨디션");
    const conditionSelect = createElement("select", "dpg-input");
    CONDITIONS.forEach((condition) => {
      const option = createElement("option", null, condition);
      option.value = condition;
      conditionSelect.append(option);
    });
    conditionLabel.append(conditionText, conditionSelect);

    const modelLabel = createElement("label", "dpg-field");
    const modelText = createElement("span", null, "GPT API 모델");
    const modelInput = createElement("input", "dpg-input");
    modelInput.type = "text";
    modelInput.placeholder = "예: gpt-5.5";
    modelInput.autocomplete = "off";
    modelLabel.append(modelText, modelInput);

    const enabledLabel = createElement("label", "dpg-toggle");
    const enabledInput = createElement("input");
    enabledInput.type = "checkbox";
    const enabledText = createElement("span", null, "프롬프트 가로채기 사용");
    enabledLabel.append(enabledInput, enabledText);

    const actions = createElement("div", "dpg-actions");
    const status = createElement("p", "dpg-status");
    const testButton = createElement("button", "dpg-secondary-button dpg-test-mode-button dpg-hidden", "테스트 모드");
    testButton.type = "button";
    const closeButton = createElement("button", "dpg-secondary-button", "닫기");
    closeButton.type = "button";
    const saveButton = createElement("button", "dpg-primary-button", "저장");
    saveButton.type = "button";
    actions.append(testButton, closeButton, saveButton);

    panel.append(title, idLabel, conditionLabel, modelLabel, enabledLabel, actions, status);
    root.append(settingsButton, panel);
    document.body.append(root);

    function syncForm() {
      idInput.value = settings.participantId;
      conditionSelect.value = settings.condition;
      modelInput.value = settings.model;
      enabledInput.checked = settings.enabled;
      testButton.classList.toggle("dpg-hidden", !isAdminMode());
    }

    settingsButton.addEventListener("click", () => {
      syncForm();
      panel.classList.toggle("dpg-hidden");
      status.textContent = "";
    });

    closeButton.addEventListener("click", () => {
      panel.classList.add("dpg-hidden");
    });

    saveButton.addEventListener("click", async () => {
      await saveSettings({
        participantId: idInput.value,
        condition: conditionSelect.value,
        model: modelInput.value,
        enabled: enabledInput.checked
      });
      syncForm();
      status.textContent = "저장되었습니다.";
    });

    testButton.addEventListener("click", () => {
      renderTestModePanel();
    });

    syncForm();
  }

  function renderTestModePanel() {
    if (!isAdminMode()) return;
    if (testModePanel) {
      testModePanel.remove();
      testModePanel = null;
      return;
    }

    const panel = createElement("section", "dpg-test-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Delegation Prompt Gate test mode");

    const title = createElement("h2", "dpg-title", "테스트 모드");
    const description = createElement(
      "p",
      "dpg-note",
      "먼저 테스트할 분기 단계를 선택한 뒤, 결과값을 골라 그 지점부터 흐름을 이어갑니다."
    );
    const stageList = createElement("div", "dpg-test-scenarios");
    const optionList = createElement("div", "dpg-test-scenarios");
    const result = createElement("p", "dpg-status");

    const evidenceButton = createElement("button", "dpg-test-scenario-button", "Evidence classifier 분기");
    evidenceButton.type = "button";
    evidenceButton.addEventListener("click", () => {
      renderTestResultOptions(optionList, result);
    });

    stageList.append(evidenceButton);

    const actions = createElement("div", "dpg-actions");
    const closeButton = createElement("button", "dpg-secondary-button", "닫기");
    closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      panel.remove();
      testModePanel = null;
    });
    actions.append(closeButton);

    panel.append(title, description, stageList, optionList, result, actions);
    document.body.append(panel);
    testModePanel = panel;
  }

  function renderTestResultOptions(container, result) {
    container.replaceChildren();
    const heading = createElement("p", "dpg-test-subtitle", "Evidence classifier 결과값");
    container.append(heading);

    TEST_EVIDENCE_RESULTS.forEach((scenario) => {
      const button = createElement("button", "dpg-test-scenario-button", scenario.label);
      button.type = "button";
      button.addEventListener("click", () => {
        reserveTestFromEvidenceResult(scenario, result);
      });
      container.append(button);
    });
  }

  function reserveTestFromEvidenceResult(scenario, result) {
    const classification = { ...scenario.classification };
    pendingTestOverride = {
      stage: "evidence",
      scenarioId: scenario.id,
      classification
    };

    result.textContent = `다음 프롬프트 1회에 Evidence 결과 '${scenario.label}'을 적용합니다.`;
  }

  function renderReviewPanel(intercept, warning) {
    const existing = document.querySelector(".dpg-review");
    if (existing) existing.remove();

    const review = createElement("section", "dpg-review");
    review.setAttribute("role", "dialog");
    review.setAttribute("aria-label", "Intercepted prompt review");

    const heading = createElement("h2", "dpg-title", "프롬프트 전송 전 확인");
    const meta = createElement(
      "p",
      "dpg-meta",
      `사용자 ${intercept.participantId || "미지정"} · ${intercept.condition}`
    );
    const classifierResult = createElement(
      "p",
      "dpg-classifier-result",
      `${intercept.classification.label} · confidence ${intercept.classification.confidence.toFixed(2)}`
    );
    const analysisResult = intercept.analysis
      ? createElement(
          "p",
          "dpg-analysis-result",
          `${getAnalysisLabel(intercept.analysis)} · confidence ${getAnalysisConfidenceText(intercept.analysis)}`
        )
      : null;
    const textarea = createElement("textarea", "dpg-review-textarea");
    textarea.value = intercept.prompt;

    const note = createElement(
      "p",
      "dpg-note",
      warning || (intercept.analysis
        ? getAnalysisReasoning(intercept.analysis)
        : "LLM 분석 결과가 없어 전송 전 확인이 필요합니다.")
    );

    const actions = createElement("div", "dpg-actions");
    const cancelButton = createElement("button", "dpg-secondary-button", "취소");
    cancelButton.type = "button";
    const sendButton = createElement(
      "button",
      "dpg-primary-button",
      intercept.testMode ? "테스트 닫기" : "GPT로 전송"
    );
    sendButton.type = "button";
    actions.append(cancelButton, sendButton);

    review.append(heading, meta, classifierResult);
    if (analysisResult) review.append(analysisResult);
    review.append(textarea, note, actions);
    document.body.append(review);
    textarea.focus();

    cancelButton.addEventListener("click", () => {
      review.remove();
    });

    sendButton.addEventListener("click", async () => {
      if (intercept.testMode) {
        review.remove();
        return;
      }

      const input = getPromptInput();
      const finalPrompt = textarea.value.trim();
      setPromptText(input, finalPrompt);
      review.remove();
      await rememberPrompt(finalPrompt);
      window.setTimeout(triggerNativeSend, 0);
    });
  }

  function getInterventionApi() {
    return window.DelegationPromptIntervention || {
      getDedQuestion: () => "이 요청에 포함하면 좋을 판단 기준과 기대 결과를 포함해서 요청해보세요",
      buildDirectionGuidance: () => "현재 요청에서 사용자가 채워야 할 방향을 포함해보세요",
      rewritePrompt: (input) => input.originalPrompt || ""
    };
  }

  function renderConditionInterventionPanel(intercept) {
    const existing = document.querySelector(".dpg-intervention");
    if (existing) existing.remove();

    const intervention = getInterventionApi();
    const condition = intercept.condition;
    const isDed = condition.startsWith("Ded");
    const isSys = condition.endsWith("Sys");
    const requestType = inferRequestType(intercept.prompt);
    const guidance = isDed
      ? intervention.getDedQuestion(requestType)
      : intervention.buildDirectionGuidance({
          originalPrompt: intercept.prompt,
          analysis: intercept.analysis,
          previousUserPrompts: intercept.previousUserPrompts
        });

    const panel = createElement("section", "dpg-intervention");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Condition intervention panel");

    const heading = createElement("h2", "dpg-title", `${condition} 개입`);
    const meta = createElement(
      "p",
      "dpg-meta",
      `사용자 ${intercept.participantId || "미지정"} · ${requestType}`
    );
    const classifierResult = createElement(
      "p",
      "dpg-classifier-result",
      `${intercept.classification.label} · confidence ${intercept.classification.confidence.toFixed(2)}`
    );
    const analysisResult = createElement(
      "p",
      "dpg-analysis-result",
      `${getAnalysisLabel(intercept.analysis)} · confidence ${getAnalysisConfidenceText(intercept.analysis)}`
    );
    const guidanceText = createElement("p", "dpg-guidance", guidance);

    const answerLabel = createElement("label", "dpg-field");
    const answerText = createElement("span", null, isDed ? "사용자 답변" : "반영할 내용");
    const answerInput = createElement("textarea", "dpg-review-textarea");
    answerInput.placeholder = isDed
      ? "질문에 대한 판단을 적어주세요."
      : "방향 안내를 바탕으로 추가로 반영할 내용을 적어주세요.";
    answerLabel.append(answerText, answerInput);

    const finalLabel = createElement("label", "dpg-field");
    const finalText = createElement("span", null, isSys ? "시스템 재작성 초안" : "직접 재작성");
    const finalPrompt = createElement("textarea", "dpg-review-textarea");
    finalPrompt.value = isSys
      ? intervention.rewritePrompt({
          originalPrompt: intercept.prompt,
          guidance,
          userAnswer: ""
        })
      : intercept.prompt;
    finalLabel.append(finalText, finalPrompt);

    if (isSys) {
      answerInput.addEventListener("input", () => {
        finalPrompt.value = intervention.rewritePrompt({
          originalPrompt: intercept.prompt,
          guidance,
          userAnswer: answerInput.value
        });
      });
    }

    const actions = createElement("div", "dpg-actions");
    const cancelButton = createElement("button", "dpg-secondary-button", "취소");
    cancelButton.type = "button";
    const sendButton = createElement(
      "button",
      "dpg-primary-button",
      intercept.testMode ? "테스트 닫기" : "GPT로 전송"
    );
    sendButton.type = "button";
    actions.append(cancelButton, sendButton);

    panel.append(heading, meta, classifierResult, analysisResult, guidanceText);
    if (isDed || isSys) panel.append(answerLabel);
    panel.append(finalLabel, actions);
    document.body.append(panel);
    finalPrompt.focus();

    cancelButton.addEventListener("click", () => {
      panel.remove();
    });

    sendButton.addEventListener("click", async () => {
      if (intercept.testMode) {
        panel.remove();
        return;
      }

      const input = getPromptInput();
      const rewrittenPrompt = finalPrompt.value.trim();
      setPromptText(input, rewrittenPrompt);
      panel.remove();
      await rememberPrompt(rewrittenPrompt);
      window.setTimeout(triggerNativeSend, 0);
    });
  }

  function showClassificationToast(classification, extraText) {
    const existing = document.querySelector(".dpg-toast");
    if (existing) existing.remove();

    const toast = createElement(
      "div",
      "dpg-toast",
      extraText || `${classification.label} · confidence ${classification.confidence.toFixed(2)}`
    );
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }

  function showAnalysisToast(analysis) {
    const existing = document.querySelector(".dpg-toast");
    if (existing) existing.remove();

    const toast = createElement(
      "div",
      "dpg-toast",
      `${getAnalysisLabel(analysis)} · confidence ${getAnalysisConfidenceText(analysis)}`
    );
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }

  async function start() {
    await loadSettings();
    injectUi();
    installSubmitInterceptors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.__delegationPromptGate = {
    CONDITIONS,
    ADMIN_PARTICIPANT_ID,
    TEST_EVIDENCE_RESULTS,
    normalizeSettings,
    isValidCondition,
    isAdminMode,
    reserveTestFromEvidenceResult,
    getPendingTestOverride: () => pendingTestOverride,
    getLatestIntercept: () => latestIntercept,
    getLatestClassification: () => latestClassification,
    getLatestAnalysis: () => latestAnalysis,
    getPromptHistory: () => [...promptHistory]
  };
})();
