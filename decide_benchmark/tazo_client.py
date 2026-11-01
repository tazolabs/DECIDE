"""Multipart Tazo choice requests, public model IDs, and bounded retries."""
from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import random
import threading
import time
from urllib.parse import urlparse


MODEL_ALIASES = {"ted-v5-bosun-7b-audio-jev": "tazo-large"}


def api_model_id(model):
    """Resolve only observed API aliases; unknown model IDs still match exactly."""
    if not isinstance(model, str) or not model.strip():
        raise ValueError("A nonempty model ID is required")
    return MODEL_ALIASES.get(model, model)


class ModelMismatchError(ValueError):
    """A response from a different model must not enter benchmark scores."""


def validate_response(payload, request):
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object response")
    requested, returned = request["model"], payload.get("model")
    expected = api_model_id(requested)
    if not isinstance(returned, str) or not returned.strip() or api_model_id(returned) != expected:
        raise ModelMismatchError(f"Response model mismatch: requested {requested!r} (API ID {expected!r}), received {returned!r}")
    return {"api_model": expected, "response_model": returned, **validate_choice_response(payload, request)}


def validate_choice_response(payload, request):
    """Shared choice contract; confidence is independent of choice probability."""
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object response")
    decision = payload.get("answers", {}).get("action") if isinstance(payload.get("answers"), dict) else None
    if not isinstance(decision, dict) or decision.get("type") != "choice":
        raise ValueError("Missing answers.action choice response")
    criteria = request["questions"]["action"]["criteria"]
    probabilities = decision.get("probabilities")
    if not isinstance(probabilities, dict) or set(probabilities) != set(criteria):
        raise ValueError("Probabilities must contain exactly the requested option IDs")
    if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in probabilities.values()):
        raise ValueError("Invalid probability values")
    total = sum(probabilities.values())
    if not math.isclose(total, 1, abs_tol=0.001):
        raise ValueError("Probabilities do not sum to one within rounding tolerance")
    choice, confidence = decision.get("choice"), decision.get("confidence")
    if not isinstance(choice, str) or choice not in criteria or type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise ValueError("Invalid selected choice or confidence")
    if probabilities[choice] < max(probabilities.values()) - 0.000001:
        raise ValueError("Selected choice disagrees with the probability argmax")
    elapsed = payload.get("elapsed_ms")
    elapsed = elapsed if type(elapsed) in (int, float) and math.isfinite(elapsed) and elapsed >= 0 else None
    usage = payload.get("usage")
    try:
        json.dumps(usage, allow_nan=False)
    except (ValueError, TypeError):
        usage = None
    return {"choice": choice, "confidence": confidence, "probabilities": probabilities,
        "normalized_probabilities": {k: v / total for k, v in probabilities.items()},
        "probability_sum": total, "decision_id": payload.get("id") if isinstance(payload.get("id"), str) else None, "server_elapsed_ms": elapsed, "usage": usage}


def retry_after(value):
    try:
        seconds = float(value)
        return max(0, seconds) if math.isfinite(seconds) else 0
    except (ValueError, TypeError):
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError, AttributeError):
            return 0


class RateGate:
    def __init__(self, requests_per_second, stop):
        if not math.isfinite(requests_per_second) or requests_per_second <= 0:
            raise ValueError("Requests per second must be positive")
        self.interval = 1 / requests_per_second
        self.next_at = self.blocked_until = 0.0
        self.lock, self.stop = threading.Lock(), stop

    def wait(self):
        while not self.stop.is_set():
            with self.lock:
                delay = max(self.next_at, self.blocked_until) - time.monotonic()
                if delay <= 0:
                    self.next_at = time.monotonic() + self.interval
                    return True
            self.stop.wait(min(delay, 1))
        return False

    def cooldown(self, seconds):
        with self.lock:
            self.blocked_until = max(self.blocked_until, time.monotonic() + seconds)


class TazoClient:
    transient_statuses = {429, 500, 502, 503, 504}
    provider_name = "Tazo"

    def __init__(self, api_url, token, *, requests_per_second=1, max_attempts=3, timeout=(10, 90), session_factory=None):
        parsed = urlparse(api_url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
            raise ValueError("Use HTTPS for the Tazo API (HTTP is allowed only for local tests)")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("API URL must not contain credentials, a query or a fragment")
        if max_attempts < 1:
            raise ValueError("Max attempts must be positive")
        if session_factory is None:
            import requests
            session_factory = requests.Session
        self.api_url, self.token, self.timeout = api_url, token, timeout
        self.max_attempts, self.session_factory = max_attempts, session_factory
        self.local, self.stop = threading.local(), threading.Event()
        self.gate = RateGate(requests_per_second, self.stop)

    def post(self, session, request, audio_path):
        with audio_path.open("rb") as audio:
            return session.post(self.api_url,
                headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"},
                data={"request": json.dumps(request, ensure_ascii=False)},
                files={"audio": (audio_path.name, audio, "audio/wav")}, timeout=self.timeout, allow_redirects=False)

    def validate(self, payload, request):
        return validate_response(payload, request)

    def predict(self, request, audio_path):
        # Use the public ID on the wire, including for direct client callers.
        wire_request = {**request, "model": api_model_id(request["model"])}
        if not hasattr(self.local, "session"):
            self.local.session = self.session_factory()
        attempts = []
        started = time.perf_counter()
        last = {"error": "Stopped before request", "fatal": False, "status_code": None, "body": "", "api_model": wire_request["model"]}
        for number in range(1, self.max_attempts + 1):
            if not self.gate.wait():
                break
            attempt_start = time.perf_counter()
            try:
                response = self.post(self.local.session, wire_request, audio_path)
                # Redact before parsing/persisting even if an upstream error echoes auth.
                body = response.text.replace(self.token, "<redacted>")
                last = {"status_code": response.status_code, "body": body, "api_model": wire_request["model"],
                    "fatal": response.status_code in {401, 402, 403, 404} or 300 <= response.status_code < 400}
                attempts.append({"attempt": number, "status_code": response.status_code, "client_ms": (time.perf_counter() - attempt_start) * 1000})
                if 200 <= response.status_code < 300:
                    try:
                        payload = json.loads(body)
                        if isinstance(payload, dict) and isinstance(payload.get("model"), str):
                            last["response_model"] = payload["model"]
                        answer = self.validate(payload, request)
                    except (ValueError, TypeError, KeyError) as exc:
                        last["error"] = f"Invalid API response: {exc}"
                        if isinstance(exc, ModelMismatchError):
                            last["fatal"] = True
                            self.stop.set()
                        break
                    return {**last, **answer, "ok": True, "attempts": attempts, "client_ms": (time.perf_counter() - started) * 1000}
                last["error"] = f"{self.provider_name} HTTP {response.status_code}"
                if last["fatal"]:
                    self.stop.set()
                transient = response.status_code in self.transient_statuses
                delay = max(retry_after(response.headers.get("Retry-After")), 2 ** (number - 1) + random.uniform(0, 0.25))
            except OSError as exc:
                # RequestException inherits OSError; do not serialize credential-bearing reprs.
                last = {"error": f"Network/audio error: {type(exc).__name__}", "status_code": None, "body": "", "fatal": False, "api_model": wire_request["model"]}
                attempts.append({"attempt": number, "status_code": None, "error": type(exc).__name__, "client_ms": (time.perf_counter() - attempt_start) * 1000})
                transient, delay = True, 2 ** (number - 1) + random.uniform(0, 0.25)
            if transient:
                self.gate.cooldown(delay)
            if not transient or number == self.max_attempts:
                break
        return {**last, "ok": False, "attempts": attempts, "client_ms": (time.perf_counter() - started) * 1000}
