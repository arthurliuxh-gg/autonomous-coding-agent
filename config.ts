#!/usr/bin/env tsx

/**
 * Configuration Module
 * 
 * Loads and validates environment variables for the autonomous agent.
 * Supports DRY_RUN mode for safe testing.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface AgentConfig {
  // GitHub
  githubToken: string;
  githubRepo: string; // owner/repo
  
  // Trello
  trelloApiKey: string;
  trelloToken: string;
  trelloBoardId: string;
  trelloTodoListId?: string;
  trelloReadyListId?: string;
  trelloInProgressListId?: string;
  trelloInReviewListId?: string;
  trelloDoneListId?: string;
  
  // Agent behavior
  dryRun: boolean;
  maxRetries: number;
  maxTasksPerRun: number;
  
  // Paths
  workspaceRoot: string;
  logDir: string;
  stateDir: string;
}

export interface ConfigFile {
  github?: {
    token_env?: string;
    repo: string;
  };
  trello?: {
    api_key_env?: string;
    token_env?: string;
    board_id: string;
    lists?: {
      todo?: string;
      ready?: string;
      in_progress?: string;
      in_review?: string;
      done?: string;
    };
  };
  agent?: {
    dry_run?: boolean;
    max_retries?: number;
    max_tasks_per_run?: number;
  };
}

function loadEnvVar(name: string, required = true): string {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value || '';
}

async function loadConfigFile(): Promise<ConfigFile> {
  const configPath = path.join(process.cwd(), 'scripts', 'agent', 'agent.config.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as ConfigFile;
  } catch (error) {
    console.warn(`Config file not found or invalid: ${configPath}, using environment variables only`);
    return {};
  }
}

export async function loadConfig(overrides?: Partial<AgentConfig>): Promise<AgentConfig> {
  const configFile = await loadConfigFile();
  
  const config: AgentConfig = {
    // GitHub
    githubToken: loadEnvVar(configFile.github?.token_env || 'GITHUB_TOKEN'),
    githubRepo: configFile.github?.repo || loadEnvVar('GITHUB_REPO'),
    
    // Trello
    trelloApiKey: loadEnvVar(configFile.trello?.api_key_env || 'TRELLO_API_KEY'),
    trelloToken: loadEnvVar(configFile.trello?.token_env || 'TRELLO_TOKEN'),
    trelloBoardId: configFile.trello?.board_id || loadEnvVar('TRELLO_BOARD_ID'),
    trelloTodoListId: configFile.trello?.lists?.todo || process.env.TRELLO_TODO_LIST_ID,
    trelloReadyListId: configFile.trello?.lists?.ready || process.env.TRELLO_READY_LIST_ID,
    trelloInProgressListId: configFile.trello?.lists?.in_progress || process.env.TRELLO_IN_PROGRESS_LIST_ID,
    trelloInReviewListId: configFile.trello?.lists?.in_review || process.env.TRELLO_IN_REVIEW_LIST_ID,
    trelloDoneListId: configFile.trello?.lists?.done || process.env.TRELLO_DONE_LIST_ID,
    
    // Agent behavior
    dryRun: overrides?.dryRun ?? configFile.agent?.max_retries ?? false,
    maxRetries: configFile.agent?.max_retries ?? 2,
    maxTasksPerRun: configFile.agent?.max_tasks_per_run ?? 3,
    
    // Paths
    workspaceRoot: path.resolve(process.cwd()),
    logDir: path.join(process.cwd(), 'scripts', 'agent', 'logs'),
    stateDir: path.join(process.cwd(), 'scripts', 'agent', 'state'),
  };
  
  // Apply overrides
  if (overrides) {
    Object.assign(config, overrides);
  }
  
  // Validate required fields
  validateConfig(config);
  
  return config;
}

function validateConfig(config: AgentConfig): void {
  const errors: string[] = [];
  
  if (!config.githubToken) errors.push('GitHub token is required');
  if (!config.githubRepo) errors.push('GitHub repo (owner/name) is required');
  if (!config.trelloApiKey) errors.push('Trello API key is required');
  if (!config.trelloToken) errors.push('Trello token is required');
  if (!config.trelloBoardId) errors.push('Trello board ID is required');
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
  
  // Warn if list IDs are not configured
  if (!config.trelloTodoListId || !config.trelloReadyListId) {
    console.warn('Warning: Trello list IDs not configured. Will fetch all cards and filter by name.');
  }
}

export async function ensureDirectories(config: AgentConfig): Promise<void> {
  await fs.mkdir(config.logDir, { recursive: true });
  await fs.mkdir(config.stateDir, { recursive: true });
}