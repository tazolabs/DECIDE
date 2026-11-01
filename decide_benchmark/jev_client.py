"""TypeSafe System One JSON transport, with the shared choice validation/retries."""
from __future__ import annotations

import json
import re

from .tazo_client import ModelMismatchError, TazoClient, validate_choice_response

DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_JEV_MODEL = "jev-1.13.0"  # Pinned stable release; --model accepts other versions/aliases.
JEV_ALIASES = {"jev-latest", "jev-preview"}


def validate_jev_response(payload, request):
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object response")
    requested, returned = request["model"], payload.get("model")
    version = isinstance(returned, str) and re.fullmatch(r"jev-\d+\.\d+(?:\.\d+)?(?:[-.][A-Za-z0-9]+)*", returned)
    if returned != requested and not (requested in JEV_ALIASES and version):
        raise ModelMismatchError(f"Jev response model mismatch: requested {requested!r}, received {returned!r}")
    return {"api_model": requested, "response_model": returned, **validate_choice_response(payload, request)}


class JevClient(TazoClient):
    transient_statuses = TazoClient.transient_statuses | {408, 529}
    provider_name = "Jev"

    def __init__(self, *args, long_context=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.long_context = long_context

    def post(self, session, request, audio_path):
        # No multipart, binary audio, attachment, or local audio path is sent to Jev.
        body = json.dumps(request, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > 32 * 1024 * 1024:
            raise ValueError("Jev request exceeds its 32 MiB JSON limit; no request sent")
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json", "Content-Type": "application/json"}
        if self.long_context:
            headers["TypeSafe-Danger-Zone-Long-Context"] = "true"
        return session.post(self.api_url, headers=headers, data=body, timeout=self.timeout, allow_redirects=False)

    def validate(self, payload, request):
        return validate_jev_response(payload, request)
