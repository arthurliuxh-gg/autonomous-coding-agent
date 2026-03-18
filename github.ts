#!/usr/bin/env tsx

/**
 * GitHub Integration
 * 
 * Create branches, commit changes, create pull requests with structured
 * descriptions including validation results.
 */

import { Octokit } from 'octokit';
import { Logger, ValidationResult } from './logger.js';

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged: boolean;
  mergeable?: boolean;
  mergeable_state?: string;
}

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export interface CommitChange {
  path: string;
  content: string;
  mode?: '100644' | '100755' | '040000';
}

export class GitHubClient {
  private octokit: Octokit;
  private repo: GitHubRepo;
  private logger: Logger;
  private dryRun: boolean;

  constructor(token: string, repo: string, logger: Logger, dryRun = false) {
    this.octokit = new Octokit({
      auth: token,
    });
    
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      throw new Error(`Invalid repo format: ${repo}. Expected 'owner/repo'`);
    }
    
    this.repo = { owner, repo: repoName };
    this.logger = logger;
    this.dryRun = dryRun;
  }

  async verifyConnection(): Promise<void> {
    try {
      const { data } = await this.octokit.rest.repos.get({
        owner: this.repo.owner,
        repo: this.repo.repo,
      });
      await this.logger.info('GitHub connection verified', {
        repo: data.full_name,
        defaultBranch: data.default_branch,
      });
    } catch (error) {
      await this.logger.error('GitHub connection failed', error as Error);
      throw error;
    }
  }

  async getRepo(): Promise<{ owner: string; repo: string }> {
    return this.repo;
  }

  async getDefaultBranch(): Promise<string> {
    const { data } = await this.octokit.rest.repos.get({
      owner: this.repo.owner,
      repo: this.repo.repo,
    });
    return data.default_branch;
  }

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base?: string
  ): Promise<PullRequest> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would create PR', { title, head, base });
      return {
        number: 0,
        title,
        body,
        head,
        base: base || 'main',
        state: 'open',
        html_url: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        merged: false,
      } as PullRequest;
    }

    try {
      const { data } = await this.octokit.rest.pulls.create({
        owner: this.repo.owner,
        repo: this.repo.repo,
        title,
        body,
        head,
        base: base || await this.getDefaultBranch(),
      });

      await this.logger.info('Pull request created', {
        number: data.number,
        title: data.title,
        url: data.html_url,
      });

      await this.logger.audit('PR_CREATED', {
        number: data.number,
        title: data.title,
        url: data.html_url,
        head: data.head.ref,
        base: data.base.ref,
      });

      return data as PullRequest;
    } catch (error) {
      await this.logger.error('Failed to create PR', error as Error, { title, head });
      throw error;
    }
  }

  async addLabels(prNumber: number, labels: string[]): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would add labels', { prNumber, labels });
      return;
    }

    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.repo.owner,
        repo: this.repo.repo,
        issue_number: prNumber,
        labels,
      });

      await this.logger.debug('Labels added', { prNumber, labels });
    } catch (error) {
      await this.logger.warn('Failed to add labels', error as Error, { prNumber, labels });
    }
  }

  async addComment(prNumber: number, body: string): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would add comment', { prNumber, body: body.slice(0, 50) });
      return;
    }

    try {
      await this.octokit.rest.issues.createComment({
        owner: this.repo.owner,
        repo: this.repo.repo,
        issue_number: prNumber,
        body,
      });

      await this.logger.debug('Comment added', { prNumber, bodyLength: body.length });
    } catch (error) {
      await this.logger.warn('Failed to add comment', error as Error, { prNumber });
    }
  }

  async getBranch(branch: string): Promise<{ exists: boolean; sha?: string }> {
    try {
      const { data } = await this.octokit.rest.repos.getBranch({
        owner: this.repo.owner,
        repo: this.repo.repo,
        branch,
      });
      return { exists: true, sha: data.commit.sha };
    } catch (error) {
      if ((error as any).status === 404) {
        return { exists: false };
      }
      throw error;
    }
  }

  async deleteBranch(branch: string): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would delete branch', { branch });
      return;
    }

    try {
      await this.octokit.rest.git.deleteRef({
        owner: this.repo.owner,
        repo: this.repo.repo,
        ref: `heads/${branch}`,
      });

      await this.logger.debug('Branch deleted', { branch });
    } catch (error) {
      await this.logger.warn('Failed to delete branch', error as Error, { branch });
    }
  }

  async getBranches(): Promise<string[]> {
    const { data } = await this.octokit.rest.repos.listBranches({
      owner: this.repo.owner,
      repo: this.repo.repo,
      per_page: 100,
    });
    return data.map(branch => branch.name);
  }

  async parsePRDescription(params: {
    taskName: string;
    taskDescription?: string;
    changes: Array<{ path: string; action: string }>;
    affectedPackages: string[];
    validation: ValidationResult;
    plan: string[];
  }): Promise<string> {
    const {
      taskName,
      taskDescription,
      changes,
      affectedPackages,
      validation,
      plan,
    } = params;

    let body = `## ${taskName}\n\n`;

    if (taskDescription) {
      body += `**Description:** ${taskDescription}\n\n`;
    }

    // What was implemented
    body += `## Changes\n\n`;
    body += `This PR was generated autonomously by the Nebula coding agent.\n\n`;

    if (plan.length > 0) {
      body += `**Implementation Plan:**\n`;
      for (const step of plan) {
        body += `- ${step}\n`;
      }
      body += `\n`;
    }

    // Files changed
    body += `**Files Changed:**\n`;
    for (const change of changes) {
      const icon = change.action === 'create' ? '✨' : change.action === 'delete' ? '🗑️' : '📝';
      body += `${icon} ${change.action}: ${change.path}\n`;
    }
    body += `\n`;

    // Packages affected
    if (affectedPackages.length > 0) {
      body += `**Packages Affected:**\n`;
      for (const pkg of affectedPackages) {
        body += `- ${pkg}\n`;
      }
      body += `\n`;
    }

    // Validation results
    body += `## Validation Results\n\n`;
    
    const typecheckIcon = validation.typecheck.passed ? '✅' : '❌';
    const buildIcon = validation.build.passed ? '✅' : '❌';
    
    body += `- ${typecheckIcon} Typecheck: ${validation.typecheck.passed ? 'PASSED' : 'FAILED'} (${validation.typecheck.durationMs}ms)\n`;
    
    if (validation.build.packages && validation.build.packages.length > 0) {
      body += `- ${buildIcon} Build: ${validation.build.passed ? 'PASSED' : 'FAILED'} (${validation.build.durationMs}ms)\n`;
      body += `  - Packages: ${validation.build.packages.join(', ')}\n`;
    } else {
      body += `- ${buildIcon} Build: ${validation.build.passed ? 'PASSED' : 'FAILED'} (${validation.build.durationMs}ms)\n`;
    }
    
    body += `\n`;

    // Metadata
    body += `---\n\n`;
    body += `*Generated by Nebula Agent* | *${new Date().toISOString()}*\n`;

    return body;
  }

  async createPRWithMetadata(params: {
    taskId: string;
    taskName: string;
    taskDescription?: string;
    branchName: string;
    changes: Array<{ path: string; action: string }>;
    affectedPackages: string[];
    validation: ValidationResult;
    plan: string[];
    labels?: string[];
  }): Promise<PullRequest> {
    const {
      taskId,
      taskName,
      taskDescription,
      branchName,
      changes,
      affectedPackages,
      validation,
      plan,
      labels = ['agent', 'auto-generated'],
    } = params;

    const body = await this.parsePRDescription({
      taskName,
      taskDescription,
      changes,
      affectedPackages,
      validation,
      plan,
    });

    const title = `[Agent] ${taskName}`;

    const pr = await this.createPullRequest(title, body, branchName);

    // Add labels
    await this.addLabels(pr.number, labels);

    // Add comment with task ID
    await this.addComment(pr.number, `Task ID: ${taskId}\n\nThis PR was created automatically. Please review the changes carefully.`);

    return pr;
  }

  async checkPRMergeable(prNumber: number): Promise<{ mergeable: boolean; state: string }> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.repo.owner,
      repo: this.repo.repo,
      pull_number: prNumber,
    });

    return {
      mergeable: data.mergeable ?? false,
      state: data.mergeable_state ?? 'unknown',
    };
  }

  async mergePR(prNumber: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<void> {
    if (this.dryRun) {
      await this.logger.info('DRY_RUN: Would merge PR', { prNumber, method });
      return;
    }

    try {
      await this.octokit.rest.pulls.merge({
        owner: this.repo.owner,
        repo: this.repo.repo,
        pull_number: prNumber,
        merge_method: method,
      });

      await this.logger.info('PR merged', { prNumber, method });
      await this.logger.audit('PR_MERGED', { prNumber, method });
    } catch (error) {
      await this.logger.error('Failed to merge PR', error as Error, { prNumber });
      throw error;
    }
  }
}

export const createGitHubClient = (
  token: string,
  repo: string,
  logger: Logger,
  dryRun = false
): GitHubClient => {
  return new GitHubClient(token, repo, logger, dryRun);
};