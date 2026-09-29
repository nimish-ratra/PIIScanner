import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export interface FindingItemDto {
  entity_type: string;
  redacted_value: string;
  confidence: number;
  start: number;
  end: number;
}

export interface ClassificationResultDto {
  tier: string;
  level: number;
  badge: string;
  recommended_action: string;
  rationale: string;
  total_findings: number;
  findings: FindingItemDto[];
  entity_counts: Record<string, number>;
  file_path: string;
}

@Injectable()
export class ClassificationClientService {
  private readonly logger = new Logger(ClassificationClientService.name);
  private readonly daemonBaseUrl = process.env.CLAISSIFY_DAEMON_URL || 'http://127.0.0.1:47821';
  private readonly agentDir = path.resolve(process.cwd(), '../../agent');

  /**
   * Classify document bytes using the unmodified local Presidio + Tika pipeline.
   * Priority:
   *  1. HTTP POST to local FastAPI microservice /classify/bytes
   *  2. Subprocess fallback via `python -m backend.classifier_cli --json-stdin`
   */
  async classifyStream(filename: string, contentBuffer: Buffer): Promise<ClassificationResultDto> {
    const base64Content = contentBuffer.toString('base64');

    // 1. Try FastAPI Loopback Daemon
    try {
      const response = await fetch(`${this.daemonBaseUrl}/classify/bytes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content_base64: base64Content,
          source_hint: 'O365-Cloud-Connector',
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const entityCounts: Record<string, number> = {};
        for (const f of data.findings || []) {
          entityCounts[f.entity_type] = (entityCounts[f.entity_type] || 0) + 1;
        }

        return {
          tier: data.tier || 'Public',
          level: data.level || 1,
          badge: data.badge || '🟢 Public',
          recommended_action: data.recommended_action || 'Allow',
          rationale: data.rationale || '',
          total_findings: data.total_findings || (data.findings ? data.findings.length : 0),
          findings: data.findings || [],
          entity_counts: entityCounts,
          file_path: filename,
        };
      }
    } catch (httpErr: any) {
      this.logger.debug(`Daemon HTTP call failed (${httpErr.message}). Falling back to headless Python CLI...`);
    }

    // 2. Subprocess Fallback to python -m backend.classifier_cli
    return this.classifyViaSubprocess(filename, base64Content);
  }

  private classifyViaSubprocess(filename: string, base64Content: string): Promise<ClassificationResultDto> {
    return new Promise<ClassificationResultDto>((resolve, reject) => {
      const payload = JSON.stringify({
        filename,
        content_base64: base64Content,
      });

      const pyProcess = spawn('python', ['-m', 'backend.classifier_cli', '--json-stdin'], {
        cwd: this.agentDir,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      pyProcess.stdout.on('data', (d) => (stdout += d.toString()));
      pyProcess.stderr.on('data', (d) => (stderr += d.toString()));

      pyProcess.on('error', (err) => {
        this.logger.error(`Subprocess launch error: ${err.message}`);
        reject(err);
      });

      pyProcess.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(`Classifier CLI exited with code ${code}: ${stderr}`);
          // Safe fallback to Public
          return resolve({
            tier: 'Public',
            level: 1,
            badge: '🟢 Public',
            recommended_action: 'Allow',
            rationale: 'Classifier extraction error (fallback)',
            total_findings: 0,
            findings: [],
            entity_counts: {},
            file_path: filename,
          });
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve({
            tier: parsed.tier || 'Public',
            level: parsed.level || 1,
            badge: parsed.badge || '🟢 Public',
            recommended_action: parsed.recommended_action || 'Allow',
            rationale: parsed.rationale || '',
            total_findings: parsed.total_findings || 0,
            findings: parsed.findings || [],
            entity_counts: parsed.entity_counts || {},
            file_path: filename,
          });
        } catch (jsonErr: any) {
          this.logger.error(`Failed to parse classifier JSON: ${jsonErr.message}. Output was: ${stdout.slice(0, 200)}`);
          reject(jsonErr);
        }
      });

      pyProcess.stdin.write(payload);
      pyProcess.stdin.end();
    });
  }
}
