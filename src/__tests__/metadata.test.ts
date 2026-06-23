import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('metadata JSON validation', () => {
  const reportsDir = path.resolve('src/content/reports');

  function findMdFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) files.push(...findMdFiles(filePath));
      else if (file.endsWith('.md')) files.push(filePath);
    }
    return files;
  }

  const mdFiles = findMdFiles(reportsDir);

  it('has at least one report', () => {
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  for (const mdPath of mdFiles) {
    const reportName = path.relative(reportsDir, mdPath);
    const jsonPath = mdPath.replace(/\.md$/, '.metadata.json');

    it(`${reportName} has metadata JSON`, () => {
      expect(fs.existsSync(jsonPath)).toBe(true);
    });

    if (fs.existsSync(jsonPath)) {
      const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

      it(`${reportName} metadata has required fields`, () => {
        expect(metadata.protocol).toBeTruthy();
        expect(metadata.protocolSlug).toBeTruthy();
        expect(metadata.chain).toBeTruthy();
        expect(metadata.auditDate).toBeTruthy();
        expect(metadata.securityScore).toBeGreaterThanOrEqual(0);
        expect(metadata.securityScore).toBeLessThanOrEqual(100);
        expect(['A', 'B', 'C', 'D', 'E', 'F', 'N/A']).toContain(metadata.securityGrade);
        expect(['Critical', 'High', 'Medium', 'Low', 'Unknown']).toContain(metadata.riskLevel);
      });

      it(`${reportName} has dealBreakerDetails`, () => {
        expect(Array.isArray(metadata.dealBreakerDetails)).toBe(true);
        expect(metadata.dealBreakerDetails.length).toBeGreaterThan(0);
        metadata.dealBreakerDetails.forEach((d: any) => {
          expect(d.item).toBeTruthy();
          expect(['PASS', 'FAIL', 'N/A', 'Inconclusive']).toContain(d.status);
        });
      });

      it(`${reportName} has accessControlRoles`, () => {
        expect(Array.isArray(metadata.accessControlRoles)).toBe(true);
        expect(metadata.accessControlRoles.length).toBeGreaterThan(0);
      });

      it(`${reportName} has contracts`, () => {
        expect(Array.isArray(metadata.contracts)).toBe(true);
        expect(metadata.contracts.length).toBeGreaterThan(0);
        metadata.contracts.forEach((c: any) => {
          expect(c.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
          expect(typeof c.verified).toBe('boolean');
        });
      });

      // Audit-outcome fields — only validate when present.
      if (metadata.dealBreakerGate !== undefined) {
        it(`${reportName} dealBreakerGate is descriptive (not advisory)`, () => {
          expect(['Pass', 'Conditional', 'Watchlist', 'Fail', 'Inconclusive']).toContain(metadata.dealBreakerGate);
          // Public site must not surface position-sizing guidance.
          expect(metadata).not.toHaveProperty('maxPositionSizePct');
          expect(metadata).not.toHaveProperty('investmentDecision');
        });
      }
      if (metadata.monitoringCadence !== undefined) {
        it(`${reportName} monitoringCadence is valid`, () => {
          expect(['Daily', 'Weekly', 'Monthly', 'Quarterly', 'N/A']).toContain(metadata.monitoringCadence);
        });
      }

      if (Array.isArray(metadata.openIssues) && metadata.openIssues.length > 0) {
        it(`${reportName} openIssues are valid`, () => {
          metadata.openIssues.forEach((issue: any) => {
            expect(['Critical', 'High', 'Medium', 'Low']).toContain(issue.severity);
            expect(['P0', 'P1', 'P2']).toContain(issue.priority);
            expect(issue.issue).toBeTruthy();
            expect(issue.recommendation).toBeTruthy();
          });
        });
      }

      if (Array.isArray(metadata.adminControlMatrix) && metadata.adminControlMatrix.length > 0) {
        it(`${reportName} adminControlMatrix entries are valid`, () => {
          metadata.adminControlMatrix.forEach((s: any) => {
            expect(['EOA', 'Multisig', 'Governance', 'Timelock', 'Contract', 'Unknown']).toContain(s.controllerType);
            expect(s.surface).toBeTruthy();
            expect(s.worstCase).toBeTruthy();
            expect(typeof s.delayHours).toBe('number');
            expect(s.delayHours).toBeGreaterThanOrEqual(0);
          });
        });
      }

      if (Array.isArray(metadata.auditHistory) && metadata.auditHistory.length > 0) {
        it(`${reportName} auditHistory tiers are valid`, () => {
          metadata.auditHistory.forEach((a: any) => {
            expect([1, 2, 3]).toContain(a.tier);
            expect(a.firm).toBeTruthy();
          });
        });
      }
    }
  }
});
