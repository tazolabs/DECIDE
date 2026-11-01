"""Public hosted client never downloads benchmark data or prints receipt credentials."""
import json
import os
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from decide_benchmark import hosted


class HostedClientTests(unittest.TestCase):
    def test_service_origin_validation(self):
        self.assertEqual(hosted.service_url('https://example.com/'), 'https://example.com')
        for value in ['http://example.com', 'https://user:pass@example.com',
                      'https://example.com/route', 'https://example.com?token=secret', 'https://example.com/#x']:
            with self.assertRaises(ValueError):
                hosted.service_url(value)

    def test_submit_retries_idempotently_and_keeps_result_token_out_of_output(self):
        calls = []
        def remote(service, method, **kwargs):
            calls.append(kwargs['body'])
            return {'id': 'job-id', 'result_token': 'test-result-token', 'status': 'queued'}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'KEY': 'Bearer test-key'}):
            args = SimpleNamespace(service='https://example.com', endpoint='https://model.example.com/predict',
                                   model='my-model', modality='audio', mode='benchmark', api_key_env='KEY',
                                   receipt=Path(tmp) / 'receipt.json')
            with patch.object(hosted, 'request', side_effect=remote):
                first = hosted.submit(args)
                hosted.submit(args)
                self.assertEqual(calls[0]['idempotency_key'], calls[1]['idempotency_key'])
                self.assertEqual(calls[0]['api_key'], 'test-key')
                self.assertNotIn('result_token', first)
                self.assertNotIn('test-result-token', json.dumps(first))
                receipt = json.loads(args.receipt.read_text())
                self.assertEqual(receipt['result_token'], 'test-result-token')
                self.assertNotIn('invitation_token', calls[0])
                self.assertNotIn('test-key', args.receipt.read_text())
                self.assertEqual(args.receipt.stat().st_mode & 0o777, 0o600)
                args.model = 'different-model'
                with self.assertRaises(ValueError):
                    hosted.submit(args)

    def test_pending_receipt_survives_network_failure(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=False):
            args = SimpleNamespace(service='https://example.com', endpoint='https://model.example.com/predict',
                                   model='my-model', modality='text', mode='benchmark', api_key_env='ABSENT_KEY',
                                   receipt=Path(tmp) / 'receipt.json')
            with patch.object(hosted, 'request', side_effect=ValueError('network')):
                with self.assertRaises(ValueError):
                    hosted.submit(args)
            self.assertIn('idempotency_key', json.loads(args.receipt.read_text()))

    def test_public_cli_submits_without_loading_dataset(self):
        from decide_benchmark.cli import main
        with patch('decide_benchmark.cli.Dataset') as loader, patch.object(hosted, 'submit', return_value={'status': 'queued'}), redirect_stdout(StringIO()):
            self.assertEqual(main(['submit', '--endpoint', 'https://example.com', '--model', 'test', '--modality', 'audio']), 0)
            loader.assert_not_called()

    def test_status_authenticates_with_receipt_and_never_follows_redirects(self):
        response = SimpleNamespace(ok=True, json=lambda: {'status': 'completed'})
        with patch('requests.request', return_value=response) as transport:
            hosted.request('https://example.com', 'GET', receipt={'id': 'job-id', 'result_token': 'test-result-token'})
            _, kwargs = transport.call_args
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer test-result-token')
            self.assertEqual(kwargs['params'], {'id': 'job-id'})
            self.assertFalse(kwargs['allow_redirects'])


if __name__ == '__main__':
    unittest.main()
