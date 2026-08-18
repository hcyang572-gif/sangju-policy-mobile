/* ═══════════════════════════════════════════════════════════════
   tap.js — 눌림 반응(파동) + 햅틱 진동
   ─────────────────────────────────────────────────────────────
   시안 A「감빛 온기」의 «.tap» 규약을 실제 앱에 옮긴 것.
     · 누를 수 있는 것을 누르면  ① 짧은 진동 12ms  ② 손가락 자리에 파동  ③ 살짝 어둡게
     · 파동은 body 위에 뜨는 «고정 레이어»라 누른 요소의 구조·레이아웃을 건드리지 않는다.
     · CSP 준수: 인라인 <script>·style= 을 쓰지 않는다. el.style.left(CSSOM)만 사용한다.
     · prefers-reduced-motion: reduce 이면 파동도 진동도 만들지 않는다(KWCAG 2.2).
     · app.js·apply_client.js·forms.js·proposals.js 의 동작에 전혀 관여하지 않는다.
       (이벤트를 가로채지 않도록 passive · capture 로 «듣기만» 한다)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // 누를 수 있다고 보는 것들 — 실제로 손가락이 닿는 대상
  var HIT =
    'button, [role="button"], a[href], summary, label[for], ' +
    ".card, .propose-card, .status-card, .big-btn, .chip, .situation";

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

  function ripple(x, y) {
    if (reduceMotion) return;
    var s = document.createElement("span");
    s.className = "tap-ripple";
    // CSSOM(el.style)은 CSP 의 style-src 대상이 아니다 — 인라인 style= 속성이 아님
    s.style.left = x + "px";
    s.style.top = y + "px";
    document.body.appendChild(s);
    window.setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 520);
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
    ripple(e.clientX, e.clientY);
    buzz();
  }

  // capture + passive: 앱의 클릭 처리보다 «먼저 듣기만» 하고 아무것도 막지 않는다
  var opt = { capture: true, passive: true };
  document.addEventListener("pointerdown", onDown, opt);
  document.addEventListener("pointerup", release, opt);
  document.addEventListener("pointercancel", release, opt);
  document.addEventListener("pointerleave", release, opt);
  window.addEventListener("blur", release);

  // 키보드로 누를 때(Enter·Space)도 같은 반응을 준다 — 파동은 요소 가운데에서
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    if (e.repeat) return;
    var el = findTarget(document.activeElement);
    if (!el) return;
    var r = el.getBoundingClientRect();
    ripple(r.left + r.width / 2, r.top + r.height / 2);
    buzz();
  });
})();
