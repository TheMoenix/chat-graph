export default {
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
        { text: 'The Graph', link: '/guide/graph' },
        { text: 'State Management', link: '/guide/state-management' },
        { text: 'Storage & Persistence', link: '/guide/storage-persistence' },
        {
          text: 'Building',
          items: [
            {
              text: 'Node',
              link: '/guide/node',
              items: [
                { text: 'Action', link: '/guide/building/node/action' },
                { text: 'Validate', link: '/guide/building/node/validate' },
              ],
            },

            { text: 'Edge', link: '/guide/building/edge' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/TheMoenix/chat-graph' },
    ],
  },
};
