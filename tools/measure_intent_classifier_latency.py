from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.intent_classifier_module import classify_user_prompt  # noqa: E402


OUTPUT_DIR = PROJECT_ROOT / "outputs/0713_prompt_labeling/intent_classifier_latency"
RESULTS_CSV = OUTPUT_DIR / "sample_latency_results.csv"
SUMMARY_JSON = OUTPUT_DIR / "latency_summary.json"
GOLD_CSV = PROJECT_ROOT / "outputs/0713_prompt_labeling/0713_19명_user_prompts_labeled.csv"


SAMPLES = [
    {
        "id": "yes_current_hypothesis",
        "prompt": "계산이 틀렸나",
        "history": [],
    },
    {
        "id": "yes_current_attempt",
        "prompt": "했는데 111111 케이스에서 안돼",
        "history": [],
    },
    {
        "id": "yes_current_approach",
        "prompt": "일단 heapq로 풀면 되겠다",
        "history": [],
    },
    {
        "id": "yes_followup_from_history",
        "prompt": "수정한 코드 줘",
        "history": ["지금처럼 나머지로 처리하면 되려나 더 좋은 방법이 있나"],
    },
    {
        "id": "yes_behavior_spec",
        "prompt": "1을 누르면 이름과 점수를 저장하고 없으면 등록된 학생이 없습니다 출력",
        "history": [],
    },
    {
        "id": "no_simple_request",
        "prompt": "문제를 구조화 해줘",
        "history": [],
    },
    {
        "id": "no_concept_question",
        "prompt": "strip은 어떤 함수인가요?",
        "history": [],
    },
    {
        "id": "no_code_only",
        "prompt": "def solution(x):\n    for i in range(x):\n        print(i)\n    return x",
        "history": [],
    },
    {
        "id": "uncertain_short_first",
        "prompt": "응",
        "history": [],
    },
    {
        "id": "uncertain_problem_statement",
        "prompt": "[문제]\n입력은 정수 n입니다.\n출력은 n x n 마방진입니다.\n예시 입력: 3\n예시 출력: [8,1,6,3,5,7,4,9,2]\n제한 사항: n은 홀수입니다. 요구사항을 만족하도록 구현하세요.",
        "history": [],
    },
]


def allocate_counts(label_counts: dict[str, int], sample_size: int) -> dict[str, int]:
    total = sum(label_counts.values())
    raw = {label: (count / total) * sample_size for label, count in label_counts.items()}
    allocated = {label: int(value) for label, value in raw.items()}
    remainder = sample_size - sum(allocated.values())
    for label, _ in sorted(raw.items(), key=lambda item: item[1] - int(item[1]), reverse=True):
        if remainder <= 0:
            break
        allocated[label] += 1
        remainder -= 1
    return allocated


def load_gold_samples(sample_size: int, seed: int) -> list[dict[str, object]]:
    by_label: dict[str, list[dict[str, str]]] = defaultdict(list)
    with GOLD_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            by_label[row["intent_label"]].append(row)

    rng = random.Random(seed)
    label_counts = {label: len(rows) for label, rows in by_label.items()}
    allocated = allocate_counts(label_counts, sample_size)

    samples: list[dict[str, object]] = []
    for label in ["Yes", "No", "Uncertain"]:
        rows = by_label.get(label, [])
        take = min(allocated.get(label, 0), len(rows))
        for row in rng.sample(rows, take):
            samples.append(
                {
                    "id": f"gold_{label}_{row['traceId']}",
                    "prompt": row["input"],
                    "history": [],
                    "gold_label": label,
                    "traceId": row["traceId"],
                }
            )

    rng.shuffle(samples)
    return samples[:sample_size]


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * ratio)))
    return ordered[index]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-gold", action="store_true", help="Sample prompts from the gold labeled CSV.")
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument("--seed", type=int, default=20260714)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    output_dir = args.output_dir
    results_csv = output_dir / "sample_latency_results.csv"
    summary_json = output_dir / "latency_summary.json"
    samples = load_gold_samples(args.sample_size, args.seed) if args.from_gold else SAMPLES

    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []

    for sample in samples:
        started = time.perf_counter()
        result = classify_user_prompt(sample["prompt"], sample["history"], item_id=sample["id"])
        total_latency_ms = round((time.perf_counter() - started) * 1000, 1)
        row = {
            "id": sample["id"],
            "traceId": sample.get("traceId", ""),
            "gold_label": sample.get("gold_label", ""),
            "label": result["label"],
            "match": "" if not sample.get("gold_label") else str(result["label"] == sample.get("gold_label")),
            "api_latency_ms": result["latency_ms"],
            "total_latency_ms": total_latency_ms,
            "rule_hint": result["rule_hint"],
            "signal": result["signal"],
        }
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))

    with results_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "traceId",
                "gold_label",
                "label",
                "match",
                "api_latency_ms",
                "total_latency_ms",
                "rule_hint",
                "signal",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    api_latencies = [float(row["api_latency_ms"]) for row in rows]
    total_latencies = [float(row["total_latency_ms"]) for row in rows]
    summary = {
        "sample_count": len(rows),
        "api_latency_ms": {
            "mean": round(statistics.mean(api_latencies), 1),
            "median": round(statistics.median(api_latencies), 1),
            "p95": round(percentile(api_latencies, 0.95), 1),
            "min": round(min(api_latencies), 1),
            "max": round(max(api_latencies), 1),
        },
        "total_latency_ms": {
            "mean": round(statistics.mean(total_latencies), 1),
            "median": round(statistics.median(total_latencies), 1),
            "p95": round(percentile(total_latencies, 0.95), 1),
            "min": round(min(total_latencies), 1),
            "max": round(max(total_latencies), 1),
        },
        "label_counts": {label: sum(1 for row in rows if row["label"] == label) for label in ["Yes", "No", "Uncertain"]},
        "gold_label_counts": {
            label: sum(1 for row in rows if row.get("gold_label") == label) for label in ["Yes", "No", "Uncertain"]
        },
        "matches": {
            "total_with_gold": sum(1 for row in rows if row.get("gold_label")),
            "correct": sum(1 for row in rows if row.get("gold_label") and row["label"] == row.get("gold_label")),
        },
    }
    if summary["matches"]["total_with_gold"]:
        summary["matches"]["accuracy"] = round(
            summary["matches"]["correct"] / summary["matches"]["total_with_gold"],
            4,
        )
    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
