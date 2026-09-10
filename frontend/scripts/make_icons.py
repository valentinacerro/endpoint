"""Generate the PWA icons. Run once; the output is version-controlled.

    uv run --with pillow python frontend/scripts/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (30, 41, 82)  # night blue
FG = (245, 246, 250)  # warm white
ACCENT = (232, 93, 84)  # red, the sticker on the suitcase


def draw_suitcase(size: int, inset_ratio: float, rounded: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=BG)

    # Usable area: for the maskable icon the artwork stays inside the safe circle.
    m = size * inset_ratio
    w = size - 2 * m
    h = w * 0.74
    x0 = m
    y0 = (size - h) / 2 + h * 0.06
    x1 = x0 + w
    y1 = y0 + h
    r = w * 0.10

    # Handle: stops at the edge of the body instead of cutting into it.
    hw = w * 0.32
    hh = h * 0.22
    stroke = max(2, int(size * 0.030))
    d.rounded_rectangle(
        [size / 2 - hw / 2, y0 - hh, size / 2 + hw / 2, y0 + stroke],
        radius=hh * 0.5,
        outline=FG,
        width=stroke,
    )
    # Body
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=FG)
    # Strap, thin and slightly off-centre like on a real suitcase.
    sw = w * 0.055
    sx = x0 + w * 0.62
    d.rectangle([sx - sw / 2, y0, sx + sw / 2, y1], fill=BG)
    # Sticker
    cr = w * 0.10
    cx, cy = x0 + w * 0.26, y0 + h * 0.34
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=ACCENT)

    return img


def main() -> None:
    draw_suitcase(192, 0.20, True).save(OUT / "icon-192.png")
    draw_suitcase(512, 0.20, True).save(OUT / "icon-512.png")
    # Maskable: Android may crop up to 20% per side, hence more margin and a
    # background that reaches the edges.
    draw_suitcase(512, 0.30, False).save(OUT / "icon-maskable-512.png")
    draw_suitcase(180, 0.20, True).save(OUT / "apple-touch-icon.png")
    print("written:", *(p.name for p in sorted(OUT.iterdir())))


if __name__ == "__main__":
    main()
