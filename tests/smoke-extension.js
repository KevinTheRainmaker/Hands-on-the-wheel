const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const contentPath = path.join(root, "src", "content.js");
const classifierPath = path.join(root, "src", "classifier.js");
const interventionPath = path.join(root, "src", "intervention.js");
const stylesPath = path.join(root, "src", "styles.css");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const content = fs.readFileSync(contentPath, "utf8");
const classifier = fs.readFileSync(classifierPath, "utf8");
const intervention = fs.readFileSync(interventionPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.permissions.includes("storage"), "storage permission is required");
assert(
  manifest.host_permissions.includes("https://chatgpt.com/*"),
  "chatgpt.com host permission is required"
);
assert(
  manifest.content_scripts[0].matches.includes("https://chat.openai.com/*"),
  "chat.openai.com match is required"
);
assert(
  manifest.content_scripts[0].js.includes("src/classifier.js"),
  "classifier script must be registered"
);
assert(
  manifest.content_scripts[0].js.includes("src/intervention.js"),
  "intervention script must be registered"
);
assert(
  manifest.content_scripts[0].js.includes("src/content.js"),
  "content script must be registered"
);
assert(
  manifest.content_scripts[0].css.includes("src/styles.css"),
  "stylesheet must be registered"
);

["Ded-Us", "Ded-Sys", "Dir-Us", "Dir-Sys"].forEach((condition) => {
  assert(content.includes(`"${condition}"`), `${condition} must be supported`);
});

assert(content.includes("chrome.storage.sync"), "settings must use chrome.storage.sync");
assert(content.includes("chrome.storage.local"), "prompt history must use local storage");
assert(content.includes("keydown"), "Enter submission must be intercepted");
assert(content.includes("click"), "send button click must be intercepted");
assert(content.includes("getLatestIntercept"), "latest intercept should be inspectable");
assert(content.includes("getLatestClassification"), "latest classification should be inspectable");
assert(content.includes("getLatestAnalysis"), "latest analysis should be inspectable");
assert(content.includes("ADMIN_3146"), "test mode must be gated by admin participant ID");
assert(content.includes("테스트 모드"), "settings UI must include test mode text");
assert(content.includes("TEST_EVIDENCE_RESULTS"), "evidence test results must be defined");
assert(content.includes("renderTestResultOptions"), "test mode must render result options after stage choice");
assert(content.includes("reserveTestFromEvidenceResult"), "evidence test result must be reservable");
assert(content.includes("pendingTestOverride"), "test mode must reserve the next action result");
assert(content.includes("getPendingTestOverride"), "pending test override should be inspectable");
assert(content.includes("Evidence classifier 결과값"), "test mode must expose evidence classifier results");
assert(content.includes("intercept.testMode ? \"테스트 닫기\""), "test mode review must not expose send action");
assert(content.includes("DelegationPromptClassifier"), "content script must call classifier");
assert(content.includes("renderConditionInterventionPanel"), "avoidant delegation must route to condition intervention");
assert(content.includes("DelegationPromptIntervention"), "content script must use condition intervention helpers");
assert(content.includes("activeDedFlow"), "Ded conditions must use composer flow state");
assert(content.includes("activeFinalComposerFlow"), "Dir accepted prompts must wait for final composer submission");
assert(content.includes("startDedComposerFlow"), "Ded conditions must start composer-based flow");
assert(content.includes("startDirComposerFlow"), "Dir conditions must start composer-based flow");
assert(content.includes("acceptDirGuidance"), "Dir guidance must support accept flow");
assert(content.includes("continueDedComposerFlow"), "Ded direction input must continue from internal surface field");
assert(content.includes("continueDirComposerFlow"), "Dir direction input must continue from internal surface field");
assert(content.includes("renderComposerSurface"), "pipeline UI must render composer-adjacent surface");
assert(content.includes("dpg-composer-surface, .dpg-test-panel"), "composer surface inputs must not be mistaken for GPT input");
assert(content.includes("classification.label === \"Yes\""), "Yes evidence must pass through");
assert(content.includes("isDedCondition(latestIntercept.condition)"), "No/Uncertain evidence must route Ded conditions to composer flow");
assert(classifier.includes("Yes"), "classifier must support Yes label");
assert(classifier.includes("No"), "classifier must support No label");
assert(classifier.includes("Uncertain"), "classifier must support Uncertain label");
assert(classifier.includes("classifyPrompt"), "classifier must expose classifyPrompt");
assert(classifier.includes("confidence"), "classifier must return confidence");
assert(intervention.includes("getDedQuestion"), "intervention must expose Ded question helper");
assert(intervention.includes("buildDirectionGuidance"), "intervention must expose Dir guidance helper");
assert(intervention.includes("rewritePrompt"), "intervention must expose Sys rewrite helper");
assert(styles.includes(".dpg-settings-button"), "settings button style is required");
assert(styles.includes(".dpg-classifier-result"), "classifier result style is required");
assert(styles.includes(".dpg-analysis-result"), "analysis result style is required");
assert(styles.includes(".dpg-test-panel"), "test mode panel style is required");
assert(styles.includes(".dpg-intervention"), "condition intervention panel style is required");
assert(styles.includes(".dpg-guidance"), "condition guidance style is required");
assert(styles.includes(".dpg-composer-surface"), "composer surface style is required");
assert(styles.includes(".dpg-composer-original"), "composer surface must style original prompt");
assert(styles.includes(".dpg-composer-textarea"), "composer surface must style internal direction textarea");
assert(styles.includes(".dpg-spinner"), "composer surface must style loading spinner");
assert(styles.includes(".dpg-test-scenario-button"), "test scenario button style is required");
assert(styles.includes(".dpg-test-subtitle"), "test result subtitle style is required");
assert(styles.includes("position: fixed"), "extension UI should be fixed in page");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(classifier, sandbox);
vm.runInContext(intervention, sandbox);

async function runClassifierChecks() {
  const api = sandbox.window.DelegationPromptClassifier;
  const interventionApi = sandbox.window.DelegationPromptIntervention;
  assert(api, "classifier API must be attached to window");
  assert(interventionApi, "intervention API must be attached to window");

  const withEvidence = await api.classifyPrompt("이 에러가 반복문 조건 때문인 것 같아. 고쳐줘");
  assert(withEvidence.label === "Yes", "explicit thinking example must be Yes");
  assert(
    typeof withEvidence.confidence === "number" && withEvidence.confidence >= 0.5,
    "Yes confidence must be numeric"
  );

  const noEvidence = await api.classifyPrompt("이 에러 고쳐줘");
  assert(noEvidence.label === "No", "bare request example must be No");
  assert(
    typeof noEvidence.confidence === "number" && noEvidence.confidence >= 0.5,
    "No confidence must be numeric"
  );

  const historyEvidence = await api.classifyPrompt("고쳐줘", ["반복문 인덱스가 하나 밀린 것 같아"]);
  assert(historyEvidence.label === "Yes", "previous user thinking must make current prompt Yes");

  const noEvidenceAfterHistory = await api.classifyPrompt("이 에러 고쳐줘", ["반복문 인덱스가 하나 밀린 것 같아"]);
  assert(
    noEvidenceAfterHistory.label === "No",
    "non-short bare requests should not inherit unrelated previous thinking"
  );

  assert(
    interventionApi.getDedQuestion("debugging").includes("에러"),
    "Ded debugging question must mention error context"
  );
  assert(
    interventionApi.getDedQuestion("delegation").includes("어떤 방향"),
    "Ded delegation question must ask for direction"
  );
  assert(
    interventionApi.getDedQuestion("evaluating").includes("기준"),
    "Ded evaluating question must ask for criteria"
  );
  assert(
    interventionApi.buildDirectionGuidance({ analysis: { request_type: "evaluating", evidence: ["판단해줘"] } }).includes("판단해줘"),
    "Dir guidance must use analyzer evidence when available"
  );

  console.log("Extension smoke test passed.");
}

runClassifierChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
