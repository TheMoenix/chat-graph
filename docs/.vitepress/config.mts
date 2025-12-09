import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'chat-graph',
  description: 'A conversational flow engine with two-phase nodes',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [{ text: 'Getting Started', link: '/guide/getting-started' }],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/TheMoenix/chat-graph' },
    ],
  },
});
