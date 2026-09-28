import { useRouteLoaderData } from 'react-router';
import type { Lang } from './i18n.js';

/** The page's language, from the root loader. */
export function useLang(): Lang {
  const data = useRouteLoaderData('root') as { lang?: Lang } | undefined;
  return data?.lang ?? 'he';
}
