/* ═══════════════════════════════════════════════════════════════
   tap.js — 눌림 반응(햅틱 진동 + 살짝 어둡게)
   ─────────────────────────────────────────────────────────────
   시안 A「감빛 온기」의 «.tap» 규약을 실제 앱에 옮긴 것.
     · 누를 수 있는 것을 누르면  ① 짧은 진동 12ms  ② 살짝 어둡게(.is-pressed)
     · CSP 준수: 인라인 <script>·style= 을 쓰지 않는다.
     · prefers-reduced-motion: reduce 이면 진동도 만들지 않는다(KWCAG 2.2).
     · app.js·apply_client.js·forms.js·proposals.js 의 동작에 전혀 관여하지 않는다.
       (이벤트를 가로채지 않도록 passive · capture 로 «듣기만» 한다)

   ⛔ 2026-08-20 양호창님 지시 — «손가락 자리에 물방울처럼 퍼지는 파동»(ripple)은
      3개 앱에서 모두 제거했다. 되살리지 말 것.
      함께 걷어낸 것: ripple() 함수 · 그 두 호출 자리 ·
        style.css 의 .tap-ripple / @keyframes tapRipple ·
        prefers-reduced-motion 블록의 .tap-ripple 줄.
      ⚠ 남긴 것(①진동 ②.is-pressed)은 «누를 수 있는 것을 눌렀다»는 되먹임이라
        없애면 «반응이 없는 앱»이 된다. 파동만 지우고 이 둘은 반드시 남긴다.
      ⚠ 파동은 body 위에 얹는 position:fixed 레이어였다 —
        어떤 컨테이너에도 overflow:hidden 을 걸지 않았으므로
        지우면서 되돌릴 여백·잘림 설정이 «없다»(초점 링에 영향 없음).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // 누를 수 있다고 보는 것들 — 실제로 손가락이 닿는 대상
  /* ⛔ 2026-08-25 — 목록에서 «.propose-card» 하나만 걷어냈다.
       이 앱의 .js·.html 어디에도 class="propose-card" 를 붙이는 곳이 없다(전수 확인).
       정책제안으로 들어가는 자리는 지금 .card / .big-btn 이 맡고 있어, 그 둘이
       이미 이 목록에 들어 있다 — 손이 닿는 자리는 한 곳도 줄지 않았다.
     ⚠ 다른 이름은 하나도 건드리지 않았다. 목록에서 이름이 빠지면 그 자리는
       «눌러도 아무 반응이 없는» 자리가 된다(진동·눌림 표시가 사라진다).
     ⚠ style.css 의 .propose-card 계열 규칙은 «그대로 두었다» — 그것은 .card·
       .status-card 와 «한 선택자 줄»에 섞여 있어, 이름만 뽑아내다 살아 있는
       카드 모양을 무너뜨릴 위험이 실제로 있었다(2026-08-25 시정구호 사고와 같은 결). */
  var HIT =
    'button, [role="button"], a[href], summary, label[for], ' +
    ".card, .status-card, .big-btn, .chip, .situation";

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.addEventListener) {
      mq.addEventListener("change", function (e) { reduceMotion = e.matches; });
    }
  } catch (e) { /* matchMedia 없는 환경 — 그냥 켠 상태로 둔다 */ }

  var pressed = null;   // 지금 눌려 있는 요소

  function findTarget(node) {
    if (!node || !node.closest) return null;
    var el = node.closest(HIT);
    if (!el) return null;
    if (el.disabled) return null;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return null;
    return el;
  }

  function buzz() {
    if (reduceMotion) return;
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (e) { /* 진동을 막아 둔 기기 — 무시 */ }
  }

  function release() {
    if (pressed) {
      pressed.classList.remove("is-pressed");
      pressed = null;
    }
  }

  function onDown(e) {
    // 마우스는 «주 버튼(왼쪽)»만
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var el = findTarget(e.target);
    if (!el) return;
    release();
    pressed = el;
    el.classList.add("is-pressed");
    buzz();
  }

  // capture + passive: 앱의 클릭 처리보다 «먼저 듣기만» 하고 아무것도 막지 않는다
  var opt = { capture: true, passive: true };
  document.addEventListener("pointerdown", onDown, opt);
  document.addEventListener("pointerup", release, opt);
  document.addEventListener("pointercancel", release, opt);
  document.addEventListener("pointerleave", release, opt);
  window.addEventListener("blur", release);

  // 키보드로 누를 때(Enter·Space)도 같은 되먹임을 준다
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    if (e.repeat) return;
    var el = findTarget(document.activeElement);
    if (!el) return;
    buzz();
  });
})();
