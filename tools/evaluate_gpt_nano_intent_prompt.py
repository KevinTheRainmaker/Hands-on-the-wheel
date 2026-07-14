from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.label_prompts import base_uncertain_reason, has_yes_expression


DEFAULT_ORIGINAL_CSV = Path(r"C:\Users\HCIS\Downloads\0713_19명.csv")
DEFAULT_GOLD_CSV = Path("outputs/0713_prompt_labeling/0713_19명_user_prompts_labeled.csv")
DEFAULT_PROMPT = Path("outputs/0713_prompt_labeling/gpt_nano_intent_prompt_v1.md")
DEFAULT_OUTPUT_DIR = Path("outputs/0713_prompt_labeling/gpt_nano_prompt_eval")
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
LABELS = ["Yes", "No", "Uncertain"]


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].strip()
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1]
    return key, value


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(line)
        if not parsed:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def load_default_dotenv() -> None:
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[1] / ".env",
    ]
    for candidate in candidates:
        load_dotenv(candidate)


def compact(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def trim(text: str | None, limit: int) -> str:
    value = compact(text)
    if len(value) <= limit:
        return value
    keep = max(0, limit - 18)
    return value[:keep] + " ...[truncated]"


def parse_metadata(row: dict[str, str]) -> dict[str, str]:
    raw = row.get("metadata") or "{}"
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def parse_turn_index(row: dict[str, str]) -> int:
    metadata = parse_metadata(row)
    if metadata.get("turnIndex") not in (None, ""):
        try:
            return int(metadata["turnIndex"])
        except (TypeError, ValueError):
            pass
    match = re.search(r"turn:(\d+)", row.get("traceName", ""))
    return int(match.group(1)) if match else 0


def load_gold(path: Path) -> dict[str, str]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return {row["traceId"]: row["intent_label"] for row in csv.DictReader(f)}


def load_turns(original_csv: Path, gold: dict[str, str]) -> list[dict[str, str]]:
    with original_csv.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    turns = []
    seen = set()
    for row in rows:
        trace_id = row.get("traceId", "")
        if trace_id in seen:
            continue
        if row.get("type") != "SPAN":
            continue
        if not (row.get("traceName") or "").startswith("turn:"):
            continue
        if trace_id not in gold:
            continue
        seen.add(trace_id)
        turns.append(
            {
                "traceId": trace_id,
                "sessionId": row.get("sessionId", ""),
                "turnIndex": str(parse_turn_index(row)),
                "startTime": row.get("startTime", ""),
                "input": row.get("input", ""),
                "output": row.get("output", ""),
                "gold": gold[trace_id],
            }
        )
    turns.sort(key=lambda r: (r["sessionId"], int(r["turnIndex"] or 0), r["startTime"]))
    return turns


def build_rule_hint(session_turns: list[dict[str, str]], index: int) -> tuple[str, str]:
    window_start = max(0, index - 5)
    latest_signal = ""
    for history_index in range(window_start, index + 1):
        has_signal, reason = has_yes_expression(session_turns[history_index].get("input") or "")
        if has_signal:
            rel = history_index - index
            latest_signal = f"[{rel}] {reason}: {trim(session_turns[history_index].get('input'), 180)}"
    if latest_signal:
        return "Yes", latest_signal

    uncertain = base_uncertain_reason(session_turns[index].get("input") or "", index)
    if uncertain:
        return "Uncertain", uncertain

    return "No", "No explicit user thought/attempt/hypothesis/judgment/criterion in current or previous 5 user turns."


def build_items(
    turns: list[dict[str, str]],
    max_current_chars: int,
    max_history_chars: int,
    include_rule_hint: bool,
) -> list[dict[str, str]]:
    by_session: dict[str, list[dict[str, str]]] = defaultdict(list)
    for turn in turns:
        by_session[turn["sessionId"]].append(turn)

    items = []
    for session_turns in by_session.values():
        session_turns.sort(key=lambda r: (int(r["turnIndex"] or 0), r["startTime"]))
        for index, turn in enumerate(session_turns):
            parts = []
            start = max(0, index - 5)
            for history_index in range(start, index):
                rel = history_index - index
                prior = session_turns[history_index]
                parts.append(f"[{rel}] U: {trim(prior['input'], max_history_chars)}")
                if prior.get("output"):
                    parts.append(f"[{rel}] A: {trim(prior['output'], max_history_chars)}")
            parts.append(f"[0] U: {trim(turn['input'], max_current_chars)}")
            item = {"id": turn["traceId"], "turns": "\n".join(parts), "gold": turn["gold"]}
            if include_rule_hint:
                hint, signal = build_rule_hint(session_turns, index)
                item["rule_hint"] = hint
                item["signal"] = signal
            items.append(item)
    return items


def extract_developer_prompt(prompt_md: str) -> str:
    marker = "## Developer Prompt"
    next_marker = "## User Payload Template"
    if marker not in prompt_md:
        return prompt_md.strip()
    body = prompt_md.split(marker, 1)[1]
    if next_marker in body:
        body = body.split(next_marker, 1)[0]
    return body.strip()


def response_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string", "enum": LABELS},
                    },
                    "required": ["id", "label"],
                },
            }
        },
        "required": ["results"],
    }


def extract_output_text(response_json: dict) -> str:
    if isinstance(response_json.get("output_text"), str):
        return response_json["output_text"]
    for item in response_json.get("output", []) or []:
        for part in item.get("content", []) or []:
            if isinstance(part.get("text"), str):
                return part["text"]
    return ""


def call_openai(
    api_key: str,
    model: str,
    developer_prompt: str,
    batch: list[dict[str, str]],
    hint_only: bool,
) -> dict[str, str]:
    keys = ["id", "rule_hint"] if hint_only else ["id", "turns", "rule_hint", "signal"]
    payload = {
        "items": [
            {
                key: item[key]
                for key in keys
                if key in item
            }
            for item in batch
        ]
    }
    request_body = {
        "model": model,
        "input": [
            {"role": "developer", "content": developer_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))},
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
    data = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
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
        response_json = json.loads(response.read().decode("utf-8"))
    parsed = json.loads(extract_output_text(response_json))
    return {row["id"]: row["label"] for row in parsed.get("results", [])}


def load_prediction_cache(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return {row["traceId"]: row["predicted_label"] for row in csv.DictReader(f) if row.get("predicted_label")}


def write_predictions(path: Path, items: list[dict[str, str]], predictions: dict[str, str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["traceId", "gold_label", "predicted_label", "match", "turns"])
        writer.writeheader()
        for item in items:
            pred = predictions.get(item["id"], "")
            writer.writerow(
                {
                    "traceId": item["id"],
                    "gold_label": item["gold"],
                    "predicted_label": pred,
                    "match": str(pred == item["gold"]),
                    "turns": item["turns"],
                }
            )


def compute_metrics(items: list[dict[str, str]], predictions: dict[str, str]) -> dict:
    confusion = {gold: Counter() for gold in LABELS}
    missing = 0
    for item in items:
        gold = item["gold"]
        pred = predictions.get(item["id"])
        if pred not in LABELS:
            missing += 1
            pred = "MISSING"
        confusion[gold][pred] += 1

    by_label = {}
    total_correct = 0
    total = len(items)
    for label in LABELS:
        label_total = sum(confusion[label].values())
        correct = confusion[label][label]
        total_correct += correct
        by_label[label] = {
            "total": label_total,
            "correct": correct,
            "match_rate": correct / label_total if label_total else None,
            "misclassification_rate": (label_total - correct) / label_total if label_total else None,
            "predicted_as": dict(confusion[label]),
        }

    uncertain_total = sum(confusion["Uncertain"].values())
    uncertain_as_no = confusion["Uncertain"]["No"]
    pass_threshold = all(
        by_label[label]["misclassification_rate"] is not None
        and by_label[label]["misclassification_rate"] < 0.05
        for label in LABELS
    ) and (uncertain_as_no / uncertain_total if uncertain_total else 0) < 0.05

    return {
        "total": total,
        "missing_predictions": missing,
        "overall_match_rate": total_correct / total if total else None,
        "by_gold_label": by_label,
        "uncertain_predicted_no_rate": uncertain_as_no / uncertain_total if uncertain_total else None,
        "passes_all_thresholds": pass_threshold,
        "threshold": "Each label misclassification_rate < 0.05 and Uncertain->No rate < 0.05",
    }


def main() -> int:
    load_default_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="gpt-5.4-nano")
    parser.add_argument("--original-csv", type=Path, default=DEFAULT_ORIGINAL_CSV)
    parser.add_argument("--gold-csv", type=Path, default=DEFAULT_GOLD_CSV)
    parser.add_argument("--prompt", type=Path, default=DEFAULT_PROMPT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--limit", type=int, default=0, help="Use 0 for the full dataset.")
    parser.add_argument("--max-current-chars", type=int, default=1600)
    parser.add_argument("--max-history-chars", type=int, default=700)
    parser.add_argument("--no-rule-hint", action="store_true")
    parser.add_argument("--hint-only", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.1)
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY is not configured; cannot call gpt-5.4-nano.", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    prediction_path = args.output_dir / "predictions.csv"
    metrics_path = args.output_dir / "metrics.json"

    gold = load_gold(args.gold_csv)
    turns = load_turns(args.original_csv, gold)
    items = build_items(turns, args.max_current_chars, args.max_history_chars, not args.no_rule_hint)
    if args.limit:
        items = items[: args.limit]

    developer_prompt = extract_developer_prompt(args.prompt.read_text(encoding="utf-8"))
    predictions = load_prediction_cache(prediction_path)
    pending = [item for item in items if item["id"] not in predictions]

    for offset in range(0, len(pending), args.batch_size):
        batch = pending[offset : offset + args.batch_size]
        try:
            batch_predictions = call_openai(api_key, args.model, developer_prompt, batch, args.hint_only)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            print(f"OpenAI HTTP error {exc.code}: {body}", file=sys.stderr)
            return 3
        except Exception as exc:
            print(f"OpenAI request failed: {exc}", file=sys.stderr)
            return 3
        predictions.update(batch_predictions)
        write_predictions(prediction_path, items, predictions)
        print(f"Predicted {min(offset + len(batch), len(pending))}/{len(pending)} pending items")
        time.sleep(args.sleep)

    write_predictions(prediction_path, items, predictions)
    metrics = compute_metrics(items, predictions)
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return 0 if metrics["passes_all_thresholds"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
