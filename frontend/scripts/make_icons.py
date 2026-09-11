"""Generate the PWA icons from the one drawing of the mark.

    python3 frontend/scripts/make_icons.py

Run when the mark changes; the output is version-controlled, so this is
not part of the build.

There used to be two independent drawings of the mark: `public/favicon.svg`,
drawn by hand, and this script, which redrew the same suitcase with Pillow
primitives. Nothing kept them in step, and they had already drifted. Now
`public/favicon.svg` is the only drawing and this rasterises it.

Rasterising needs a browser, because the only SVG renderers that are
correct are the ones inside browsers, and every Python alternative wants a
compiled C library. Chrome is already on the machine that runs this; CI
never does, since the PNGs are committed. Set CHROME to point elsewhere.

Two Chrome flags are deliberately absent. `--user-data-dir` pointed at a
fresh directory makes this Chrome hang forever rather than render, and
`--default-background-color=00000000` does the same. Neither is needed:
nothing here wants transparency.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
SOURCE = PUBLIC / "favicon.svg"
OUT = PUBLIC / "icons"

# The ground the maskable icon bleeds to, when the artwork is inset. Read
# out of the source so there is still only one drawing.
MASKABLE_INSET = 0.10

CHROME_CANDIDATES = (
    os.environ.get("CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
        if candidate and shutil.which(candidate):
            return candidate
    sys.exit(
        "No browser found to rasterise the SVG.\n"
        "Install Chrome or Chromium, or set CHROME to its path.\n"
        "Tried:\n  " + "\n  ".join(c for c in CHROME_CANDIDATES if c)
    )


def ground_of(svg: str) -> str:
    """The mark's own background, for the maskable icon to bleed out to."""
    match = re.search(r'<rect[^>]*\bfill="(#[0-9a-fA-F]{3,8})"', svg)
    if not match:
        sys.exit(f"{SOURCE.name}: expected the first <rect> to carry the ground colour.")
    return match.group(1)


def page(svg: str, size: int, ground: str, *, inset: float = 0.0) -> str:
    """One SVG on an otherwise empty page, at exactly `size` device pixels.

    Full-bleed and fully opaque, never transparent: the rounded corner
    belongs to the browser tab, where nothing masks the icon, and the SVG
    keeps it for that. Android and iOS both apply a mask of their own to
    the PNGs, so a PNG that arrives already rounded gets rounded twice and
    shows a pale wedge in each corner. The source's own ground rectangle
    is hidden here and painted by the frame instead, which is also why
    this needs no transparency — and the one Chrome flag that would have
    produced it hangs on this machine.

    `inset` shrinks the artwork, which is what the maskable icon needs:
    only the middle 80% is promised to survive whatever shape a launcher
    crops to.
    """
    pad = round(size * inset)
    return (
        "<!doctype html><meta charset=utf-8>"
        "<style>"
        "html,body{margin:0;padding:0}"
        f"#f{{width:{size}px;height:{size}px;background:{ground};"
        "display:flex;align-items:center;justify-content:center}"
        f"#f>svg{{width:{size - 2 * pad}px;height:{size - 2 * pad}px;display:block}}"
        # The ground is the frame's now; drawing it twice would round the
        # corners back in.
        "#f>svg>rect:first-of-type{display:none}"
        "</style>"
        f"<div id=f>{svg}</div>"
    )


def render(chrome: str, html: str, size: int, destination: Path) -> None:
    with tempfile.TemporaryDirectory() as work:
        source = Path(work) / "icon.html"
        source.write_text(html, encoding="utf-8")
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                f"--screenshot={Path(work) / 'icon.png'}",
                f"--window-size={size},{size}",
                source.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
        shutil.copyfile(Path(work) / "icon.png", destination)
    print(f"  {destination.relative_to(PUBLIC.parent)}  {size}x{size}")


def main() -> None:
    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE}")

    chrome = find_chrome()
    svg = SOURCE.read_text(encoding="utf-8").strip()
    # The <svg> must not carry width/height, or the CSS above cannot size it.
    svg = re.sub(r'\s(width|height)="[^"]*"', "", svg, count=2)
    ground = ground_of(svg)

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"from {SOURCE.relative_to(PUBLIC.parent)} (ground {ground}) with {Path(chrome).name}")

    # A little air on the "any" icons, because some launchers show them
    # unmasked and edge-to-edge artwork looks cramped.
    render(chrome, page(svg, 192, ground, inset=0.06), 192, OUT / "icon-192.png")
    render(chrome, page(svg, 512, ground, inset=0.06), 512, OUT / "icon-512.png")
    render(chrome, page(svg, 180, ground, inset=0.06), 180, OUT / "apple-touch-icon.png")
    # The one a launcher crops to its own shape: more air, so nothing that
    # matters is outside the safe circle.
    render(chrome, page(svg, 512, ground, inset=MASKABLE_INSET), 512, OUT / "icon-maskable-512.png")


if __name__ == "__main__":
    main()
