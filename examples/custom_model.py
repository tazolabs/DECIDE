"""Replace predict() with your model. This module is not a performance baseline."""


def predict(example):
    """Receive a model-safe example and return one option ID or a distribution.

    example["request"]["state"] contains the allowed context.
    example["request"]["questions"]["action"] contains instructions and criteria.
    For audio mode, example["audio_path"] points to the exact WAV clip.
    For text mode, state["clip_transcript"] contains the frozen STT representation.
    Reference answers and reviewer notes are never passed to this function.
    """
    question = example["request"]["questions"]["action"]
    # Implement your model inference here, preserving the option IDs and order.
    # Return {"choice": "an_allowed_id", "probabilities": {"an_allowed_id": 0.8, ...}}
    raise NotImplementedError("Connect your model to the context, question, criteria and audio")
