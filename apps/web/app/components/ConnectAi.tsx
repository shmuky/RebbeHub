import { useState, type ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { Icon } from '../ui/Icon.js';

/**
 * Connecting an AI app (Claude, ChatGPT, Cursor, VS Code) to RebbeHub's
 * MCP server, written for someone who has never heard the word MCP: pick
 * your app, copy one address, follow two or three steps. Where the app
 * takes a link that adds the server by itself (Cursor, VS Code), that is
 * one button. Signing in happens in the app afterwards, on RebbeHub's own
 * consent page (/oauth/consent), so no token is ever copied by hand.
 * Everything here is plain text and links: nothing is fetched.
 */

type AppId = 'claude' | 'chatgpt' | 'claude-code' | 'cursor' | 'vscode' | 'other';

const APPS: Array<{ id: AppId; name: string }> = [
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'vscode', name: 'VS Code' },
  { id: 'other', name: '…' },
];

const WORDS = {
  he: {
    address: 'הכתובת להדבקה',
    copy: 'העתקה',
    copied: 'הועתק',
    which: 'באיזו אפליקציה אתם משתמשים?',
    other: 'אחרת',
    open: (app: string) => `פתיחה ב-${app}`,
    claude: [
      <>פתחו את הגדרות ה-Connectors של Claude (הכפתור למטה), ובחרו <b>Add custom connector</b>.</>,
      <>בשם כתבו <b>RebbeHub</b>, ובכתובת הדביקו את הכתובת שלמעלה. לחצו <b>Add</b>.</>,
      <>לחצו <b>Connect</b>, היכנסו ל-RebbeHub ואשרו. זהו.</>,
    ],
    claudeNote: 'מה שמחברים באתר Claude עובד גם באפליקציה במחשב ובטלפון.',
    chatgpt: [
      <>ב-ChatGPT פתחו <b>Settings</b> ואז <b>Apps &amp; Connectors</b>. אם אין אפשרות להוסיף, הפעילו שם את <b>Developer mode</b> (תחת Advanced).</>,
      <>בחרו <b>Create</b>, כתבו את השם <b>RebbeHub</b> והדביקו את הכתובת שלמעלה. בחיבור (Authentication) בחרו <b>OAuth</b>.</>,
      <>היכנסו ל-RebbeHub כשתתבקשו ואשרו.</>,
    ],
    claudeCode: [<>הריצו בטרמינל את הפקודה הזאת:</>, <>ב-Claude Code כתבו <code>/mcp</code> ובחרו את rebbehub כדי להתחבר לחשבון (צריך רק כדי לשלוח הצעות).</>],
    cursor: [<>לחצו על הכפתור. Cursor ייפתח וישאל אם להוסיף את RebbeHub; אשרו.</>, <>כשהכלים יבקשו, היכנסו ל-RebbeHub ואשרו.</>],
    vscode: [<>לחצו על הכפתור. VS Code ייפתח וישאל אם להתקין את RebbeHub; אשרו.</>, <>כשהכלים יבקשו, היכנסו ל-RebbeHub ואשרו.</>],
    otherSteps: [<>בכל אפליקציה שמקבלת שרת MCP מרוחק (remote / HTTP): הוסיפו שרת בשם <b>RebbeHub</b> עם הכתובת שלמעלה.</>, <>אם האפליקציה לא יודעת להתחבר עם OAuth, צרו טוקן אישי בחשבון שלכם ושלחו אותו ככותרת <code dir="ltr">Authorization: Bearer rhp_…</code>.</>],
    readFree: 'קריאה וחיפוש עובדים בלי חשבון. רק שליחת תיקונים ודיווחים מבקשת להיכנס, וכל מה שנשלח נבדק כמו כל הצעה.',
    tryTitle: 'נסו לשאול:',
    tries: ['חפש ב-RebbeHub את השיחות בלקוטי שיחות על פרשת נח', 'מה אמר הרבי בהתוועדות י״ט כסלו תשכ״ב? תן לי את הקלטות', 'מצאתי טעות בכותרת של שיחה ב-RebbeHub, תציע תיקון'],
  },
  en: {
    address: 'The address to paste',
    copy: 'Copy',
    copied: 'Copied',
    which: 'Which app do you use?',
    other: 'Another',
    open: (app: string) => `Open in ${app}`,
    claude: [
      <>Open Claude's Connectors settings (the button below) and choose <b>Add custom connector</b>.</>,
      <>Name it <b>RebbeHub</b> and paste the address above. Press <b>Add</b>.</>,
      <>Press <b>Connect</b>, sign in to RebbeHub and say yes. That's it.</>,
    ],
    claudeNote: 'What you connect on claude.ai works in the desktop and phone apps too.',
    chatgpt: [
      <>In ChatGPT open <b>Settings</b>, then <b>Apps &amp; Connectors</b>. If there is no way to add one, turn on <b>Developer mode</b> there (under Advanced).</>,
      <>Choose <b>Create</b>, name it <b>RebbeHub</b> and paste the address above. For Authentication choose <b>OAuth</b>.</>,
      <>Sign in to RebbeHub when asked, and say yes.</>,
    ],
    claudeCode: [<>Run this in a terminal:</>, <>In Claude Code type <code>/mcp</code> and pick rebbehub to sign in (only needed to send suggestions).</>],
    cursor: [<>Press the button. Cursor opens and asks whether to add RebbeHub; say yes.</>, <>When a tool asks, sign in to RebbeHub and say yes.</>],
    vscode: [<>Press the button. VS Code opens and asks whether to install RebbeHub; say yes.</>, <>When a tool asks, sign in to RebbeHub and say yes.</>],
    otherSteps: [<>In any app that takes a remote (HTTP) MCP server: add a server named <b>RebbeHub</b> with the address above.</>, <>If the app can't sign in with OAuth, make a personal token in your account and send it as the header <code dir="ltr">Authorization: Bearer rhp_…</code>.</>],
    readFree: 'Reading and searching need no account. Only sending fixes and reports asks you to sign in, and whatever is sent is reviewed like any suggestion.',
    tryTitle: 'Try asking:',
    tries: ['Find the Likkutei Sichos on Parshas Noach on RebbeHub', 'What did the Rebbe say at the Yud-Tes Kislev 5722 farbrengen? Give me the recordings', 'I found a mistake in a sicha\'s title on RebbeHub; suggest a fix'],
  },
} as const;

/** The one-click links: Cursor's and VS Code's own install links, from their docs. */
export function installLinks(mcpUrl: string) {
  const cursorConfig = btoa(JSON.stringify({ url: mcpUrl }));
  return {
    claude: 'https://claude.ai/settings/connectors',
    chatgpt: 'https://chatgpt.com/',
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=rebbehub&config=${encodeURIComponent(cursorConfig)}`,
    vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'rebbehub', type: 'http', url: mcpUrl }))}`,
    claudeCode: `claude mcp add --transport http rebbehub ${mcpUrl}`,
  };
}

function CopyLine({ text, lang, big }: { text: string; lang: Lang; big?: boolean }) {
  const w = WORDS[lang];
  const [copied, setCopied] = useState(false);
  return (
    <div className={`secret-line ai-copy${big ? ' big' : ''}`}>
      <code dir="ltr">{text}</code>
      <button
        type="button"
        className={`btn sm${big ? ' primary' : ''}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(text).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? w.copied : w.copy}
      </button>
    </div>
  );
}

function Steps({ steps }: { steps: readonly ReactNode[] }) {
  return (
    <ol className="ai-steps">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

export function ConnectAi({ lang, mcpUrl, compact }: { lang: Lang; mcpUrl: string; compact?: boolean }) {
  const w = WORDS[lang];
  const [app, setApp] = useState<AppId>('claude');
  const links = installLinks(mcpUrl);
  const openButton = (to: string, name: string) => (
    <a className="btn primary" href={to} target={to.startsWith('http') ? '_blank' : undefined} rel="noopener">
      <Icon name={to.startsWith('http') ? 'external' : 'link'} />
      {w.open(name)}
    </a>
  );

  return (
    <div className={`ai-connect${compact ? ' compact' : ''}`}>
      <div className="ai-address">
        <span className="field-label">{w.address}</span>
        <CopyLine text={mcpUrl} lang={lang} big />
      </div>

      <fieldset className="ai-apps">
        <legend>{w.which}</legend>
        <div className="ai-app-row" role="radiogroup">
          {APPS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={app === a.id} className={`btn sm${app === a.id ? ' on' : ''}`} onClick={() => setApp(a.id)}>
              {a.id === 'other' ? w.other : a.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="ai-how" aria-live="polite">
        {app === 'claude' ? (
          <>
            <Steps steps={w.claude} />
            <div className="btn-row">{openButton(links.claude, 'Claude')}</div>
            <p className="hint">{w.claudeNote}</p>
          </>
        ) : app === 'chatgpt' ? (
          <>
            <Steps steps={w.chatgpt} />
            <div className="btn-row">{openButton(links.chatgpt, 'ChatGPT')}</div>
          </>
        ) : app === 'claude-code' ? (
          <ol className="ai-steps">
            <li>
              {w.claudeCode[0]}
              <CopyLine text={links.claudeCode} lang={lang} />
            </li>
            <li>{w.claudeCode[1]}</li>
          </ol>
        ) : app === 'cursor' ? (
          <>
            <div className="btn-row">{openButton(links.cursor, 'Cursor')}</div>
            <Steps steps={w.cursor} />
          </>
        ) : app === 'vscode' ? (
          <>
            <div className="btn-row">{openButton(links.vscode, 'VS Code')}</div>
            <Steps steps={w.vscode} />
          </>
        ) : (
          <Steps steps={w.otherSteps} />
        )}
      </div>

      <p className="ai-free">
        <Icon name="lock" />
        <span>{w.readFree}</span>
      </p>

      {compact ? null : (
        <div className="ai-try">
          <b>{w.tryTitle}</b>
          <ul>
            {w.tries.map((q) => (
              <li key={q} dir="auto">
                “{q}”
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
