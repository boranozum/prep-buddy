# Verifier conformance suite

Populated in M2 (`docs/implementation-plan.md` section 6): at least one
valid and one invalid case per verifier rule (V001-V015), boundary cases,
and randomly generated cases checked against a brute-force reference
checker. Both the TypeScript and Python verifiers must pass every case
here in CI.
