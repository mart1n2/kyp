#!/usr/bin/env node

/**
 * Extract structured metadata from audit reports using AI
 * Usage: node scripts/extract-meta.mjs [report.md]
 * If no file specified, processes all reports in src/content/reports/
 *
 * Environment variables:
 *   OPENAI_API_KEY    - Required. Your OpenAI API key
 *   OPENAI_MODEL      - Optional. Default: gpt-4o-mini
 */

import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, '../src/content/reports');

const SYSTEM_PROMPT = `You are an expert at extracting structured data from DeFi security audit reports.

Extract the following information from the audit report and return it as a JSON object:

{
  "protocol": "Protocol name",
  "chain": "Blockchain(s)",
  "auditDate": "YYYY-MM-DD format",
  "auditor": "Auditor/firm name",
  "securityScore": 0-100 number,
  "securityGrade": "A/B/C/D/E/F",
  "riskLevel": "Critical/High/Medium/Low",
  "recommendation": "Brief investment recommendation",
  "dealBreakers": [
    {
      "title": "Issue name",
      "category": "Access Control/Oracle/Economic/etc",
      "status": "PASS/FAIL/N/A/Inconclusive",
      "evidence": "Brief evidence summary"
    }
  ],
  "permissions": {
    "roles": [
      {
        "contract": "Contract name",
        "role": "Role name",
        "holder": "Holder address or name",
        "holderType": "EOA/Multisig/Governance/Contract/Timelock/Unknown",
        "powers": "What this role can do"
      }
    ],
    "summary": {
      "hasEOAControl": true/false,
      "hasTimelock": true/false,
      "hasMultisig": true/false,
      "eoaControlledContracts": ["list of contracts controlled by EOA"]
    }
  },
  "contracts": [
    {
      "name": "Contract name",
      "address": "0x address",
      "type": "Proxy/Implementation/Immutable/etc",
      "verified": true/false,
      "compiler": "Solidity version"
    }
  ],
  "auditHistory": [
    {
      "date": "Date or Unknown",
      "firm": "Firm name",
      "tier": 1/2/3,
      "reportUrl": "URL or empty"
    }
  ],
  "keyFindings": ["Key finding 1", "Key finding 2"]
}

Rules:
- Extract ALL deal breakers, permissions, and contracts from the report
- Be precise with addresses and contract names
- If a field cannot be determined, use null or omit it
- Return ONLY valid JSON, no markdown formatting
`;

async function extractMetadata(markdown: string): Promise<Record<string, any>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // For large reports, truncate to first 50k chars (should be enough)
  const truncatedMarkdown = markdown.slice(0, 50000);

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: truncatedMarkdown },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('AI returned empty response');
  }

  // Parse JSON (remove any markdown code blocks if present)
  const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(jsonStr);
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results.push(...walkDir(filePath));
    } else if (file.endsWith('.md') && !file.endsWith('.meta.md')) {
      results.push(filePath);
    }
  }
  return results;
}

// Main
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/extract-meta.mjs [report.md]');
  console.log('');
  console.log('Extract structured metadata from audit reports using AI.');
  console.log('');
  console.log('Options:');
  console.log('  [report.md]    Process a specific report file');
  console.log('  (no args)      Process all reports in src/content/reports/');
  console.log('');
  console.log('Environment:');
  console.log('  OPENAI_API_KEY   Required. Your OpenAI API key');
  console.log('  OPENAI_MODEL     Optional. Default: gpt-4o-mini');
  process.exit(0);
}

let reportFiles: string[];

if (args.length > 0) {
  reportFiles = args.map(f => path.resolve(f));
} else {
  reportFiles = walkDir(reportsDir);
}

if (reportFiles.length === 0) {
  console.log('No report files found.');
  process.exit(0);
}

console.log(`Processing ${reportFiles.length} report(s)...\n`);

for (const filePath of reportFiles) {
  const fileName = path.basename(filePath);
  const dir = path.dirname(filePath);
  const baseName = fileName.replace(/\.md$/, '');
  const metaPath = path.join(dir, `${baseName}.meta.json`);

  console.log(`Processing: ${filePath}`);
  
  try {
    const markdown = fs.readFileSync(filePath, 'utf-8');
    
    // Skip if meta.json already exists and is recent
    if (fs.existsSync(metaPath)) {
      const metaStat = fs.statSync(metaPath);
      const mdStat = fs.statSync(filePath);
      if (metaStat.mtimeMs > mdStat.mtimeMs) {
        console.log(`  ⏭️  Meta file already up to date: ${metaPath}`);
        continue;
      }
    }

    const meta = await extractMetadata(markdown);
    
    // Add slug fields
    meta.protocolSlug = meta.protocol
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    meta.slug = baseName.toLowerCase().replace(/\s+/g, '-');

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    console.log(`  ✅ Generated: ${metaPath}`);
    console.log(`     Protocol: ${meta.protocol} | Risk: ${meta.riskLevel} | Grade: ${meta.securityGrade}`);
    
    // Rate limiting - wait between requests
    if (reportFiles.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error: any) {
    console.error(`  ❌ Failed: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\nDone!');
