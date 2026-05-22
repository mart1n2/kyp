import { createMarkdownProcessor } from '@astrojs/markdown-remark';

let processor: ReturnType<typeof createMarkdownProcessor> | null = null;

export async function renderMarkdown(content: string): Promise<string> {
  if (!processor) {
    processor = await createMarkdownProcessor({
      shikiConfig: {
        theme: 'github-dark',
      },
    });
  }
  const result = await processor.render(content);
  return result.code;
}
