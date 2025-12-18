import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'chat-graph',
  description: 'A type-safe conversational flow engine',
  // IMPORTANT: set base for GitHub Pages project site
  // https://<user>.github.io/<repo>/ -> base should be '/<repo>/'
  base: '/chat-graph/',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/TheMoenix/chat-graph' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Graph Building', link: '/guide/graph-building' },
        { text: 'State Management', link: '/guide/state-management' },
        { text: 'Persistence', link: '/guide/persistence' },
        {
          text: 'Building',
          items: [
            { text: 'Action', link: '/guide/building/action' },
            { text: 'Validate', link: '/guide/building/validate' },
            { text: 'Edge', link: '/guide/building/edge' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/TheMoenix/chat-graph' },
    ],
  },
});
