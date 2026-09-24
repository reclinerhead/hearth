-- Reseed Kalamazoo under detail-page classification (issue #355).
--
-- The watcher now reads each open advisory's own page (heading + lead)
-- for status and folds those fields into the content hash. The three
-- Kalamazoo rows seeded on 2026-09-24 were hashed from the list entry
-- alone and one of them ("Boil Water Advisory: LOW and HIGH Pressure
-- Districts") is stored as active although its page has said LIFTED since
-- 2026-09-21. Deleting the rows lets the source seed silently (issue #331)
-- under the new formula — the LOW/HIGH row comes back as lifted, nobody
-- is emailed about a four-day-old lift or a hash-only "update" — the same
-- pattern as 20260922230000 and 20260924120000.
--
-- Push this and merge the code back to back, right after a cron tick
-- (:00 / :30). No notification rows reference these advisories (the FK
-- cascades regardless). Portage is untouched.

delete from hearth.water_advisories where pwsid = 'MI0003520';
