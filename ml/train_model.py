import os
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# ── Paths ─────────────────────────────────────────────────────────────────────
# Build all paths relative to this script's location so the script works
# regardless of which directory you run it from.

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH   = os.path.join(SCRIPT_DIR, "raw_exoplanets.csv")
DATA_DIR   = os.path.join(SCRIPT_DIR, "..", "data")
JSON_PATH  = os.path.join(DATA_DIR, "exoplanets.json")
STATS_PATH = os.path.join(DATA_DIR, "model_stats.json")

# The 8 features the model will learn from.
FEATURES = [
    "pl_rade",    # planet radius (Earth radii)
    "pl_bmasse",  # planet mass (Earth masses)
    "pl_orbper",  # orbital period (days)
    "pl_eqt",     # equilibrium temperature (Kelvin)
    "st_teff",    # star temperature (Kelvin)
    "st_rad",     # star radius (solar radii)
    "st_mass",    # star mass (solar masses)
    "pl_orbsmax", # orbital distance from star (AU)
]


# ── Section 1: Load and clean ─────────────────────────────────────────────────

print("=" * 50)
print("SECTION 1: Loading and cleaning data")
print("=" * 50)

df = pd.read_csv(CSV_PATH, comment="#")
print(f"Raw rows loaded: {len(df)}")

# Drop rows where the core features are missing.
# These are the columns used in the habitability label rules — without them
# we cannot correctly label or train on the planet.
required_cols = ["pl_rade", "pl_eqt", "pl_orbper", "st_teff", "pl_orbsmax"]
df = df.dropna(subset=required_cols)
print(f"After dropping rows missing required features: {len(df)}")

# Fill missing mass and star properties with the column median.
# Many transit-detected planets have no measured mass — dropping them would
# remove a large portion of the dataset. The median is a safe neutral fill.
fill_with_median = ["pl_bmasse", "st_rad", "st_mass"]
for col in fill_with_median:
    n_missing = df[col].isna().sum()
    if n_missing > 0:
        median_val = df[col].median()
        df[col] = df[col].fillna(median_val)
        print(f"  Filled {n_missing} missing '{col}' values with median {median_val:.3f}")

print()


# ── Section 2: Label habitability ─────────────────────────────────────────────

print("=" * 50)
print("SECTION 2: Labeling habitability")
print("=" * 50)

def label_habitability(row):
    """
    Returns 1 (habitable) if the planet meets all three criteria, else 0.
    These thresholds approximate the classical habitable zone definition.
    """
    radius_ok = 0.5  <= row["pl_rade"]   <= 2.5   # rocky, not a gas giant
    temp_ok   = 200  <= row["pl_eqt"]    <= 320   # liquid water possible
    period_ok = 50   <= row["pl_orbper"] <= 500   # reasonable orbital distance
    return 1 if (radius_ok and temp_ok and period_ok) else 0

df["label"] = df.apply(label_habitability, axis=1)

total   = len(df)
hab     = int(df["label"].sum())
not_hab = total - hab
print(f"Total planets:          {total}")
print(f"Potentially habitable:  {hab}  ({hab/total*100:.1f}%)")
print(f"Not habitable:          {not_hab}  ({not_hab/total*100:.1f}%)")
print()


# ── Section 3: Train Random Forest ────────────────────────────────────────────

print("=" * 50)
print("SECTION 3: Training Random Forest classifier")
print("=" * 50)

X = df[FEATURES].values  # feature matrix: shape (n_planets, 8)
y = df["label"].values    # label vector:   shape (n_planets,)

# Split 80% for training, 20% for testing.
# stratify=y ensures both splits have the same ratio of habitable/not-habitable.
# random_state=42 makes the split reproducible (same result every run).
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"Training on {len(X_train)} planets, testing on {len(X_test)}...")

clf = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1)
clf.fit(X_train, y_train)

y_pred   = clf.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)

print(f"\nAccuracy: {accuracy * 100:.2f}%\n")
print(classification_report(y_test, y_pred, target_names=["Not Habitable", "Habitable"]))

# Feature importances: how much each feature contributed to the model's decisions.
importances = dict(zip(FEATURES, clf.feature_importances_.tolist()))
top_feature = max(importances, key=importances.get)

print("Feature importances (higher = more influential):")
for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
    bar = "█" * int(imp * 50)
    print(f"  {feat:<15} {imp:.4f}  {bar}")
print(f"\nTop feature: {top_feature}")
print()


# ── Section 4: Generate habitability scores for every planet ──────────────────

print("=" * 50)
print("SECTION 4: Scoring all planets")
print("=" * 50)

# predict_proba returns a 2-column array: [prob_class_0, prob_class_1]
# We take column [:, 1] — the probability of being habitable — for every planet.
# This is run on ALL data (X), not just the test split.
probas = clf.predict_proba(X)[:, 1]
df["habitability_score"] = probas
df["is_habitable"]       = df["label"] == 1

print(f"Scored {len(df)} planets. Score range: {probas.min():.3f} – {probas.max():.3f}")
print()


# ── Section 5: Export JSON ────────────────────────────────────────────────────

print("=" * 50)
print("SECTION 5: Exporting JSON")
print("=" * 50)

os.makedirs(DATA_DIR, exist_ok=True)

planets = []
for _, row in df.iterrows():
    # sy_dist is in parsecs. Convert to light-years (1 parsec = 3.262 ly).
    # Use None if the value is missing — JSON null is cleaner than a fake number.
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

print(f"Exported {len(planets)} planets → {JSON_PATH}")

# Export model metadata for the website's stats display.
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

print(f"Exported model stats   → {STATS_PATH}")
print("\nDone.")
