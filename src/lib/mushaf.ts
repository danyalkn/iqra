// ════════════════════════════════════════════════════════════════════════
// Iqra - Mushaf map (standard 604-page King Fahd / Madani 15-line Uthmani).
//
// Surah start pages + juz start pages are for the standard mushaf. This is
// STATIC data - the running app makes no network calls (the original 'no Quran
// API at runtime' constraint stands); the table was generated from a reference
// at build time.
//
// Page → juz: every juz spans ~20 pages. Juz 1 is pages 1–21 and juz 30 runs
// long (582–604). Most juz start on an x2 page (22, 42, 62…) but juz 7 (121)
// and juz 11 (201) begin a page earlier in the real mushaf, so we key off the
// exact boundaries rather than a formula.
// ════════════════════════════════════════════════════════════════════════

const MADANI_TOTAL = 604;

/** Start page of each juz in the 15-line Madani mushaf (index 0 → Juz 1). */
const MADANI_JUZ_STARTS = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182,
  201, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

export type Surah = {
  number: number;
  name: string;
  arabic: string;
  page: number;
};

/** Every surah with the page it begins on, ordered by surah number. */
export const SURAHS: Surah[] = [
  { number: 1, name: 'Al-Fatihah', arabic: 'الفاتحة', page: 1 },
  { number: 2, name: 'Al-Baqarah', arabic: 'البقرة', page: 2 },
  { number: 3, name: 'Ali \'Imran', arabic: 'آل عمران', page: 50 },
  { number: 4, name: 'An-Nisa', arabic: 'النساء', page: 77 },
  { number: 5, name: 'Al-Ma\'idah', arabic: 'المائدة', page: 106 },
  { number: 6, name: 'Al-An\'am', arabic: 'الأنعام', page: 128 },
  { number: 7, name: 'Al-A\'raf', arabic: 'الأعراف', page: 151 },
  { number: 8, name: 'Al-Anfal', arabic: 'الأنفال', page: 177 },
  { number: 9, name: 'At-Tawbah', arabic: 'التوبة', page: 187 },
  { number: 10, name: 'Yunus', arabic: 'يونس', page: 208 },
  { number: 11, name: 'Hud', arabic: 'هود', page: 221 },
  { number: 12, name: 'Yusuf', arabic: 'يوسف', page: 235 },
  { number: 13, name: 'Ar-Ra\'d', arabic: 'الرعد', page: 249 },
  { number: 14, name: 'Ibrahim', arabic: 'ابراهيم', page: 255 },
  { number: 15, name: 'Al-Hijr', arabic: 'الحجر', page: 262 },
  { number: 16, name: 'An-Nahl', arabic: 'النحل', page: 267 },
  { number: 17, name: 'Al-Isra', arabic: 'الإسراء', page: 282 },
  { number: 18, name: 'Al-Kahf', arabic: 'الكهف', page: 293 },
  { number: 19, name: 'Maryam', arabic: 'مريم', page: 305 },
  { number: 20, name: 'Taha', arabic: 'طه', page: 312 },
  { number: 21, name: 'Al-Anbya', arabic: 'الأنبياء', page: 322 },
  { number: 22, name: 'Al-Hajj', arabic: 'الحج', page: 332 },
  { number: 23, name: 'Al-Mu\'minun', arabic: 'المؤمنون', page: 342 },
  { number: 24, name: 'An-Nur', arabic: 'النور', page: 350 },
  { number: 25, name: 'Al-Furqan', arabic: 'الفرقان', page: 359 },
  { number: 26, name: 'Ash-Shu\'ara', arabic: 'الشعراء', page: 367 },
  { number: 27, name: 'An-Naml', arabic: 'النمل', page: 377 },
  { number: 28, name: 'Al-Qasas', arabic: 'القصص', page: 385 },
  { number: 29, name: 'Al-\'Ankabut', arabic: 'العنكبوت', page: 396 },
  { number: 30, name: 'Ar-Rum', arabic: 'الروم', page: 404 },
  { number: 31, name: 'Luqman', arabic: 'لقمان', page: 411 },
  { number: 32, name: 'As-Sajdah', arabic: 'السجدة', page: 415 },
  { number: 33, name: 'Al-Ahzab', arabic: 'الأحزاب', page: 418 },
  { number: 34, name: 'Saba', arabic: 'سبإ', page: 428 },
  { number: 35, name: 'Fatir', arabic: 'فاطر', page: 434 },
  { number: 36, name: 'Ya-Sin', arabic: 'يس', page: 440 },
  { number: 37, name: 'As-Saffat', arabic: 'الصافات', page: 446 },
  { number: 38, name: 'Sad', arabic: 'ص', page: 453 },
  { number: 39, name: 'Az-Zumar', arabic: 'الزمر', page: 458 },
  { number: 40, name: 'Ghafir', arabic: 'غافر', page: 467 },
  { number: 41, name: 'Fussilat', arabic: 'فصلت', page: 477 },
  { number: 42, name: 'Ash-Shuraa', arabic: 'الشورى', page: 483 },
  { number: 43, name: 'Az-Zukhruf', arabic: 'الزخرف', page: 489 },
  { number: 44, name: 'Ad-Dukhan', arabic: 'الدخان', page: 496 },
  { number: 45, name: 'Al-Jathiyah', arabic: 'الجاثية', page: 499 },
  { number: 46, name: 'Al-Ahqaf', arabic: 'الأحقاف', page: 502 },
  { number: 47, name: 'Muhammad', arabic: 'محمد', page: 507 },
  { number: 48, name: 'Al-Fath', arabic: 'الفتح', page: 511 },
  { number: 49, name: 'Al-Hujurat', arabic: 'الحجرات', page: 515 },
  { number: 50, name: 'Qaf', arabic: 'ق', page: 518 },
  { number: 51, name: 'Adh-Dhariyat', arabic: 'الذاريات', page: 520 },
  { number: 52, name: 'At-Tur', arabic: 'الطور', page: 523 },
  { number: 53, name: 'An-Najm', arabic: 'النجم', page: 526 },
  { number: 54, name: 'Al-Qamar', arabic: 'القمر', page: 528 },
  { number: 55, name: 'Ar-Rahman', arabic: 'الرحمن', page: 531 },
  { number: 56, name: 'Al-Waqi\'ah', arabic: 'الواقعة', page: 534 },
  { number: 57, name: 'Al-Hadid', arabic: 'الحديد', page: 537 },
  { number: 58, name: 'Al-Mujadila', arabic: 'المجادلة', page: 542 },
  { number: 59, name: 'Al-Hashr', arabic: 'الحشر', page: 545 },
  { number: 60, name: 'Al-Mumtahanah', arabic: 'الممتحنة', page: 549 },
  { number: 61, name: 'As-Saf', arabic: 'الصف', page: 551 },
  { number: 62, name: 'Al-Jumu\'ah', arabic: 'الجمعة', page: 553 },
  { number: 63, name: 'Al-Munafiqun', arabic: 'المنافقون', page: 554 },
  { number: 64, name: 'At-Taghabun', arabic: 'التغابن', page: 556 },
  { number: 65, name: 'At-Talaq', arabic: 'الطلاق', page: 558 },
  { number: 66, name: 'At-Tahrim', arabic: 'التحريم', page: 560 },
  { number: 67, name: 'Al-Mulk', arabic: 'الملك', page: 562 },
  { number: 68, name: 'Al-Qalam', arabic: 'القلم', page: 564 },
  { number: 69, name: 'Al-Haqqah', arabic: 'الحاقة', page: 566 },
  { number: 70, name: 'Al-Ma\'arij', arabic: 'المعارج', page: 568 },
  { number: 71, name: 'Nuh', arabic: 'نوح', page: 570 },
  { number: 72, name: 'Al-Jinn', arabic: 'الجن', page: 572 },
  { number: 73, name: 'Al-Muzzammil', arabic: 'المزمل', page: 574 },
  { number: 74, name: 'Al-Muddaththir', arabic: 'المدثر', page: 575 },
  { number: 75, name: 'Al-Qiyamah', arabic: 'القيامة', page: 577 },
  { number: 76, name: 'Al-Insan', arabic: 'الانسان', page: 578 },
  { number: 77, name: 'Al-Mursalat', arabic: 'المرسلات', page: 580 },
  { number: 78, name: 'An-Naba', arabic: 'النبإ', page: 582 },
  { number: 79, name: 'An-Nazi\'at', arabic: 'النازعات', page: 583 },
  { number: 80, name: '\'Abasa', arabic: 'عبس', page: 585 },
  { number: 81, name: 'At-Takwir', arabic: 'التكوير', page: 586 },
  { number: 82, name: 'Al-Infitar', arabic: 'الإنفطار', page: 587 },
  { number: 83, name: 'Al-Mutaffifin', arabic: 'المطففين', page: 587 },
  { number: 84, name: 'Al-Inshiqaq', arabic: 'الإنشقاق', page: 589 },
  { number: 85, name: 'Al-Buruj', arabic: 'البروج', page: 590 },
  { number: 86, name: 'At-Tariq', arabic: 'الطارق', page: 591 },
  { number: 87, name: 'Al-A\'la', arabic: 'الأعلى', page: 591 },
  { number: 88, name: 'Al-Ghashiyah', arabic: 'الغاشية', page: 592 },
  { number: 89, name: 'Al-Fajr', arabic: 'الفجر', page: 593 },
  { number: 90, name: 'Al-Balad', arabic: 'البلد', page: 594 },
  { number: 91, name: 'Ash-Shams', arabic: 'الشمس', page: 595 },
  { number: 92, name: 'Al-Layl', arabic: 'الليل', page: 595 },
  { number: 93, name: 'Ad-Duhaa', arabic: 'الضحى', page: 596 },
  { number: 94, name: 'Ash-Sharh', arabic: 'الشرح', page: 596 },
  { number: 95, name: 'At-Tin', arabic: 'التين', page: 597 },
  { number: 96, name: 'Al-\'Alaq', arabic: 'العلق', page: 597 },
  { number: 97, name: 'Al-Qadr', arabic: 'القدر', page: 598 },
  { number: 98, name: 'Al-Bayyinah', arabic: 'البينة', page: 598 },
  { number: 99, name: 'Az-Zalzalah', arabic: 'الزلزلة', page: 599 },
  { number: 100, name: 'Al-\'Adiyat', arabic: 'العاديات', page: 599 },
  { number: 101, name: 'Al-Qari\'ah', arabic: 'القارعة', page: 600 },
  { number: 102, name: 'At-Takathur', arabic: 'التكاثر', page: 600 },
  { number: 103, name: 'Al-\'Asr', arabic: 'العصر', page: 601 },
  { number: 104, name: 'Al-Humazah', arabic: 'الهمزة', page: 601 },
  { number: 105, name: 'Al-Fil', arabic: 'الفيل', page: 601 },
  { number: 106, name: 'Quraysh', arabic: 'قريش', page: 602 },
  { number: 107, name: 'Al-Ma\'un', arabic: 'الماعون', page: 602 },
  { number: 108, name: 'Al-Kawthar', arabic: 'الكوثر', page: 602 },
  { number: 109, name: 'Al-Kafirun', arabic: 'الكافرون', page: 603 },
  { number: 110, name: 'An-Nasr', arabic: 'النصر', page: 603 },
  { number: 111, name: 'Al-Masad', arabic: 'المسد', page: 603 },
  { number: 112, name: 'Al-Ikhlas', arabic: 'الإخلاص', page: 604 },
  { number: 113, name: 'Al-Falaq', arabic: 'الفلق', page: 604 },
  { number: 114, name: 'An-Nas', arabic: 'الناس', page: 604 },
];

/** Which mushaf an entry was logged in / a user reads. */
export type MushafId = "uthmani15" | "indopak13";
export const DEFAULT_MUSHAF: MushafId = "uthmani15";

// The 13-line Indo-Pak isn't standardized across publishers, so rather than
// invent per-surah page numbers we PROJECT the content-fixed 15-line positions
// onto the 13-line's page count: every surah/juz begins at the same fraction of
// the way through the Qur'an in any mushaf. Accurate to within a few pages;
// recalibrate INDOPAK13_TOTAL to a specific print to tighten it.
const INDOPAK13_TOTAL = 849;
function project(madaniPage: number, total: number): number {
  const f = (madaniPage - 1) / (MADANI_TOTAL - 1);
  return Math.min(total, Math.max(1, Math.round(1 + f * (total - 1))));
}

type MushafSpec = {
  id: MushafId;
  totalPages: number;
  juzStart: number[]; // length 30
  surahStart: number[]; // length 114, index = surah number − 1
};

const SPECS: Record<MushafId, MushafSpec> = {
  uthmani15: {
    id: "uthmani15",
    totalPages: MADANI_TOTAL,
    juzStart: MADANI_JUZ_STARTS,
    surahStart: SURAHS.map((s) => s.page),
  },
  indopak13: {
    id: "indopak13",
    totalPages: INDOPAK13_TOTAL,
    juzStart: MADANI_JUZ_STARTS.map((p) => project(p, INDOPAK13_TOTAL)),
    surahStart: SURAHS.map((s) => project(s.page, INDOPAK13_TOTAL)),
  },
};

function spec(m: MushafId | null | undefined): MushafSpec {
  return SPECS[m ?? DEFAULT_MUSHAF] ?? SPECS.uthmani15;
}

/** Options for the settings picker. */
export const MUSHAF_OPTIONS: { id: MushafId; label: string; sub: string }[] = [
  { id: "uthmani15", label: "15-line Uthmani", sub: "Madani · 604 pages" },
  { id: "indopak13", label: "13-line Indo-Pak", sub: `~${INDOPAK13_TOTAL} pages` },
];

/** Total page count of a mushaf. */
export function totalPages(m: MushafId): number {
  return spec(m).totalPages;
}

export type MushafLocation = { page: number; juz: number; surah: Surah };

/** Clamp/round any input to a valid page for the given mushaf. */
export function clampPage(m: MushafId, page: number): number {
  return Math.min(spec(m).totalPages, Math.max(1, Math.round(page)));
}

/** Pull a page number out of a stored bookmark ref ("262" or "Page 262"). */
export function pageFromRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const match = ref.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Juz (1–30) that a page falls in, for the given mushaf. */
/** Start page of each juz in this mushaf (index 0 → Juz 1). */
export function juzStartPages(m: MushafId): number[] {
  return spec(m).juzStart;
}

export function juzForPage(m: MushafId, page: number): number {
  const s = spec(m);
  const p = clampPage(m, page);
  let juz = 1;
  for (let i = 0; i < s.juzStart.length; i++) {
    if (p >= s.juzStart[i]) juz = i + 1;
    else break;
  }
  return juz;
}

/** The surah a page belongs to - the latest surah begun by that page. */
export function surahForPage(m: MushafId, page: number): Surah {
  const s = spec(m);
  const p = clampPage(m, page);
  let found = SURAHS[0];
  for (let i = 0; i < SURAHS.length; i++) {
    if (s.surahStart[i] <= p) found = SURAHS[i];
    else break;
  }
  return found;
}

/** Full location for a last-read page in the given mushaf. */
export function locatePage(m: MushafId, page: number): MushafLocation {
  const p = clampPage(m, page);
  return { page: p, juz: juzForPage(m, p), surah: surahForPage(m, p) };
}

/** Compact bookmark label, e.g. "Juz 7 · An-Nahl". */
export function bookmarkLabel(m: MushafId, page: number): string {
  const loc = locatePage(m, page);
  return `Juz ${loc.juz} · ${loc.surah.name}`;
}
