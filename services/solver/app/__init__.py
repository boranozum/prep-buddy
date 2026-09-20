"""Prep Buddy solver service.

FastAPI + OR-Tools CP-SAT solver and the Python verifier. Populated in M3
(docs/implementation-plan.md section 7). A solver request contains only
tasks with resolved durations, the kit, the concurrency cap and a time
limit — never personal data (CLAUDE.md rule 4).
"""
