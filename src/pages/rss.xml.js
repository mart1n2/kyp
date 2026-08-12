import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { parseAuditDate } from '../utils/format';

export async function GET(context) {
  // Was a notes feed; the notes moved to mart1n.xyz, so this now publishes
  // assessments. One item per report, newest audit first — a re-assessment of an
  // already-covered protocol is a distinct item, which is the point.
  const reports = (await getCollection('reports')).sort((a, b) =>
    b.data.auditDate.localeCompare(a.data.auditDate)
  );

  return rss({
    title: 'Know Your Protocol — Assessments',
    description:
      'Permission analysis and audit findings for DeFi protocols: trust surfaces, deal-breaker gates, and contract inventories.',
    site: context.site,
    items: reports.map(report => ({
      title: `${report.data.protocol} (${report.data.chain}) — grade ${report.data.securityGrade}, gate ${report.data.dealBreakerGate}`,
      description:
        report.data.findingsSummary ||
        `Permission analysis and audit findings for ${report.data.protocol} on ${report.data.chain}.`,
      pubDate: parseAuditDate(report.data.auditDate) ?? undefined,
      link: `/reports/${report.data.protocolSlug}/${report.data.slug}`,
      categories: [report.data.chain, report.data.riskLevel].filter(Boolean),
    })),
    customData: '<language>en</language>',
  });
}
