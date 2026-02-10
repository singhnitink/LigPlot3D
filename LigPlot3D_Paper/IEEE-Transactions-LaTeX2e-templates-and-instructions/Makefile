# Makefile for compiling IEEE_LigPlot3D.tex and cover_letter.tex

TEX = pdflatex -interaction=nonstopmode
BIB = bibtex
SRC = IEEE_LigPlot3D
COVER = cover_letter

all: $(SRC).pdf $(COVER).pdf

$(SRC).pdf: $(SRC).tex references.bib
	-$(TEX) $(SRC).tex
	$(BIB) $(SRC)
	-$(TEX) $(SRC).tex
	$(TEX) $(SRC).tex

$(COVER).pdf: $(COVER).tex
	$(TEX) $(COVER).tex

zip: $(SRC).pdf $(COVER).pdf
	rm -f LigPlot3D_submission.zip
	zip LigPlot3D_submission.zip \
		$(SRC).tex \
		$(SRC).bbl \
		references.bib \
		IEEEtran.cls \
		webpage_snapshot.png

clean:
	rm -f $(SRC).aux $(SRC).bbl $(SRC).blg $(SRC).log $(SRC).out $(SRC).pdf
	rm -f $(COVER).aux $(COVER).log $(COVER).out $(COVER).pdf
	rm -f LigPlot3D_submission.zip

.PHONY: all clean zip
