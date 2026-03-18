#!/usr/bin/env tsx

/**
 * Git Utilities
 * 
 * Safe git operations with branch isolation and rollback support.
 * - Create feature branches: agent/<task-slug>
 * - Structured commit messages
 * - Change detection
 * - Rollback on failure
 */

import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger.js';

export interface GitStatus {
  branch: string;
  isClean: boolean;
  changedFiles: string[];
  untrackedFiles: string[];
}

export interface BranchInfo {
  name: string;
  exists: boolean;
  isCurrent: boolean;
  remoteExists: boolean;
}

export class GitManager {
  private repoPath: string;
  private logger: Logger;
  private dryRun: boolean;
  private currentBranch?: string;
  private originalBranch?: string;
  private backupDir?: string;

  constructor(repoPath: string, logger: Logger, dryRun = false) {
    this.repoPath = repoPath;
    this.logger = logger;
    this.dryRun = dryRun;
  }

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const result = await execa('git', args, {
        cwd: this.repoPath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Autonomous Agent',
          GIT_AUTHOR_EMAIL: 'agent@nebula.gg',
          GIT_COMMITTER_NAME: 'Autonomous Agent',
          GIT_COMMITTER_EMAIL: 'agent@nebula.gg',
        },
      });
      
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      if (error instanceof Error && 'exitCode' in error) {
        return {
          stdout: '',
          stderr: error.message,
          exitCode: (error as any).exitCode || 1,
        };
      }
      throw error;
    }
  }

  async initialize(): Promise<void> {
    // Verify we're in a git repository
    const result = await this.git('rev-parse', '--git-dir');
    if (result.exitCode !== 0) {
      throw new Error(`Not a git repository: ${this.repoPath}`);
    }
    
    // Store original branch
    const branchResult = await this.git('rev-parse', '--abbrev-ref', 'HEAD');
    this.originalBranch = branchResult.stdout.trim();
    
    await this.logger.debug('Git initialized', { originalBranch: this.originalBranch });
  }

  async getStatus(): Promise<GitStatus> {
    const branchResult = await this.git('rev-parse', '--abbrev-ref', 'HEAD');
    const statusResult = await this.git('status', '--porcelain');
    
    const changedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    
    if (statusResult.stdout) {
      const lines = statusResult.stdout.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const status = line.slice(0, 2);
        const file = line.slice(3).trim();
        
        if (status.startsWith('??')) {
          untrackedFiles.push(file);
        } else if (status.trim()) {
          changedFiles.push(file);
        }
      }
    }
    
    return {
      branch: branchResult.stdout.trim(),
      isClean: changedFiles.length === 0 && untrackedFiles.length === 0,
      changedFiles,
      untrackedFiles,
    };
  }

  async createBranch(taskSlug: string): Promise<string> {
    const timestamp = Date.now();
    const sanitizedSlug = taskSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
    
    const branchName = `agent/${sanitizedSlug}-${timestamp}`;
    
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would create branch', { branchName }, taskSlug);
      this.currentBranch = branchName;
      return branchName;
    }
    
    // Check if branch already exists
    const checkResult = await this.git('rev-parse', '--verify', branchName, '--quiet');
    if (checkResult.exitCode === 0) {
      throw new Error(`Branch ${branchName} already exists`);
    }
    
    // Create and checkout branch
    const result = await this.git('checkout', '-b', branchName);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch: ${result.stderr}`);
    }
    
    this.currentBranch = branchName;
    
    await this.logger.info('Branch created', { branchName }, taskSlug);
    await this.logger.audit('BRANCH_CREATED', { branchName, fromBranch: this.originalBranch }, taskSlug);
    
    return branchName;
  }

  async stageFiles(files: string[]): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would stage files', { files }, this.currentBranch);
      return;
    }
    
    if (files.length === 0) return;
    
    const result = await this.git('add', ...files);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage files: ${result.stderr}`);
    }
    
    await this.logger.debug('Files staged', { count: files.length }, this.currentBranch);
  }

  async commit(message: string, taskId: string): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would commit', { message }, taskId);
      return;
    }
    
    // Check if there are changes to commit
    const status = await this.getStatus();
    if (!status.changedFiles.length) {
      await this.logger.warn('No changes to commit', {}, taskId);
      return;
    }
    
    // Structured commit message: "type: description [agent:task-id]"
    const fullMessage = `${message} [agent:${taskId}]`;
    
    const result = await this.git('commit', '-m', fullMessage);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to commit: ${result.stderr}`);
    }
    
    await this.logger.info('Changes committed', { message: fullMessage }, taskId);
    await this.logger.audit('CHANGES_COMMITTED', { message: fullMessage, files: status.changedFiles }, taskId);
  }

  async push(branch: string, force = false): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would push branch', { branch, force }, this.currentBranch);
      return;
    }
    
    const args = ['push', '-u', 'origin', branch];
    if (force) {
      args.push('--force');
    }
    
    const result = await this.git(...args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to push: ${result.stderr}`);
    }
    
    await this.logger.info('Branch pushed', { branch }, this.currentBranch);
    await this.logger.audit('BRANCH_PUSHED', { branch, remote: 'origin' }, this.currentBranch);
  }

  async checkoutBranch(branch: string): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would checkout branch', { branch });
      this.currentBranch = branch;
      return;
    }
    
    const result = await this.git('checkout', branch);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to checkout branch: ${result.stderr}`);
    }
    
    this.currentBranch = branch;
    await this.logger.debug('Branch checked out', { branch });
  }

  async deleteBranch(branch: string, force = false): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would delete branch', { branch, force });
      return;
    }
    
    const args = ['branch', force ? '-D' : '-d', branch];
    const result = await this.git(...args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to delete branch: ${result.stderr}`);
    }
    
    await this.logger.debug('Branch deleted', { branch });
  }

  async deleteRemoteBranch(branch: string): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would delete remote branch', { branch });
      return;
    }
    
    const result = await this.git('push', 'origin', '--delete', branch);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to delete remote branch: ${result.stderr}`);
    }
    
    await this.logger.debug('Remote branch deleted', { branch });
  }

  async createBackup(taskId: string): Promise<string> {
    const backupDir = path.join(this.repoPath, '.agent-backup', taskId);
    
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would create backup', { backupDir }, taskId);
      this.backupDir = backupDir;
      return backupDir;
    }
    
    const status = await this.getStatus();
    
    if (status.changedFiles.length > 0) {
      await fs.mkdir(backupDir, { recursive: true });
      
      for (const file of status.changedFiles) {
        const srcPath = path.join(this.repoPath, file);
        const destPath = path.join(backupDir, file);
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      }
      
      await this.logger.debug('Backup created', { backupDir, files: status.changedFiles.length }, taskId);
    }
    
    this.backupDir = backupDir;
    return backupDir;
  }

  async rollback(taskId: string): Promise<void> {
    if (!this.backupDir) {
      await this.logger.warn('No backup available for rollback', {}, taskId);
      return;
    }
    
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would rollback', { backupDir: this.backupDir }, taskId);
      return;
    }
    
    try {
      // Restore backed up files
      const files = await fs.readdir(this.backupDir, { recursive: true });
      
      for (const file of files) {
        const srcPath = path.join(this.backupDir, file);
        const destPath = path.join(this.repoPath, file);
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      }
      
      // Reset git state
      await this.git('reset', '--hard', 'HEAD');
      
      // Delete agent branch if we're on one
      if (this.currentBranch?.startsWith('agent/')) {
        await this.checkoutBranch(this.originalBranch || 'main');
        await this.deleteBranch(this.currentBranch, true);
      }
      
      await this.logger.info('Rollback completed', { backupDir: this.backupDir }, taskId);
      await this.logger.audit('ROLLBACK_COMPLETED', { backupDir: this.backupDir }, taskId);
      
    } catch (error) {
      await this.logger.error('Rollback failed', error as Error, {}, taskId);
      throw error;
    }
  }

  async cleanupBackup(taskId: string): Promise<void> {
    if (!this.backupDir) return;
    
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would cleanup backup', { backupDir: this.backupDir }, taskId);
      return;
    }
    
    try {
      await fs.rm(this.backupDir, { recursive: true, force: true });
      await this.logger.debug('Backup cleaned up', { backupDir: this.backupDir }, taskId);
    } catch (error) {
      await this.logger.warn('Failed to cleanup backup', error as Error, { backupDir: this.backupDir }, taskId);
    }
  }

  async getDiff(branch?: string): Promise<string> {
    const targetBranch = branch || this.originalBranch || 'main';
    const result = await this.git('diff', `${targetBranch}...HEAD`);
    return result.stdout;
  }

  async getCurrentBranch(): Promise<string> {
    if (this.currentBranch) return this.currentBranch;
    
    const result = await this.git('rev-parse', '--abbrev-ref', 'HEAD');
    return result.stdout.trim();
  }

  async getOriginalBranch(): Promise<string | undefined> {
    return this.originalBranch;
  }
}

export const createGitManager = (repoPath: string, logger: Logger, dryRun = false): GitManager => {
  return new GitManager(repoPath, logger, dryRun);
};