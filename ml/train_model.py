import os
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# ── Config ────────────────────────────────────────────────────────────────────
# Set to True to run the full analysis without saving any files.
# Set to False once you're happy with the results and want to export JSON.
DRY_RUN = False

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH   = os.path.join(SCRIPT_DIR, "raw_exoplanets.csv")
DATA_DIR   = os.path.join(SCRIPT_DIR, "..", "data")
JSON_PATH  = os.path.join(DATA_DIR, "exoplanets.json")
STATS_PATH = os.path.join(DATA_DIR, "model_stats.json")

FEATURES = [
    "pl_rade", "pl_bmasse", "pl_orbper", "pl_eqt",
    "pl_insol",                                        # stellar flux (Earth units)
    "st_teff", "st_rad",    "st_mass",   "pl_orbsmax",
]

# ── PHL Habitable Worlds Catalog ──────────────────────────────────────────────
# Source: Wikipedia "List of potentially habitable exoplanets" +
#         arxiv.org/abs/2501.14054 (Rocky Exoplanets in the HZ Catalog)
#         Cross-referenced against NASA Exoplanet Archive naming conventions.
# Names use exact NASA archive spelling (e.g. "Proxima Cen b" not "Proxima Centauri b").

HABITABLE_CATALOG_NAMES = [
    # TRAPPIST-1 system
    "TRAPPIST-1 d", "TRAPPIST-1 e", "TRAPPIST-1 f", "TRAPPIST-1 g",

    # Nearby M-dwarf systems
    "Proxima Cen b",
    "GJ 667 C c", "GJ 667 C e", "GJ 667 C f",
    "GJ 1002 b",  "GJ 1002 c",
    "GJ 1061 c",  "GJ 1061 d",
    "GJ 3293 d",
    "GJ 3323 b",
    "GJ 3998 d",
    "GJ 163 c",
    "GJ 180 c",   "GJ 180 d",
    "GJ 251 c",
    "GJ 357 d",
    "GJ 433 d",
    "GJ 514 b",
    "GJ 625 b",
    "GJ 682 b",   "GJ 682 c",
    "GJ 273 b",   # also known as Luyten b
    "Wolf 1061 c",
    "Wolf 1069 b",
    "Ross 128 b",
    "Ross 508 b",
    "Teegarden's Star b", "Teegarden's Star c", "Teegarden's Star d",
    "LHS 1140 b",
    "LP 890-9 c",

    # TOI (TESS) systems
    "TOI-700 d", "TOI-700 e",
    "TOI-715 b",
    "TOI-2257 b",
    "TOI-2285 b",

    # K2 systems
    "K2-72 e",
    "K2-288 B b",

    # Kepler systems
    "Kepler-22 b",
    "Kepler-62 e",    "Kepler-62 f",
    "Kepler-186 f",
    "Kepler-283 c",
    "Kepler-296 e",   "Kepler-296 f",
    "Kepler-440 b",
    "Kepler-441 b",
    "Kepler-442 b",
    "Kepler-443 b",
    "Kepler-452 b",
    "Kepler-705 b",
    "Kepler-1229 b",
    "Kepler-1410 b",
    "Kepler-1455 b",
    "Kepler-1540 b",
    "Kepler-1544 b",
    "Kepler-1606 b",
    "Kepler-1649 c",
    "Kepler-1652 b",
    "Kepler-1653 b",

    # Other confirmed systems
    "HD 40307 g",
    "HD 20794 d",
    "L 98-59 f",
]

# Normalize: lowercase + strip spaces. Handles minor formatting differences
# (e.g. "TRAPPIST-1e" vs "TRAPPIST-1 e"). NASA names already use "GJ" not
# "Gliese", so no alias substitution is needed after cross-referencing above.
def normalize_name(name):
    return str(name).lower().replace(" ", "")

HABITABLE_CATALOG = {normalize_name(n) for n in HABITABLE_CATALOG_NAMES}


# ── Section 1: Load and clean ─────────────────────────────────────────────────

print("=" * 55)
print("SECTION 1: Loading and cleaning data")
print("=" * 55)

df = pd.read_csv(CSV_PATH, comment="#")
print(f"Raw rows loaded: {len(df)}")

# ── Improvement 2: Estimate missing pl_eqt from stellar flux BEFORE dropna ───
# T_eq = 278.5 * (flux ^ 0.25) K  — standard Stefan-Boltzmann approximation
# assuming Earth-like albedo (0.3). Only fills rows where pl_eqt is missing
# but pl_insol is available.
recovered = 0
def estimate_eqt(row):
    global recovered
    if pd.isna(row["pl_eqt"]) and pd.notna(row["pl_insol"]) and row["pl_insol"] > 0:
        recovered += 1
        return round(278.5 * (row["pl_insol"] ** 0.25), 1)
    return row["pl_eqt"]

df["pl_eqt"] = df.apply(estimate_eqt, axis=1)
print(f"Estimated pl_eqt from flux for {recovered} planets (recovered before dropna)")

# Now drop rows still missing required features after the estimation attempt
required_cols = ["pl_rade", "pl_eqt", "pl_orbper", "st_teff", "pl_orbsmax"]
df = df.dropna(subset=required_cols)
print(f"After dropping rows still missing required features: {len(df)}")

# Fill remaining optional columns with medians
for col in ["pl_bmasse", "st_rad", "st_mass", "pl_insol"]:
    n_missing = df[col].isna().sum()
    if n_missing > 0:
        median_val = df[col].median()
        df[col] = df[col].fillna(median_val)
        print(f"  Filled {n_missing} missing '{col}' with median {median_val:.3f}")
print()


# ── Section 2: Label using PHL catalog ───────────────────────────────────────

print("=" * 55)
print("SECTION 2: Labeling via PHL Habitable Worlds Catalog")
print("=" * 55)

df["label"] = df["pl_name"].apply(
    lambda name: 1 if normalize_name(name) in HABITABLE_CATALOG else 0
)

total   = len(df)   # captured here, used in comparison table below
hab     = int(df["label"].sum())
not_hab = total - hab
print(f"Total planets:          {total}")
print(f"Potentially habitable:  {hab}  ({hab/total*100:.1f}%)")
print(f"Not habitable:          {not_hab}  ({not_hab/total*100:.1f}%)")

# Show which catalog planets were actually found in our dataset
matched   = df[df["label"] == 1]["pl_name"].tolist()
not_found = [n for n in HABITABLE_CATALOG_NAMES if normalize_name(n) not in
             {normalize_name(p) for p in df["pl_name"]}]

print(f"\nCatalog planets matched in NASA dataset ({len(matched)}):")
for name in sorted(matched):
    print(f"  ✓  {name}")

print(f"\nCatalog planets NOT in NASA dataset ({len(not_found)}):")
for name in sorted(not_found):
    print(f"  ✗  {name}")
print()


# ── Section 3: Train with class_weight='balanced' ────────────────────────────

print("=" * 55)
print("SECTION 3: Training Random Forest (balanced weights)")
print("=" * 55)

X = df[FEATURES].values
y = df["label"].values

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"Training on {len(X_train)} planets, testing on {len(X_test)}...")

# class_weight='balanced' tells the model to penalize misclassifying the rare
# habitable class more heavily — preventing it from just ignoring the minority.
clf = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    n_jobs=-1,
    class_weight="balanced",
)
clf.fit(X_train, y_train)

y_pred   = clf.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)

print(f"\nAccuracy: {accuracy * 100:.2f}%\n")
print(classification_report(y_test, y_pred, target_names=["Not Habitable", "Habitable"]))

importances = dict(zip(FEATURES, clf.feature_importances_.tolist()))
top_feature  = max(importances, key=importances.get)

print("Feature importances:")
for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
    bar = "█" * int(imp * 50)
    print(f"  {feat:<15} {imp:.4f}  {bar}")
print()


# ── Section 4: Score all planets ─────────────────────────────────────────────

probas = clf.predict_proba(X)[:, 1]
df["habitability_score"] = probas
df["is_habitable"]       = df["label"] == 1


# ── Section 5: Comparison vs old rule-based results ──────────────────────────

print("=" * 55)
print("SECTION 5: Comparison — old vs new")
print("=" * 55)

V1 = {"accuracy": 99.77, "habitable_count": 38, "total": 4409, "top_feature": "pl_eqt",  "label": "v1 rule-based"}
V2 = {"accuracy": 99.32, "habitable_count": 48, "total": 4409, "top_feature": "pl_eqt",  "label": "v2 catalog"}
V3 = {"accuracy": round(accuracy * 100, 2), "habitable_count": hab, "total": total, "top_feature": top_feature, "label": "v3 catalog+flux+recovered"}

print(f"  {'Metric':<22} {V1['label']:>22}  {V2['label']:>20}  {V3['label']:>26}")
print(f"  {'-'*95}")
for metric, k in [("Accuracy", "accuracy"), ("Habitable count", "habitable_count"), ("Total planets", "total"), ("Top feature", "top_feature")]:
    v1_val = str(V1[k]) + ("%" if k == "accuracy" else "")
    v2_val = str(V2[k]) + ("%" if k == "accuracy" else "")
    v3_val = str(V3[k]) + ("%" if k == "accuracy" else "")
    print(f"  {metric:<22} {v1_val:>22}  {v2_val:>20}  {v3_val:>26}")
print()

if DRY_RUN:
    print("DRY RUN — JSON files were NOT modified.")
    print("Set DRY_RUN = False in this script to export.")
else:
    # ── Export JSON ───────────────────────────────────────────────────────────
    os.makedirs(DATA_DIR, exist_ok=True)
    planets = []
    for _, row in df.iterrows():
        dist_parsecs = row["sy_dist"]
        distance_ly  = round(float(dist_parsecs) * 3.262, 1) if pd.notna(dist_parsecs) else None
        planets.append({
            "name":               str(row["pl_name"]),
            "star":               str(row["hostname"]),
            "radius":             round(float(row["pl_rade"]),      3),
            "mass":               round(float(row["pl_bmasse"]),    3),
            "orbital_period":     round(float(row["pl_orbper"]),    2),
            "temperature":        round(float(row["pl_eqt"]),       1),
            "star_temp":          round(float(row["st_teff"]),      0),
            "distance":           distance_ly,
            "orbital_distance":   round(float(row["pl_orbsmax"]),   4),
            "habitability_score": round(float(row["habitability_score"]), 4),
            "is_habitable":       bool(row["is_habitable"]),
        })
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(planets, f, indent=2)

    stats = {
        "accuracy":            round(accuracy * 100, 2),
        "n_estimators":        200,
        "feature_importances": {k: round(v, 4) for k, v in importances.items()},
        "top_feature":         top_feature,
        "total_planets":       len(df),
        "habitable_count":     hab,
    }
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    print(f"Exported {len(planets)} planets → {JSON_PATH}")
    print(f"Exported model stats   → {STATS_PATH}")
print("\nDone.")
