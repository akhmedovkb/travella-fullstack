# Aviation reference directory

Data attribution: OpenTravelData (OPTD) contributors, https://github.com/opentraveldata/opentraveldata .
OPTD's curated/generated data is licensed under Creative Commons Attribution 4.0 International:
https://creativecommons.org/licenses/by/4.0/ . Upstream licensing statement:
https://github.com/opentraveldata/opentraveldata#licensing .

`directory.json` is a modified extract of `optd_por_public.csv` and `optd_airlines.csv`.
The source revision, reference date, source hashes and transformations are recorded in its `source` object.
It is a checked-in local snapshot: user messages, images and bookings are never sent to the directory provider.

Transformations: retain current records, resolve served city names (prefer Russian aliases when present,
otherwise preserve source names), extract IATA and ICAO airport/airline mappings, omit conflicting current
assignments. For shared passenger/cargo IATA codes, prefer the unique non-cargo assignment; ICAO mappings
retain cargo operators. No inferred translations are generated. Existing display text and unknown codes are preserved.

The snapshot is broad coverage, not a guarantee of every code or a real-time flight schedule.
Historic code reassignments are not resolved against individual booking dates.

## Updating

Run from the repository root:

    node backend/scripts/build-aviation-directory.cjs
    npm run test:unit --prefix backend

The update fetches a pinned upstream revision, validates coverage and key entries, then atomically replaces
the snapshot. Download or validation failure leaves the existing file intact. Review the diff and deploy normally.
No runtime network dependency or new API key is required.

Offline reproduction is supported with `--source-dir DIR --as-of YYYY-MM-DD`.
That directory must contain the two upstream CSV files and `aviation-source-commit.txt` with their revision.
