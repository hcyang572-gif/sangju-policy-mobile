# -*- coding: utf-8 -*-
"""
시민앱(모바일웹) PWA 아이콘 생성기 — 상상주도 CI 로고 + 역할 라벨('시민').
  · icon-192.png / icon-512.png

레이아웃(공무원앱과 동일 위치로 통일):
  · 곶감 테마 크림 배경 둥근 사각
  · 상상주도 CI 로고(assets/sangsang1.png) 상단 중앙
  · 하단 중앙에 '시민' 라벨 알약(초록 배경·흰 글씨) — 공무원앱 '공무원'과 같은 위치

실행:  py -3 make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "assets", "sangsang1.png")

BG = (255, 247, 240)        # #FFF7F0  크림 배경(곶감 테마)
PILL = (46, 125, 68)        # #2E7D44  '시민' 알약(초록)
PILL_TX = (255, 255, 255)
FONT_B = "C:/Windows/Fonts/malgunbd.ttf"
LABEL = "시민"


def font(size):
    try:
        return ImageFont.truetype(FONT_B, size)
    except Exception:
        return ImageFont.load_default()


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 둥근 사각 단색 바탕
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)

    # 상상주도 로고 — 상단 중앙(하단 라벨 공간 확보 위해 위쪽 영역에 배치)
    pad = int(size * 0.16)
    box_w = size - pad * 2
    box_h = int(size * 0.52)
    try:
        logo = Image.open(LOGO).convert("RGBA")
        lw, lh = logo.size
        scale = min(box_w / lw, box_h / lh)
        logo = logo.resize((max(1, int(lw * scale)), max(1, int(lh * scale))),
                           Image.LANCZOS)
        lx = (size - logo.width) // 2
        ly = int(size * 0.40 - logo.height / 2)
        if ly < pad:
            ly = pad
        img.paste(logo, (lx, ly), logo)
    except Exception as e:
        print("[경고] 로고 합성 실패:", e)

    # 하단 중앙 역할 라벨 알약
    f = font(int(size * 0.155))
    bbox = d.textbbox((0, 0), LABEL, font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    px = int(size * 0.075)
    py = int(size * 0.045)
    bw = tw + px * 2
    bh = th + py * 2
    bx0 = (size - bw) // 2
    by1 = size - int(size * 0.085)
    by0 = by1 - bh
    bx1 = bx0 + bw
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=bh // 2, fill=PILL)
    d.text((bx0 + px - bbox[0], by0 + py - bbox[1]), LABEL, font=f, fill=PILL_TX)

    return img


def main():
    for s in (192, 512):
        out = os.path.join(HERE, f"icon-{s}.png")
        make_icon(s).save(out)
        print("[완료]", out, f"{s}x{s}")


if __name__ == "__main__":
    main()
