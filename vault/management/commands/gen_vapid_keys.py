"""One-time VAPID keypair generator. Run:  python manage.py gen_vapid_keys
Copy the two values into your environment (.env / PythonAnywhere env vars)."""

import base64

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Generate a VAPID keypair for Web Push and print env-ready values."

    def handle(self, *args, **opts):
        key = ec.generate_private_key(ec.SECP256R1())
        d = key.private_numbers().private_value.to_bytes(32, "big")
        pub = key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        self.stdout.write("Add these to your environment:\n")
        self.stdout.write(f"VAPID_PRIVATE_KEY={_b64u(d)}")
        self.stdout.write(f"VAPID_PUBLIC_KEY={_b64u(pub)}")
        self.stdout.write("VAPID_SUBJECT=mailto:you@example.com")
