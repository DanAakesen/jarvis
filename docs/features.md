# Features

## Software Factory tools

Jarvis uses the backend tool registry from chat and voice to operate the Software
Factory:

- `list_projects` lists active projects and their IDs.
- `list_tasks` lists tasks with the Tasks API's project, agent, state, date,
  search, and bounded pagination filters.
- `get_task` returns a task and bounded event summaries without event payloads.
- `create_task` creates a Ready task from a project ID and prompt, using Codex
  unless another supported agent is selected. Optional model and reasoning
  settings override the project/default settings for that task.
- `steer_task`, `pause_task`, `resume_task`, and `cancel_task` use the task
  controller and its state-dependent lifecycle rules.

The backend exposes each tool's input schema through `GET /tools`, validates
calls through `POST /tools/{name}`, and records chat tool results against the
source message. Success, refusal, and failure confirmations are built from the
backend result; the model does not decide whether an action succeeded.
