---
name: webx-i18n-l10n
description: Internationalising and localising a website - UTF-8, the lang and dir attributes, locale-aware formatting with Intl, plural rules, RTL and logical CSS, Unicode normalisation, with Vietnamese as the worked case
domain: web-development
tags: i18n,l10n,unicode,utf-8,lang,rtl,intl,vietnamese,normalization
apply_when: "a site will serve more than one language or region; text shows garbled characters; dates, numbers or sorting look wrong for a locale; Vietnamese diacritics break search, fonts or truncation; adding right-to-left languages"
sources: "W3C Internationalization - Declaring language in HTML (read); W3C Internationalization - Text direction (read); W3C Internationalization - Character encodings, definitions (read); W3C Internationalization - Personal names around the world (read); MDN - Intl (read)"
last_reviewed: 2026-09-26
confidence: medium
---

# Internationalisation and localisation

**i18n** is designing so a product *can* support many languages and regions; **l10n** is supplying one locale's translations and conventions. Do i18n early: retrofitting it into hard-coded strings and layouts is expensive.

## Foundations

- **UTF-8 everywhere**: HTML (`<meta charset="utf-8">`), HTTP headers, database, APIs, files. It covers virtually all languages, so no other encoding declaration is needed.
- **`lang` on `<html>`** (BCP 47 tags such as `en`, `vi`, `pt-BR`); add `lang` to inner elements for passages in another language. It drives screen-reader pronunciation, font choice, hyphenation, spell-check and translation tools (`a11y-wcag-essentials`).
- **Direction**: set `dir="rtl"` on `<html>` for Arabic, Hebrew and similar scripts; use `dir="auto"` for user-generated text of unknown direction. Do not set base direction with CSS. Write CSS with **logical properties** (`margin-inline-start`, `padding-inline-end`, `text-align: start`) instead of left and right so layouts mirror correctly.
- **URL strategy**: one URL per language (path prefix or domain), linked with `hreflang` alternates so search engines serve the right version (`seo-technical-basics`); do not rely on IP or `Accept-Language` alone, and let users switch.

## Format with `Intl`, not by hand

`Intl.DateTimeFormat`, `NumberFormat`, `PluralRules`, `Collator`, `RelativeTimeFormat` and `ListFormat` apply locale conventions (separators, date order, plural categories, sorting, "2 days ago"). Pass the locale explicitly; `navigator.language` gives the user's preference. Keep stored data in neutral form (ISO dates, UTC times, numbers) and format only at display. Do not build sentences by concatenating fragments; translators need whole messages with named placeholders and plural forms (message-format libraries handle these). Store time zones explicitly for events.

## Text and Unicode

- A user-perceived character can be several code points (Vietnamese "ề" can be E + combining circumflex + combining grave); bytes and code units do not equal characters. Use grapheme-aware APIs for truncation, cursor and length limits.
- **Normalise** text (NFC is the usual choice) before comparing, storing keys or searching, because the same Vietnamese word can arrive as composed or decomposed forms and fail equality checks. (W3C normalisation page not read; this is standard Unicode practice, verify with your platform's docs.)
- Sorting and search: use locale-aware collation (`Intl.Collator`, database collations); decide whether searches should ignore diacritics, and make that an explicit product choice.

## Vietnamese checklist

`lang="vi"`; a font subset that includes the Latin Extended Additional block (stacked tone marks need generous line height and no clipping); NFC on input; diacritic-insensitive search as an option; `vi` plural rules have a single category, but keep the plural mechanism for other languages; date order day/month/year, decimal comma and thousands dot in `vi-VN`; test with long words, all-caps and mixed input methods (Telex, VNI). See `fe-media-assets` for font subsetting.

## Names and forms

W3C guidance: prefer one full-name field, or label fields so they work when the family name comes first (Chinese, Japanese, Korean, Hungarian) or does not exist (Icelandic patronymics, many single-name cultures). Do not require a family name, allow spaces, hyphens and apostrophes, keep the capitalisation users type ("McNamara", "van der Waals"), and consider a "What should we call you?" field (`ux-forms-errors`). Vietnamese names are family-name-first, so "first name / last name" labels confuse users.

## Translation workflow

Externalise all strings into resource files with keys and context notes; use pseudo-localisation to find hard-coded text and overflow; expect 30 percent or more expansion in some languages (rule of thumb, not from a read source); include translators in review; keep images and icons free of embedded text.

## Use when

- Any site expecting a second language or an international audience, or one that handles names and free text.

## Do not use when

- A single-locale internal tool needs only UTF-8, `lang` and correct formats; do not add a translation framework prematurely.

## Trade-offs

- Machine translation is fast and needs human review for tone and legal text.
- Separate URLs per language help search and sharing and add routing and content workflow complexity.

## Common mistakes

- Hard-coded strings and concatenated sentences.
- Assuming one name has first and last parts, or one address format.
- Formatting numbers and dates with string operations.
- Truncating strings at a byte or code unit boundary and breaking a letter.
- Missing `lang`, so screen readers mispronounce the text.

## Related

- Notes: `webx-privacy-consent-analytics`, `fe-media-assets`, `ux-forms-errors`, `a11y-wcag-essentials`, `seo-technical-basics`, `ux-responsive-mobile-first`
