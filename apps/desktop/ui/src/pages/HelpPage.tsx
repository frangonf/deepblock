import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
const steps = [
  ['Plan your day', 'Choose today or a future date. Add blocks with a start time, duration and type. Calendar and list show the same plan.'],
  ['Save a revised plan', 'Edits stay in a draft until you save. Save revised plan appends a revision and keeps your previous plan. Discard drops only unsaved edits.'],
  ['Review what changed', 'Choose Show history in the calendar to see saved revisions side by side, or use Compare to inspect changes between two revisions.'],
  ['Record what happened', 'Edit a block to record a focus rating or attach output. Reality runs today’s local ActivityWatch audit; Review shows findings and how much evidence is available.'],
  ['Capture and reflect', 'Backlog holds unscheduled tasks. Schedule today opens a prefilled block. Notes saves Markdown for the selected day.'],
];
export function HelpPage() {
  return <div className="grid max-w-3xl gap-6"><Card><CardHeader><CardTitle>Getting started</CardTitle><CardDescription>A daily plan you can revise as the day changes.</CardDescription></CardHeader><CardContent className="grid gap-5">{steps.map(([title, text]) => <section key={title}><h2 className="mb-1 font-medium">{title}</h2><p className="text-sm text-muted">{text}</p></section>)}<Link to="/planner" className="text-sm text-accent underline">Open planner</Link></CardContent></Card><Card><CardHeader><CardTitle>Focus and reflect intent</CardTitle></CardHeader><CardContent className="text-sm text-muted">The header stores your current intent across clients: focus for doing the work, reflect for reviewing it. It does not alter editing or reminders.</CardContent></Card><Card><CardHeader><CardTitle>Keyboard navigation</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm text-muted">
    <p>Use Tab and Shift+Tab to move between controls, Enter or Space to activate them, and Escape to close a dialog.</p>
    <p>In the planner, press C to add a block, T to go to today, or J and K to go forward and back a day. Use Ctrl/Cmd+S to save the draft and Ctrl/Cmd+Z to undo its last edit.</p>
  </CardContent></Card></div>;
}
