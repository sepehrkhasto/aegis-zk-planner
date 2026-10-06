"""vault/push.py — Web Push, the zero-knowledge way (v1.11).

We send *payload-free* pushes ("tickles"). Two consequences we like:

1. No RFC 8291 payload encryption is needed at all — an empty push only
   requires VAPID authorization, which is a signed ES256 JWT. So this file
   implements just VAPID, in ~60 lines of `cryptography`, with no pywebpush
   dependency to babysit on PythonAnywhere.
2. Neither this server nor Google's/Mozilla's push service ever carries a
   byte of task content. The visible notification text is composed by the
   service worker on the device, from IndexedDB.

VAPID keys come from the environment (see `gen_vapid_keys` management
command): VAPID_PRIVATE_KEY (base64url d-value), VAPID_PUBLIC_KEY
(base64url uncompressed point, the same string the browser gets), and
VAPID_SUBJECT (a mailto: or https: contact URL).
"""

import base64
import json
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
)
from cryptography.hazmat.primitives import hashes
from django.conf import settings


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _private_key():
    d = int.from_bytes(_b64u_dec(settings.VAPID_PRIVATE_KEY), "big")
    return ec.derive_private_key(d, ec.SECP256R1())


def vapid_headers(endpoint: str) -> dict:
    """Authorization + Crypto-Key headers for one push endpoint's origin."""
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(endpoint))
    claims = {
        "aud": origin,
        "exp": int(time.time()) + 12 * 3600,
        "sub": settings.VAPID_SUBJECT,
    }
    header = _b64u(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    body = _b64u(json.dumps(claims).encode())
    signing_input = f"{header}.{body}".encode()

    der_sig = _private_key().sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)  # JWT wants raw r||s, not DER
    jwt = f"{header}.{body}." + _b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))

    pub = settings.VAPID_PUBLIC_KEY
    return {
        "Authorization": f"vapid t={jwt}, k={pub}",
        "TTL": "300",   # a reminder is worthless after a few minutes
        "Urgency": "high",
    }


def send_tickle(subscription) -> bool:
    """POST an empty push. Returns False when the subscription is dead
    (endpoint answered 404/410) so callers can prune it."""
    import requests  # local import: keeps module importable without network

    try:
        r = requests.post(
            subscription.endpoint,
            headers=vapid_headers(subscription.endpoint),
            data=b"",
            timeout=10,
        )
    except requests.RequestException:
        return True  # transient network trouble ≠ dead subscription
    if r.status_code in (404, 410):
        return False
    return True
