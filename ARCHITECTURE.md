# Autonomous Coding Agent - Production Architecture

## Safety-First Design

This agent implements **defensive automation** with multiple layers of protection to prevent destructive changes in production environments.

## Core Principles

1. **Never Destroy**: No deletions without explicit approval
2. **Always Reversible**: Every change tracked with rollback capability
3. **Validate First**: Test before, during, and after changes
4. **Audit Everything**: Complete trail of all actions
5. **Fail Safe**: Stop on errors, never continue blindly

## Execution Flow

1. Load task from queue (state/queue.json)
2. Create isolated git branch (agent/{task-id}-{timestamp})
3. Validate proposed changes against safety rules
4. Backup files before modification
5. Apply changes incrementally
6. Run validation (typecheck + build)
7. On success: commit & mark completed
8. On failure: rollback & mark failed

## Safety Layers

### Layer 1: Task Queue Guards
- Maximum 1 concurrent task (sequential execution)
- Priority-based ordering (security > bugs > features)
- Blocked task detection with backoff
- Duplicate prevention

### Layer 2: File System Guards
- Protected paths (config files, infrastructure)
- Max files per task (10)
- Max lines changed (500)
- No deletions without approval
- Backup before every modification

### Layer 3: Git Guards
- Isolated branch per task
- Feature branch naming: agent/{task-id}-{timestamp}
- Auto-commit with structured messages
- Validation before commit
- Rollback branch on failure

### Layer 4: Validation Guards
- Pre-change baseline (typecheck, build)
- Post-change validation (same checks)
- Automatic rollback on failure
- Change impact analysis

### Layer 5: Audit Trail
- Timestamped log entries
- Change diffs stored
- Rollback capability
- Progress persistence

## Change Types & Restrictions

| Change Type | Max Files | Max Lines | Requires Review |
|-------------|-----------|-----------|-----------------|
| config      | 3         | 100       | No              |
| lib         | 5         | 300       | No              |
| app         | 8         | 400       | No              |
| test        | 10        | 500       | No              |
| delete      | 1         | -         | Yes (manual)    |
| migration   | 3         | 200       | Yes (manual)    |

## Rollback Strategy

### Immediate Rollback (Auto)
Triggered when:
- Validation fails (typecheck/build)
- File write error
- Git operation failure

Process:
1. Stop execution immediately
2. Restore from backups
3. Reset git branch
4. Mark task as failed
5. Log rollback details

### Delayed Rollback (Manual)
For completed tasks that need reverting:
1. Locate commit by task-id
2. Create rollback branch
3. Revert commit
4. Validate rollback
5. Create PR with explanation

## Task Queue System

### Queue File: state/queue.json
Structure:
- queue: array of pending tasks
- history: completed/failed tasks
- blocked: tasks that need manual intervention

### Status Transitions
- pending -> in_progress -> completed
- pending -> in_progress -> failed -> (retry or blocked)
- pending -> in_progress -> blocked

## Audit Trail Format

### Log File: state/audit.log
Format: [timestamp] [level] [task:id] message

Levels: DEBUG, INFO, WARN, ERROR

### Change Diffs: state/diffs/{task-id}.diff
Stored for every task for audit and rollback capability.

## Configuration

### Config File: agent.config.json
Sections:
- safety: file limits, protected paths
- git: branch prefix, commit template
- validation: commands, timeout
- queue: max concurrent, retries, backoff

## Error Recovery

### Transient Errors (Auto-Retry)
- Network failures
- File locks
- Temporary resource unavailability

Retry strategy:
- Max 3 retries
- Exponential backoff (1s, 2s, 4s)
- Different random task after backoff

### Permanent Errors (Block & Alert)
- Validation failures
- Protected file modifications
- Schema violations

Action:
- Mark task as blocked
- Log detailed error
- Continue with next task
- Generate report for review

## Disaster Recovery

### Emergency Stop
Stops all running tasks and preserves state for recovery.

### State Recovery
Restores from backup state file.

### Full Reset
Clears queue, state, and branches. Use only when necessary.