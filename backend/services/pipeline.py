"""
Recommendation pipeline: orchestrates Gemini → OpenLibrary validate → AI select → enrich.
"""
import logging

from services.gemini_service import GeminiService
from services.openlibrary_service import OpenLibraryService

logger = logging.getLogger(__name__)


class RecommendationPipeline:
    def __init__(self):
        self.gemini = GeminiService()
        self.openlibrary = OpenLibraryService()

    def run(self, request_data: dict) -> dict:
        """
        Execute the full recommendation pipeline.

        Steps:
        1.  Generate recommendations via Gemini (8 candidates)
        2.  Validate each against OpenLibrary → 2 buckets: with_docs / discarded
        2b. AI selection: Gemini picks the correct OL candidate for ALL books with docs
        2c. Gemini-guided search correction: retry OL with canonical title/author for
            not-found books; AI selects from any new candidates found
        3.  Retry with Gemini if fewer than 5 validated after all steps
        4.  Enrich validated books with cover/description/metadata (parallel)
        5.  Return structured response
        """
        # ── Step 1 — Generate ────────────────────────────────────────────────
        logger.info('Generating recommendations via Gemini...')
        generated = self.gemini.get_recommendations(request_data)
        total_generated = len(generated)
        logger.info('Gemini returned %d candidates', total_generated)

        # ── Step 2 — Validate against OpenLibrary ────────────────────────────
        logger.info('Validating %d books against OpenLibrary...', total_generated)
        with_docs, discarded = self.openlibrary.validate_books(generated)
        logger.info('Step 2: With OL docs: %d | No docs: %d', len(with_docs), len(discarded))

        validated: list[dict] = []

        # ── Step 2b — AI selects correct OL candidate for ALL books with docs ─
        if with_docs:
            logger.info('Step 2b: AI selecting OL match for %d books...', len(with_docs))
            ai_resolved = self.gemini.select_ol_matches(with_docs)
            logger.info('Step 2b: confirmed %d / %d', len(ai_resolved), len(with_docs))

            resolved_titles = {b['title'] for b in ai_resolved}
            ai_unresolved = [
                e['book'] for e in with_docs
                if e['book']['title'] not in resolved_titles
            ]
            if ai_unresolved:
                logger.info('Step 2b: %d book(s) rejected by AI → step 2c pool',
                            len(ai_unresolved))
                discarded.extend(ai_unresolved)

            validated.extend(ai_resolved)

        # ── Step 2c — Gemini-guided search correction for not-found books ─────
        if discarded:
            logger.info('Step 2c: OL found nothing for %d books — asking Gemini for correct search terms...',
                        len(discarded))
            for b in discarded:
                logger.info('  Not found: "%s" by %s', b.get('title'), b.get('author'))

            corrections = self.gemini.correct_search_terms(discarded)
            if corrections:
                c_with_docs, c_truly_discarded = \
                    self.openlibrary.validate_with_corrections(corrections, discarded)

                c_recovered: list[dict] = []
                if c_with_docs:
                    logger.info('Step 2c: AI selecting OL match for %d corrected books...', len(c_with_docs))
                    c_recovered = self.gemini.select_ol_matches(c_with_docs)
                    logger.info('Step 2c: confirmed %d / %d corrected', len(c_recovered), len(c_with_docs))

                    confirmed_titles = {b['title'] for b in c_recovered}
                    c_unresolved = [
                        e['book'] for e in c_with_docs
                        if e['book']['title'] not in confirmed_titles
                    ]
                    c_truly_discarded.extend(c_unresolved)

                validated.extend(c_recovered)
                discarded = c_truly_discarded

                logger.info('Step 2c result: recovered %d | truly discarded: %d',
                            len(c_recovered), len(c_truly_discarded))
                for b in c_truly_discarded:
                    logger.info('  Truly discarded: "%s" by %s', b.get('title'), b.get('author'))
            else:
                logger.info('Step 2c: Gemini returned no corrections (%d truly discarded)', len(discarded))
                for b in discarded:
                    logger.info('  Truly discarded: "%s" by %s', b.get('title'), b.get('author'))

        logger.info('Total validated after all steps: %d', len(validated))

        # ── Step 3 — Retry if < 5 validated ──────────────────────────────────
        retry_needed = len(validated) < 5
        if retry_needed:
            needed = 8 - len(validated)
            logger.info('Fewer than 5 validated. Requesting %d additional from Gemini...', needed)
            additional = self.gemini.get_additional_recommendations(
                request_data,
                validated=validated,
                discarded=discarded,
                count_needed=needed,
            )
            if additional:
                add_with_docs, _ = self.openlibrary.validate_books(additional)
                if add_with_docs:
                    add_resolved = self.gemini.select_ol_matches(add_with_docs)
                    validated.extend(add_resolved)
                logger.info('After retry: %d total validated', len(validated))

        # ── Step 4 — Enrich ───────────────────────────────────────────────────
        logger.info('Enriching %d books...', len(validated))
        enriched = self.openlibrary.enrich_books(validated)
        logger.info('Enrichment complete. Final book count: %d', len(enriched))

        return {
            'books': enriched,
            'meta': {
                'total_generated': total_generated,
                'total_validated': len(validated),
                'retry_needed': retry_needed,
                'processing_time_ms': 0,  # set by app.py
            },
        }
