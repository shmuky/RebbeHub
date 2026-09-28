import type { Config } from '@react-router/dev/config';

// Every page is rendered on the server: search engines and slow phones get
// the whole page, and the site works without JavaScript.
export default {
  appDirectory: 'app',
  ssr: true,
} satisfies Config;
