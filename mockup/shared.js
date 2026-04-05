// Shared layout components for all mockup pages

function createSidebar(activePage) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', href: 'dashboard.html' },
    { id: 'robots', label: 'Robots', icon: 'Bot', href: 'robots.html' },
    { id: 'missions', label: 'Missions', icon: 'Target', href: 'missions.html' },
    { id: 'maps', label: 'Maps', icon: 'Map', href: 'maps.html' },
    { id: 'events', label: 'Events / Logs', icon: 'Activity', href: 'events.html' },
    { id: 'operators', label: 'Operators', icon: 'Users', href: 'operators.html' },
    { id: 'settings', label: 'Settings', icon: 'Settings', href: '#' },
  ];

  const icons = {
    LayoutDashboard: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    Bot: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>`,
    Target: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    Map: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16"/><path d="M16 6v16"/></svg>`,
    Activity: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    Users: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    Settings: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  };

  const items = menuItems.map(item => {
    const isActive = item.id === activePage;
    return `
      <a href="${item.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
        ${isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}">
        ${icons[item.icon]}
        ${item.label}
      </a>`;
  }).join('');

  return `
    <aside class="fixed left-0 top-0 bottom-0 w-60 bg-slate-900 border-r border-slate-800 flex flex-col z-30">
      <div class="h-14 flex items-center px-5 border-b border-slate-800">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>
          </div>
          <span class="text-white font-bold text-lg">RobotOps</span>
        </div>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        ${items}
      </nav>
      <div class="px-3 py-4 border-t border-slate-800">
        <div class="flex items-center gap-2 px-3 text-xs text-slate-500">
          <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
          System Online
        </div>
      </div>
    </aside>`;
}

function createHeader(title, subtitle) {
  return `
    <header class="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-20">
      <div>
        <h1 class="text-lg font-semibold text-slate-900">${title}</h1>
        ${subtitle ? `<p class="text-xs text-slate-500">${subtitle}</p>` : ''}
      </div>
      <div class="flex items-center gap-4">
        <div class="relative">
          <input type="text" placeholder="Search..." class="w-64 h-9 pl-9 pr-4 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <svg class="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </div>
        <button class="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
        <div class="flex items-center gap-2 pl-4 border-l border-slate-200">
          <div class="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-sm font-medium text-slate-600">OP</div>
          <div class="text-sm">
            <div class="font-medium text-slate-700">Operator</div>
            <div class="text-xs text-slate-400">Admin</div>
          </div>
        </div>
      </div>
    </header>`;
}

function initLayout(activePage, title, subtitle) {
  document.getElementById('sidebar').innerHTML = createSidebar(activePage);
  document.getElementById('header').innerHTML = createHeader(title, subtitle);
}
