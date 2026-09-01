# Phase 4.1A — Legacy parity: exposed engine controls

This pass does not declare Tournament parity complete. It corrects the first Phase 4 workspace so existing engine capabilities are no longer silently hardcoded.

Included in 4.1A:
- inline BO1 result entry and correction;
- inline BO3 set editor;
- persisted format values reload into the form;
- consolation toggle;
- performance vs pots final draw;
- avoid/allow immediate group rematches;
- preferred rest slots exposed;
- category order controls and schedule regeneration;
- schedule regeneration reads preferred rest from saved format config instead of hardcoding one slot;
- parity matrix added as the acceptance source for subsequent 4.1 passes.

Still intentionally NOT marked as parity complete:
- legacy format simulator / minimum guaranteed matches;
- explicit snake/random/manual seeding modes;
- manual groups;
- live progressive draw;
- standings/cross-group transparency in the admin UI;
- group/schedule PNG export;
- visible backup export/import flow;
- public Live/TV and offline sync (later architectural phases, still required before legacy retirement).
