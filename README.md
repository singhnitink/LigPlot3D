# LigPlot3D

**LigPlot3D** is a web-based tool for visualizing and analyzing protein-ligand interactions from molecular docking studies. It provides an interactive 3D view of the binding pocket and detects non-covalent interactions using scientifically accurate geometric criteria.


## Features

- **Interactive 3D Visualization**: powered by NGL and 3Dmol.js.
- **Automated Interaction Detection**:
  - Hydrogen Bonds (≤ 3.5 Å, angle ≥ 120°)
  - Salt Bridges (≤ 4.0 Å)
  - Hydrophobic Contacts (≤ 4.5 Å)
  - Pi-Stacking (Parallel & T-shaped) and Cation-Pi Contacts
  - Halogen Bonds
- **Support for Multiple Formats**: PDB, CIF, SDF, MOL2.
- **Export Data**: Download interaction lists as CSV or JSON.
- **Customizable view**: Change representation styles (Cartoon, Stick, Ball & Stick) and colors.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/singhnitink/LigPlot3D.git
   cd LigPlot3D
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## Built With

- **React** - UI Framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **NGL / 3Dmol.js** - Molecular visualization
- **Lucide React** - Icons
- **Tailwind CSS** - Styling

## License

This project is licensed under the MIT License.
