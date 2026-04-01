# Planning Notes

These notes capture the transition point between the current safety-first Playwright tool and the next architecture phase.

Use these docs for product and technical planning, not as release notes.

## Documents

- [Phase 1 Completion And Release Plan](/Users/malpern/local-code/youtube-cli/docs/plans/phase-1-completion-and-release-plan.md)
- [Native App And Monorepo Evolution Plan](/Users/malpern/local-code/youtube-cli/docs/plans/native-app-and-monorepo-evolution.md)

## Working assumptions

- The current CLI remains a real product and should be finished cleanly before major architectural expansion.
- The future macOS app should be native, local-first, and performant.
- Playwright remains the YouTube automation executor unless and until a better write transport exists.
- The next architecture phase should happen on a separate branch after a phase 1 release point is tagged.
