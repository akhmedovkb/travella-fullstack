HOW TO USE (drop-in)
======================
1) Unzip into the ROOT of your repo (where 'frontend/' and 'backend/' are).
2) Commit and push.

Included:
- .github/workflows/audit.yml — self-sufficient audit pipeline:
  * Generates package-lock.json automatically if it's missing.
  * Runs npm ci + npm audit (high) for both frontend and backend (matrix).
- .gitattributes — fixes LF/CRLF warnings on Windows.
