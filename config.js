// 모바일 웹앱 설정값 (이 파일만 고치면 됨)
//
// WEB3FORMS_KEY: 「불편신고」를 담당 부서 메일로 보내는 폼메일 서비스(Web3Forms) 접속 키.
//   ⚠ 2026-08-24 양호창님 지시로 «사업신청 메일 발송은 완전히 없앴습니다».
//      신청 내용(이름·연락처)은 이 서비스로 «전송되지 않습니다» — 클라우드(Supabase)에만 저장됩니다.
//      이 키가 아직 필요한 이유는 «불편신고» 하나뿐입니다(시민이 앱 오류를 알리는 유일한 길).
//   · https://web3forms.com 에서 "Create your Access Key"에 팀 Gmail 주소
//     (email_config.txt 의 EMAIL 과 같은 주소)를 입력하면 메일로 키가 옵니다.
//   · 받은 키(예: a1b2c3d4-....)를 아래 따옴표 안에 붙여넣으세요.
//   · 이 키는 공개되어도 안전합니다(그 메일주소로 불편신고를 보내는 용도만).
window.WEB3FORMS_KEY = "b9e8dc17-a4a5-4a3e-b800-c8cbbdccb195";

// ── 정책참여(시민 제안) 기능용 Supabase 연결 ──────────────────────
// anon key 는 공개되어도 안전합니다(RLS 행 수준 보안으로 보호).
// 공무원앱(cloudui/config.js)과 같은 프로젝트·같은 값입니다.
window.SUPABASE_URL = "https://nalpuhtdruovzulcagtj.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hbHB1aHRkcnVvdnp1bGNhZ3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODk2MjIsImV4cCI6MjA5Nzc2NTYyMn0.hBALnDwobaCMlbaW-ANhG1Uwjf5eNcNxWed11b7mY2M";
