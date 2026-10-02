# Cosine 2.0 / FinGov

Government data and financial research in one workspace — dashboards, multi-source search, files, and a context-grounded AI assistant.

**Live product:** [fingov.ai](https://fingov.ai)

## Product design case study

End-to-end product design write-up (problem, rejected directions, constraints, UI, outcomes):

**→ [FinGov Product Design Case Study](docs/FinGov-Product-Design-Case-Study.md)**

Covers the Cursor-style dashboard + side chat model, full search pages, Easy Mode, drag-and-drop context, and post-demo learnings. Includes flows, decision diagrams, and final UI screenshots.

## Repository

| Path | Contents |
|------|----------|
| `frontend/react-app/` | React app (dashboards, search, files, chat) |
| `backend_app/` | API / Lambda application code |
| `terraform/` | App infrastructure |
| `docs/` | Architecture notes and the case study above |
| `scripts/` | Ops and helper scripts |

Shared auth, data pipelines, and base AWS modules live in the companion **Cosine-Base-Infra** repository.
