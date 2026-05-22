export async function initPagefind() {
  if (typeof window === 'undefined') return;
  
  try {
    const pagefind = await (globalThis as any).__pagefind;
    
    const searchInput = document.getElementById('search') as HTMLInputElement;
    const searchResults = document.getElementById('pagefind-search');
    
    if (!searchInput || !searchResults || !pagefind) return;
    
    searchInput.addEventListener('input', async (e) => {
      const query = (e.target as HTMLInputElement).value;
      
      if (query.length < 2) {
        searchResults.classList.add('hidden');
        return;
      }
      
      const results = await pagefind.search(query);
      
      if (results.length === 0) {
        searchResults.innerHTML = '<div class="p-4 text-slate-400">No results found</div>';
        searchResults.classList.remove('hidden');
        return;
      }
      
      const html = await Promise.all(results.map(async (r: any) => {
        const data = await r.data();
        return `
          <a href="${data.url}" class="block p-3 hover:bg-slate-700 border-b border-slate-700 last:border-0">
            <div class="font-semibold">${data.meta.title}</div>
            <div class="text-sm text-slate-400 mt-1">${data.excerpt?.substring(0, 100)}...</div>
          </a>
        `;
      }));
      
      searchResults.innerHTML = html.join('');
      searchResults.classList.remove('hidden');
    });
    
    document.addEventListener('click', (e) => {
      if (!searchResults.contains(e.target as Node) && e.target !== searchInput) {
        searchResults.classList.add('hidden');
      }
    });
  } catch (e) {
    console.log('Pagefind not available');
  }
}
