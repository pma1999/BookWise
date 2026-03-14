"""
OpenLibrary API integration: validation and enrichment of book data.

Rate limits (per OL docs):
  - Non-identified requests: 1 req/s
  - Identified requests (User-Agent with contact): 3 req/s  ← we use this
We send OL_HEADERS with every request to claim the 3 req/s budget.

_validate_single no longer applies text-similarity matching itself.
All books that OL returns ANY candidates for are forwarded to the Gemini
AI layer (select_ol_matches) for final selection — ensuring the correct
OL entry is chosen rather than relying on fuzzy string matching alone.
"""
import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote_plus

import requests

logger = logging.getLogger(__name__)

OL_BASE = 'https://openlibrary.org'
COVERS_BASE = 'https://covers.openlibrary.org'
OL_HEADERS = {'User-Agent': 'BookWise (contact@bookwise.app)'}
MAX_WORKERS = 4
RATE_LIMIT = 3             # max requests per second (identified: 3/s)
REQUEST_TIMEOUT = 10       # seconds per HTTP call
RETRY_DELAYS = (0.5, 1.0)  # wait before retry 1 and retry 2


class OpenLibraryService:
    def __init__(self):
        self._lock = threading.Lock()
        self._request_times: list = []

    # ──────────────────────────────────────────
    # Rate limiting
    # ──────────────────────────────────────────

    def _throttle(self):
        """Block until we are under RATE_LIMIT requests/second."""
        with self._lock:
            now = time.monotonic()
            self._request_times = [t for t in self._request_times if now - t < 1.0]
            if len(self._request_times) >= RATE_LIMIT:
                sleep_for = 1.0 - (now - self._request_times[0])
                if sleep_for > 0:
                    time.sleep(sleep_for)
            self._request_times.append(time.monotonic())

    # ──────────────────────────────────────────
    # Validation
    # ──────────────────────────────────────────

    def validate_books(self, books: list) -> tuple:
        """
        Validate each book against OpenLibrary Search API in parallel.
        Returns (with_docs, discarded) 2-tuple:
          - with_docs:  [{'book': ..., 'candidates': [ol_doc, ...]}]
                        ALL books that OL returned any results for; sent to AI for selection
          - discarded:  books where OL found nothing (likely hallucinated or severely mis-titled)
        """
        with_docs: list[dict] = []
        discarded: list[dict] = []

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_book = {
                executor.submit(self._validate_single, book): book
                for book in books
            }
            for future in as_completed(future_to_book):
                original_book = future_to_book[future]
                try:
                    result = future.result()
                except Exception as e:
                    logger.warning('Validation future error for "%s": %s', original_book.get('title'), e)
                    result = None

                if result is None:
                    discarded.append(original_book)
                else:
                    with_docs.append({'book': original_book, 'candidates': result['candidates']})

        for e in with_docs:
            b = e['book']
            logger.info('  [has-docs]  "%s" by %s (%d candidates)',
                        b.get('title'), b.get('author'), len(e.get('candidates', [])))
        for b in discarded:
            logger.info('  [no-docs]   "%s" by %s', b.get('title'), b.get('author'))

        return with_docs, discarded

    def _search_ol(self, title: str, author: str | None) -> list:
        """
        Search OpenLibrary and return docs list.
        Retries up to len(RETRY_DELAYS) times on transient errors.
        Raises the last exception after all attempts are exhausted.
        """
        params: dict = {
            'title': title,
            'limit': 5,
            'fields': 'key,title,author_name,first_publish_year,cover_i,edition_count,subject,language,ratings_average,isbn',
        }
        if author:
            params['author'] = author

        last_exc: Exception | None = None
        # (None, 0.5, 1.0) → attempt 1 (no sleep), retry 2 (0.5s), retry 3 (1.0s)
        for attempt, delay in enumerate((None,) + RETRY_DELAYS, start=1):
            if delay is not None:
                logger.warning(
                    'OL search retry %d/%d for "%s" — waiting %.1fs (prev error: %s)',
                    attempt, len(RETRY_DELAYS) + 1, title, delay, last_exc,
                )
                time.sleep(delay)
            try:
                self._throttle()
                resp = requests.get(
                    f'{OL_BASE}/search.json',
                    params=params,
                    headers=OL_HEADERS,
                    timeout=REQUEST_TIMEOUT,
                )
                resp.raise_for_status()
                return resp.json().get('docs', [])
            except Exception as exc:
                last_exc = exc

        raise last_exc  # propagate after all retries exhausted

    def search_books(
        self,
        *,
        query: str,
        page: int = 1,
        limit: int = 12,
        language: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        subject: str | None = None,
    ) -> dict:
        """Manual OpenLibrary search endpoint data, normalized for frontend use."""
        clean_query = (query or '').strip()
        clean_limit = max(1, min(limit, 30))
        clean_page = max(1, page)

        if not clean_query:
            return {
                'books': [],
                'meta': {'num_found': 0, 'start': 0, 'page': clean_page, 'limit': clean_limit, 'has_next_page': False},
            }

        params: dict[str, str | int] = {
            'q': clean_query,
            'page': clean_page,
            'limit': clean_limit,
            'fields': 'key,title,author_name,first_publish_year,cover_i,edition_count,subject,language,ratings_average,isbn,edition_key',
        }
        if language:
            params['language'] = language
        if year_from:
            params['first_publish_year'] = year_from
        if year_to and year_to != year_from:
            params['publish_year'] = year_to
        if subject:
            params['subject'] = subject

        self._throttle()
        response = requests.get(
            f'{OL_BASE}/search.json',
            params=params,
            headers=OL_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        docs = payload.get('docs', [])
        books = [self._map_search_doc(doc) for doc in docs]

        num_found = int(payload.get('numFound', 0) or 0)
        start = int(payload.get('start', 0) or 0)
        return {
            'books': books,
            'meta': {
                'num_found': num_found,
                'start': start,
                'page': clean_page,
                'limit': clean_limit,
                'has_next_page': (start + len(books)) < num_found,
            },
        }

    def _map_search_doc(self, doc: dict) -> dict:
        work_key = doc.get('key') or ''
        work_id = work_key.split('/')[-1] if work_key else None
        edition_keys = doc.get('edition_key') or []
        edition_id = edition_keys[0] if edition_keys else None

        cover_i = doc.get('cover_i')
        cover_url = f'{COVERS_BASE}/b/id/{cover_i}-M.jpg' if cover_i else None
        cover_url_large = f'{COVERS_BASE}/b/id/{cover_i}-L.jpg' if cover_i else None

        isbns = doc.get('isbn') or []
        isbn = isbns[0] if isbns else None
        if not cover_url and isbn:
            cover_url = f'{COVERS_BASE}/b/isbn/{quote_plus(isbn)}-M.jpg'
            cover_url_large = f'{COVERS_BASE}/b/isbn/{quote_plus(isbn)}-L.jpg'

        authors = doc.get('author_name') or []
        author = ', '.join(authors[:2]) if authors else 'Autor desconocido'

        return {
            'id': work_id,
            'work_id': work_id,
            'edition_id': edition_id,
            'title': doc.get('title') or 'Título desconocido',
            'author': author,
            'year': doc.get('first_publish_year'),
            'cover_url': cover_url,
            'cover_url_large': cover_url_large,
            'description': None,
            'reason': 'Añadido manualmente desde OpenLibrary.',
            'subjects': (doc.get('subject') or [])[:5],
            'edition_count': doc.get('edition_count'),
            'rating': round(doc['ratings_average'], 1) if doc.get('ratings_average') else None,
            'openlibrary_url': f'{OL_BASE}{work_key}' if work_key else None,
            'isbn': isbn,
            'languages': doc.get('language') or [],
        }

    def _validate_single(self, book: dict) -> dict | None:
        """
        Search OpenLibrary for a single book.
        Returns:
          - {'candidates': docs}  if OL returned any results (all forwarded to AI selection)
          - None                  if OL found nothing at all (tier 3 / discarded)
        """
        try:
            # Primary search: title + author
            docs = self._search_ol(book['title'], book.get('author'))
            logger.debug('OL search: "%s" by "%s" → %d docs', book['title'], book.get('author'), len(docs))

            # Fallback: title only
            if not docs:
                docs = self._search_ol(book['title'], None)
                logger.debug('OL search (title-only): "%s" → %d docs', book['title'], len(docs))

            if not docs:
                logger.debug('No OL results for "%s" (title-only also empty)', book['title'])
                return None

        except Exception as e:
            logger.warning('OpenLibrary search failed for "%s" (all retries exhausted): %s',
                           book.get('title'), e)
            return None

        return {'candidates': docs}

    def validate_with_corrections(self, corrections: list, original_books: list) -> tuple:
        """
        Retry OL validation using Gemini-corrected search terms.

        Input:
          corrections    — [{'book_index': i, 'ol_title': '...', 'ol_author': '...'}]
          original_books — the discarded books list (same order as book_index refers to)

        Returns (with_docs, truly_discarded) 2-tuple:
          - with_docs:       [{'book': original_book, 'candidates': [ol_doc, ...]}]
          - truly_discarded: books where OL found nothing even after correction
        """
        with_docs: list[dict] = []
        truly_discarded: list[dict] = []
        corrected_indices: set[int] = set()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_correction = {
                executor.submit(
                    self._validate_single_terms,
                    original_books[c['book_index']],
                    c['ol_title'],
                    c['ol_author'],
                ): c
                for c in corrections
                if 0 <= c['book_index'] < len(original_books)
            }
            for future in as_completed(future_to_correction):
                c = future_to_correction[future]
                bidx = c['book_index']
                orig_book = original_books[bidx]
                corrected_indices.add(bidx)
                try:
                    result = future.result()
                except Exception as e:
                    logger.warning('Correction retry error for "%s": %s', orig_book.get('title'), e)
                    result = None

                logger.info("Correction retry '%s' → '%s': has_docs=%s",
                            orig_book.get('title'), c['ol_title'], result is not None)

                if result is None:
                    truly_discarded.append(orig_book)
                else:
                    with_docs.append({'book': orig_book, 'candidates': result['candidates']})

        # Books that had no correction entry are also truly discarded
        for i, book in enumerate(original_books):
            if i not in corrected_indices:
                truly_discarded.append(book)

        return with_docs, truly_discarded

    def _validate_single_terms(self, book: dict, search_title: str, search_author: str) -> dict | None:
        """
        Like _validate_single but uses Gemini-corrected search terms.

        If the corrected-title search returns nothing AND search_title differs from
        book['title'], falls back to the original Gemini title (Gemini correction may
        have suggested the wrong direction — OL sometimes indexes works under their
        original-language title, not the translation).

        Returns {'candidates': docs} if any docs found, None otherwise.
        Preserves book['title']/book['author'] for display (Gemini values), while
        OL candidates are used for cover/metadata enrichment.
        """
        docs: list = []

        try:
            # Try corrected terms
            docs = self._search_ol(search_title, search_author)
            logger.debug('OL correction search: "%s" by "%s" → %d docs',
                         search_title, search_author, len(docs))

            if not docs:
                docs = self._search_ol(search_title, None)
                logger.debug('OL correction search (title-only): "%s" → %d docs', search_title, len(docs))

        except Exception as e:
            logger.warning('OL correction search failed for "%s": %s', search_title, e)

        # Fallback: original Gemini title if correction found nothing
        if not docs and search_title != book['title']:
            logger.debug('Correction empty for "%s"; falling back to original title "%s"',
                         search_title, book['title'])
            try:
                docs = self._search_ol(book['title'], book.get('author'))
                if not docs:
                    docs = self._search_ol(book['title'], None)
                if docs:
                    logger.info('OL correction fallback succeeded for "%s" using original title',
                                book['title'])
            except Exception as e:
                logger.warning('OL correction fallback failed for "%s": %s', book['title'], e)

        if not docs:
            return None

        return {'candidates': docs}

    # ──────────────────────────────────────────
    # Enrichment
    # ──────────────────────────────────────────

    def enrich_books(self, validated_books: list) -> list:
        """
        Enrich each validated book with cover URLs, description, and metadata.
        Runs in parallel. Order may differ from input; sorted by validated order at end.
        """
        order = {id(b): i for i, b in enumerate(validated_books)}
        results = [None] * len(validated_books)

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_idx = {
                executor.submit(self._enrich_single, book): order[id(book)]
                for book in validated_books
            }
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    logger.warning('Enrichment error at index %d: %s', idx, e)
                    book = validated_books[idx]
                    results[idx] = self._minimal_enriched(book)

        return [r for r in results if r is not None]

    def _enrich_single(self, book: dict) -> dict:
        doc = book.get('_ol_doc', {})
        work_key = doc.get('key', '')           # e.g. /works/OL12345W
        work_id = work_key.split('/')[-1] if work_key else None

        # Cover URLs
        cover_i = doc.get('cover_i')
        cover_url = f'{COVERS_BASE}/b/id/{cover_i}-M.jpg' if cover_i else None
        cover_url_large = f'{COVERS_BASE}/b/id/{cover_i}-L.jpg' if cover_i else None

        # If no cover_i, try ISBN
        if not cover_url:
            isbns = doc.get('isbn') or []
            if isbns:
                isbn = isbns[0]
                cover_url = f'{COVERS_BASE}/b/isbn/{isbn}-M.jpg'
                cover_url_large = f'{COVERS_BASE}/b/isbn/{isbn}-L.jpg'
            else:
                isbn = None
        else:
            isbns = doc.get('isbn') or []
            isbn = isbns[0] if isbns else None

        # Description from Works endpoint
        description = self._fetch_description(work_id)
        if not description:
            description = book.get('reason')  # Gemini reason as fallback

        # Subjects — first 5
        subjects = (doc.get('subject') or [])[:5]

        return {
            'id': work_id,
            'work_id': work_id,
            'edition_id': None,
            'title': book['title'],
            'author': book['author'],
            'year': doc.get('first_publish_year') or book.get('year'),
            'cover_url': cover_url,
            'cover_url_large': cover_url_large,
            'description': description,
            'reason': book.get('reason'),
            'subjects': subjects,
            'edition_count': doc.get('edition_count'),
            'rating': round(doc['ratings_average'], 1) if doc.get('ratings_average') else None,
            'openlibrary_url': f'{OL_BASE}{work_key}' if work_key else None,
            'isbn': isbn,
            'languages': doc.get('language') or [],
        }

    def _fetch_description(self, work_id: str | None) -> str | None:
        if not work_id:
            return None
        self._throttle()
        try:
            resp = requests.get(
                f'{OL_BASE}/works/{work_id}.json',
                headers=OL_HEADERS,
                timeout=REQUEST_TIMEOUT,
            )
            if not resp.ok:
                return None
            data = resp.json()
            raw = data.get('description')
            if isinstance(raw, dict):
                desc = raw.get('value', '')
            elif isinstance(raw, str):
                desc = raw
            else:
                return None
            desc = desc.strip()
            if len(desc) > 300:
                desc = desc[:297] + '...'
            return desc or None
        except Exception as e:
            logger.debug('Failed to fetch description for %s: %s', work_id, e)
            return None

    def _minimal_enriched(self, book: dict) -> dict:
        """Return minimal enriched object when enrichment fails entirely."""
        return {
            'id': None,
            'work_id': None,
            'edition_id': None,
            'title': book['title'],
            'author': book['author'],
            'year': book.get('year'),
            'cover_url': None,
            'cover_url_large': None,
            'description': book.get('reason'),
            'reason': book.get('reason'),
            'subjects': [],
            'edition_count': None,
            'rating': None,
            'openlibrary_url': None,
            'isbn': None,
            'languages': [],
        }
