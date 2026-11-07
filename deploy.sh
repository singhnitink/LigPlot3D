#!/bin/bash

# LigPlot3D Deployment Script

# Stop on error
set -e

echo "========================================"
echo "🚀 Starting LigPlot3D Deployment"
echo "========================================"

# 1. Check if we are in the correct directory (Look for package.json)
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found!"
    echo "Please run this script from the root of the LigPlot3D repository."
    exit 1
fi

# 2. The demo structure must be present, or "Try Demo" breaks on the live site.
if [ ! -f "public/1R9Q.pdb" ]; then
    echo "❌ Error: public/1R9Q.pdb (demo structure) is missing!"
    exit 1
fi

# 3. Install the exact locked dependencies
echo "📦 Installing dependencies (npm ci)..."
npm ci

# 4. Lint, test, build and publish to GitHub Pages
#    ('npm run deploy' runs predeploy = lint + test + build, then gh-pages -d dist)
echo "🔨 Linting, testing, building and deploying..."
npm run deploy

echo "========================================"
echo "✅ Deployment Success!"
echo "🌍 App is live at: https://singhnitink.github.io/LigPlot3D/"
echo "========================================"
