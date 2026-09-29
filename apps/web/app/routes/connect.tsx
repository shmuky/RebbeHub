import { Link } from 'react-router';
import type { Route } from './+types/connect';
import { ConnectAi } from '../components/ConnectAi.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { Box } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * "Use RebbeHub in Claude": connecting an AI app to the MCP server in a
 * minute, for anyone. The same steps are in the account's AI apps
 * section; this page is the one to share, and needs no account. Nothing
 * is read from the catalog: the loader only says where the API is.
 */
const API_FALLBACK = 'https://api.rebbehub.org';

export function loader({ request, context }: Route.LoaderArgs) {
  const { siteUrl, api } = siteOf(context);
  const apiBase = /^https?:\/\//.test(api.baseUrl) ? api.baseUrl.replace(/\/+$/, '') : API_FALLBACK;
  return { lang: langFrom(request), siteUrl, mcpUrl: `${apiBase}/mcp` };
}

const W = {
  title: { he: 'RebbeHub בתוך Claude ו-ChatGPT', en: 'Use RebbeHub in Claude and ChatGPT' },
  lede: {
    he: 'חברו את RebbeHub לאפליקציית ה-AI שלכם, ושאלו אותה על כל שיחה, מאמר, התוועדות והקלטה של הרבי. היא תחפש, תקרא ותביא קישורים מהקטלוג. לוקח דקה, ולא צריך לדעת שום דבר טכני.',
    en: "Connect RebbeHub to your AI app and ask it about any of the Rebbe's sichos, maamarim, farbrengens and recordings. It searches, reads and links to the catalog. It takes a minute, and nothing technical is needed.",
  },
  description: {
    he: 'איך מחברים את RebbeHub ל-Claude, ל-ChatGPT, ל-Cursor ול-VS Code: מעתיקים כתובת אחת ומאשרים.',
    en: 'How to connect RebbeHub to Claude, ChatGPT, Cursor and VS Code: copy one address and say yes.',
  },
  what: { he: 'מה אפשר לעשות כך', en: 'What it can do' },
  can: {
    he: ['לחפש בכל הקטלוג, לפי שם, תאריך עברי או מילים מתוך הטקסט', 'לקרוא שיחה, דף סרוק או תמלול של הקלטה', 'לשלוח תיקון או דיווח בשמכם, לבדיקה של אדם'],
    en: ['Search the whole catalog, by name, Hebrew date, or words in the text', 'Read a sicha, a scanned page, or a recording\'s transcript', 'Send a fix or a report as you, for a person to review'],
  },
  more: { he: 'לפרטים הטכניים', en: 'The technical details' },
  apps: { he: 'האפליקציות שחיברתם', en: 'Apps you connected' },
} as const;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl } = loaderData;
  return pageMeta({ title: W.title[lang], description: W.description[lang], path: '/connect', lang, siteUrl });
}

export default function Connect({ loaderData }: Route.ComponentProps) {
  const { lang, mcpUrl } = loaderData;
  return (
    <>
      <div className="phead">
        <div className="wrap narrow">
          <h1 className="page-title">{W.title[lang]}</h1>
          <p className="lede">{W.lede[lang]}</p>
        </div>
      </div>
      <div className="wrap narrow page stack-lg">
        <Box>
          <div className="set-pad">
            <ConnectAi lang={lang} mcpUrl={mcpUrl} />
          </div>
        </Box>
        <section aria-labelledby="can-h">
          <h2 className="h-side" id="can-h">
            <Icon name="sparkle" className="subtle" />
            {W.what[lang]}
          </h2>
          <ul className="ai-can">
            {W.can[lang].map((c) => (
              <li key={c}>
                <Icon name="check" />
                {c}
              </li>
            ))}
          </ul>
        </section>
        <p className="muted">
          <Link to={href('/account/apps', lang)}>{W.apps[lang]}</Link> · <Link to={href('/developers/agents', lang)}>{W.more[lang]}</Link>
        </p>
      </div>
    </>
  );
}
