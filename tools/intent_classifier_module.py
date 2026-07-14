from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.evaluate_gpt_nano_intent_prompt import (  # noqa: E402
    OPENAI_RESPONSES_URL,
    extract_developer_prompt,
    extract_output_text,
    load_default_dotenv,
    response_schema,
)
from tools.label_prompts import base_uncertain_reason, has_yes_expression  # noqa: E402


DEFAULT_MODEL = "gpt-5.4-nano"
DEFAULT_PROMPT_PATH = PROJECT_ROOT / "outputs/0713_prompt_labeling/gpt_nano_intent_prompt_v5.md"
LABELS = {"Yes", "No", "Uncertain"}


def normalize_previous_user_prompts(previous: list[Any] | None) -> list[str]:
    if not previous:
        return []
    prompts: list[str] = []
    for item in previous[-5:]:
        if isinstance(item, str):
            prompts.append(item)
        elif isinstance(item, dict):
            value = item.get("user") or item.get("prompt") or item.get("content") or ""
            prompts.append(str(value))
        else:
            prompts.append(str(item))
    return prompts


def looks_like_first_turn_problem_statement(text: str) -> bool:
    stripped = " ".join(str(text or "").split())
    if len(stripped) < 80:
        return False
    markers = ["[문제]", "문제", "입력", "출력", "예시", "제한", "요구사항", "구현하세요", "작성하세요"]
    marker_hits = sum(1 for marker in markers if marker in stripped)
    return marker_hits >= 4


def build_rule_hint(current_prompt: str, previous_user_prompts: list[str] | None = None) -> tuple[str, str]:
    prompts = normalize_previous_user_prompts(previous_user_prompts)
    prompts.append(str(current_prompt or ""))

    if len(prompts) == 1 and looks_like_first_turn_problem_statement(prompts[0]):
        return "Uncertain", "첫 턴이 문제 원문/요구사항 붙여넣기에 가까워 선행 맥락을 확인할 수 없음"

    latest_signal = ""
    current_index = len(prompts) - 1
    window_start = max(0, current_index - 5)
    for index in range(window_start, current_index + 1):
        has_signal, reason = has_yes_expression(prompts[index])
        if has_signal:
            rel = index - current_index
            snippet = " ".join(prompts[index].split())[:180]
            latest_signal = f"[{rel}] {reason}: {snippet}"

    if latest_signal:
        return "Yes", latest_signal

    uncertain = base_uncertain_reason(prompts[current_index], len(prompts) - 1)
    if uncertain:
        return "Uncertain", uncertain

    return "No", "No explicit user thought/attempt/hypothesis/judgment/criterion in current or previous 5 user turns."


def build_request_body(
    item_id: str,
    rule_hint: str,
    model: str,
    developer_prompt: str,
) -> dict[str, Any]:
    return {
        "model": model,
        "input": [
            {"role": "developer", "content": developer_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {"items": [{"id": item_id, "rule_hint": rule_hint}]},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "intent_label_batch",
                "strict": True,
                "schema": response_schema(),
            }
        },
    }


def call_openai(api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def classify_user_prompt(
    current_prompt: str,
    previous_user_prompts: list[Any] | None = None,
    *,
    model: str = DEFAULT_MODEL,
    prompt_path: Path = DEFAULT_PROMPT_PATH,
    item_id: str = "current",
) -> dict[str, Any]:
    load_default_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    rule_hint, signal = build_rule_hint(current_prompt, previous_user_prompts)
    developer_prompt = extract_developer_prompt(prompt_path.read_text(encoding="utf-8"))
    body = build_request_body(item_id, rule_hint, model, developer_prompt)

    started = time.perf_counter()
    response_json = call_openai(api_key, body)
    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    parsed = json.loads(extract_output_text(response_json))
    results = parsed.get("results") or []
    label = results[0].get("label") if results else None
    if label not in LABELS:
        raise RuntimeError(f"Invalid model label: {label!r}")

    return {
        "label": label,
        "latency_ms": latency_ms,
        "model": model,
        "version": "gpt-nano-intent-v5",
        "rule_hint": rule_hint,
        "signal": signal,
        "item_id": item_id,
    }


def load_history_json(value: str | None) -> list[Any]:
    if not value:
        return []
    candidate = Path(value)
    raw = candidate.read_text(encoding="utf-8") if candidate.exists() else value
    parsed = json.loads(raw)
    if isinstance(parsed, list):
        return parsed
    raise ValueError("--history-json must be a JSON array or a path to a JSON array.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify a user prompt as Yes/No/Uncertain.")
    parser.add_argument("prompt", nargs="?", default="")
    parser.add_argument("--history-json", default="", help="JSON array or path to JSON array of previous user prompts.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--prompt-path", type=Path, default=DEFAULT_PROMPT_PATH)
    args = parser.parse_args()

    try:
        result = classify_user_prompt(
            args.prompt,
            load_history_json(args.history_json),
            model=args.model,
            prompt_path=args.prompt_path,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(json.dumps({"error": f"OpenAI HTTP error {exc.code}", "detail": body}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
