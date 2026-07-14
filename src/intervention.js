(function () {
  "use strict";

  const DED_QUESTIONS = {
    debugging: "어떤 부분에서 에러가 발생한 것 같은지, 그리고 그 에러가 왜 날 것 같은지를 포함해서 요청해보세요",
    implementation: "이 작업에서 어떤 방향으로 접근하면 좋을지, 그리고 어떤 결과를 기대하는지를 포함해서 요청해보세요",
    delegation: "이 작업에서 어떤 방향으로 접근하면 좋을지, 그리고 어떤 결과를 기대하는지를 포함해서 요청해보세요",
    evaluating: "어떤 기준으로 판단하려 하는지를 포함해서 요청해보세요",
    other: "이 요청에서 어떤 판단 기준이나 기대 결과를 포함하면 좋을지 생각해보고 요청해보세요"
  };

  function normalizeRequestType(requestType) {
    return Object.prototype.hasOwnProperty.call(DED_QUESTIONS, requestType)
      ? requestType
      : "other";
  }

  function getDedQuestion(requestType) {
    return DED_QUESTIONS[normalizeRequestType(requestType)];
  }

  function buildDirectionGuidance(input) {
    const analysis = input && input.analysis ? input.analysis : {};
    const requestType = normalizeRequestType(analysis.request_type);
    const evidence = Array.isArray(analysis.evidence) && analysis.evidence.length > 0
      ? `현재 요청에서 "${analysis.evidence[0]}" 표현이 관찰됩니다.`
      : "현재 요청은 위임 표현을 포함하고 있습니다.";
    const direction = getDedQuestion(requestType);

    return `${evidence} ${direction}`;
  }

  function rewritePrompt(input) {
    const originalPrompt = String(input && input.originalPrompt ? input.originalPrompt : "").trim();
    const guidance = String(input && input.guidance ? input.guidance : "").trim();
    const userAnswer = String(input && input.userAnswer ? input.userAnswer : "").trim();

    return [
      originalPrompt,
      guidance ? `반영할 방향: ${guidance}` : "",
      userAnswer ? `사용자 판단: ${userAnswer}` : ""
    ].filter(Boolean).join("\n\n");
  }

  window.DelegationPromptIntervention = {
    DED_QUESTIONS,
    getDedQuestion,
    buildDirectionGuidance,
    rewritePrompt
  };
})();
