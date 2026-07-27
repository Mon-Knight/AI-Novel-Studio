# Autonomous UI Control Panel Plan

The control surface is available at `/novels/:id/autonomous-monitor` and is also linked from the novel detail page. It exposes:

- pending/running/paused/completed job state and progress;
- start, pause, resume, cancel and refresh actions;
- editable quality thresholds;
- token and cost counters;
- auditable action history.

The panel uses the existing light desktop surface, border and button tokens. It does not use Tailwind or introduce a web-admin layout.
