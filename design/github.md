repo: shmuky/RebbeHub
branch: main
path: apps/web

## Last sync
date: 2026-09-30T23:20:00Z

### Updated in this project
- Turn 2: new printed-sefer look (paper, ink, one red accent); library tree with collections and printings; transcript player now uses a Rebbe recording
- Copied the site's fonts (Noto Sans Hebrew, Noto Sans, Frank Ruhl Libre, FrankRuehlCLM) and the favicon mark
- Built the phone redesign on tokens.css colours for light and dark mode
- Recreated today's /daily page and a text page at phone width for reference

## Screen map
| Screen | Repo files |
| --- | --- |
| 2a–2j Sefer direction | same sources as the matching 1x screens |
| 1a Library shelves | app/components/Library.tsx, app/ui/Shaar.tsx, app/lib/shelves.ts, styles/items.css, styles/components.css (.shaar) |
| 1b / 1h Reading page | styles/pages/words.css, app/components/ChapterNav.tsx, styles/items.css (.chapter-nav) |
| 1c / 1g Audio player | app/player/PlayerBar.tsx, styles/layout.css (.player-*) |
| 1d / 1e Suggest + review | styles/pages/suggestion.css, styles/components.css (.diff, .review-box, .scanline) |
| 1f Daily learning | app/routes/daily.tsx, styles/pages/daily.css |
| 1i More sheet | app/ui/Header.tsx (.sheet), styles/layout.css |
| Shell (all) | app/root.tsx, app/ui/Header.tsx, app/ui/Icon.tsx, styles/tokens.css, styles/fonts.css, styles/base.css, styles/layout.css |
| 0a / 0b Today | app/routes/daily.tsx, app/components/DailyShiurim.tsx, app/ui/ItemShell.tsx, app/player/PlayerBar.tsx, styles/pages/daily.css, styles/pages/words.css, styles/items.css, styles/layout.css |
