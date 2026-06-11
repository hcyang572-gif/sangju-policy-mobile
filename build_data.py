# -*- coding: utf-8 -*-
"""
엑셀(상주시 지원사업 목록.xlsx) → 모바일 웹앱용 data.json 변환 스크립트.

· PC 데스크톱 앱의 분류 규칙(config.POLICY_CATEGORIES, ALWAYS_SHOW_CATEGORIES)을
  그대로 재사용하여, 웹앱이 PC 앱과 '같은 카테고리'로 사업을 분류하도록 한다.
· 사업 데이터는 빌드 시점에 카테고리를 미리 계산해 각 사업에 categories 배열로 붙인다.
  (클라이언트는 키워드 매칭 없이 카테고리 키로만 필터링 → 단순/빠름)

실행:  py -3 build_data.py
결과:  ./data.json  (웹앱이 fetch 해서 사용)
"""
import os
import re
import sys
import json
import datetime

import pandas as pd

# 상위 폴더(PC 앱 소스)의 config.py 를 그대로 가져와 분류 규칙을 공유한다.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
EXCEL = os.path.join(os.path.dirname(HERE), "상주시 지원사업 목록.xlsx")
OUT = os.path.join(HERE, "data.json")


def _norm_name(s):
    return re.sub(r"\s+", "", str(s or "")).strip()


def _pid(r):
    p = str(r.get("정책번호", "")).strip()
    try:
        return int(float(p))
    except Exception:
        return -1


def dedupe_keep_latest(records):
    """같은 사업명이 여러 건이면 '가장 최신' 1건만 남긴다(PC 앱 _dedupe_keep_latest 동일 규칙)."""
    best = {}
    for i, r in enumerate(records):
        key = _norm_name(r.get("사업명", ""))
        if not key:
            continue
        score = (_pid(r), i)
        if key not in best or score > best[key][0]:
            best[key] = (score, r)
    seen, out = set(), []
    for r in records:
        key = _norm_name(r.get("사업명", ""))
        if not key:
            out.append(r)
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(best[key][1])
    return out


def categorize(record):
    """PC 앱 rebuild_categories_from_db 와 동일한 규칙으로 한 사업의 카테고리 키 목록을 만든다."""
    cats = []
    explicit = str(record.get("카테고리", "")).strip()
    if explicit and explicit.lower() != "nan":
        for c in explicit.split(","):
            c = c.strip()
            if c in config.POLICY_CATEGORIES and c not in cats:
                cats.append(c)
        if cats:
            return cats
    text = str(record.get("사업명", "")) + " " + str(record.get("대상자 상세기준", ""))
    for category, keywords in config.POLICY_CATEGORIES.items():
        if any(kw in text for kw in keywords):
            cats.append(category)
    return cats


def main():
    if not os.path.exists(EXCEL):
        print("[오류] 엑셀을 찾을 수 없습니다:", EXCEL)
        sys.exit(1)

    df = pd.read_excel(EXCEL).fillna("")
    records = dedupe_keep_latest(df.to_dict("records"))

    programs = []
    found = set()
    for r in records:
        cats = categorize(r)
        for c in cats:
            found.add(c)
        programs.append({
            "사업명": str(r.get("사업명", "")).strip(),
            "내용": str(r.get("내용", "")).strip(),
            "대상자상세기준": str(r.get("대상자 상세기준", "")).strip(),
            "이용방법": str(r.get("이용방법", "")).strip(),
            "필요서류": str(r.get("필요서류", "")).strip(),
            "기관명": str(r.get("기관명", "")).strip(),
            "팀명": str(r.get("팀명", "")).strip(),
            "연락처": str(r.get("연락처", "")).strip(),
            "담당자이메일": str(r.get("담당자 이메일", "")).strip(),
            "종료일": str(r.get("종료일", "")).strip(),
            "categories": cats,
        })

    # DB에 사업이 없어도 항상 보여줄 카테고리(PC 앱과 동일)
    for c in getattr(config, "ALWAYS_SHOW_CATEGORIES", []):
        if c in config.POLICY_CATEGORIES:
            found.add(c)

    def sort_key(s):
        return re.sub(r"[^가-힣A-Za-z0-9]", "", s)

    categories = sorted(found, key=sort_key)

    # 맞춤추천 규칙(PC 앱 recommend_view 와 동일) — 클라이언트가 그대로 사용
    situation_map = [
        ["임신 중이거나 출산 예정", "👶 임신·출산"],
        ["영유아·미취학 아동 자녀가 있음", "🧸 영유아·보육"],
        ["초·중·고 학생 자녀가 있음", "🎒 청소년·교육"],
        ["자녀가 2명 이상(다자녀 가구)", "👨‍👩‍👧‍👦 다자녀·가족"],
        ["한부모·조손 가정", "👩‍👦 한부모·조손"],
        ["1인 가구", "👤 1인가구"],
        ["다문화·외국인 가정", "🌏 다문화·외국인"],
        ["가구원 중 장애가 있음", "♿ 장애인"],
        ["기초생활수급·차상위·저소득", "💰 저소득·기초수급"],
        ["농업·축산·임업 종사", "🌾 농림축수산업"],
        ["귀농·귀촌 (예정 또는 정착)", "🏡 귀농·귀촌"],
        ["소상공인·창업 준비 중", "🏪 소상공인·기업"],
        ["구직 중·취업 준비 중", "💼 일자리·구직"],
        ["무주택·주거 지원이 필요", "🏠 주거·부동산"],
        ["국가유공자·보훈 대상", "🎖️ 보훈·유공자"],
        ["여성(경력단절 등)", "👩 여성"],
        ["건강·의료 지원이 필요", "🏥 건강·의료"],
    ]

    out = {
        "generated": datetime.date.today().isoformat(),
        "categories": categories,
        "always_show": list(getattr(config, "ALWAYS_SHOW_CATEGORIES", [])),
        "situation_map": situation_map,
        "programs": programs,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"[완료] {len(programs)}개 사업, {len(categories)}개 카테고리 → {OUT}")


if __name__ == "__main__":
    main()
