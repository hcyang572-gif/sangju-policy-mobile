# -*- coding: utf-8 -*-
"""
⛔ 폐기(2026-08-24). 아이콘은 루트 `mkicons.py` 로만 만든다.
   · 이 생성기는 «상상주도가 아닌, 직접 그린 말풍선» 을 그렸다 — 그래서 PC앱과 디자인 언어가 달랐다.
   · 2026-08-24 양호창님이 «A안»(크림 바탕 + 원색 상상주도 로고 + 아래 색 띠 + 문구)을 확정하면서
     3앱을 «한 벌»로 뽑는 루트 `mkicons.py` 로 일원화했다.
   · 새로 뽑을 때:  py -3 mkicons.py --out <앱폴더> --scheme 2 --kind <citizen|admin> --pwa
   · 지우지 않고 남겨 둔 이유 — 왜 없앴는지 모르면 누군가 다시 만든다.

──────────────── 아래는 옛 문서(참고용) ────────────────
시민앱(모바일웹) PWA 아이콘 생성기 — 확정 도안 「ICON:CITIZEN」(감빛 #B84A1C).

공무원앱 cloudui/make_icons.py 와 «같은 도안·같은 배치»를 쓰고 색과 역할 라벨만 다르다.
  · 공무원용: 청록 #0E7C86 + 「공무원용」
  · 시민용  : 감빛 #B84A1C + 「시민용」      ← 이 파일
두 앱을 같은 폰에 나란히 깔았을 때 «형제»로 보이면서도 색으로 즉시 구분된다.

만드는 파일 (⚠ 파일명에 «-v2»)
  · icon-192-v2.png            192x192  작게 보이므로 «말풍선 + 시민용» 만
  · icon-512-v2.png            512x512  완성형(앱 이름까지)
  · icon-maskable-512-v2.png   512x512  안드로이드 «잘리는» 아이콘용
        (원형으로 잘려도 살아남도록 그림을 안전영역(가운데 80%) 안으로 줄이고 바탕을 꽉 채운다)

⚠⚠ 왜 파일명에 «-v2» 를 붙였나 (2026-08-19)
    설치 아이콘은 파일명이 같으면 브라우저·안드로이드 런처가 «옛 이미지»를 계속 쓴다.
    서비스워커 캐시를 비워도, 이미 홈 화면에 박힌 그림은 그것만으로 바뀌지 않는다.
    → 도안을 새로 만들 때는 «이름을 바꾼다». 그래야 브라우저가 새 파일로 인식한다.
    이름을 바꿨으면 다음 세 곳을 «모두» 함께 고칠 것(하나만 빠져도 옛 아이콘이 남는다):
      ① manifest.json  icons[]           ② index.html  apple-touch-icon · icon
      ③ sw.js          OPTIONAL 프리캐시 목록

실행:  py -3 make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = HERE                       # 시민앱은 아이콘을 앱 루트에 둔다(공무원앱은 assets/)

SS = 4                       # 4배로 그린 뒤 줄여서 계단현상을 없앤다(수퍼샘플링)
BASE = (184, 74, 28)         # #B84A1C  상주 곶감 감빛 — 시민용 정체성(테마색과 동일)
DARK = (138, 53, 18)         # #8A3512  그라데이션 아래쪽
WHITE = (255, 255, 255)

FONT_B = "C:/Windows/Fonts/malgunbd.ttf"     # 맑은 고딕 Bold


def font(px):
    try:
        return ImageFont.truetype(FONT_B, int(px))
    except Exception:
        return ImageFont.load_default()


# ── 512 좌표계 기준 심볼 배치 (공무원앱과 «같은 값» — 형제로 보이게) ────
SYM_512 = dict(bx=140, by=70, bw=232, bh=164, brx=56,
               tail=[(190, 198), (240, 198), (184, 282)],
               bars=[(172, 106, 118, 24, 12), (172, 144, 168, 24, 12), (172, 182, 92, 24, 12)])
SYM_128 = dict(bx=112, by=72, bw=288, bh=206, brx=72,
               tail=[(176, 238), (240, 238), (168, 338)],
               bars=[(152, 116, 150, 30, 15), (152, 166, 206, 30, 15), (152, 216, 106, 30, 15)])


def _grad_plate(size, radius, border=True):
    """라운드 사각 바탕 — 세로 그라데이션 + 위쪽 흰 광택 + 안쪽 흰 테두리."""
    grad = Image.new("RGB", (1, size))
    gp = grad.load()
    for y in range(size):
        t = y / max(1, size - 1)
        gp[0, y] = tuple(int(BASE[i] + (DARK[i] - BASE[i]) * t) for i in range(3))
    grad = grad.resize((size, size), Image.BILINEAR).convert("RGBA")

    # 위쪽 흰 광택 (0% 지점 20% → 55% 지점 0%)
    sheen = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    sp = sheen.load()
    stop = int(size * 0.55)
    for y in range(stop):
        a = int(255 * 0.20 * (1 - y / max(1, stop)))
        for x in range(size):
            sp[x, y] = (255, 255, 255, a)
    grad = Image.alpha_composite(grad, sheen)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate.paste(grad, (0, 0), mask)

    # 안쪽 흰 테두리(26%) — «잘리는»(maskable) 아이콘에서는 테두리가 잘려 어색하므로 뺀다
    if not border:
        return plate
    d = ImageDraw.Draw(plate)
    inset = max(1, int(size * 0.0059))          # 512 기준 3px
    w = max(1, int(size * 0.0117))              # 512 기준 6px
    d.rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset],
                        radius=int(radius * 0.973), outline=(255, 255, 255, 66), width=w)
    return plate


def _bubble(img, k, sym):
    """말풍선(흰 면 + 꼬리) + 정책 목록 막대 3개. k = 512 좌표 → 실제 픽셀 배율."""
    d = ImageDraw.Draw(img)
    d.polygon([(x * k, y * k) for (x, y) in sym["tail"]], fill=WHITE)
    d.rounded_rectangle([sym["bx"] * k, sym["by"] * k,
                         (sym["bx"] + sym["bw"]) * k, (sym["by"] + sym["bh"]) * k],
                        radius=sym["brx"] * k, fill=WHITE)
    for (x, y, w, h, r), op in zip(sym["bars"], (1.0, 0.58, 0.32)):
        d.rounded_rectangle([x * k, y * k, (x + w) * k, (y + h) * k],
                            radius=r * k, fill=BASE + (int(255 * op),))


def _text(img, k, cx, y, txt, px, weight_alpha=255, spacing=0):
    """가운데 정렬 글자. spacing 은 letter-spacing(512 좌표계 px)."""
    d = ImageDraw.Draw(img)
    f = font(px * k)
    if spacing:
        sp = spacing * k
        widths = [d.textlength(ch, font=f) for ch in txt]
        total = sum(widths) + sp * (len(txt) - 1)
        x = cx * k - total / 2
        for ch, w in zip(txt, widths):
            d.text((x, y * k), ch, font=f, fill=WHITE + (weight_alpha,), anchor="ls")
            x += w + sp
    else:
        d.text((cx * k, y * k), txt, font=f, fill=WHITE + (weight_alpha,), anchor="ms")


def icon_full(size):
    """완성형 — 말풍선 + 「상주시 정책플랫폼」 + 구분선 + 「시민용」 (512 용)."""
    S = size * SS
    k = S / 512.0
    img = _grad_plate(S, int(112 * k))
    _bubble(img, k, SYM_512)

    d = ImageDraw.Draw(img)
    f_sm, f_lg = font(40 * k), font(52 * k)
    w_sm = d.textlength("상주시 ", font=f_sm)
    w_lg = d.textlength("정책플랫폼", font=f_lg)
    x = 256 * k - (w_sm + w_lg) / 2
    d.text((x, 342 * k), "상주시 ", font=f_sm, fill=WHITE + (219,), anchor="ls")   # 86% 불투명
    d.text((x + w_sm, 342 * k), "정책플랫폼", font=f_lg, fill=WHITE, anchor="ls")

    d.line([(234 * k, 374 * k), (278 * k, 374 * k)], fill=WHITE + (107,), width=max(1, int(3 * k)))
    _text(img, k, 256, 416, "시민용", 30, weight_alpha=230, spacing=5)

    return img.resize((size, size), Image.LANCZOS)


def icon_small(size):
    """작은 크기 — 말풍선을 키우고 「시민용」 한 마디만 (192 용)."""
    S = size * SS
    k = S / 512.0
    img = _grad_plate(S, int(112 * k))
    _bubble(img, k, SYM_128)
    _text(img, k, 256, 424, "시민용", 76, spacing=1)
    return img.resize((size, size), Image.LANCZOS)


def icon_maskable(size):
    """안드로이드 «잘리는» 아이콘 — 바탕을 모서리까지 꽉 채우고, 그림은 안전영역(80%) 안으로."""
    S = size * SS
    k = S / 512.0
    plate = _grad_plate(S, 0, border=False)

    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    _bubble(art, k, SYM_128)
    _text(art, k, 256, 424, "시민용", 76, spacing=1)
    scaled = art.resize((int(S * 0.80), int(S * 0.80)), Image.LANCZOS)
    off = (S - scaled.width) // 2
    plate.alpha_composite(scaled, (off, off))
    return plate.resize((size, size), Image.LANCZOS)


def main():
    jobs = [
        ("icon-192-v2.png", icon_small(192)),
        ("icon-512-v2.png", icon_full(512)),
        ("icon-maskable-512-v2.png", icon_maskable(512)),
    ]
    for name, img in jobs:
        out = os.path.join(OUT_DIR, name)
        img.save(out)
        print("[완료]", out, img.size)
    print("[안내] manifest.json · index.html · sw.js 의 파일명을 함께 확인하세요.")


if __name__ == "__main__":
    main()
