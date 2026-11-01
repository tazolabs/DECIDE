#!/usr/bin/env python3
"""Operator-only: pack the frozen benchmark for private worker loading."""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decide_benchmark.data import Dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if root in output.parents and output.relative_to(root).parts[0] not in {'private', 'data'}:
        parser.error('Full dataset bundles must be outside the public tree or in ignored private/data directories')
    dataset = Dataset(args.data)
    dataset.verify()
    assert dataset.manifest['version'] == '1.0' and len(dataset.questions) == 4867
    raw = json.dumps({'version': '1.0', 'fingerprint': dataset.fingerprint,
        'questions': dataset.questions, 'references': dataset.references()}, ensure_ascii=False, separators=(',', ':')).encode()
    packed = gzip.compress(raw, compresslevel=6, mtime=0)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(packed)
    print(json.dumps({'questions': len(dataset.questions), 'compressed_bytes': len(packed),
        'uncompressed_bytes': len(raw), 'sha256': hashlib.sha256(packed).hexdigest()}))


if __name__ == '__main__':
    main()
