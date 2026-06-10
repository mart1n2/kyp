import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import type { MarkdownHeading } from '@astrojs/markdown-remark';

let processor: Awaited<ReturnType<typeof createMarkdownProcessor>> | null = null;

export interface RenderedMarkdown {
  html: string;
  /** Headings with the exact slugs present in the HTML — use these for TOCs. */
  headings: MarkdownHeading[];
}

export async function renderMarkdown(content: string): Promise<RenderedMarkdown> {
  if (!processor) {
    processor = await createMarkdownProcessor({
      shikiConfig: {
        theme: 'github-dark',
      },
    });
  }
  const result = await processor.render(content);
  return { html: result.code, headings: result.metadata.headings };
}
