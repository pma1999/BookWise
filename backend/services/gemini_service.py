"""
Gemini integration for generating book recommendations.
SDK: google-genai (google.genai) — current, non-deprecated SDK.
Primary model: gemini-3-flash-preview
Fallback model on 429: gemini-3.1-flash-lite-preview

Key design decisions:
- response_mime_type='application/json' + response_json_schema enforces field names
  exactly, preventing the model from renaming fields to its language of choice.
- Temperature is not set (uses Gemini 3's recommended default of 1.0).
- No temperature retry: with a strict schema, JSON is always valid on the first call.
  If the model fails anyway, we raise immediately and let the pipeline handle it.
"""
import json
import os
import logging

from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError

logger = logging.getLogger(__name__)

# ── Custom application-level exceptions ───────────────────

class GeminiUnavailableError(Exception):
    """Raised when Gemini is down (5xx) or otherwise unreachable."""

class GeminiRateLimitError(Exception):
    """Raised when we hit Gemini's rate limit (429 / RESOURCE_EXHAUSTED)."""

class GeminiInvalidResponseError(Exception):
    """Raised when Gemini's response is empty or structurally invalid."""

# ── Constants ─────────────────────────────────────────────

MODEL = 'gemini-3-flash-preview'
FALLBACK_MODEL = 'gemini-3.1-flash-lite-preview'

# Strict JSON schema passed to the API so field names are always correct
# regardless of the prompt language or model behaviour.
_BOOK_LIST_SCHEMA: dict = {
    'type': 'array',
    'items': {
        'type': 'object',
        'properties': {
            'title':  {'type': 'string',  'description': 'Exact book title'},
            'author': {'type': 'string',  'description': 'Full author name'},
            'reason': {'type': 'string',  'description': 'Why this book fits the reader'},
            'year':   {'type': 'integer', 'description': 'Approximate publication year'},
        },
        'required': ['title', 'author', 'reason'],
    },
}

# ── Prompt label maps ─────────────────────────────────────

SYSTEM_PROMPT = (
    "Eres un librero experto con décadas de experiencia y un conocimiento enciclopédico "
    "de literatura mundial, tanto clásica como contemporánea. Tu trabajo es recomendar "
    "libros que el lector realmente disfrutará, no los más populares ni los más obvios.\n\n"
    "Prioriza:\n"
    "- Libros que encajen con lo que el usuario describe, no los más conocidos del género\n"
    "- Diversidad de autores (no repitas autor en una misma lista)\n"
    "- Mezcla de clásicos reconocidos y joyas menos conocidas\n"
    "- Libros disponibles y publicados (no recomiendes manuscritos ni ediciones agotadas raras)\n\n"
    "NUNCA recomiendes libros que no estés seguro de que existen con ese título y autor exacto. "
    "Si no estás seguro, omite esa recomendación."
)

PURPOSE_MAP = {
    'enjoy':   'Disfrutar (entretenimiento puro)',
    'learn':   'Aprender (adquirir conocimiento)',
    'reflect': 'Reflexionar (crecimiento personal, filosofía)',
    'escape':  'Evadirme (desconexión total, escapismo)',
}
LENGTH_MAP = {
    'short':  'Corto (menos de 200 páginas)',
    'medium': 'Medio (200–400 páginas)',
    'long':   'Largo (más de 400 páginas)',
}
LANGUAGE_MAP = {
    'es': 'Español', 'en': 'Inglés', 'fr': 'Francés', 'de': 'Alemán',
    'ja': 'Japonés', 'ru': 'Ruso',   'it': 'Italiano', 'pt': 'Portugués',
}
GENRE_MAP = {
    'ficcion_literaria':       'Ficción literaria',
    'ciencia_ficcion':         'Ciencia ficción',
    'fantasia':                'Fantasía',
    'thriller_misterio':       'Thriller / Misterio',
    'romance':                 'Romance',
    'terror':                  'Terror',
    'historica':               'Histórica',
    'no_ficcion_ensayo':       'No ficción / Ensayo',
    'biografia_memorias':      'Biografía / Memorias',
    'ciencia_divulgacion':     'Ciencia y divulgación',
    'filosofia':               'Filosofía',
    'negocios_productividad':  'Negocios y productividad',
    'poesia':                  'Poesía',
    'comic_novela_grafica':    'Cómic / Novela gráfica',
}

REQUIRED_FIELDS = {'title', 'author', 'reason'}

# ── AI capabilities config ─────────────────────────────────
# Gemini 3 models use thinking_level (not thinking_budget).
# "high" maximises reasoning depth for complex recommendation tasks.
_THINKING_CONFIG = types.ThinkingConfig(thinking_level='high')
# Google Search grounding: lets the model verify book existence and
# access real-time bibliographic data before generating its response.
_SEARCH_TOOL = types.Tool(google_search=types.GoogleSearch())

# Schema for the OL search correction response
_OL_CORRECTION_SCHEMA: dict = {
    'type': 'array',
    'items': {
        'type': 'object',
        'properties': {
            'book_index': {'type': 'integer'},
            'ol_title':   {'type': 'string'},
            'ol_author':  {'type': 'string'},
        },
        'required': ['book_index', 'ol_title', 'ol_author'],
    },
}

# Schema for the OL match selection response
_OL_SELECTION_SCHEMA: dict = {
    'type': 'array',
    'items': {
        'type': 'object',
        'properties': {
            'book_index':      {'type': 'integer', 'description': 'Index of the book in the input list'},
            'candidate_index': {'type': 'integer', 'nullable': True, 'description': 'Index of the matching OL candidate, or null'},
        },
        'required': ['book_index', 'candidate_index'],
    },
}

# Schema for intent inference from free text
_INTENT_INFERENCE_SCHEMA: dict = {
    'type': 'object',
    'properties': {
        'purpose': {'type': 'string', 'enum': ['enjoy', 'learn', 'reflect', 'escape'], 'description': 'Inferred purpose'},
        'mood': {'type': 'string', 'description': 'Inferred mood (light, intense, dark, uplifting, etc.)'},
        'inferred_genres': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Inferred genres'},
    },
    'required': ['purpose'],
}


# ── Service ────────────────────────────────────────────────

class GeminiService:
    """
    Wrapper around the google-genai SDK for book recommendation generation.

    Uses response_mime_type + response_json_schema so the model always returns
    a valid JSON array with the exact field names we expect — no parsing failures.
    """

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise RuntimeError('Gemini API key is required')
        self._client = genai.Client(api_key=api_key)

    @staticmethod
    def _is_rate_limit_error(exc: ClientError) -> bool:
        return exc.code == 429 or (exc.status or '').upper() == 'RESOURCE_EXHAUSTED'

    def _generate_content_with_fallback(
        self,
        *,
        contents: str,
        config: types.GenerateContentConfig,
    ):
        """Retry with fallback model when the primary model is rate-limited."""
        try:
            return self._client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=config,
            )
        except ClientError as exc:
            if not self._is_rate_limit_error(exc):
                self._raise_for_client_error(exc)

            logger.warning(
                'Primary Gemini model rate-limited (code=%s, status=%s). Retrying with fallback model %s.',
                exc.code,
                exc.status,
                FALLBACK_MODEL,
            )
            try:
                return self._client.models.generate_content(
                    model=FALLBACK_MODEL,
                    contents=contents,
                    config=config,
                )
            except ClientError as fallback_exc:
                self._raise_for_client_error(fallback_exc)
            except ServerError as fallback_exc:
                raise GeminiUnavailableError(str(fallback_exc)) from fallback_exc
        except ServerError as exc:
            raise GeminiUnavailableError(str(exc)) from exc

    # ── Public API ─────────────────────────────────────────

    def get_recommendations(self, request_data: dict) -> list[dict]:
        """Generate 8 book recommendations. Returns a validated list of book dicts."""
        prompt = self._build_user_prompt(request_data)
        return self._call(prompt)

    def get_additional_recommendations(
        self,
        request_data: dict,
        validated: list[dict],
        discarded: list[dict],
        count_needed: int,
    ) -> list[dict]:
        """Second call when validation left fewer than 5 books."""
        base = self._build_user_prompt(request_data, count_override=count_needed)

        exclusion_lines: list[str] = []
        if discarded:
            titles = ', '.join(
                f'"{b["title"]}" de {b["author"]}' for b in discarded
            )
            exclusion_lines.append(
                f'Los siguientes libros NO existen o no se encontraron, NO los repitas: {titles}.'
            )
        if validated:
            titles = ', '.join(
                f'"{b["title"]}" de {b["author"]}' for b in validated
            )
            exclusion_lines.append(
                f'Los siguientes YA están en la lista, tampoco los repitas: {titles}.'
            )
        exclusion_lines.append(
            f'Necesito exactamente {count_needed} recomendaciones adicionales.'
        )

        prompt = base + '\n\n' + '\n'.join(exclusion_lines)
        try:
            return self._call(prompt)
        except Exception as exc:
            logger.warning('Additional recommendations call failed: %s', exc)
            return []

    def correct_search_terms(self, discarded_books: list[dict]) -> list[dict]:
        """
        Ask Gemini to provide OL-canonical title/author for books OL couldn't find.

        Input: list of book dicts that OL returned no results for.
        Returns: [{'book_index': i, 'ol_title': '...', 'ol_author': '...'}]
        Non-fatal: returns [] on any error.
        """
        if not discarded_books:
            return []
        try:
            lines: list[str] = [
                'Eres el mismo asistente bibliógrafo que recomendó estos libros.',
                'OpenLibrary no encontró ningún resultado para ellos.',
                'Esto suele ocurrir porque el título está en español/otro idioma, pero OL',
                'lo indexa en inglés o en el idioma original, o porque el autor tiene',
                'un formato diferente.',
                '',
                'Para cada libro, proporciona el título y autor EXACTOS tal como',
                'aparecen en OpenLibrary (normalmente en inglés para obras traducidas).',
                '',
            ]
            for i, book in enumerate(discarded_books):
                lines.append(f'Libro {i}: "{book["title"]}" de {book["author"]}')
            lines.append(
                '\nDispones de la herramienta de búsqueda web. Úsala para buscar el título '
                'y autor exactos tal como aparecen indexados en OpenLibrary, especialmente '
                'útil para obras traducidas o con variantes en el nombre del autor.'
            )
            prompt = '\n'.join(lines)

            config = self._make_config(
                max_output_tokens=4096,
                response_json_schema=_OL_CORRECTION_SCHEMA,
            )
            response = self._generate_content_with_fallback(contents=prompt, config=config)
            raw = response.text
            if not raw or not raw.strip():
                logger.warning('correct_search_terms: empty response from Gemini')
                return []

            corrections = json.loads(raw)
            if not isinstance(corrections, list):
                logger.warning('correct_search_terms: unexpected response shape')
                return []

            valid: list[dict] = []
            for c in corrections:
                bidx = c.get('book_index')
                ol_title = c.get('ol_title', '').strip()
                ol_author = c.get('ol_author', '').strip()
                if not isinstance(bidx, int) or bidx < 0 or bidx >= len(discarded_books):
                    continue
                if not ol_title or not ol_author:
                    continue
                orig_title = discarded_books[bidx]['title']
                logger.info("Correction for '%s': try '%s' by '%s'", orig_title, ol_title, ol_author)
                valid.append({'book_index': bidx, 'ol_title': ol_title, 'ol_author': ol_author})

            return valid

        except Exception as exc:
            logger.warning('correct_search_terms failed (non-fatal): %s', exc)
            return []

    def select_ol_matches(self, books_with_candidates: list[dict]) -> list[dict]:
        """
        Given books that have OL candidates, ask Gemini (which originally suggested
        these books) to select the correct OL entry for each one.

        Receives ALL books with OL candidates — not just ambiguous ones — so Gemini
        can confirm even "clear" matches and reject any incorrect auto-matches.

        Input: list of {'book': gemini_book_dict, 'candidates': [ol_doc, ...]}
        Returns: list of {**gemini_book, '_ol_doc': selected_ol_doc} for confirmed matches.
        Falls back to [] on any error so the pipeline can continue.
        """
        if not books_with_candidates:
            return []
        try:
            prompt = self._build_ol_selection_prompt(books_with_candidates)
            config = self._make_config(
                max_output_tokens=4096,
                response_json_schema=_OL_SELECTION_SCHEMA,
                include_search=False,
            )
            response = self._generate_content_with_fallback(contents=prompt, config=config)
            raw = response.text
            if not raw or not raw.strip():
                logger.warning('select_ol_matches: empty response from Gemini')
                return []

            selections = json.loads(raw)
            if not isinstance(selections, list):
                logger.warning('select_ol_matches: unexpected response shape')
                return []

            resolved: list[dict] = []
            for sel in selections:
                bidx = sel.get('book_index')
                cidx = sel.get('candidate_index')
                if bidx is None or not isinstance(bidx, int):
                    continue
                if bidx < 0 or bidx >= len(books_with_candidates):
                    continue
                if cidx is None:
                    # Gemini says this book has no valid OL candidate
                    continue
                entry = books_with_candidates[bidx]
                candidates = entry.get('candidates', [])
                if not isinstance(cidx, int) or cidx < 0 or cidx >= len(candidates):
                    continue
                book = entry['book']
                resolved.append({**book, '_ol_doc': candidates[cidx]})

            logger.info('select_ol_matches: confirmed %d / %d books',
                        len(resolved), len(books_with_candidates))
            return resolved

        except Exception as exc:
            logger.warning('select_ol_matches failed (non-fatal): %s', exc)
            return []

    def generate_similar_recommendations(
        self,
        seed_book: dict,
        profile: dict | None,
        count: int = 6,
    ) -> list[dict]:
        """
        Generate book recommendations similar to a seed book.
        Excludes the same author to ensure variety.
        """
        prompt = self._build_similar_prompt(seed_book, profile, count)
        return self._call(prompt)

    def infer_intent_from_text(self, freetext: str) -> dict:
        """
        Infer purpose, mood, and genres from free-text user input.
        Returns a dict with at least 'purpose' key.
        """
        if not freetext or not freetext.strip():
            return {'purpose': 'enjoy', 'mood': None, 'inferred_genres': []}

        lines: list[str] = [
            'Analiza esta descripción de lo que el usuario quiere leer e infiere:',
            '',
            f'"{freetext}"',
            '',
            'Proporciona el propósito principal (enjoy=disfrutar/entretenimiento, '
            'learn=aprender, reflect=reflexionar, escape=evadirse), el mood/tono '
            'deseado, y géneros inferidos si es posible.',
        ]
        prompt = '\n'.join(lines)

        config = self._make_config(
            max_output_tokens=1024,
            response_json_schema=_INTENT_INFERENCE_SCHEMA,
            include_search=False,
        )

        try:
            response = self._generate_content_with_fallback(contents=prompt, config=config)
            raw = response.text
            if not raw or not raw.strip():
                return {'purpose': 'enjoy', 'mood': None, 'inferred_genres': []}

            result = json.loads(raw)
            return {
                'purpose': result.get('purpose', 'enjoy'),
                'mood': result.get('mood'),
                'inferred_genres': result.get('inferred_genres', []),
            }
        except Exception as exc:
            logger.warning('infer_intent_from_text failed (non-fatal): %s', exc)
            return {'purpose': 'enjoy', 'mood': None, 'inferred_genres': []}

    # ── Internal ───────────────────────────────────────────

    def _make_config(
        self,
        *,
        max_output_tokens: int,
        response_json_schema: dict | None = None,
        include_search: bool = True,
    ) -> types.GenerateContentConfig:
        """
        Centralised factory for GenerateContentConfig.

        Every call gets thinking_level='high' for maximum reasoning depth.
        Google Search grounding is enabled by default (include_search=True) so
        the model can verify book data in real time; pass include_search=False
        for tasks that work entirely with data already provided in the prompt
        (e.g. selecting among OpenLibrary candidates already returned by the API).
        """
        return types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=max_output_tokens,
            response_mime_type='application/json',
            response_json_schema=response_json_schema,
            thinking_config=_THINKING_CONFIG,
            tools=[_SEARCH_TOOL] if include_search else None,
        )

    def _call(self, prompt: str) -> list[dict]:
        """
        Single call to Gemini with strict JSON schema enforcement.
        No temperature retry needed: the schema guarantees valid JSON structure.
        """
        config = self._make_config(
            max_output_tokens=65536,
            response_json_schema=_BOOK_LIST_SCHEMA,
        )

        response = self._generate_content_with_fallback(contents=prompt, config=config)

        raw = response.text
        if not raw or not raw.strip():
            raise GeminiInvalidResponseError(
                'Gemini returned an empty response. '
                f'finish_reason={response.candidates[0].finish_reason if response.candidates else "unknown"}'
            )

        return self._parse_and_validate(raw)

    def _raise_for_client_error(self, exc: ClientError) -> None:
        if self._is_rate_limit_error(exc):
            raise GeminiRateLimitError(exc.message or str(exc)) from exc
        raise GeminiUnavailableError(exc.message or str(exc)) from exc

    def _parse_and_validate(self, raw: str) -> list[dict]:
        """
        Parse the JSON array returned by Gemini and discard malformed entries.
        With response_json_schema active, json.loads should always succeed —
        this is a last-resort safety net.
        """
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error('Unexpected JSON decode error (schema was active): %s\n%s', exc, raw[:400])
            raise GeminiInvalidResponseError(f'JSON decode error: {exc}') from exc

        if not isinstance(data, list):
            raise GeminiInvalidResponseError(
                f'Expected JSON array at root, got {type(data).__name__}'
            )

        valid: list[dict] = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            if not all(entry.get(f) for f in REQUIRED_FIELDS):
                logger.debug('Skipping malformed entry (missing required fields): %s', entry)
                continue
            valid.append({
                'title':  str(entry['title']).strip(),
                'author': str(entry['author']).strip(),
                'reason': str(entry['reason']).strip(),
                'year':   entry.get('year'),
            })

        logger.info('Gemini returned %d valid book entries (raw count: %d)', len(valid), len(data))
        return valid

    # ── Prompt builder ─────────────────────────────────────

    def _build_user_prompt(self, data: dict, count_override: int = 8) -> str:
        purpose_label = PURPOSE_MAP.get(data.get('purpose', ''), data.get('purpose', ''))
        lines: list[str] = [
            f'Recomiéndame exactamente {count_override} libros basándote en esto:',
            '',
            f'PROPÓSITO: {purpose_label}',
        ]

        if data.get('mood'):
            lines.append(f'MOOD DESEADO: {data["mood"]}')
        if data.get('genres'):
            genre_labels = [GENRE_MAP.get(g, g) for g in data['genres']]
            lines.append(f'GÉNEROS PREFERIDOS: {", ".join(genre_labels)}')
        if data.get('length'):
            lines.append(f'EXTENSIÓN PREFERIDA: {LENGTH_MAP.get(data["length"], data["length"])}')
        if data.get('language'):
            lines.append(f'IDIOMA ORIGINAL: {LANGUAGE_MAP.get(data["language"], data["language"])}')
        if data.get('freetext'):
            lines.append(f'LO QUE BUSCO: {data["freetext"]}')

        profile = data.get('profile')
        if profile:
            plines: list[str] = ['', 'CONTEXTO DEL LECTOR:']
            if profile.get('liked'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['liked']
                )
                plines.append(f'- Libros que le han gustado: {items}')
            if profile.get('disliked'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['disliked']
                )
                plines.append(f'- Libros que no le gustaron: {items}')
            if profile.get('read'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['read']
                )
                plines.append(f'- Libros que ya ha leído: {items}')
            if profile.get('rejected'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['rejected']
                )
                plines.append(f'- Libros que no le interesaron: {items}')
            plines.append('NO repitas ninguno de estos libros.')
            lines.extend(plines)

        lines.append(
            '\nDispones de la herramienta de búsqueda web. Úsala si necesitas verificar '
            'que un libro existe realmente con ese título y autor exactos, o para descubrir '
            'publicaciones recientes que encajen mejor con lo que el lector busca.'
        )
        return '\n'.join(lines)

    def _build_ol_selection_prompt(self, books_with_candidates: list[dict]) -> str:
        lines: list[str] = [
            'Eres el mismo asistente bibliógrafo que recomendó los siguientes libros.',
            'La API de OpenLibrary devolvió candidatos para cada uno.',
            'Para cada libro, selecciona el índice (0, 1, 2...) del candidato que corresponde',
            'exactamente al libro que recomendaste, o null si ningún candidato es ese libro.',
            '',
        ]
        for i, entry in enumerate(books_with_candidates):
            book = entry['book']
            year_str = str(book['year']) if book.get('year') else 's/f'
            lines.append(f'Libro {i}: "{book["title"]}" de {book["author"]} ({year_str})')
            for j, doc in enumerate(entry.get('candidates', [])):
                ol_title = doc.get('title', '?')
                ol_authors = ', '.join(doc.get('author_name') or ['?'])
                ol_year = doc.get('first_publish_year', '?')
                editions = doc.get('edition_count', '?')
                lines.append(f'  [{j}] "{ol_title}" / {ol_authors} / {ol_year} — {editions} ediciones')
            lines.append('')
        return '\n'.join(lines)

    def _build_similar_prompt(self, seed_book: dict, profile: dict | None, count: int) -> str:
        """Build prompt for similar book recommendations."""
        lines: list[str] = [
            f'Recomiéndame exactamente {count} libros similares a este:',
            '',
            f'LIBRO SEMILLA: "{seed_book["title"]}" de {seed_book["author"]}',
            '',
            'Busca libros que tengan:',
            '- Tono y atmósfera similares',
            '- Temáticas parecidas o complementarias',
            '- Nivel de complejidad comparable',
            '',
            'IMPORTANTE: NO incluyas libros del mismo autor. '
            'Busca autores diferentes que ofrezcan experiencias similares.',
            'Explica brevemente por qué cada libro es similar al original.',
        ]

        if profile:
            plines: list[str] = ['', 'CONTEXTO DEL LECTOR:']
            if profile.get('liked'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['liked']
                )
                plines.append(f'- Libros que le han gustado: {items}')
            if profile.get('disliked'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['disliked']
                )
                plines.append(f'- Libros que no le gustaron: {items}')
            if profile.get('read'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['read']
                )
                plines.append(f'- Libros que ya ha leído: {items}')
            if profile.get('rejected'):
                items = ', '.join(
                    f'"{b["title"]}" de {b["author"]}' for b in profile['rejected']
                )
                plines.append(f'- Libros que no le interesaron: {items}')
            plines.append('NO repitas ninguno de estos libros.')
            lines.extend(plines)

        lines.append(
            '\nDispones de la herramienta de búsqueda web. Úsala si necesitas encontrar '
            'libros similares recientes que quizá no estén en tu contexto de entrenamiento, '
            'o para verificar que los títulos y autores que propones son correctos.'
        )
        return '\n'.join(lines)
