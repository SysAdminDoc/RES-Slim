#!/usr/bin/env python
"""
Generate the RES-Slim icon set.

Design:
- Dark charcoal circular background with subtle inner highlight.
- Bold white "RS" monogram (reads "RES-Slim").
- Reddit-orange accent bar beneath the monogram.

Renders at 512x512 then downsamples to every size referenced in the repo.
The action/toolbar icons (css-on*, css-off*) use a simpler variant:
- "on" = full-color
- "off" = grayscale + reduced alpha

Run from repo root: `python build/generate-icons.py`
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
IMAGES = REPO / "images"

BG_OUTER = (24, 24, 26, 255)       # near-black charcoal
BG_INNER = (46, 46, 50, 255)       # slightly lighter for the inner ring
ACCENT   = (255, 69, 0, 255)       # Reddit orange #ff4500
WHITE    = (245, 245, 245, 255)

ARIAL_BOLD = "C:/Windows/Fonts/arialbd.ttf"

ICON_SIZES = [16, 44, 48, 50, 64, 128, 150, 256, 512]
ACTION_SIZES = [16, 32]  # css-*-small (16) and css-* (32)
BETA_SIZES = [48, 128]   # beta128.png, beta48.png


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    """Mask with a rounded square shape."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def draw_base(size: int, *, accent: tuple[int, int, int, int] = ACCENT, letters: str = "RS") -> Image.Image:
    """Render the canonical icon at arbitrary size using a 4x supersample."""
    scale = 4
    canvas = size * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Outer charcoal circle with subtle inner ring.
    d.ellipse((0, 0, canvas - 1, canvas - 1), fill=BG_OUTER)
    inset = canvas // 18
    d.ellipse(
        (inset, inset, canvas - 1 - inset, canvas - 1 - inset),
        outline=BG_INNER,
        width=max(1, canvas // 80),
    )

    # "RS" monogram — sits in the upper two-thirds of the icon, centered.
    font_size = int(canvas * 0.58)
    try:
        font = ImageFont.truetype(ARIAL_BOLD, font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = d.textbbox((0, 0), letters, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (canvas - tw) // 2 - bbox[0]
    ty = (canvas - th) // 2 - bbox[1] - canvas // 18
    d.text((tx, ty), letters, font=font, fill=WHITE)

    # Reddit-orange accent bar beneath the monogram.
    bar_w = int(canvas * 0.42)
    bar_h = max(3, canvas // 22)
    bar_x = (canvas - bar_w) // 2
    bar_y = ty + th + canvas // 28
    d.rounded_rectangle(
        (bar_x, bar_y, bar_x + bar_w, bar_y + bar_h),
        radius=bar_h // 2,
        fill=accent,
    )

    img = img.resize((size, size), Image.LANCZOS)
    return img


def make_action_icon(size: int, *, on: bool) -> Image.Image:
    """Toolbar action icon. At small sizes drop the bar and just show 'R'."""
    scale = 4
    canvas = size * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = canvas // 5
    d.rounded_rectangle(
        (0, 0, canvas - 1, canvas - 1),
        radius=radius,
        fill=BG_OUTER if on else (60, 60, 62, 255),
    )

    letters = "R"
    font_size = int(canvas * 0.72)
    try:
        font = ImageFont.truetype(ARIAL_BOLD, font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = d.textbbox((0, 0), letters, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (canvas - tw) // 2 - bbox[0]
    ty = (canvas - th) // 2 - bbox[1] - canvas // 22
    d.text((tx, ty), letters, font=font, fill=WHITE if on else (170, 170, 170, 255))

    if size >= 24:
        bar_w = int(canvas * 0.5)
        bar_h = max(2, canvas // 12)
        bar_x = (canvas - bar_w) // 2
        bar_y = ty + th + canvas // 40
        d.rounded_rectangle(
            (bar_x, bar_y, bar_x + bar_w, bar_y + bar_h),
            radius=bar_h // 2,
            fill=ACCENT if on else (120, 120, 120, 255),
        )

    return img.resize((size, size), Image.LANCZOS)


def make_beta_icon(size: int) -> Image.Image:
    """Beta flavor — same as base but with a teal accent and 'β' overlay in the corner."""
    scale = 4
    canvas = size * scale
    base = draw_base(size, accent=(0, 200, 190, 255))
    base = base.resize((canvas, canvas), Image.LANCZOS)

    d = ImageDraw.Draw(base)
    try:
        font = ImageFont.truetype(ARIAL_BOLD, int(canvas * 0.28))
    except OSError:
        font = ImageFont.load_default()
    badge_r = canvas // 6
    cx, cy = canvas - badge_r - canvas // 22, badge_r + canvas // 22
    d.ellipse(
        (cx - badge_r, cy - badge_r, cx + badge_r, cy + badge_r),
        fill=(0, 200, 190, 255),
        outline=(245, 245, 245, 255),
        width=max(2, canvas // 64),
    )
    text = "β"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw // 2 - bbox[0], cy - th // 2 - bbox[1]), text, font=font, fill=WHITE)

    return base.resize((size, size), Image.LANCZOS)


def main() -> int:
    IMAGES.mkdir(exist_ok=True)

    # Main icon family
    for size in ICON_SIZES:
        img = draw_base(size)
        img.save(IMAGES / f"icon{size}.png")
        print(f"wrote icon{size}.png")

    # Action / toolbar icons: css-on{,-small}.png + css-off{,-small}.png
    for size, suffix in [(32, ""), (16, "-small")]:
        make_action_icon(size, on=True).save(IMAGES / f"css-on{suffix}.png")
        make_action_icon(size, on=False).save(IMAGES / f"css-off{suffix}.png")
        print(f"wrote css-on{suffix}.png, css-off{suffix}.png")

    # Beta flavor icons
    for size in BETA_SIZES:
        make_beta_icon(size).save(IMAGES / f"beta{size}.png")
        print(f"wrote beta{size}.png")

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
