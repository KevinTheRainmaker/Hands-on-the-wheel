from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


INPUT_PATH = Path(r"C:\Users\HCIS\Downloads\0713_19명.csv")
OUTPUT_DIR = Path("outputs/0713_prompt_labeling")
UNIQUE_OUTPUT = OUTPUT_DIR / "0713_19명_user_prompts_labeled.csv"
FULL_OUTPUT = OUTPUT_DIR / "0713_19명_all_rows_with_prompt_labels.csv"
SUMMARY_OUTPUT = OUTPUT_DIR / "0713_19명_labeling_summary.json"


YES_LABEL = "Yes"
NO_LABEL = "No"
UNCERTAIN_LABEL = "Uncertain"
NA_LABEL = "NotApplicable"


HYPOTHESIS_PATTERNS = [
    r"같아",
    r"같은데",
    r"같네",
    r"같습니다",
    r"같음",
    r"것\s*같",
    r"듯",
    r"아마",
    r"때문",
    r"문제\s*(인|있|같|자체|이해)",
    r"문제가",
    r"문제는",
    r"문제일까",
    r"문제일까요",
    r"잘못",
    r"틀렸",
    r"이상하",
    r"이상한",
    r"오류",
    r"에러",
    r"안\s*돼",
    r"안\s*되",
    r"안됨",
    r"모르겠",
    r"생각[이가\s]*안\s*나",
    r"헷갈",
    r"막히",
    r"막혀",
    r"왜\s",
    r"어디(가|서)?\s*(틀|문제|잘못)",
    r"되려나",
    r"되나",
    r"되지\s*않을까",
    r"아닌가",
    r"맞나",
    r"맞아\?",
    r"잘한거\s*아닌가",
    r"끝난\s*건가",
    r"끝난건가",
    r"이렇게\s*하면",
    r"하면\s*돼",
    r"하면\s*되",
    r"나오나",
    r"차이나지",
    r"신경\s*안\s*썼",
    r"잖아",
    r"\bi\s+(think|guess|suppose|remind|remember|forgot)\b",
    r"\bi\s+(don't|do\s+not)\s+know\b",
    r"\bmaybe\b",
    r"\bseems?\b",
    r"\binefficient\b",
    r"\bthere\s+can\s+be\b",
    r"\bdoes\s+this\b",
]

ATTEMPT_PATTERNS = [
    r"해\s*봤",
    r"해봤",
    r"해보나",
    r"해보면",
    r"바꿔\s*봤",
    r"넣어\s*봤",
    r"실행해?\s*봤",
    r"했는데",
    r"했더니",
    r"하니까",
    r"보니까",
    r"수정했",
    r"작성했",
    r"만들었",
    r"썼어",
    r"써본적",
    r"써\s*본\s*적",
    r"써봐서",
    r"변환했",
    r"바꿨",
    r"실행했",
    r"입력했",
    r"눌렀",
    r"시도",
]

APPROACH_PATTERNS = [
    r"하려고",
    r"할\s*거",
    r"할\s*꺼",
    r"할게",
    r"해\s*볼게",
    r"해볼게",
    r"일단",
    r"먼저",
    r"방향",
    r"기준으로",
    r"기준은",
    r"기준이",
    r"중요",
    r"원해",
    r"하고\s*싶",
    r"필요하",
    r"목표",
    r"기본적으로",
    r"만들자",
    r"해보자",
    r"풀면\s*되겠",
    r"로\s*풀",
    r"로\s*만들",
    r"로\s*만들기",
    r"부터\s*구현",
    r"역산",
    r"사용하여",
    r"이용하여",
    r"로\s*비교",
    r"로\s*입력",
    r"입력받",
    r"허용하지\s*않",
    r"한정",
    r"실수\s*방지",
    r"되게",
    r"도록",
    r"해야",
    r"되어야",
    r"되면",
    r"없으면",
    r"있으면",
    r"누르면",
    r"입력\s*시",
    r"입력시",
    r"선택\s*시",
    r"선택하면",
    r"검색\s*후",
    r"경우",
    r"하는\s*함수",
    r"함수도\s*만들",
    r"\bshould\b",
    r"\bneed(?:s)?\s+to\b",
]

REQUEST_ONLY_PATTERNS = [
    r"^(풀어줘|해줘|고쳐줘|짜줘|만들어줘|작성해줘|설명해줘|알려줘|수정해줘|코드\s*줘|코드\s*부탁해|수정한\s*코드\s*부탁해)[.!?。]*$",
    r"^(네|응|아니|아니요|맞아|좋아|오케이|ok|OK|1번|2번|3번|4번|1|2|3|4)$",
]


def compact(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def parse_metadata(row: dict[str, str]) -> dict[str, str]:
    raw = row.get("metadata") or "{}"
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def parse_turn_index(row: dict[str, str], metadata: dict[str, str]) -> int:
    if metadata.get("turnIndex") not in (None, ""):
        try:
            return int(metadata["turnIndex"])
        except (TypeError, ValueError):
            pass
    match = re.search(r"turn:(\d+)", row.get("traceName", ""))
    return int(match.group(1)) if match else 0


def parse_problem_id(row: dict[str, str], metadata: dict[str, str]) -> str:
    if metadata.get("problemId") not in (None, ""):
        return str(metadata["problemId"])
    match = re.search(r"p(\d+)", row.get("traceName", ""))
    return match.group(1) if match else ""


def is_turn_prompt(row: dict[str, str]) -> bool:
    return (row.get("traceName") or "").startswith("turn:")


def looks_like_code_only(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    code_markers = [
        "def ",
        "class ",
        "import ",
        "public class",
        "function ",
        "#include",
        "console.log",
        "if(",
        "if (",
        "while ",
        "for ",
        "{",
        "}",
        ";",
    ]
    line_count = len(stripped.splitlines())
    marker_count = sum(1 for marker in code_markers if marker in stripped)
    hangul_letters = len(re.findall(r"[가-힣]", stripped))
    ascii_symbols = len(re.findall(r"[{}();=<>:+\-*/]", stripped))
    return line_count >= 4 and marker_count >= 2 and ascii_symbols > max(10, hangul_letters)


def looks_like_problem_statement(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 180:
        return False
    markers = [
        "문제",
        "입력",
        "출력",
        "예제",
        "제한",
        "구현하세요",
        "작성하세요",
        "요구사항",
        "조건",
    ]
    marker_hits = sum(1 for marker in markers if marker in stripped)
    return marker_hits >= 3 and not has_yes_expression(stripped)[0]


def looks_like_short_ambiguous(text: str) -> bool:
    stripped = compact(text)
    if not stripped:
        return True
    if len(stripped) <= 8:
        return True
    if re.fullmatch(r"[0-9가-힣A-Za-z\s.,!?]+", stripped) and len(stripped.split()) <= 2:
        return True
    return False


def is_request_only(text: str) -> bool:
    stripped = compact(text)
    return any(re.search(pattern, stripped, re.IGNORECASE) for pattern in REQUEST_ONLY_PATTERNS)


def match_any(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def has_yes_expression(text: str) -> tuple[bool, str]:
    stripped = compact(text)
    if not stripped:
        return False, ""

    attempt = match_any(ATTEMPT_PATTERNS, stripped)
    if attempt:
        return True, f"시도 언급 표현 감지: '{attempt}'"

    hypothesis = match_any(HYPOTHESIS_PATTERNS, stripped)
    if hypothesis:
        return True, f"가설/판단 표현 감지: '{hypothesis}'"

    approach = match_any(APPROACH_PATTERNS, stripped)
    if approach and not is_request_only(stripped):
        return True, f"접근 방향/기준 표현 감지: '{approach}'"

    # Long behavior specifications in the user's own words are treated as criteria.
    if (
        not looks_like_code_only(stripped)
        and len(stripped) >= 70
        and re.search(
            r"(입력|출력|저장|검색|삭제|생성|변경|선택|반복|예외|조건|메뉴|함수|menu|function|clause|capacity|prompt|input|output|return|argument)",
            stripped,
            re.IGNORECASE,
        )
        and not re.search(r"(문제|예제\s*입력|예제\s*출력|제한\s*사항)", stripped)
        and not re.search(r"(expected:|actual:|failed|FAILED|Traceback|err=|error:|case #)", stripped, re.IGNORECASE)
    ):
        return True, "사용자 기준/요구 동작을 구체적으로 제시"

    return False, ""


def base_uncertain_reason(text: str, prior_count: int) -> str | None:
    stripped = compact(text)
    if looks_like_problem_statement(stripped) and prior_count == 0:
        return "첫 턴이 문제 원문/요구사항 붙여넣기에 가까워 선행 맥락을 확인할 수 없음"
    if looks_like_short_ambiguous(stripped) and prior_count == 0:
        return "첫 턴 단답/짧은 발화라 자기 의도인지 확인 불가"
    return None


def sort_key(turn: dict[str, str]) -> tuple[str, int, str]:
    return (
        turn["sessionId"],
        int(turn.get("turnIndex") or 0),
        turn.get("startTime") or "",
    )


def evidence_snippet(text: str) -> str:
    stripped = compact(text)
    return stripped[:180] + ("..." if len(stripped) > 180 else "")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with INPUT_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        original_fields = reader.fieldnames or []

    unique_turns_by_trace: dict[str, dict[str, str]] = {}
    for row in rows:
        if row.get("type") != "SPAN" or not is_turn_prompt(row):
            continue
        metadata = parse_metadata(row)
        row = dict(row)
        row["turnIndex"] = str(parse_turn_index(row, metadata))
        row["problemId"] = parse_problem_id(row, metadata)
        unique_turns_by_trace[row["traceId"]] = row

    turns_by_session: dict[str, list[dict[str, str]]] = defaultdict(list)
    for turn in unique_turns_by_trace.values():
        turns_by_session[turn["sessionId"]].append(turn)

    label_by_trace: dict[str, dict[str, str]] = {}
    unique_labeled: list[dict[str, str]] = []

    for session_id, session_turns in turns_by_session.items():
        sorted_turns = sorted(session_turns, key=sort_key)
        base_infos: list[dict[str, str | bool]] = []
        for idx, turn in enumerate(sorted_turns):
            text = turn.get("input") or ""
            has_intent, current_reason = has_yes_expression(text)
            uncertainty = None if has_intent else base_uncertain_reason(text, idx)
            base_infos.append(
                {
                    "has_intent": has_intent,
                    "current_reason": current_reason,
                    "uncertainty": uncertainty or "",
                }
            )

        for idx, turn in enumerate(sorted_turns):
            window_start = max(0, idx - 5)
            window = list(range(window_start, idx + 1))
            intent_indexes = [i for i in window if bool(base_infos[i]["has_intent"])]

            if intent_indexes:
                evidence_idx = intent_indexes[-1]
                label = YES_LABEL
                if evidence_idx == idx:
                    reason = str(base_infos[idx]["current_reason"])
                else:
                    distance = idx - evidence_idx
                    reason = f"이전 {distance}턴 내 명시적 표현 존재: {base_infos[evidence_idx]['current_reason']}"
                evidence = evidence_snippet(sorted_turns[evidence_idx].get("input") or "")
            elif base_infos[idx]["uncertainty"]:
                label = UNCERTAIN_LABEL
                reason = str(base_infos[idx]["uncertainty"])
                evidence = evidence_snippet(turn.get("input") or "")
            elif looks_like_code_only(turn.get("input") or ""):
                label = NO_LABEL
                reason = "코드/로그 붙여넣기 중심이며 최근 5턴 내 명시적 의도 표현 없음"
                evidence = evidence_snippet(turn.get("input") or "")
            elif is_request_only(turn.get("input") or ""):
                label = NO_LABEL
                reason = "단순 요청/확인 응답이며 최근 5턴 내 명시적 의도 표현 없음"
                evidence = evidence_snippet(turn.get("input") or "")
            else:
                label = NO_LABEL
                reason = "명령형 요청 또는 정보 제공만 있고 최근 5턴 내 자기 생각/시도/기준 표현 없음"
                evidence = evidence_snippet(turn.get("input") or "")

            labeled = {
                "userId": turn.get("userId", ""),
                "problemId": turn.get("problemId", ""),
                "sessionId": session_id,
                "turnIndex": turn.get("turnIndex", ""),
                "traceId": turn.get("traceId", ""),
                "traceName": turn.get("traceName", ""),
                "startTime": turn.get("startTime", ""),
                "input": turn.get("input", ""),
                "intent_label": label,
                "label_reason": reason,
                "evidence": evidence,
                "current_turn_has_explicit_expression": str(bool(base_infos[idx]["has_intent"])),
            }
            unique_labeled.append(labeled)
            label_by_trace[turn["traceId"]] = labeled

    unique_labeled.sort(key=lambda row: (row["userId"], row["problemId"], row["sessionId"], int(row["turnIndex"] or 0)))

    unique_fields = [
        "userId",
        "problemId",
        "sessionId",
        "turnIndex",
        "traceId",
        "traceName",
        "startTime",
        "input",
        "intent_label",
        "label_reason",
        "evidence",
        "current_turn_has_explicit_expression",
    ]

    with UNIQUE_OUTPUT.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=unique_fields)
        writer.writeheader()
        writer.writerows(unique_labeled)

    full_fields = original_fields + [
        "is_user_prompt_turn",
        "intent_label",
        "label_reason",
        "evidence",
        "current_turn_has_explicit_expression",
    ]
    with FULL_OUTPUT.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=full_fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            out = dict(row)
            labeled = label_by_trace.get(row.get("traceId", ""))
            if is_turn_prompt(row):
                out["is_user_prompt_turn"] = "true"
                if labeled:
                    out["intent_label"] = labeled["intent_label"]
                    out["label_reason"] = labeled["label_reason"]
                    out["evidence"] = labeled["evidence"]
                    out["current_turn_has_explicit_expression"] = labeled["current_turn_has_explicit_expression"]
                else:
                    out["intent_label"] = NA_LABEL
                    out["label_reason"] = "중복/비SPAN 관찰 행이며 동일 traceId의 SPAN 턴이 없음"
                    out["evidence"] = evidence_snippet(row.get("input") or "")
                    out["current_turn_has_explicit_expression"] = ""
            else:
                out["is_user_prompt_turn"] = "false"
                out["intent_label"] = NA_LABEL
                out["label_reason"] = "채팅 프롬프트가 아닌 코드 실행/제출 이벤트"
                out["evidence"] = ""
                out["current_turn_has_explicit_expression"] = ""
            writer.writerow(out)

    counts = Counter(row["intent_label"] for row in unique_labeled)
    current_counts = Counter(row["current_turn_has_explicit_expression"] for row in unique_labeled)
    summary = {
        "input_path": str(INPUT_PATH),
        "total_original_rows": len(rows),
        "unique_user_prompt_turns": len(unique_labeled),
        "label_counts_unique_prompts": dict(counts),
        "current_explicit_expression_counts": dict(current_counts),
        "output_unique_prompts_csv": str(UNIQUE_OUTPUT.resolve()),
        "output_full_rows_csv": str(FULL_OUTPUT.resolve()),
    }
    SUMMARY_OUTPUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
