import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import fs from 'fs';
import path from 'path';

function walkDir(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) walkDir(filePath, fileList);
    else if (file.endsWith('.md')) fileList.push(filePath);
  }
  return fileList;
}

const reports = defineCollection({
  loader: async () => {
    const reportsDir = path.resolve('src/content/reports');
    const mdFiles = walkDir(reportsDir);

    return mdFiles.map(mdPath => {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const jsonPath = mdPath.replace(/\.md$/, '.metadata.json');

      if (!fs.existsSync(jsonPath)) {
        throw new Error(`Missing metadata JSON for ${mdPath}. Add ${path.basename(mdPath).replace('.md', '')}.metadata.json`);
      }

      const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const relPath = path.relative(reportsDir, mdPath);

      return {
        id: relPath.replace(/\.md$/, ''),
        ...metadata,
        body: content,
      };
    });
  },
  schema: z.object({
    slug: z.string(),
    protocol: z.string(),
    protocolSlug: z.string(),
    chain: z.string(),
    auditDate: z.string(),
    securityScore: z.number(),
    securityGrade: z.string(),
    riskLevel: z.string(),
    dealBreakers: z.string(),

    dealBreakerDetails: z.array(z.object({
      item: z.string(),
      status: z.string(),
      evidence: z.string(),
      category: z.string().optional(),
    })).default([]),

    accessControlRoles: z.array(z.object({
      contract: z.string(),
      role: z.string(),
      holder: z.string(),
      powers: z.string(),
    })).default([]),

    contracts: z.array(z.object({
      name: z.string(),
      address: z.string(),
      verified: z.boolean(),
      type: z.string(),
      compiler: z.string(),
    })).default([]),

    keyFindings: z.array(z.string()).default([]),
    findingsSummary: z.string().default(''),

    dealBreakerGate: z.enum(['Pass', 'Conditional', 'Watchlist', 'Fail', 'Inconclusive']).default('Inconclusive'),
    complexityTier: z.string().default(''),

    openIssues: z.array(z.object({
      issue: z.string(),
      category: z.string(),
      severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
      impact: z.string(),
      recommendation: z.string(),
      priority: z.enum(['P0', 'P1', 'P2']),
      timeline: z.string(),
    })).default([]),

    auditHistory: z.array(z.object({
      date: z.string(),
      firm: z.string(),
      tier: z.number().int().min(1).max(3),
      scope: z.string().default(''),
      findings: z.object({
        critical: z.number().default(0),
        high: z.number().default(0),
        medium: z.number().default(0),
        low: z.number().default(0),
      }).optional(),
      reportUrl: z.string().default(''),
    })).default([]),

    adminControlMatrix: z.array(z.object({
      surface: z.string(),
      controller: z.string(),
      controllerType: z.enum(['EOA', 'Multisig', 'Governance', 'Timelock', 'Contract', 'Unknown']),
      multisigConfig: z.string().optional(),
      delayHours: z.number().default(0),
      worstCase: z.string(),
    })).default([]),

    protocolMeta: z.object({
      website: z.string().default(''),
      docs: z.string().default(''),
      github: z.string().default(''),
      type: z.string().default(''),
      subtype: z.string().default(''),
      tvlUsd: z.number().nullable().default(null),
      tvlSource: z.string().default(''),
      launchDate: z.string().default(''),
    }).optional(),

    bugBounty: z.object({
      provider: z.string(),
      maxBountyUsd: z.number().nullable().default(null),
      url: z.string().default(''),
    }).nullable().default(null),

    dealBreakerSummary: z.object({
      pass: z.number().default(0),
      fail: z.number().default(0),
      na: z.number().default(0),
      inconclusive: z.number().default(0),
    }).optional(),

    body: z.string(),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    description: z.string().optional(),
    relatedProtocol: z.string().optional(),
    draft: z.boolean().default(false),
    kind: z.enum(['incident', 'research', 'essay']).default('essay'),
    incident: z.object({
      loss: z.string().optional(),
      scope: z.enum(['single-market', 'protocol-wide', 'cross-protocol', 'ecosystem']).optional(),
      status: z.enum(['post-mortem', 'ongoing', 'unresolved']).optional(),
      occurredOn: z.coerce.date().optional(),
    }).optional(),
  }),
});

export const collections = { reports, notes };
