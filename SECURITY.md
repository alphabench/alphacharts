# Security policy

Report a vulnerability privately through GitHub's "Report a vulnerability" (Security tab of
https://github.com/alphabench/alphacharts) rather than a public issue. Include the package, version and a
minimal reproduction. We aim to acknowledge within 5 working days.

Supported: the latest 0.x release.

`@alphacharts/report` sends crash reports only when the host calls `enableCrashReporting` (to the endpoint the host passes; there is no default); the fields are listed in `packages/report/README.md`.
