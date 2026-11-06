"""Guard the publication boundary without credentials or private fixture data."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from refresh_public_samples import outside_checkout, ROOT, validate_plan, validate_public_text


class PublicSampleReviewTests(unittest.TestCase):
    def plan(self):
        return {"rows": [{"id": f"sample-{n}", "clip_id": f"clip-{n}",
            "source_row_id": f"private-{n}", "source_audio_sha256": "a" * 64,
            "reviewed_audio_sha256": "b" * 64, "spans": [],
            "review": {"independent_transcripts_checked": True,
                       "identified_entities_reviewed": True,
                       "redacted_retranscription_checked": True}} for n in range(20)]}

    def test_incomplete_review_and_missing_reviewed_hash_rejected(self):
        plan = self.plan()
        validate_plan(plan)
        for key in plan["rows"][0]["review"]:
            changed = copy.deepcopy(plan)
            changed["rows"][0]["review"][key] = False
            with self.assertRaises(ValueError):
                validate_plan(changed)
        del plan["rows"][0]["reviewed_audio_sha256"]
        with self.assertRaises(ValueError):
            validate_plan(plan)

    def test_duplicate_clip_and_extra_rows_rejected(self):
        plan = self.plan()
        plan["rows"][1]["clip_id"] = plan["rows"][0]["clip_id"]
        with self.assertRaises(ValueError):
            validate_plan(plan)
        plan = self.plan()
        plan["rows"].append(copy.deepcopy(plan["rows"][0]))
        with self.assertRaises(ValueError):
            validate_plan(plan)

    def test_contact_and_private_identifier_leak_rejected(self):
        for text in ("person@example.com", "1234567890", "row_012345abcdef", "agent_13"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                validate_public_text({"context": text})
        validate_public_text({"context": "A masked client name: [REDACTED_CLIENT]."})

    def test_private_inputs_cannot_be_staged_inside_checkout(self):
        for path in (ROOT, ROOT / "private-staging", ROOT / "site" / "source"):
            with self.assertRaises(ValueError):
                outside_checkout(path)


if __name__ == "__main__":
    unittest.main()
