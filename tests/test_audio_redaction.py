from array import array
import io
import math
import unittest
import wave

from tools.redact_public_audio import redact_wav


def wav(samples):
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        stream.writeframes(array("h", samples).tobytes())
    return output.getvalue()


def frames(data):
    with wave.open(io.BytesIO(data), "rb") as stream:
        return stream.getparams(), stream.readframes(stream.getnframes())


class AudioRedactionTests(unittest.TestCase):
    def test_replacement_removes_source_and_preserves_every_other_frame(self):
        original = wav([round(10000 * math.sin(n / 11)) for n in range(16000)])
        alternative = wav([-7000] * 16000)
        spans = [{"start_seconds": 0.2, "end_seconds": 0.6}]
        params, before = frames(original)
        after_params, after = frames(redact_wav(original, spans))
        _, other = frames(redact_wav(alternative, spans))
        start, end = 3200 * 2, 9600 * 2
        self.assertEqual(params, after_params)
        self.assertEqual(before[:start], after[:start])
        self.assertEqual(before[end:], after[end:])
        self.assertEqual(after[start:end], other[start:end])
        self.assertNotEqual(after[start:end], before[start:end])
        samples = array("h", after[start:end])
        self.assertEqual(samples[0], 0)
        self.assertEqual(samples[-1], 0)
        self.assertLessEqual(max(abs(value) for value in samples), 3933)

    def test_invalid_or_overlapping_spans_are_rejected(self):
        source = wav([0] * 16000)
        for spans in ([{"start_seconds": -0.1, "end_seconds": 0.3}],
                      [{"start_seconds": 0.4, "end_seconds": 1.1}],
                      [{"start_seconds": 0.4, "end_seconds": 0.4}],
                      [{"start_seconds": 0.2, "end_seconds": 0.5},
                       {"start_seconds": 0.3, "end_seconds": 0.6}]):
            with self.subTest(spans=spans), self.assertRaises(ValueError):
                redact_wav(source, spans)

    def test_invalid_tone_settings_are_rejected(self):
        for settings in ({"amplitude": 1.0}, {"tone_hz": 9000}, {"fade_ms": -1}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                redact_wav(wav([0] * 16000), [], **settings)


if __name__ == "__main__":
    unittest.main()
