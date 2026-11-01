#!/usr/bin/env python3
"""Internal operator entry point; never give participants private dataset credentials.

This entry point is not an access-control boundary. Hugging Face permissions and
the controlled evaluation infrastructure enforce data access. Public submission
execution/isolation is not implemented by this local operator utility.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decide_benchmark.cli import main

if __name__ == "__main__":
    raise SystemExit(main(maintainer=True))
