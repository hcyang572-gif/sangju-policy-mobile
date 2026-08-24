# 상주시 정책플랫폼 — 모바일 웹앱 (MVP)

PC 데스크톱 앱(V0.6.7)은 **그대로 두고**, 모바일/웹 접근성을 위한 **반응형 웹앱**을 별도로 추가한 것입니다.
서버 없이 동작하는 정적 페이지(HTML/CSS/JS)로, 시민이 폰 브라우저에서 사업을 **검색·맞춤추천·상세보기**하고
**신청은 클라우드(Supabase)에 바로 저장**되어 공무원 화면에 즉시 나타납니다. 「불편신고·오류문의」만 폼메일(Web3Forms)로 팀 메일함에 전달됩니다.
(2026-08-24 「사업신청 → 담당자 메일」 기능이 완전히 제거되었습니다. 신청에는 메일이 전혀 관여하지 않습니다.)

## 구성
- `index.html` / `style.css` / `app.js` — 웹앱 본체 (상주 곶감 테마)
- `build_data.py` — 엑셀 → `data.json` 변환 (PC 앱 `config.py` 분류 규칙 재사용)
- `data.json` — 빌드 산출물 (사업 72건 + 카테고리 + 맞춤추천 규칙)

## 데이터 갱신 방법
PC 앱의 `상주시 지원사업 목록.xlsx`가 바뀌면, 모바일웹 폴더에서 아래를 실행해 `data.json`을 다시 만듭니다.
```
py -3 build_data.py
```

## 로컬에서 미리보기
파일을 직접 열면(`file://`) `data.json` 로딩이 막히므로, 간단한 서버로 띄웁니다.
```
py -3 -m http.server 5180
```
그 후 브라우저에서 http://localhost:5180 접속.

## 재사용한 PC 앱 자산
- 분류: `config.POLICY_CATEGORIES`, `config.ALWAYS_SHOW_CATEGORIES`
- 중복정리: `data_io._dedupe_keep_latest` 규칙
- 맞춤추천: `recommend_view.SITUATION_MAP`, 나이→연령 카테고리 규칙

## 한계 / 다음 단계
- 신청 실시간 동기화는 로드맵 2단계(클라우드 DB)로 **해결되었습니다** — Supabase `applications` 테이블이 정본이고, 공무원앱·PC 관리앱이 이를 함께 봅니다.
- ⚠ 신청은 **받쳐 주는 통로가 없습니다.** 예전에는 메일이 백업 경로였지만 2026-08-24 에 없앴습니다. Supabase 저장이 실패하면 신청은 접수되지 않으므로, `submitApplication` 의 오류를 삼키지 마십시오.
- `FALLBACK_EMAIL`은 폐기됨(현재 모바일 코드에 없음). 「오류·문의」는 담당자 주소(`SUPPORT_EMAIL`)로 `자동접수.py`가 전달합니다 — 신청과는 무관한 경로입니다.
