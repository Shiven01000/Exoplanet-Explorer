import os
import requests

# The NASA Exoplanet Archive TAP service URL.
# We pass the SQL query as a parameter dict and let requests handle
# the URL encoding — this avoids issues with spaces, commas, etc.
# The table is specified inside the SQL (FROM pscomppars), not as a
# separate URL parameter.
BASE_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"

PARAMS = {
    "query": (
        "select pl_name,hostname,pl_rade,pl_bmasse,pl_orbper,"
        "pl_eqt,pl_insol,st_teff,st_rad,st_mass,pl_orbsmax,sy_dist "
        "from pscomppars"
    ),
    "format": "csv",
}

# Save the CSV next to this script, regardless of where you run it from.
# os.path.abspath(__file__) is the full path to fetch_data.py itself.
# os.path.dirname(...) strips the filename, leaving just the directory.
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw_exoplanets.csv")


def main():
    print("Fetching data from NASA Exoplanet Archive...")
    print("This may take 20-60 seconds — the dataset is large.\n")

    # Send the HTTP GET request. timeout=120 means give up after 2 minutes
    # if the server hasn't responded. raise_for_status() will throw an
    # exception if the server returns an error code (e.g. 404, 500).
    response = requests.get(BASE_URL, params=PARAMS, timeout=120)
    response.raise_for_status()

    # Write the raw response text (the CSV) directly to disk.
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(response.text)

    # Count how many planet rows were downloaded.
    # The response may contain comment lines starting with "#" — skip those.
    # The first non-comment line is the header, so subtract 1 for the count.
    lines = response.text.strip().split("\n")
    data_lines = [line for line in lines if not line.startswith("#")]
    planet_count = len(data_lines) - 1

    print(f"Success! Downloaded {planet_count} planets.")
    print(f"Saved to: {OUTPUT_PATH}")
    print(f"File size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
