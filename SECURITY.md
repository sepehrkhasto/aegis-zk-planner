# Security Policy

Aegis Planner is a zero-knowledge application, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/sepehrkhasto/aegis-zk-planner/security/advisories/new) for this repository
and include steps to reproduce, the affected component, and the impact you see.

You can expect an acknowledgement within a few days.

## Scope of interest

- Anything that lets the server (or an attacker with database access) read plaintext vault data.
- Weaknesses in the key hierarchy in `static/js/crypto.js`.
- Authentication, lockout, rate-limit, CSRF or CSP bypasses.
- Broken access control on the `/api/*` vault endpoints.

## Design notes

How the encryption works and which threats are (and are not) covered is described in the
[README](README.md#security-model) and, in Persian, in
[`docs/fa/security-design.fa.md`](docs/fa/security-design.fa.md).
