"""Extract PDF text and optionally render selected pages for visual reference review."""
import argparse
from pathlib import Path

import pypdfium2 as pdfium


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", type=int, nargs="+", help="One-based pages to render")
    parser.add_argument("--dpi", type=int, default=144)
    parser.add_argument("--out", type=Path, default=Path("reference/rendered"))
    args = parser.parse_args()
    if args.dpi <= 0:
        parser.error("--dpi must be positive")
    with pdfium.PdfDocument(args.pdf) as pdf:
        if any(p < 1 or p > len(pdf) for p in (args.pages or [])):
            parser.error(f"Pages must be between 1 and {len(pdf)}")
        args.out.mkdir(parents=True, exist_ok=True)
        text_path = args.out / f"{args.pdf.stem}.txt"
        with text_path.open("w", encoding="utf-8", newline="\n") as output:
            for index in range(len(pdf)):
                page = pdf[index]
                try:
                    text = page.get_textpage()
                    try:
                        content = text.get_text_range().replace("\r\n", "\n")
                        output.write(f"\n--- Page {index + 1} ---\n{content}\n")
                    finally:
                        text.close()
                    if index + 1 in (args.pages or []):
                        image_path = args.out / f"{args.pdf.stem}-p{index + 1:02}.png"
                        bitmap = page.render(scale=args.dpi / 72)
                        bitmap.to_pil().save(image_path)
                        bitmap.close()
                        print(image_path)
                finally:
                    page.close()
        print(f"{len(pdf)} pages; text: {text_path}")


if __name__ == "__main__":
    main()
