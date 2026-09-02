#!/bin/bash
# mark_remover.sh - Cleans AI signatures, unwanted punctuation (em-dashes, colons, semicolons),
# and artificial transition markers from generated LaTeX (.tex) files and updates PDFs.

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <target.tex> [compile_pdf=1]"
    exit 1
fi

TEX_FILE="$1"
COMPILE_PDF="${2:-1}"

if [ ! -f "$TEX_FILE" ]; then
    echo "Error: File $TEX_FILE not found."
    exit 1
fi

echo "Running mark_remover on $TEX_FILE..."

# 1. Remove unicode em-dashes and spaced dash punctuation
sed -i -E 's/ — / /g' "$TEX_FILE"
sed -i -E 's/ --- / /g' "$TEX_FILE"

# 2. Remove AI transition words & filler phrases
sed -i -E 's/\b(Furthermore|Moreover|Importantly|Notably|In summary|In conclusion|It is worth noting that|It is important to note that|It should be emphasized that),? //gI' "$TEX_FILE"

# 3. Clean AI marker tags if any remain
sed -i -E 's/\[AI_MARKER\]//g' "$TEX_FILE"
sed -i -E 's/\[TODO: AI\]//g' "$TEX_FILE"

# 4. Remove unneeded semicolons in running text (preserving LaTeX comments and commands)
sed -i -E '/^[^%]*;/ { s/([a-zA-Z0-9]); ([a-zA-Z0-9])/\1 and \2/g }' "$TEX_FILE"

echo "Cleaned $TEX_FILE successfully."

if [ "$COMPILE_PDF" -eq 1 ]; then
    DIR=$(dirname "$TEX_FILE")
    MAIN_TEX="$DIR/main.tex"
    if [ -f "$MAIN_TEX" ]; then
        echo "Compiling PDF via main.tex in $DIR..."
        (cd "$DIR" && pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1 && bibtex main > /dev/null 2>&1 && pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1)
        echo "PDF compilation finished."
    fi
fi
