# -*- coding: utf-8 -*-
"""
엑셀(상주시 지원사업 목록.xlsx) → 모바일 웹앱용 data.json 변환 스크립트.

· PC 데스크톱 앱의 분류 규칙(config.POLICY_CATEGORIES, ALWAYS_SHOW_CATEGORIES)을
  그대로 재사용하여, 웹앱이 PC 앱과 '같은 카테고리'로 사업을 분류하도록 한다.
· 사업 데이터는 빌드 시점에 카테고리를 미리 계산해 각 사업에 categories 배열로 붙인다.
  (클라이언트는 키워드 매칭 없이 카테고리 키로만 필터링 → 단순/빠름)

실행:  py -3 build_data.py
결과:  ./data.json  (웹앱이 fetch 해서 사용 — «단일 출처»)
       ./data.js    (같은 원본에서 나온 «사본». window.__SANGJU_DATA__ 로 실어 둔다)

⚠ data.js 를 두는 이유 (2026-08-21):
  공무원 행정망(업무망) 프록시가 «.json 요청»을 막는 사례가 있다. 그러면 HTML·CSS·JS 는
  다 내려오는데 data.json 만 실패해 「사업 정보를 준비 중입니다」 화면만 뜬다.
  그래서 app.js 는 fetch("data.json") 이 실패하면 <script src="data.js"> 를 끼워 넣어
  같은 내용을 읽는다. data.js 는 «따로 관리하는 데이터가 아니다» — 아래에서 data.json 과
  «같은 순간·같은 out 객체»로 함께 쓰므로 절대 갈라지지 않는다. 손으로 고치지 마세요.
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
APP_ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "data.json")


def _write_json_pair(json_path, data):
    """data.json 과 «짝» data.js 를 같은 내용으로 함께 쓴다.

    돌려주는 값은 (json_path, js_path). js_path 는 json_path 의 확장자만 .js 로 바꾼 것.
    ⚠ 두 파일은 반드시 «한 자리»에서 함께 써야 한다 — 따로 쓰면 갱신 시점이 갈린다.
    """
    js_path = os.path.splitext(json_path)[0] + ".js"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(js_path, "w", encoding="utf-8") as f:
        # 자동 생성물 — 손으로 고치지 말라는 표시를 파일 안에도 남긴다.
        f.write("/* 자동 생성 — build_data.py. data.json 과 «같은 내용»입니다. 손으로 고치지 마세요. */\n")
        f.write("window.__SANGJU_DATA__ = ")
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    return json_path, js_path


def _excel_path():
    """빌드에 쓸 엑셀 경로.
    순서 ① PC 앱이 마지막으로 연동한 DB(last_excel_path.txt)
         ② 기준 엑셀(config.BASELINE_DB_FILE) ③ 상위 폴더의 기본 파일.
    → PC앱·자동배포·클라우드 동기화가 모두 «같은 DB» 를 보도록 맞춘다."""
    try:
        cfg = os.path.join(APP_ROOT, "last_excel_path.txt")
        if os.path.exists(cfg):
            with open(cfg, encoding="utf-8") as f:
                p = f.read().strip()
            if p and os.path.exists(p) and p.lower().endswith((".xlsx", ".xls", ".csv")):
                return p
    except Exception:
        pass
    base = getattr(config, "BASELINE_DB_FILE", "")
    if base and os.path.exists(base):
        return base
    return os.path.join(APP_ROOT, "상주시 지원사업 목록.xlsx")


EXCEL = _excel_path()


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


# ── 표시 텍스트 정돈 — «URL 은 살린다» ────────────────────────────────────
# ⚠ config.clean_text 는 공백 정돈에 더해 «본문 속 URL 까지 지운다». 그 규칙은 구
#   customtkinter 앱(data_io.py)이 아직 쓰므로 함수 자체는 건드리지 않는다.
#   시민앱은 «웹»이라 URL 이 곧 신청하러 가는 문이다. 지우면 정보가 사라질 뿐 아니라
#   「정부24(https://www.gov.kr) 접수」가 「정부24( 접수」로 남아 문장이 깨진다.
#   → 빌드는 config.tidy_text 를 쓴다(URL 은 살리고 공백·빈 줄만 정돈 + 고아 괄호 치유).
#     화면에서 안전한 링크로 바꾸는 일은 app.js 의 linkifyHtml() 이 맡는다.
#   ★ 정돈 규칙은 «config.py 단일 출처». 여기에 사본을 두지 않는다(2026-08-04 검수 반영).
#     브라우저에서 도는 app.js 의 tidyText()/healOrphanParens() 만 불가피한 사본이며,
#     config.py 를 고치면 app.js 도 같이 고쳐야 한다(세 경로가 같은 화면을 내야 한다).
tidy_text = config.tidy_text


# ═══════════════════════════════════════════════════════════════════════════
#  📑 C-05 · 장황한 「내용」·「이용방법」을 «파생 필드»로 갈라 준다 (2026-08-24)
# ═══════════════════════════════════════════════════════════════════════════
#
#  ⭐ 왜 «파생»인가 — 원본을 절대 건드리지 않는다
#     엑셀의 「내용」·「이용방법」은 상주시 홈페이지 연동(web_import)이 **덮어쓴다.**
#     엑셀을 쪼개 놓으면 다음 연동에서 원상복구되고, 그 사이 담당자가 손댄 것도 함께 날아간다.
#     그래서 «읽어서 갈라 붙이는» 일은 오직 이 빌드 시점에만 한다.
#     → data.json 의 「내용」·「이용방법」은 **원문 그대로 남는다.** 아래 필드가 «덧붙는다».
#
#  만들어지는 파생 필드 (없으면 "" 또는 [] — 화면은 «있을 때만» 그리면 된다)
#    · 내용본문     : 「내용」에서 아래 꼬리들을 떼어낸 나머지 (= 실제 지원 내용)
#    · 이용방법본문 : 「이용방법」에서 「신청기간:」 머리줄과 「자세히 보기: URL」 줄을 떼어낸 나머지
#    · 신청기간     : 언제 신청하는가            (「내용」의 «/ 신청기한:» 꼬리 우선, 없으면 「이용방법」의 «신청기간:» 줄)
#    · 지원기간     : 지원이 얼마나 계속되는가   (「내용」의 «/ 지원기간:» 꼬리)
#    · 유의사항     : ※ 로 시작하는 안내 «목록»  (list[str])
#    · 상세링크     : 상주시 홈페이지 원문 주소  (「이용방법」의 «자세히 보기:» 줄)
#
#  ⚠ 규칙으로 못 가르는 것은 «건드리지 않는다». 억지로 자르면 문장이 깨진다.
#    - ※ 가 «괄호 안»에 있으면 문장의 일부다(예: 「월 최대 20만원(※ 관내 졸업자 40만원)」) → 자르지 않는다.
#    - ※ 뒤가 너무 길면(_NOTE_MAX_LEN 초과) 안내가 아니라 본문이다 → 자르지 않는다.
#    - 「/」 로 나뉜 조각에 아래 머리말이 없으면 본문이다 → 그대로 둔다.

# 「/」 조각·줄머리에서 «신청 시기»로 인정할 머리말
_HEAD_APPLY = ("신청기한", "신청기간", "신청시기", "접수기간", "접수기한", "신청일정")
# 「/」 조각에서 «지원 지속기간»으로 인정할 머리말
_HEAD_PERIOD = ("지원기간", "지급기간")

# 앞에 붙는 머리표(- · ○ ▶ …)는 무시하고 머리말을 알아본다.
#   실제 자료에 「- 신청기간 : 상시접수」처럼 머리표를 달고 오는 줄이 있다.
_BULLET = r"[\-·ㆍ○●▶◇◆*]?\s*"
_RE_APPLY = re.compile(r"^\s*%s(?:%s)\s*[:：]\s*(.+)$" % (_BULLET, "|".join(_HEAD_APPLY)), re.S)
_RE_PERIOD = re.compile(r"^\s*%s(?:%s)\s*[:：]\s*(.+)$" % (_BULLET, "|".join(_HEAD_PERIOD)), re.S)
_RE_MORE = re.compile(r"^\s*자세히\s*보기\s*[:：]\s*(\S+)\s*$")
_RE_HOWTO = re.compile(r"\s*[-·]?\s*신청\s*방법\s*[:：]\s*")

# 머리말 없이 「/」 뒤에 붙은 짧은 «신청 안내»(예: 「매년 연초 신청」·「연중 신청 가능」)
_SHORT_APPLY_MAX = 20
# ※ 뒤 안내가 이보다 길면 «안내»가 아니라 본문으로 본다(잘라 내면 정보가 사라진다)
_NOTE_MAX_LEN = 150


def _cut_note(seg):
    """한 조각 → (※ 앞 본문, ※ 안내 목록).

    ※ 가 «괄호 밖»에 있을 때만 자른다. 괄호 안 ※ 는 문장의 일부다."""
    depth = 0
    for i, ch in enumerate(seg):
        if ch in "([{（〔":
            depth += 1
        elif ch in ")]}）〕":
            depth = max(0, depth - 1)
        elif ch == "※" and depth == 0:
            tail = seg[i + 1:].strip()
            if not tail or len(tail) > _NOTE_MAX_LEN:
                break                       # 안내로 보기엔 너무 길다 → 자르지 않는다
            head, rest = seg[:i].rstrip(), tail
            # ※ 가 여러 개 이어 붙은 경우까지 훑는다
            notes = []
            for part in rest.split("※"):
                part = part.strip()
                if part:
                    notes.append(part)
            return head, notes
    return seg, []


def _parse_content(text):
    """「내용」 → (본문, 신청기간 목록, 지원기간 목록, 유의사항 목록)."""
    body, apply_at, period, notes = [], [], [], []
    for line in str(text or "").split("\n"):
        keep = []
        for seg in line.split(" / "):
            m = _RE_APPLY.match(seg)
            if m:
                v, nt = _cut_note(m.group(1).strip())
                if v:
                    apply_at.append(v)
                notes.extend(nt)
                continue
            m = _RE_PERIOD.match(seg)
            if m:
                v, nt = _cut_note(m.group(1).strip())
                if v:
                    period.append(v)
                notes.extend(nt)
                continue
            head, nt = _cut_note(seg)
            notes.extend(nt)
            head = head.strip()
            if not head:
                continue
            # 머리말 없는 짧은 신청 안내(「매년 연초 신청」 등)
            if keep and len(head) <= _SHORT_APPLY_MAX and "신청" in head:
                apply_at.append(head)
                continue
            keep.append(head)
        if keep:
            body.append(" / ".join(keep))
    return "\n".join(body).strip(), apply_at, period, notes


def _parse_howto(text):
    """「이용방법」 → (본문, 신청기간 목록, 상세링크)."""
    body, apply_at, link = [], [], ""
    for line in str(text or "").split("\n"):
        m = _RE_MORE.match(line)
        if m:                                   # 「자세히 보기: https://…」 줄
            link = link or m.group(1)
            continue
        m = _RE_APPLY.match(line)
        if m:
            v = m.group(1).strip()
            # 「신청기간: 상시접수 - 신청방법 : 읍면동…」처럼 한 줄에 붙어 온 경우 갈라 둔다
            parts = _RE_HOWTO.split(v, maxsplit=1)
            if parts[0].strip():
                apply_at.append(parts[0].strip())
            if len(parts) > 1 and parts[1].strip():
                body.append(parts[1].strip())
            continue
        if line.strip():
            body.append(line.rstrip())
    return "\n".join(body).strip(), apply_at, link


def _uniq(seq):
    out = []
    for s in seq:
        s = str(s or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def derive_fields(content, howto):
    """「내용」·「이용방법」 원문 → 파생 필드 dict. 원문은 건드리지 않는다."""
    c_body, c_apply, c_period, c_notes = _parse_content(content)
    h_body, h_apply, link = _parse_howto(howto)
    # 신청기간은 「내용」 쪽이 더 구체적이다(「2026.3.3.~12.14.」). 없을 때만 「이용방법」 값을 쓴다.
    apply_at = _uniq(c_apply) or _uniq(h_apply)
    return {
        "내용본문": c_body,
        "이용방법본문": h_body,
        "신청기간": " / ".join(apply_at),
        "지원기간": " / ".join(_uniq(c_period)),
        "유의사항": _uniq(c_notes),
        "상세링크": link,
    }


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

    # 🔒 분류 규칙 자기점검 — «분야가 실제로 다시 계산되는» 이 자리가 잡아낼 마지막 기회다.
    #    (예: 💍 결혼·신혼부부에 맨 '결혼'을 넣으면 다문화 사업이 딸려 온다 — config 주석 참조)
    for _p in getattr(config, "verify_category_rules", lambda: [])():
        print("[⚠ 분류규칙 경고]", _p)

    if EXCEL.lower().endswith(".csv"):
        try:
            df = pd.read_csv(EXCEL, encoding="utf-8-sig").fillna("")
        except Exception:
            df = pd.read_csv(EXCEL, encoding="cp949").fillna("")
    else:
        df = pd.read_excel(EXCEL).fillna("")
    records = dedupe_keep_latest(df.to_dict("records"))

    programs = []
    found = set()
    for r in records:
        # 카테고리: 공유 보정 규칙(보정맵→명시→키워드) 사용
        cats = config.categories_for_record(r)
        for c in cats:
            found.add(c)
        # ⚠ config.clean_text 가 아니라 tidy_text — 본문 속 신청 URL 을 살린다(위 주석 참조)
        _content = tidy_text(r.get("내용", ""))
        _howto = tidy_text(r.get("이용방법", ""))
        programs.append({
            "사업명": str(r.get("사업명", "")).strip(),
            "내용": _content,
            "대상자상세기준": tidy_text(r.get("대상자 상세기준", "")),
            "이용방법": _howto,
            "필요서류": tidy_text(r.get("필요서류", "")),
            "기관명": str(r.get("기관명", "")).strip(),
            "팀명": str(r.get("팀명", "")).strip(),
            "연락처": str(r.get("연락처", "")).strip(),
            "담당자이메일": str(r.get("담당자 이메일", "")).strip(),
            # 종료일: 신규 DB에는 열이 없을 수 있다(없으면 "" → 화면에서 렌더 생략).
            "종료일": str(r.get("종료일", "")).strip(),
            # 비고: 접수 마감/재접수 시기 등 시민에게 반드시 보여야 할 안내(📌 접수 안내)
            # ⚠ «※[내부]» 로 시작하는 줄은 담당자끼리 남긴 내부 메모라 시민에게 내보내지 않는다.
            #   (규칙·함수는 config.py 단일 출처 — config.strip_internal_notes 주석 참조)
            "비고": config.strip_internal_notes(tidy_text(r.get("비고", ""))),
            "categories": cats,
            # 📑 C-05 파생 필드 — 원문(내용·이용방법)은 위에 그대로 두고 «덧붙인다».
            #    화면은 값이 있을 때만 그리면 된다(빈 문자열/빈 배열이면 없는 것).
            **derive_fields(_content, _howto),
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
        # 2026-08-24 (C-13 승인) — 「결혼」이 빠져 있었다. 상주시 인구정책의 축이
        #   «결혼 → 출산 → 양육»인데 상황 목록은 임신부터 시작해, 결혼을 앞둔 시민이
        #   맞춤추천으로는 결혼장려금·신혼부부 주거지원을 만날 길이 없었다.
        #   ⚠ 순서상 «임신·출산 앞»에 둔다(사람의 생애 순서를 따른다).
        #   ⚠ PC앱 recommend_view.py·data_service.py 에 같은 표의 «사본»이 있다 —
        #     그쪽은 🟠단장·🔵손길 몫이라 여기서 건드리지 않았다(C-13 파급 목록 참조).
        ["결혼 예정이거나 신혼(혼인 7년 이내)", "💍 결혼·신혼부부"],
        ["임신 중이거나 출산 예정", "👶 임신·출산"],
        ["영유아·미취학 아동 자녀가 있음", "🧸 영유아·보육"],
        ["초·중·고 학생 자녀가 있음", "📚 청소년·교육"],
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
        # 2026-08-24 (C-13 승인) — 🚚 전입·정착 신설에 맞춰 추가.
        ["상주시로 이사 왔거나 이사 예정", "🚚 전입·정착"],
        ["국가유공자·보훈 대상", "🎖️ 보훈·유공자"],
        # 2026-08-24 (C-13) — 라벨을 「경력단절 등」에서 바꿨다. 새 기준으로 👩 여성은
        #   «수혜자가 여성 본인»인 16건(산전·산후, 난임, 생리용품 등)인데, 정작
        #   «경력단절» 사업은 이 DB에 0건이라 라벨이 없는 것을 가리키고 있었다.
        ["여성(여성 건강·임신·출산 등)", "👩 여성"],
        ["건강·의료 지원이 필요", "🏥 건강·의료"],
    ]

    out = {
        "generated": datetime.date.today().isoformat(),
        "categories": categories,
        "always_show": list(getattr(config, "ALWAYS_SHOW_CATEGORIES", [])),
        "situation_map": situation_map,
        # 🏙 읍·면·동(행정구역) — 시민앱·공무원앱의 «선택칸» 이 이 값을 그대로 쓴다.
        #    ★ JS 쪽에 목록을 «복사해 두지 않는다». config.SANGJU_REGIONS 가 유일한 출처이고,
        #      브라우저는 이 data.json 을 통해서만 그 목록을 받는다.
        #      (행정구역이 바뀌면 config 만 고치고 재빌드하면 세 앱이 함께 바뀐다)
        #    regions        : 표준 순서(읍 → 면 → 동 → 기타·타지역)로 늘어놓은 평면 목록
        #    region_groups  : 화면에서 묶음(optgroup)으로 보여 줄 때 쓰는 [묶음이름, [지역…]]
        #    region_etc     : 「기타·타지역」 값 자체(타지역 신청자를 막지 않기 위해 필수)
        #    ⭐ 아래 세 표는 «화면의 정규화가 파이썬과 똑같이 동작하게» 하려고 싣는다
        #      (2026-08-20, 공무원앱 담당 요청). 이것이 없으면 화면이 파이썬보다 좁게
        #      알아본다 — 실제로 「사벌면」·「낙양동」이 화면에서만 «미기재» 로 떨어졌다.
        #      옛 자유입력 값이 남아 있는 정책제안에서 특히 차이가 크다.
        #    region_aliases    : 옛 이름·오타 → 정식 이름   (사벌면 → 사벌국면)
        #    region_legal_dong : 법정동 36개 → 행정동 6개   (낙양동 → 남원동)
        #    region_etc_words  : 「기타·타지역」으로 모을 낱말 (관외·타지역 …)
        #    ⚠ JS 는 이 표들을 «그대로» 쓰기만 한다. 값을 베껴 적지 말 것.
        "regions": list(getattr(config, "SANGJU_REGIONS", [])),
        "region_groups": [[g, list(v)] for g, v in
                          getattr(config, "SANGJU_REGION_GROUPS", [])],
        "region_etc": getattr(config, "SANGJU_REGION_ETC", ""),
        "region_aliases": dict(getattr(config, "SANGJU_REGION_ALIASES", {})),
        "region_legal_dong": dict(getattr(config, "SANGJU_LEGAL_DONG", {})),
        "region_etc_words": list(getattr(config, "SANGJU_REGION_ETC_WORDS", [])),
        "programs": programs,
    }

    _, out_js = _write_json_pair(OUT, out)
    print(f"[완료] 행정망 대비 사본 → {out_js}")

    # ── 공무원앱(cloudui)에도 «같은 파일»을 둔다 (2026-08-20) ──────────────────────
    #   왜: 공무원앱의 「읍·면·동별 신청 현황」 차트도 regions / region_groups / region_etc
    #       를 읽어야 한다. 위 196행 규약 그대로 «브라우저는 data.json 을 통해서만» 받는다
    #       — 25개 이름을 JS 에 베껴 적으면 셋(엑셀·시민앱·공무원앱)이 언젠가 어긋난다.
    #   ⚠ 공무원앱은 사업 목록을 Supabase 에서 받으므로 programs 부분은 «쓰지 않는다».
    #      그래도 파일을 쪼개지 않고 통째로 두는 이유는 «출처가 하나»여야 하기 때문이다
    #      (쪼개는 순간 두 파일의 갱신 시점이 달라진다).
    #   ⚠ 배포.py 의 공무원앱 항목은 "데이터빌드": None 이라 스스로 만들지 못한다.
    #      그래서 시민앱을 빌드하는 «이 자리»에서 함께 써 둔다. 지우지 마세요.
    admin_out = os.path.join(os.path.dirname(HERE), "cloudui", "data.json")
    try:
        if os.path.isdir(os.path.dirname(admin_out)):
            _write_json_pair(admin_out, out)
            print(f"[완료] 공무원앱에도 같은 data.json/data.js 복사 → {admin_out}")
        else:
            print("[건너뜀] cloudui 폴더가 없어 공무원앱 data.json 은 만들지 않았습니다.")
    except OSError as e:
        # 데이터 빌드 자체를 멈추지는 않는다 — 시민앱 배포가 이것 때문에 막히면 안 된다.
        print(f"[경고] 공무원앱 data.json 을 쓰지 못했습니다: {e}")

    n_note = sum(1 for p in programs if p.get("비고"))
    n_end = sum(1 for p in programs if p.get("종료일"))
    # 신청 URL 보존 검증 — 0 이면 어딘가에서 다시 URL 을 지우고 있다는 신호다.
    url_re = re.compile(r"https?://")
    n_url = sum(len(url_re.findall(" ".join(
        str(p.get(k, "")) for k in ("내용", "대상자상세기준", "이용방법", "필요서류", "비고"))))
        for p in programs)
    print(f"[완료] {len(programs)}개 사업, {len(categories)}개 카테고리 → {OUT}")
    print(f"       비고(접수 안내) 있는 사업 {n_note}건 / 종료일 있는 사업 {n_end}건")
    # 📑 C-05 파생 필드가 몇 건에 붙었는지 — 0 이 되면 파싱 규칙이 죽었다는 신호다.
    print("       파생: 신청기간 %d · 지원기간 %d · 유의사항 %d · 상세링크 %d건"
          % (sum(1 for p in programs if p.get("신청기간")),
             sum(1 for p in programs if p.get("지원기간")),
             sum(1 for p in programs if p.get("유의사항")),
             sum(1 for p in programs if p.get("상세링크"))))
    print(f"       본문 속 신청 URL {n_url}개 보존(화면에서 링크로 표시)")


if __name__ == "__main__":
    main()
