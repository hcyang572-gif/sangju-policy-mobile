# -*- coding: utf-8 -*-
"""
공유용 이미지 생성:
  · qr.png        — 사이트 주소 QR코드(인쇄/게시용, 여백 포함)
  · share.png     — 카카오톡/SNS 링크 미리보기 카드(1200x630, og:image 용)

실행:  py -3 make_share.py
"""
import os
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "https://hcyang572-gif.github.io/sangju-policy-mobile/"

# 테마 색 (상주 곶감)
CREAM = "#FFF7F0"
ORANGE = "#E66B3A"
DARK = "#4A3B32"
MUTED = "#8C7A6E"
WHITE = "#FFFFFF"

FONT_B = "C:/Windows/Fonts/malgunbd.ttf"
FONT_R = "C:/Windows/Fonts/malgun.ttf"


def make_qr(fill=DARK, box=20, border=3):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=box, border=border)
    qr.add_data(URL)
    qr.make(fit=True)
    return qr.make_image(fill_color=fill, back_color=WHITE).convert("RGB")


def save_standalone_qr():
    img = make_qr(fill=DARK, box=20, border=3)
    path = os.path.join(HERE, "qr.png")
    img.save(path)
    print("[완료] qr.png", img.size)


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_center(d, cx, y, text, fnt, fill):
    w = d.textlength(text, font=fnt)
    d.text((cx - w / 2, y), text, font=fnt, fill=fill)


def make_share_card():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # 상단 오렌지 띠
    d.rectangle([0, 0, W, 18], fill=ORANGE)

    # 왼쪽 텍스트 영역
    lx = 70
    d.text((lx, 95), "상주시", font=font(FONT_B, 64), fill=ORANGE)
    d.text((lx, 175), "정책 플랫폼", font=font(FONT_B, 78), fill=DARK)

    d.text((lx, 300), "내게 맞는 지원사업,", font=font(FONT_B, 40), fill=DARK)
    d.text((lx, 352), "휴대폰으로 1분 만에 찾기", font=font(FONT_B, 40), fill=DARK)

    d.text((lx, 430), "검색 · 맞춤추천 · 간편신청", font=font(FONT_R, 30), fill=MUTED)

    # 하단 안내
    d.text((lx, 540), "설치 없이 링크 한 번으로 — 톱니바퀴 제6기 미래상주 희망연구팀",
           font=font(FONT_R, 24), fill=MUTED)

    # 오른쪽 QR 카드(흰 패널 + 그림자 느낌 테두리)
    qr = make_qr(fill=DARK, box=10, border=2)
    qr_size = 320
    qr = qr.resize((qr_size, qr_size), Image.NEAREST)
    panel_pad = 28
    px = W - qr_size - panel_pad - 70
    py = (H - qr_size) // 2 - 20
    d.rounded_rectangle(
        [px - panel_pad, py - panel_pad, px + qr_size + panel_pad, py + qr_size + panel_pad + 44],
        radius=28, fill=WHITE, outline="#EEDACF", width=3)
    img.paste(qr, (px, py))
    draw_center(d, px + qr_size / 2, py + qr_size + 6, "휴대폰으로 스캔하세요",
                font(FONT_B, 22), ORANGE)

    path = os.path.join(HERE, "share.png")
    img.save(path, quality=92)
    print("[완료] share.png", img.size)


if __name__ == "__main__":
    save_standalone_qr()
    make_share_card()
