"""Submit an API for server-side evaluation; never fetch benchmark inputs or labels."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import time
import tempfile
from urllib.parse import urlparse
import uuid

DEFAULT_SERVICE = 'https://decide-benchmark.vercel.app'


def service_url(value):
    parsed = urlparse(value)
    local = parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1'}
    if not parsed.hostname or (parsed.scheme != 'https' and not local) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'', '/'}:
        raise ValueError('Use the HTTPS evaluation-service origin, without credentials, path or query')
    return value.rstrip('/')


def secret(name, *, required=True):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise ValueError('Invalid environment variable name')
    value = os.getenv(name, '').strip()
    value = re.sub(r'^Bearer\s+', '', value, flags=re.I)
    if required and not value:
        raise ValueError(f'Set {name} in the environment or .env')
    return value


def write_receipt(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    # The receipt grants access to aggregate results; never print its token.
    fd, temporary = tempfile.mkstemp(prefix='.decide-receipt-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, indent=2)
            f.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def request(service, method, *, body=None, receipt=None):
    import requests
    headers = {'Accept': 'application/json'}
    params = None
    if receipt:
        headers['Authorization'] = 'Bearer ' + receipt['result_token']
        params = {'id': receipt['id']}
    try:
        response = requests.request(method, service + '/api/evaluations', headers=headers,
                                    params=params, json=body, timeout=(10, 90), allow_redirects=False)
        if not response.ok:
            raise ValueError(f'Hosted evaluation request returned HTTP {response.status_code}. Check the invitation, approved endpoint and service status.')
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError('Invalid hosted service response')
        return payload
    except requests.RequestException as exc:
        raise ValueError(f'Could not contact hosted evaluator ({type(exc).__name__}); retry with the same receipt path') from None


def submit(args):
    from .data import digest
    service = service_url(args.service)
    body = {'endpoint': args.endpoint, 'model': args.model, 'modality': args.modality, 'mode': args.mode,
            'api_key': secret(args.api_key_env, required=False), 'invitation_token': secret(args.submission_token_env)}
    fingerprint = digest({'service': service, **body})
    if args.receipt.exists():
        receipt = json.loads(args.receipt.read_text())
        if receipt.get('submission_fingerprint') != fingerprint:
            raise ValueError('Receipt belongs to a different submission. Use a new --receipt file')
    else:
        receipt = {'service': service, 'submission_fingerprint': fingerprint, 'idempotency_key': str(uuid.uuid4())}
        write_receipt(args.receipt, receipt)
    payload = request(service, 'POST', body={**body, 'idempotency_key': receipt['idempotency_key']})
    if not isinstance(payload.get('result_token'), str) or not isinstance(payload.get('id'), str):
        raise ValueError('Hosted service omitted the job receipt')
    receipt.update(id=payload['id'], result_token=payload.pop('result_token'))
    write_receipt(args.receipt, receipt)
    payload['receipt_file'] = str(args.receipt)
    return payload


def status(args, *, cancel=False):
    receipt = json.loads(args.receipt.read_text())
    if not receipt.get('id') or not receipt.get('result_token'):
        raise ValueError('Submission has no job ID yet; retry the submit command with the same --receipt')
    service = service_url(receipt['service'])
    while True:
        payload = request(service, 'DELETE' if cancel else 'GET', receipt=receipt)
        if cancel or not args.wait or payload['status'] in {'completed', 'failed', 'cancelled'}:
            return payload
        progress = payload['progress']
        print(f"{payload['status']}: {progress['completed']}/{progress['total']} questions", flush=True)
        time.sleep(10)
