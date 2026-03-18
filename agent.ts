#!/usr/bin/env tsx

/**
 * Autonomous Coding Agent - Main Loop
 * 
 * Orchestrates the full workflow:
 * Fetch Trello tasks → Select next task → Plan implementation →
 * Create branch → Apply changes → Validate → Create PR → Update Trello
 */

import { loadConfig, ensureDirectories } from './config.js';
import { createLogger } from './logger.js';
import { createGitManager } from './git.js';
import { createTrelloClient } from './trello.js';
import { createGitHubClient } from './github.js';
import { createPlanner } from './planner.js';
import { createExecutor } from './executor.js';
import { createValidator } from './validator.js';
import type { TrelloCard } from './trello.js';
import type { ValidationResult } from './logger.js';

export interface AgentOptions {
  dryRun?: boolean;
  verbose?: boolean;
  maxRuns?: number;
  taskId?: string; // Run specific task
}

export interface AgentRunResult {
  tasksProcessed: number;
  successful: number;
  failed: number;
  blocked: number;
  details: Array<{
    taskId: string;
    taskName: string;
    status: 'success' | 'failed' | 'blocked';
    prUrl?: string;
    error?: string;
  }>;
}

export class AutonomousAgent {
  private config: Awaited<ReturnType<typeof loadConfig>>;
  private logger: ReturnType<typeof createLogger>;
  private trello: ReturnType<typeof createTrelloClient>;
  private github: ReturnType<typeof createGitHubClient>;
  private git: ReturnType<typeof createGitManager>;
  private planner: ReturnType<typeof createPlanner>;
  private executor: ReturnType<typeof createExecutor>;
  private validator: ReturnType<typeof createValidator>;
  private options: AgentOptions;
  private processedTaskIds = new Set<string>();

  constructor(options: AgentOptions = {}) {
    this.options = {
      dryRun: false,
      verbose: false,
      maxRuns: 3,
      ...options,
    };
  }

  async initialize(): Promise<void> {
    // Load configuration
    this.config = await loadConfig({ dryRun: this.options.dryRun });
    
    // Ensure directories exist
    await ensureDirectories(this.config);
    
    // Initialize logger
    this.logger = createLogger(this.config.logDir, this.options.verbose);
    await this.logger.initialize();
    
    await this.logger.info('Agent initializing', {
      dryRun: this.options.dryRun,
      maxRuns: this.options.maxRuns,
      workspace: this.config.workspaceRoot,
    });
    
    // Initialize integrations
    this.trello = createTrelloClient(
      this.config.trelloApiKey,
      this.config.trelloToken,
      this.config.trelloBoardId,
      this.logger,
      this.config.dryRun
    );
    
    this.github = createGitHubClient(
      this.config.githubToken,
      this.config.githubRepo,
      this.logger,
      this.config.dryRun
    );
    
    this.git = createGitManager(
      this.config.workspaceRoot,
      this.logger,
      this.config.dryRun
    );
    
    this.planner = createPlanner(this.config.workspaceRoot, this.logger);
    
    this.executor = createExecutor(
      this.config.workspaceRoot,
      this.logger,
      this.planner,
      this.config.dryRun
    );
    
    this.validator = createValidator(
      {
        maxRetries: this.config.maxRetries,
        timeoutMs: 5 * 60 * 1000, // 5 minutes
        workspaceRoot: this.config.workspaceRoot,
      },
      this.logger
    );
    
    // Verify connections
    await this.github.verifyConnection();
    await this.git.initialize();
    
    await this.logger.info('Agent initialized successfully');
  }

  /**
   * Run the agent main loop
   */
  async run(): Promise<AgentRunResult> {
    await this.logger.info('Agent run started');
    
    const result: AgentRunResult = {
      tasksProcessed: 0,
      successful: 0,
      failed: 0,
      blocked: 0,
      details: [],
    };
    
    try {
      // Fetch ready tasks from Trello
      const cards = await this.fetchReadyTasks();
      
      await this.logger.info('Fetched tasks from Trello', {
        count: cards.length,
        maxToProcess: this.options.maxRuns,
      });
      
      // Process tasks up to maxRuns limit
      for (const card of cards) {
        if (result.tasksProcessed >= this.options.maxRuns!) {
          await this.logger.info('Reached max tasks limit', { 
            limit: this.options.maxRuns 
          });
          break;
        }
        
        // Skip already processed tasks (idempotency)
        if (this.processedTaskIds.has(card.id)) {
          await this.logger.debug('Skipping already processed task', { 
            taskId: card.id 
          });
          continue;
        }
        
        // Process the task
        const taskResult = await this.processTask(card);
        
        result.tasksProcessed++;
        result.details.push(taskResult);
        
        if (taskResult.status === 'success') {
          result.successful++;
        } else if (taskResult.status === 'failed') {
          result.failed++;
        } else {
          result.blocked++;
        }
        
        this.processedTaskIds.add(card.id);
      }
      
    } catch (error) {
      await this.logger.error('Agent run failed', error as Error);
      throw error;
    }
    
    await this.logger.info('Agent run completed', result);
    
    return result;
  }

  /**
   * Fetch tasks ready for processing from Trello
   */
  private async fetchReadyTasks(): Promise<TrelloCard[]> {
    try {
      const cards = await this.trello.getReadyCards(20);
      
      // Filter out cards that are blocked or have agent label already
      const filteredCards = cards.filter(card => {
        // Skip closed cards
        if (card.closed) return false;
        
        // Skip cards with 'blocked' label
        const hasBlockedLabel = card.labels?.some(
          label => label.name?.toLowerCase() === 'blocked'
        );
        if (hasBlockedLabel) return false;
        
        return true;
      });
      
      await this.logger.debug('Filtered ready tasks', {
        total: cards.length,
        filtered: filteredCards.length,
      });
      
      return filteredCards;
    } catch (error) {
      await this.logger.error('Failed to fetch Trello tasks', error as Error);
      return [];
    }
  }

  /**
   * Process a single Trello task
   */
  private async processTask(card: TrelloCard): Promise<AgentRunResult['details'][number]> {
    const taskId = card.id;
    const taskName = card.name;
    const taskDescription = card.desc;
    
    await this.logger.startTask(taskId, taskName, 'trello');
    await this.trello.addAgentLabel(taskId);
    
    try {
      // Move to in-progress
      await this.trello.moveToInProgress(taskId);
      await this.trello.addUpdateComment(taskId, 'started', `Starting work on: ${taskName}`);
      
      // Generate implementation plan
      const plan = await this.planner.generatePlan(taskName, taskDescription);
      await this.logger.logPlan(plan, taskId);
      
      // Create git branch
      const branchName = await this.git.createBranch(taskId);
      
      // Execute code changes
      const executionResult = await this.executor.execute(
        taskId,
        taskName,
        taskDescription,
        plan.steps
      );
      
      if (!executionResult.success) {
        throw new Error(executionResult.error || 'Execution failed');
      }
      
      await this.logger.logChanges(
        executionResult.changes.map(c => ({
          path: c.path,
          action: c.action,
          linesAdded: c.linesAdded,
          linesRemoved: c.linesRemoved,
        })),
        taskId
      );
      
      // Stage and commit changes
      const changedFiles = executionResult.changes.map(c => c.path);
      await this.git.stageFiles(changedFiles);
      await this.git.commit(
        `feat: ${taskName}`,
        taskId
      );
      
      // Push branch
      await this.git.push(branchName);
      
      // Run validation
      const validationResult = await this.validator.validateWithRetry(taskId);
      await this.logger.logValidation(validationResult, taskId);
      
      if (!validationResult.overall) {
        // Validation failed - attempt rollback
        await this.logger.warn('Validation failed, rolling back', {
          typecheckPassed: validationResult.typecheck.passed,
          buildPassed: validationResult.build.passed,
        }, taskId);
        
        await this.git.rollback(taskId);
        await this.trello.addUpdateComment(
          taskId,
          'blocked',
          `Validation failed:\n- Typecheck: ${validationResult.typecheck.passed ? '✅' : '❌'}\n- Build: ${validationResult.build.passed ? '✅' : '❌'}\n\nTask requires manual review.`
        );
        
        return {
          taskId,
          taskName,
          status: 'blocked',
          error: 'Validation failed after retries',
        };
      }
      
      // Create GitHub PR
      const pr = await this.github.createPRWithMetadata({
        taskId,
        taskName,
        taskDescription,
        branchName,
        changes: executionResult.changes.map(c => ({
          path: c.path,
          action: c.action,
        })),
        affectedPackages: executionResult.affectedPackages,
        validation: validationResult,
        plan: plan.steps,
      });
      
      // Update Trello with PR
      await this.trello.moveToInReview(taskId);
      await this.trello.addPRComment(taskId, pr.html_url, pr.title);
      
      await this.logger.completeTask('completed', pr.html_url);
      
      return {
        taskId,
        taskName,
        status: 'success',
        prUrl: pr.html_url,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      await this.logger.error('Task processing failed', error as Error, {}, taskId);
      
      // Attempt rollback
      try {
        await this.git.rollback(taskId);
      } catch (rollbackError) {
        await this.logger.warn('Rollback failed', rollbackError as Error, {}, taskId);
      }
      
      // Update Trello
      try {
        await this.trello.addUpdateComment(
          taskId,
          'blocked',
          `Task failed: ${errorMessage}\n\nRequires manual intervention.`
        );
      } catch {
        // Ignore Trello update errors
      }
      
      await this.logger.completeTask('failed', undefined, errorMessage);
      
      return {
        taskId,
        taskName,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Run a specific task by ID
   */
  async runTask(taskId: string): Promise<AgentRunResult['details'][number]> {
    await this.logger.info('Running specific task', { taskId });
    
    const card = await this.trello.getCard(taskId);
    return this.processTask(card);
  }

  /**
   * Get agent status
   */
  async getStatus(): Promise<{
    lastRun?: string;
    tasksProcessed: number;
    dryRun: boolean;
  }> {
    const recentLogs = await this.logger.getRecentLogs(1);
    
    return {
      lastRun: recentLogs.find(log => log.action === 'AGENT_RUN_STARTED')?.timestamp,
      tasksProcessed: recentLogs.filter(log => log.action === 'TASK_COMPLETED').length,
      dryRun: this.config.dryRun,
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  const options: AgentOptions = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    maxRuns: parseInt(args.find(a => a.startsWith('--max-runs='))?.split('=')[1] || '3', 10),
  };
  
  const taskIdArg = args.find(a => a.startsWith('--task='));
  if (taskIdArg) {
    options.taskId = taskIdArg.split('=')[1];
  }
  
  const agent = new AutonomousAgent(options);
  
  try {
    await agent.initialize();
    
    let result: AgentRunResult;
    
    if (options.taskId) {
      const taskResult = await agent.runTask(options.taskId);
      result = {
        tasksProcessed: 1,
        successful: taskResult.status === 'success' ? 1 : 0,
        failed: taskResult.status === 'failed' ? 1 : 0,
        blocked: taskResult.status === 'blocked' ? 1 : 0,
        details: [taskResult],
      };
    } else {
      result = await agent.run();
    }
    
    // Print summary
    console.log('\n=== Agent Run Summary ===');
    console.log(`Tasks Processed: ${result.tasksProcessed}`);
    console.log(`Successful: ${result.successful}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Blocked: ${result.blocked}`);
    
    if (result.details.length > 0) {
      console.log('\nDetails:');
      for (const detail of result.details) {
        const icon = detail.status === 'success' ? '✅' : detail.status === 'failed' ? '❌' : '⚠️';
        console.log(`${icon} ${detail.taskName} - ${detail.status}${detail.prUrl ? ` - ${detail.prUrl}` : ''}`);
      }
    }
    
    process.exit(result.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('Agent run failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { main };