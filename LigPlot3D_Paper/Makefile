# Makefile for compiling main.tex with citations

TEX = pdflatex
BIB = bibtex
SRC = main

all: $(SRC).pdf cover_letter.pdf highlights.pdf

$(SRC).pdf: $(SRC).tex references.bib
	$(TEX) $(SRC).tex
	$(BIB) $(SRC)
	$(TEX) $(SRC).tex
	$(TEX) $(SRC).tex

cover_letter.pdf: cover_letter.tex
	$(TEX) cover_letter.tex

cover_letter: cover_letter.pdf

highlights.pdf: highlights.tex
	$(TEX) highlights.tex

highlights: highlights.pdf

clean:
	rm -f $(SRC).aux $(SRC).bbl $(SRC).blg $(SRC).log $(SRC).out $(SRC).pdf
	rm -f cover_letter.aux cover_letter.log cover_letter.out cover_letter.pdf
	rm -f highlights.aux highlights.log highlights.out highlights.pdf

.PHONY: all clean cover_letter highlights

