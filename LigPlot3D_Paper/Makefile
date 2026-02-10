# Makefile for compiling main.tex with citations

TEX = pdflatex
BIB = bibtex
SRC = main

all: $(SRC).pdf

$(SRC).pdf: $(SRC).tex references.bib
	$(TEX) $(SRC).tex
	$(BIB) $(SRC)
	$(TEX) $(SRC).tex
	$(TEX) $(SRC).tex

clean:
	rm -f $(SRC).aux $(SRC).bbl $(SRC).blg $(SRC).log $(SRC).out $(SRC).pdf

.PHONY: all clean
