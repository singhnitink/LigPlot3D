# LigPlot3D

**LigPlot3D** is a web-based tool for visualizing and analyzing protein-ligand interactions from experimental structures and molecular docking studies. It provides an interactive 3D view of the binding pocket and detects non-covalent interactions with geometric criteria adapted from PLIP.

Live: https://singhnitink.github.io/LigPlot3D/ — files are processed entirely in your browser and never uploaded.

## Features

- **Interactive 3D visualization** (3Dmol.js) of the ligand, binding-site residues and interaction lines.
- **Automated interaction detection**:
  - Hydrogen bonds (≤ 3.5 Å; donor–H···acceptor ≥ 120° when hydrogens are present)
  - Salt bridges (≤ 4.0 Å between oppositely charged atoms; ligand charges perceived from geometry)
  - π-stacking (parallel and T-shaped, ≤ 5.5 Å, lateral offset ≤ 2.0 Å) and cation–π (≤ 6.0 Å)
  - Halogen bonds (≤ 3.5 Å, C–X···A 165° ± 30°)
  - Metal coordination (≤ 2.8 Å, including ligand → metal-ion / heme Fe)
  - Hydrophobic contacts (≤ 4.5 Å between carbons bonded only to C/H, PLIP-style reduction)
- **Ligand chemistry perceived from coordinates**: aromatic rings (planarity + bond lengths), charged groups (amines, guanidinium, carboxylate, phosphate, sulfonate, …), histidine protonation.
- **Formats**: PDB/ENT, mmCIF, SDF, MOL2. Multi-model files: model 1 is shown and analysed.
- **Export**: CSV (UTF-8, chain-aware) and JSON; PNG snapshot of the view.
- **Customizable view**: cartoon/rope/line protein with adjustable opacity, ligand and pocket styles, ligand colour.

See the in-app **Help** page for the exact criteria.

## Development

```bash
git clone https://github.com/singhnitink/LigPlot3D.git
cd LigPlot3D
npm ci           # install the exact locked dependencies
npm run dev      # development server
npm test         # regression tests (real PDB entries in tests/fixtures)
npm run lint     # ESLint
npm run build    # type-check + production build into dist/
```

Deploy to GitHub Pages with `./deploy.sh` (or `npm run deploy`, which lints, tests and builds first).

## Built With

- **React** + **TypeScript**, built with **Vite**
- **3Dmol.js** — molecular visualization
- **NGL** — structure-file parsing for the analysis
- **Tailwind CSS** (compiled at build time) and **Lucide** icons
- **Vitest** — tests

## License

This project is licensed under the MIT License.
