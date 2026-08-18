# 상주시 정책플랫폼 — 모바일 웹앱 (MVP)

PC 데스크톱 앱(V0.6.7)은 **그대로 두고**, 모바일/웹 접근성을 위한 **반응형 웹앱**을 별도로 추가한 것입니다.
서버 없이 동작하는 정적 페이지(HTML/CSS/JS)로, 시민이 폰 브라우저에서 사업을 **검색·맞춤추천·상세보기**하고
**신청은 이메일**(mailto)로 담당 부서에 보냅니다. (웹모바일 전환 로드맵의 **1단계 + 시민용 화면 선행 제작**)

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
- 신청이 **이메일**이라 실시간 접수대장 동기화는 아직 없음 → 로드맵 2단계(서버+DB)에서 해결.
- `FALLBACK_EMAIL`은 폐기됨(현재 모바일 코드에 없음). 담당자 이메일이 빈 사업은 PC의 `자동접수.py`가 `SUPPORT_EMAIL`(hcyang572@korea.kr)로 폴백 전달함.
