# Exoplanet Explorer

An interactive 3D visualisation of 4,493 real NASA exoplanets, with a Random Forest machine learning model predicting the habitability of each one.

**Live demo → https://shiven01000.github.io/Exoplanet-Explorer/**

---

## Features

- **4,493 real exoplanets** fetched directly from the NASA Exoplanet Archive
- **Random Forest classifier** (200 trees, 99.2% accuracy) trained on 9 physical features to predict habitability
- **Procedural planet textures** — gas giants have banded atmospheres and storm spots, habitable worlds have oceans and continents, lava worlds have glowing crack networks, ice worlds have fracture patterns
- **Temperature-based colouring** — smooth gradient from deep blue (frozen) through green (habitable zone) to near-black (star-surface heat)
- **Glow effects** — every planet has a temperature-coloured halo; the ~56 habitable planets have a large pulsing green bloom
- **Sunflower spiral layout** — planets are arranged using the golden angle, guaranteeing even spacing with no overlaps; sorted by orbital distance so inner rings contain close-orbiting planets
- **Interactive** — hover for a tooltip, click to fly the camera to any planet and open its data panel
- **Real-time filters** — filter by habitability score, distance, mass, radius, or show habitable planets only
- **Animations** — each planet rotates on its axis, star field twinkles, habitable glows breathe independently

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| ML pipeline | Python · pandas · scikit-learn (RandomForestClassifier) |
| Data source | NASA Exoplanet Archive TAP service |
| 3D rendering | Three.js r128 (WebGL) |
| Camera animations | GSAP 3 |
| Hosting | GitHub Pages (fully static, no server) |

---

## Architecture

The project is split into three fully decoupled layers:

```
NASA Exoplanet Archive
        ↓  (HTTP, run once)
ml/fetch_data.py       — downloads raw CSV
ml/train_model.py      — cleans data, trains RF, exports JSON
        ↓
data/exoplanets.json   — 4,493 planet records with habitability scores
data/model_stats.json  — accuracy, feature importances, counts
        ↓  (fetch() in browser)
src/planets.js         — loads JSON, builds 3D meshes and textures
src/ui.js              — filter panel, info panel, tooltip, stats bar
src/main.js            — Three.js scene, render loop, camera fly-to
```

The Python pipeline runs once to produce the JSON. The browser reads those static files — no backend, no API calls at runtime.

---

## ML Pipeline

### Habitability labels
Planets are labelled using the **PHL Habitable Worlds Catalog** (Planetary Habitability Laboratory, UPR Arecibo), cross-referenced against NASA archive naming conventions. 56 planets matched out of 4,493.

### Features used
| Feature | Description |
|---------|-------------|
| `pl_rade` | Planet radius (Earth radii) |
| `pl_bmasse` | Planet mass (Earth masses) |
| `pl_orbper` | Orbital period (days) |
| `pl_eqt` | Equilibrium temperature (K) |
| `pl_insol` | Stellar flux (Earth units) |
| `st_teff` | Host star effective temperature (K) |
| `st_rad` | Host star radius (Solar radii) |
| `st_mass` | Host star mass (Solar masses) |
| `pl_orbsmax` | Semi-major axis (AU) |

### Data cleaning
- Planets missing `pl_eqt` but with known stellar flux have temperature recovered via Stefan-Boltzmann: `T_eq = 278.5 × flux^0.25` K
- Rows still missing required features after recovery are dropped
- Optional features (`pl_bmasse`, `st_rad`, `st_mass`, `pl_insol`) are filled with column medians so transit-only planets (which often lack mass measurements) aren't excluded
- `class_weight='balanced'` compensates for the 98:1 class imbalance

### Results
- **99.2% accuracy**, 82% recall on the habitable class
- Top predictive feature: equilibrium temperature (`pl_eqt`)

---

## Local Development

### Prerequisites
- Python 3.9+
- A local HTTP server (Python's built-in one works fine — `fetch()` doesn't work on `file://` URLs)

### Run the ML pipeline (optional — JSON is already committed)
```bash
cd ml
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

python fetch_data.py          # downloads raw_exoplanets.csv from NASA
python train_model.py         # trains model, exports data/exoplanets.json
```

### Serve the site locally
```bash
# from the project root
python3 -m http.server 8080
# open http://localhost:8080
```

---

## Data Source

Planet data is fetched from the **NASA Exoplanet Archive** Planetary Systems Composite Parameters table (`pscomppars`) via the TAP (Table Access Protocol) service — no API key required.

Habitability labels are based on the **Planetary Habitability Laboratory Habitable Worlds Catalog** (University of Puerto Rico at Arecibo).
