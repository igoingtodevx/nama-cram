#!/usr/bin/env python3
"""Render the selected original NAMA exercise and solution pages for the crash course.

The source PDFs remain ignored by Vercel. This produces only the eight selected,
readable task/solution image pairs used in the authenticated-study-style crash tab.
"""
from pathlib import Path
import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "knowledge" / "source-pdfs"
TARGET = ROOT / "crash-assets"

# output name -> (source pdf, one-indexed page numbers)
ASSETS = {
    "01-integrated-value-task.webp": ("Uebungen/SuSFi_Uebung1_Aufgaben.pdf", [9, 10]),
    "01-integrated-value-solution.webp": ("Uebungen/SuSFi_Uebung1_Loesung.pdf", [18, 19]),
    "02-taxonomie-kpis-task.webp": ("Uebungen/CorpSus_Uebung3_Aufgaben.pdf", [6, 7]),
    "02-taxonomie-kpis-solution.webp": ("Uebungen/CorpSus_Uebung3_Loesung.pdf", [13, 14, 15]),
    "03-wesentlichkeit-task.webp": ("Uebungen/CorpSus_Uebung2_Aufgaben.pdf", [2, 3, 4, 5]),
    "03-wesentlichkeit-solution.webp": ("Uebungen/CorpSus_Ergaenzungen_Loesungen.pdf", [6, 7, 8, 9, 10]),
    "04-essay-task.webp": ("Uebungen/CorpSus_Uebung1_Aufgaben.pdf", [7]),
    "04-essay-solution.webp": ("Uebungen/CorpSus_Uebung1_Loesung.pdf", [10, 11]),
    "05-wacc-capm-task.webp": ("Uebungen/SuSFi_Uebung1_Aufgaben.pdf", [8]),
    "05-wacc-capm-solution.webp": ("Uebungen/SuSFi_Uebung1_Loesung.pdf", [13, 14, 15]),
    "06-produktrechnung-task.webp": ("Uebungen/CorpSus_Uebung3_Aufgaben.pdf", [2, 3]),
    "06-produktrechnung-solution.webp": ("Uebungen/CorpSus_Uebung3_Loesung.pdf", [4, 5]),
    "07-kapitel4-theorie-task.webp": ("Uebungen/CorpSus_Uebung1_Aufgaben.pdf", [8, 9]),
    "07-kapitel4-theorie-solution.webp": ("Uebungen/CorpSus_Uebung1_Loesung.pdf", [13, 14, 15, 16]),
    "08-reserve-rechnen-task.webp": ("Uebungen/SuSFi_Uebung3_Aufgaben.pdf", [7, 8]),
    "08-reserve-rechnen-solution.webp": ("Uebungen/SuSFi_Uebung3_Loesung.pdf", [15, 16, 17]),
    "roads-omnibus-original-task.webp": ("Klausuren/SS25_PT1_Nachhaltigkeitsmanagement_Mies.pdf", [1, 2]),
    "roads-wesentlichkeit-original-task.webp": ("Klausuren/SS25_PT2_Nachhaltigkeitsmanagement_Mies.pdf", [1]),
}


def render_asset(output_name: str, source_name: str, pages: list[int]) -> None:
    doc = fitz.open(SOURCE / source_name)
    images = []
    for page_number in pages:
        page = doc[page_number - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(1.55, 1.55), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(image)
    doc.close()

    width = max(image.width for image in images)
    margin = 20
    height = sum(image.height for image in images) + margin * (len(images) - 1)
    merged = Image.new("RGB", (width, height), "#ffffff")
    y = 0
    for image in images:
        if image.width != width:
            image = image.resize((width, round(image.height * width / image.width)))
        merged.paste(image, ((width - image.width) // 2, y))
        y += image.height + margin
    merged.save(TARGET / output_name, "WEBP", quality=82, method=6)


def main() -> None:
    TARGET.mkdir(exist_ok=True)
    for output_name, (source_name, pages) in ASSETS.items():
        render_asset(output_name, source_name, pages)
        print(f"rendered {output_name}")


if __name__ == "__main__":
    main()
