-- Page 604 holds Al-Ikhlas, Al-Falaq and An-Nas; ties on start page must
-- resolve the same way the app's surahForPage does (the LAST surah whose
-- start is ≤ the page), or the push copy and the UI would name different
-- surahs for the same bookmark.
create or replace function public.surah_name_for_page(p int)
returns text
language sql
stable
as $$
  select name from public.surah_starts
  where page <= p
  order by page desc, number desc
  limit 1;
$$;
