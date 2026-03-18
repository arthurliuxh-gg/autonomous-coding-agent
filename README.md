# Autonomous Coding Agent

Production-grade autonomous agent that implements tasks from Trello, validates changes, and creates GitHub Pull Requests automatically.

## Overview

This agent behaves like a careful senior developer:
- Fetches tasks from Trello board (todo/ready lists)
- Creates isolated git branches for each task
- Makes minimal, scoped code changes
- Validates all changes (typecheck + build)
- Creates GitHub PRs with detailed descriptions
- Updates Trello cards with PR links

## Quick Start

```bash
# Dry run (preview without changes)
pnpm --filter @workspace/scripts run agent --dry-run --verbose

# Run up to 3 tasks
pnpm --filter @workspace/scripts run agent --max-runs=3

# Run specific task
pnpm --filter @workspace/scripts run agent --task=TRELLO_CARD_ID
```

## Environment Setup

### Required Environment Variables

Create a `.env` file in the workspace root or export these variables:

```bash
# GitHub
GITHUB_TOKEN=ghp_your_personal_access_token
GITHUB_REPO=owner/repo-name

# Trello
TRELLO_API_KEY=your_trello_api_key
TRELLO_TOKEN=your_trello_token
TRELLO_BOARD_ID=your_board_id

# Optional: Specific list IDs (auto-detected if not provided)
TRELLO_TODO_LIST_ID=todo_list_id
TRELLO_READY_LIST_ID=ready_list_id
TRELLO_IN_PROGRESS_LIST_ID=in_progress_list_id
TRELLO_IN_REVIEW_LIST_ID=in_review_list_id
TRELLO_DONE_LIST_ID=done_list_id
```

### Getting Your Trello Credentials

1. **API Key**: Visit https://trello.com/app-key
2. **Token**: Generate at https://trello.com/1/connect?name=Nebula+Agent&expiration=never&response_type=token&scope=read,write
3. **Board ID**: Open your board in browser, the ID is in the URL (e.g., `trello.com/b/BOARD_ID/...`)
4. **List IDs**: Hover over a list, click "..." → "Copy Link", the ID is in the URL

### Getting Your GitHub Token

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Generate a new token with scopes:
   - `repo` (full control of private repositories)
   - `workflow` (update GitHub Actions workflows)
3. Copy and save the token securely

### Configuration File

Alternatively, create `scripts/agent/agent.config.json`:

```json
{
  "github": {
    "token_env": "GITHUB_TOKEN",
    "repo": "your-org/your-repo"
  },
  "trello": {
    "api_key_env": "TRELLO_API_KEY",
    "token_env": "TRELLO_TOKEN",
    "board_id": "your_board_id",
    "lists": {
      "todo": "todo_list_id",
      "ready": "ready_list_id",
      "in_progress": "in_progress_list_id",
      "in_review": "in_review_list_id",
      "done": "done_list_id"
    }
  },
  "agent": {
    "dry_run": false,
    "max_retries": 2,
    "max_tasks_per_run": 3
  }
}
```

## CLI Commands

```bash
# Basic usage
pnpm --filter @workspace/scripts run agent [options]

# Options
--dry-run           Preview changes without applying
--verbose, -v       Enable debug logging
--max-runs=<n>      Maximum tasks per run (default: 3)
--task=<id>         Run specific Trello card ID
--help              Show help
```

## Agent Workflow

### 1. Fetch Tasks
- Connects to Trello board
- Fetches cards from "Todo" and "Ready" lists
- Filters out blocked tasks

### 2. Select Task
- Prioritizes by list position
- Skips already processed tasks (idempotency)
- Adds "agent" label to card

### 3. Plan Implementation
- Parses README.md for project context
- Scans workspace structure
- Generates step-by-step implementation plan
- Detects affected packages

### 4. Create Branch
- Branch naming: `agent/{task-id}-{timestamp}`
- Isolated from main branch
- Clean git state

### 5. Apply Changes
- Makes minimal, scoped modifications
- Respects package boundaries
- Follows existing code patterns

### 6. Validate
- Runs `pnpm run typecheck`
- Runs `pnpm run build` for affected packages
- Auto-retries on failure (max 2 retries)

### 7. Create PR
- Pushes branch to remote
- Creates PR with detailed description:
  - What was implemented
  - Files changed
  - Packages affected
  - Validation results
- Adds labels: `agent`, `auto-generated`

### 8. Update Trello
- Moves card to "In Review" list
- Adds comment with PR link
- Posts summary of changes

## Example Run Output

```
$ pnpm --filter @workspace/scripts run agent --verbose

[2025-01-16T10:00:00.000Z] [INFO] Agent initializing
[2025-01-16T10:00:01.000Z] [INFO] GitHub connection verified: my-org/my-repo
[2025-01-16T10:00:02.000Z] [INFO] Agent initialized successfully
[2025-01-16T10:00:03.000Z] [INFO] Fetched tasks from Trello: 12
[2025-01-16T10:00:04.000Z] [INFO] TASK_STARTED: Add vehicle mileage tracking
[2025-01-16T10:00:05.000Z] [INFO] PLAN_GENERATED: 6 steps, 3 packages, low risk
[2025-01-16T10:00:06.000Z] [INFO] BRANCH_CREATED: agent/task-abc123-1737012345
[2025-01-16T10:00:10.000Z] [INFO] CHANGES_APPLIED: 3 files (2 modified, 1 created)
[2025-01-16T10:00:11.000Z] [INFO] Changes committed: feat: Add vehicle mileage tracking
[2025-01-16T10:00:15.000Z] [INFO] BRANCH_PUSHED: origin/agent/task-abc123-1737012345
[2025-01-16T10:02:30.000Z] [INFO] VALIDATION_COMPLETED: typecheck=✅, build=✅
[2025-01-16T10:02:35.000Z] [INFO] PR_CREATED: #42
[2025-01-16T10:02:36.000Z] [INFO] CARD_MOVED: to in_review
[2025-01-16T10:02:37.000Z] [INFO] TASK_COMPLETED: Add vehicle mileage tracking

=== Agent Run Summary ===
Tasks Processed: 1
Successful: 1
Failed: 0
Blocked: 0

Details:
✅ Add vehicle mileage tracking - success - https://github.com/my-org/my-repo/pull/42
```

## Sample PR Description

```markdown
## Add vehicle mileage tracking

**Description:** Allow users to track vehicle odometer readings over time

## Changes

This PR was generated autonomously by the Nebula coding agent.

**Implementation Plan:**
- Review existing vehicle schema patterns
- Add mileage field to vehicle model
- Update API endpoint for vehicle updates
- Add validation for mileage values
- Update mobile app vehicle form
- Add unit tests

**Files Changed:**
📝 modify: lib/db/schema/vehicle.ts
📝 modify: lib/api/src/routes/vehicles.ts
✨ create: lib/api/src/__tests__/vehicles.test.ts

**Packages Affected:**
- @workspace/db
- @workspace/api-spec
- api-server

## Validation Results

- ✅ Typecheck: PASSED (3241ms)
- ✅ Build: PASSED (8932ms)
  - Packages: @workspace/db, @workspace/api-spec

---

*Generated by Nebula Agent | 2025-01-16T10:02:35.000Z*
```

## Cron Setup

### Unix/Linux (crontab)

```bash
# Edit crontab
crontab -e

# Run every 30 minutes
*/30 * * * * cd /path/to/workspace && pnpm --filter @workspace/scripts run agent >> /var/log/nebula-agent.log 2>&1

# Run every hour at minute 0
0 * * * * cd /path/to/workspace && pnpm --filter @workspace/scripts run agent --max-runs=1 >> /var/log/nebula-agent.log 2>&1

# Run during business hours only (9am-6pm, every hour)
0 9-18 * * 1-5 cd /path/to/workspace && pnpm --filter @workspace/scripts run agent >> /var/log/nebula-agent.log 2>&1
```

### GitHub Actions

Create `.github/workflows/agent.yml`:

```yaml
name: Autonomous Agent

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:      # Manual trigger

jobs:
  agent:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run agent
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPO: ${{ github.repository }}
          TRELLO_API_KEY: ${{ secrets.TRELLO_API_KEY }}
          TRELLO_TOKEN: ${{ secrets.TRELLO_TOKEN }}
          TRELLO_BOARD_ID: ${{ secrets.TRELLO_BOARD_ID }}
        run: pnpm --filter @workspace/scripts run agent --max-runs=1
```

### macOS (launchd)

Create `~/Library/LaunchAgents/gg.nebula.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>gg.nebula.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd /path/to/workspace && pnpm --filter @workspace/scripts run agent</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>  # 30 minutes
    <key>EnvironmentVariables</key>
    <dict>
        <key>GITHUB_TOKEN</key>
        <string>your_token</string>
        <key>TRELLO_API_KEY</key>
        <string>your_key</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/nebula-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/nebula-agent.err</string>
</dict>
</plist>
```

## Logging & Audit

### Log Files

- **Daily logs**: `scripts/agent/logs/agent-YYYY-MM-DD.log`
- **Task logs**: `scripts/agent/logs/task-{task-id}.json`
- **State directory**: `scripts/agent/state/`

### Log Format

Each log entry is a JSON line:

```json
{
  "timestamp": "2025-01-16T10:00:00.000Z",
  "level": "info",
  "task": "card-abc123",
  "action": "TASK_STARTED",
  "details": {
    "taskId": "card-abc123",
    "taskName": "Add vehicle mileage tracking",
    "taskSource": "trello"
  }
}
```

### Audit Trail

All agent actions are logged with `audit` level:
- `TASK_SELECTED` - Task chosen for processing
- `BRANCH_CREATED` - Git branch created
- `FILES_MODIFIED` - Code changes applied
- `VALIDATION_COMPLETED` - Typecheck/build results
- `PR_CREATED` - GitHub PR created
- `CARD_MOVED` - Trello card updated
- `TASK_COMPLETED` - Task finished successfully
- `ROLLBACK_COMPLETED` - Changes rolled back on failure

## Safety Features

### Protected Paths

These files cannot be modified by the agent:
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `.github/` directory
- `.env*` files

### Change Limits

- Maximum 10 files per task
- Maximum 500 lines per task
- No deletions without explicit approval
- No cross-package breaking changes

### Validation Gates

- Typecheck MUST pass before committing
- Build MUST pass for affected packages
- Automatic retry on transient failures (max 2)
- Rollback on validation failure

### Dry Run Mode

Always test with `--dry-run` first:
```bash
pnpm --filter @workspace/scripts run agent --dry-run --verbose
```

## Troubleshooting

### Common Issues

**"GitHub connection failed"**
- Verify `GITHUB_TOKEN` is valid
- Check token has `repo` scope
- Ensure `GITHUB_REPO` is in format `owner/repo`

**"Trello API error"**
- Verify `TRELLO_API_KEY` and `TRELLO_TOKEN`
- Check board ID is correct
- Ensure token has read/write permissions

**"Validation failed"**
- Check typecheck errors in logs
- Run `pnpm run typecheck` manually to diagnose
- Some tasks may require manual intervention

**"No tasks found"**
- Verify Trello board has cards in todo/ready lists
- Check list ID configuration
- Ensure cards are not closed or archived

### Getting Help

1. Check logs: `scripts/agent/logs/agent-*.log`
2. Run with `--verbose` for detailed output
3. Try `--dry-run` to preview without changes
4. Review task-specific logs: `scripts/agent/logs/task-{id}.json`

## Architecture

```
scripts/agent/
├── agent.ts           # Main orchestration loop
├── config.ts          # Configuration & env loading
├── logger.ts          # Structured JSON logging
├── git.ts             # Git operations (branch, commit, push)
├── trello.ts          # Trello API client
├── github.ts          # GitHub API client (PRs)
├── planner.ts         # Task planning & workspace analysis
├── executor.ts        # Code change application
├── validator.ts       # Typecheck & build validation
├── agent.config.json  # Optional configuration file
├── README.md          # This file
├── logs/              # Runtime logs
└── state/             # Persisted state
```

## Best Practices

1. **Always dry-run first** - Test configuration before enabling changes
2. **Monitor initial runs** - Watch first few executions to verify behavior
3. **Use list IDs** - Configure specific Trello list IDs for reliability
4. **Review PRs** - Agent-generated PRs still need human review
5. **Set reasonable limits** - Start with `--max-runs=1` and increase gradually
6. **Check logs regularly** - Review audit trail for insights

## License

MIT - Nebula Project