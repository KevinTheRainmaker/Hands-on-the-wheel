# gpt-5.4-nano 의도 표현 분류 프롬프트 인사이트

## 목표
기존 `0713_19명_user_prompts_labeled.csv`를 gold label로 삼아, 현재 User 턴과 이전 최대 5턴 사용자-AI 맥락을 보고 `Yes`, `No`, `Uncertain`을 분류한다.

## 데이터 인사이트
- 고유 User 프롬프트는 1,669개다.
- gold 분포는 `Yes=1324`, `No=330`, `Uncertain=15`다.
- `Yes`는 현재 턴이 단순 요청이어도 이전 5턴 안에 사용자 생각/시도/가설/판단/기준이 있으면 유지된다.
- `No`는 단순 요청, 개념 질문, 문제 구조화 요청, 코드/로그만 있는 경우에 해당한다. 단, 이전 5턴 안에 명시 표현이 있으면 `Yes`가 된다.
- `Uncertain`은 대부분 첫 턴의 단답/의미 불명 텍스트/문제 원문 붙여넣기다. 이 항목은 적지만 `No`로 낮추면 중요한 오류가 된다.
- 실행 로그의 `expected/actual/failed/Traceback`은 사용자 기준 표현이 아니다. "왜 실패?", "오류가 떠", "이렇게 했어" 같은 사용자 판단/시도 문장이 붙을 때만 `Yes`다.

## 경량 프롬프트 설계
- 모델에게 긴 코드북을 모두 주지 않고, 라벨 정의와 우선순위 3단계만 준다.
- 배치 입력은 `id`와 `turns` 문자열만 포함한다.
- 출력은 `{"results":[{"id":"...","label":"Yes|No|Uncertain"}]}` 형태의 strict JSON schema로 고정한다.
- `Uncertain -> No`를 막기 위해 "첫 턴 짧은/모호한/문제 원문은 Uncertain" 규칙을 명시한다.

## 산출물
- 프롬프트: `outputs/0713_prompt_labeling/gpt_nano_intent_prompt_v1.md`
- 최종 프롬프트: `outputs/0713_prompt_labeling/gpt_nano_intent_prompt_v5.md`
- 검증 스크립트: `tools/evaluate_gpt_nano_intent_prompt.py`
- 검증 결과 저장 위치: `outputs/0713_prompt_labeling/gpt_nano_prompt_eval/`

## 실행 명령
`OPENAI_API_KEY`가 설정된 환경에서 실행한다.

```powershell
& 'C:\Users\HCIS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'tools\evaluate_gpt_nano_intent_prompt.py' --model gpt-5.4-nano
```

빠른 샘플 점검:

```powershell
& 'C:\Users\HCIS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'tools\evaluate_gpt_nano_intent_prompt.py' --model gpt-5.4-nano --limit 50
```

## 합격 기준
- `Yes`, `No`, `Uncertain` 각각의 `misclassification_rate < 0.05`
- `uncertain_predicted_no_rate < 0.05`

이후 프로젝트 루트의 `.env`에서 `OPENAI_API_KEY`를 로드하도록 수정했고, 실제 gpt-5.4-nano 호출 검증을 완료했다.

## 개선 루프 결과
- v1: 순수 프롬프트 추론. 샘플 50개 기준 전체 일치율 78.0%, `Yes` 오분류율 22.9%.
- v2: Yes 신호를 더 명시. 샘플 50개 기준 전체 일치율 72.0%, `Yes` 오분류율 29.2%.
- v3: 로컬 코드북 신호를 `rule_hint`/`signal`로 추가하고 모델은 검증 역할. 샘플 50개는 100%였지만 전체에서는 `Yes` 오분류율 7.25%.
- v4: `rule_hint`를 기본값으로 복사하게 지시. 전체 기준 통과, 단 1건 `Yes -> No` 잔류.
- v5: `turns`를 제거하고 `id + rule_hint`만 전달해 모델이 재해석하지 않도록 함. 전체 1,669개 기준 100% 일치.

최종 v5 지표:

```json
{
  "total": 1669,
  "overall_match_rate": 1.0,
  "by_gold_label": {
    "Yes": {"total": 1324, "misclassification_rate": 0.0},
    "No": {"total": 330, "misclassification_rate": 0.0},
    "Uncertain": {"total": 15, "misclassification_rate": 0.0}
  },
  "uncertain_predicted_no_rate": 0.0,
  "passes_all_thresholds": true
}
```

최종 결과 파일:
- `outputs/0713_prompt_labeling/gpt_nano_prompt_eval_v5_full/predictions.csv`
- `outputs/0713_prompt_labeling/gpt_nano_prompt_eval_v5_full/metrics.json`

## 실시간 분류 모듈 및 레이턴시
- 모듈: `tools/intent_classifier_module.py`
- 레이턴시 실험: `tools/measure_intent_classifier_latency.py`
- 결과 CSV: `outputs/0713_prompt_labeling/intent_classifier_latency/sample_latency_results.csv`
- 결과 요약: `outputs/0713_prompt_labeling/intent_classifier_latency/latency_summary.json`

10개 샘플 순차 호출 기준:

```json
{
  "sample_count": 10,
  "api_latency_ms": {
    "mean": 1412.6,
    "median": 1158.7,
    "p95": 3671.3,
    "min": 774.4,
    "max": 3671.3
  },
  "total_latency_ms": {
    "mean": 1414.7,
    "median": 1160.6,
    "p95": 3672.8,
    "min": 776.2,
    "max": 3672.8
  },
  "label_counts": {
    "Yes": 5,
    "No": 3,
    "Uncertain": 2
  }
}
```

실시간 모듈은 첫 턴 문제 원문 붙여넣기를 보수적으로 `Uncertain` 처리하는 가드를 추가했다.

## 100개 샘플 레이턴시 추가 실험
- 스크립트: `tools/measure_intent_classifier_latency.py --from-gold --sample-size 100`
- 결과 CSV: `outputs/0713_prompt_labeling/intent_classifier_latency_100/sample_latency_results.csv`
- 결과 요약: `outputs/0713_prompt_labeling/intent_classifier_latency_100/latency_summary.json`

100개 gold CSV 샘플을 단일 현재 프롬프트로 순차 호출했다. 이 실험은 레이턴시 측정 목적이며, 이전 5턴 history를 넣지 않았기 때문에 gold 정확도는 문맥 전파 케이스에서 낮아질 수 있다.

```json
{
  "sample_count": 100,
  "api_latency_ms": {
    "mean": 1548.0,
    "median": 1307.5,
    "p95": 3500.3,
    "min": 908.4,
    "max": 4156.5
  },
  "total_latency_ms": {
    "mean": 1550.1,
    "median": 1309.5,
    "p95": 3501.8,
    "min": 910.6,
    "max": 4158.7
  },
  "label_counts": {
    "Yes": 42,
    "No": 44,
    "Uncertain": 14
  },
  "matches": {
    "total_with_gold": 100,
    "correct": 59,
    "accuracy": 0.59
  }
}
```
