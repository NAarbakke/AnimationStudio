# PDF reference tools

Local PDFium rendering and text extraction, with no system Poppler dependency.
Create the environment once from the project root (Python 3.10+):

```powershell
python -m venv tools/pdf/.venv
tools/pdf/.venv/Scripts/python -m pip install -r tools/pdf/requirements.txt
```

Extract every page's text, and render selected one-based page numbers to PNG:

```powershell
tools/pdf/.venv/Scripts/python tools/pdf/inspect_pdf.py reference/Burevestnik_Paper_Final_pdf.pdf --pages 1 2 3 --dpi 144
```

The source PDF is read only. Outputs default to `reference/rendered/`; use `--out`
to choose another directory. Both the local environment and rendered references
are git-ignored. On Linux/macOS use `.venv/bin/python` instead of `.venv/Scripts/python`.
