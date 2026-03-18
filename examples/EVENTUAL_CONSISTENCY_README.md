# Eventual Consistency in Task Discovery

## Problem

The autonomous agent discovers tasks from multiple sources:
- Manual tasks.md files (declarative)
- TODO/FIXME comments in code (discoverable)
- OpenAPI spec gaps (analysis-based)
- Schema vs API mismatches (validation-based)

Each source operates independently and updates at different cadences. This creates **eventual consistency** challenges.

## Example Scenario

### T=0: Initial State

**tasks.md:**
```markdown
- [ ] Add user profile endpoint [priority:high]
```

**Code:**
```typescript
// apps/api-server/src/routes/user.route.ts

// No profile endpoint yet
```

**Discovery Queue:**
- Task: "Add user profile endpoint" (source: manual, priority: high)

---

### T=1: Agent Implements Task

Agent processes the task:
1. Creates branch `agent/user-profile-1234567890`
2. Implements `/api/users/:id/profile` endpoint
3. Adds OpenAPI spec entry
4. Creates PR #42
5. Marks task as "in review" in Trello

**Code (on PR branch):**
```typescript
// apps/api-server/src/routes/user.route.ts

export const getUserProfile = async (req, res) => {
  // Implementation
};

router.get('/users/:id/profile', getUserProfile);
```

**Discovery Queue:**
- Task: "Add user profile endpoint" (status: in_review, PR: #42)

---

### T=2: PR Merged

PR #42 is merged to main branch.

**Code (on main):**
```typescript
// apps/api-server/src/routes/user.route.ts

export const getUserProfile = async (req, res) => {
  // Implementation
};

router.get('/users/:id/profile', getUserProfile);
```

**tasks.md** (not updated yet):
```markdown
- [ ] Add user profile endpoint [priority:high]  # STALE!
```

**Problem:** Next discovery run will **re-discover** this as a pending task because:
- tasks.md still shows it as incomplete
- No automatic cross-reference between tasks.md and code

---

### T=3: Discovery Re-detects Completed Task

Agent runs discovery again:

**Discovery sources report:**
1. **Manual (tasks.md):** "Add user profile endpoint" (incomplete)
2. **TODO scanner:** No related TODOs
3. **OpenAPI gap detector:** No gap (spec exists)
4. **Schema mismatch:** No mismatch

The task queue now has:
- Task: "Add user profile endpoint" (duplicate!)
  - Original: completed, PR merged
  - New: pending (from stale tasks.md)

**Agent might:**
- Re-implement the same feature
- Create conflicting code
- Waste resources

---

## Solution: Idempotency + Cross-Reference

### 1. Task Fingerprinting

Generate a stable ID for each discovered task:

```typescript
function generateTaskFingerprint(task: DiscoveredTask): string {
  const normalized = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `${task.source}-${normalized}`;
}
```

Example:
- Manual: `manual-add-user-profile-endpoint`
- TODO: `todo-implement-caching-layer`

### 2. Deduplication in Queue

Before ingesting:

```typescript
const existingTask = queue.findByFingerprint(fingerprint);

if (existingTask) {
  if (existingTask.status === 'completed') {
    logger.info('Task already completed, skipping');
    return;
  }
  if (existingTask.status === 'in_progress') {
    logger.info('Task already in progress, skipping');
    return;
  }
}
```

### 3. Code-Based Validation

Before starting work, validate the task is still needed:

```typescript
async function validateTaskStillNeeded(task: Task): Promise<boolean> {
  if (task.title.includes('endpoint')) {
    // Check if endpoint already exists
    const endpointExists = await checkEndpointExists(task.title);
    if (endpointExists) {
      logger.info('Endpoint already exists, skipping task');
      return false;
    }
  }
  
  if (task.title.includes('test')) {
    // Check if test file exists
    const testExists = await checkTestExists(task.title);
    if (testExists) {
      logger.info('Test already exists, skipping task');
      return false;
    }
  }
  
  return true;
}
```

### 4. Auto-Update tasks.md After Completion

When a task completes:

```typescript
async function markTaskComplete(taskId: string, prUrl: string) {
  // Update Trello
  await trello.moveToDone(taskId);
  
  // Update tasks.md if source was manual
  if (task.source === 'manual') {
    await updateTasksMarkdown(task.location, {
      status: 'completed',
      pr: prUrl,
      completedAt: new Date().toISOString(),
    });
  }
}
```

Updated tasks.md:
```markdown
- [x] Add user profile endpoint [priority:high] [completed:2025-01-15] [pr:42]
```

---

## Best Practices

1. **Fingerprint Everything:** Every discovered task gets a stable, deterministic ID
2. **Dedup Before Ingest:** Check queue for duplicates before adding
3. **Validate Before Execute:** Confirm task is still needed before starting work
4. **Update Source of Truth:** Mark tasks complete in their origin (tasks.md, Trello, etc.)
5. **Idempotent Operations:** Agent should safely re-run on same task without side effects

---

## Implementation Status

Current implementation:
- [x] Task fingerprinting
- [x] Queue deduplication
- [ ] Code-based validation (planned)
- [ ] Auto-update tasks.md (planned)
- [ ] Cross-source reconciliation (planned)
