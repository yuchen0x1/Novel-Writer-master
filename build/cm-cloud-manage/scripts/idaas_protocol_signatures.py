"""Protocol-mandated IDaaS request signatures."""

import hashlib


def validate_request_signature(client_id, interface_version, timestamp, trace_id):
    """Return the legacy IDaaS validate signature without changing wire format.

    The upstream endpoint requires this MD5 digest over public request metadata.
    It is a compatibility signature, not a password digest or a local integrity
    primitive, so mark the operation as non-security use for FIPS-aware Python.
    """
    message = (client_id + interface_version + timestamp + trace_id).encode("utf-8")
    return hashlib.md5(message, usedforsecurity=False).hexdigest()
