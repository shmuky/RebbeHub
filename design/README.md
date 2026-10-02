# RebbeHub design handoff

Design mockups for the RebbeHub web app (repo: shmuky/RebbeHub, apps/web). These are static design references, not production code. Recreate them in the real codebase; do not ship these files.

## Files
- `RebbeHub Screens.dc.html` — main design canvas (open in a browser). Newest work at the top:
  - Turn 5: special pages — Likkutei Sichos index (5a phone, 5c desktop, 5e tablet), single document / letter page (5b phone, 5d desktop)
  - Turn 4: profile (4a), menu & settings (4b), page history (4c), transcript editor (4d), proofreading against scan (4e, desktop), version compare (4f, desktop)
  - Turn 3: library tree, volume, volume source sheet, reading, home (3f phone, 3n desktop), plus tablet/desktop versions
- `RebbeHub Phone.dc.html` — earlier phone explorations (turns 0–2) and the "sefer" direction the later work builds on
- `fonts/` — Noto Sans Hebrew, Noto Sans, Frank Ruhl Libre, FrankRuehlCLM (same files as apps/web/public/fonts)
- `assets/` — favicon / logo mark

## Logo (final)
- Mark: a tall book in the accent colour (`--accent`, #8a2c1e light / #e2957f dark), width:height 4:5, corner radius ~20% of width on the left and ~33% on the right (the rounder side faces outward in RTL). A centred Latin **R** in Frank Ruhl Libre 700, colour `--bg`.
- Wordmark: "RebbeHub" in **Newsreader 600** (Google Fonts), letter-spacing -0.015em, nudged down ~0.21em to sit optically centred against the book.
- In RTL headers the book comes first (on the right), then the name. Full rules (construction, direction, clear space, minimum sizes, placement, colour, misuse): `RebbeHub Logo Guidelines.dc.html`. The **English (left-to-right) lockup is the primary logo**; Hebrew pages use the mirrored version (book on the right).
- `github.md` — map from each screen to the repo files it relates to

## Design rules
- RTL first (`dir="rtl"`), English mirrors it.
- Fonts: Noto Sans Hebrew for UI, Frank Ruhl Libre for titles, FrankRuehlCLM for Torah text.
- Torah text: justified blocks, large first word, footnote numbers in the accent colour that jump to notes printed at the foot of the page, with a "back to text" link.
- Palette ("sefer" theme, light): bg #f7f3ea, card #fffdf8, sunken #ece5d6, rule #dcd2bf, ink #1f1a13 / #4e463a / #776d5e, accent #8a2c1e, ok #2f6b3f, machine (unchecked text dot) #b07a1a. Dark ("sefer-dark"): bg #16130e, card #1f1b15, ink #ede5d5, accent #e2957f. Full token lists are in the `<style>` block at the top of each .dc.html file.
- One accent colour. Quiet line icons (24px grid, 1.5 stroke), no unicode arrows.
- Power features (history, versions, scans, editions) live behind one ⋯ menu per page.
- Plain words in the UI; GitHub terms only in help (הצעת תיקון = Pull request, אישור = Merge, גרסה = Commit, מהדורה = Branch).
- Unchecked machine text: a small quiet dot, never a banner.
- Phone tabs: Home, Library, Daily, Listen, Menu.
- Library: Rebbe, then sefer (unfolds in place as a tree), then main series volumes first, then other parts of the series, then other editions.
- Daily learning: Chumash, Tehillim, Tanya, Rambam (3 chapters / 1 chapter / Sefer Hamitzvos as one toggle), Hayom Yom.
- Audio-to-text transcripts only for the Rebbe's recordings, shiurim and chassidim farbrengens.
