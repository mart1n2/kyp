import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { compareNotes } from '../utils/notes';

export async function GET(context) {
  const notes = (await getCollection('notes', ({ data }) => !data.draft)).sort(compareNotes);

  return rss({
    title: 'Know Your Protocol — Notes',
    description:
      'Security research, incident writeups, and short essays on DeFi protocol security.',
    site: context.site,
    items: notes.map(note => ({
      title: note.data.title,
      description: note.data.description ?? '',
      pubDate: note.data.updated ?? note.data.date,
      link: `/notes/${note.id}`,
      categories: note.data.tags,
    })),
    customData: '<language>en</language>',
  });
}
