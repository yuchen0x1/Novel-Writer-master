import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from idaas_protocol_signatures import validate_request_signature


class ValidateRequestSignatureTests(unittest.TestCase):
    def test_preserves_the_upstream_md5_wire_format(self):
        self.assertEqual(
            validate_request_signature("client", "3.1", "1700000000", "trace-1"),
            "191f6527fbc78fe69ea43725cb7b2fdd",
        )


if __name__ == "__main__":
    unittest.main()
