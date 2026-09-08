# Project Instructions

## User Preferences — Game Room

- 2026-09-08: The user explicitly accepts authentication vulnerabilities and experience-point manipulation in this game room. Exclude login/authentication hardening, sender-identity impersonation prevention, and XP anti-cheat from audits and fixes unless the user explicitly requests them again. Do not repeatedly warn about these accepted issues or make them prerequisites for other work.
- Continue fixing ordinary gameplay, private answer delivery, connection isolation, result persistence, ranking accuracy, and invalid-input handling. This preference is scoped to the game room, not other projects.

## Remote Action Safety

- Keep all code and testing local by default.
- Never deploy, publish, upload, or release changes to an external server or hosting service unless the user explicitly approves that exact action in the current conversation.
- Never run `git push`, publish GitHub Pages, or open a pull request without explicit approval in the current conversation.
- Never change remote databases, including Supabase schema or data, without explicit approval in the current conversation.
- Do not treat a request to implement, test, or run the app as permission to perform any remote action.
- Start a local development server only when the user explicitly asks, and clearly identify it as local rather than deployed.
