import { execSync } from 'child_process';

try {
  execSync('npx pagefind --site dist --output-path dist/pagefind', { stdio: 'inherit' });
  console.log('Pagefind index generated');
} catch (e) {
  console.log('Pagefind generation failed, continuing without search index');
}
