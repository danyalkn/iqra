-- ════════════════════════════════════════════════════════════════════════
-- Iqra - 16-line Indo-Pak mushaf, and page counts converted to Uthmani
-- pages for every mushaf (owner ask, 2026-10-17).
--
-- 1. 'indopak16' (a 553-page 16-line Indo-Pak print, a member's cousin
--    reads one) joins the allowed mushaf values on profiles and
--    log_entries. The web PWA cannot pick it (its picker lists only the
--    first two) and falls back to Uthmani positions if it meets one.
--
-- 2. pages_equiv converts page amounts to the standard 604-page Uthmani
--    mushaf. It used to pass page amounts through untouched, so 5 pages in
--    the 849-page 13-line Indo-Pak counted as 5 Uthmani pages in the group
--    khatmah and stats. A page is now scaled by 604 / that mushaf's page
--    count, matching the proportional projection in src/lib/mushaf.ts
--    (INDOPAK13_TOTAL = 849, INDOPAK16_TOTAL = 553: keep the two in step).
--    Quarter, hizb and juz are fixed shares of the Qur'an, so they stay
--    5 / 10 / 20 Uthmani pages in any mushaf. Uthmani rows keep exactly
--    `amount`. No entry used a non-Uthmani mushaf when this was applied,
--    so no history changes.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles drop constraint if exists profiles_mushaf_check;
alter table public.profiles
  add constraint profiles_mushaf_check
  check (mushaf in ('uthmani15', 'indopak13', 'indopak16'));

alter table public.log_entries drop constraint if exists log_entries_mushaf_check;
alter table public.log_entries
  add constraint log_entries_mushaf_check
  check (mushaf in ('uthmani15', 'indopak13', 'indopak16'));

alter table public.log_entries
  alter column pages_equiv set expression as (
    case unit
      when 'page' then
        case mushaf
          when 'indopak13' then round(amount * 604 / 849, 2)
          when 'indopak16' then round(amount * 604 / 553, 2)
          else amount
        end
      when 'quarter' then amount * 5
      when 'hizb' then amount * 10
      when 'juz' then amount * 20
      else null
    end
  );
