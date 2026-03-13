"""
BookWise Backend — Flask application entry point.
Exposes POST /api/recommend.
"""
import logging
import os
import re
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()

from services.gemini_service import (
    GeminiInvalidResponseError,
    GeminiRateLimitError,
    GeminiUnavailableError,
    GeminiService,
)
from services.openlibrary_service import OpenLibraryService
from services.pipeline import RecommendationPipeline

# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────

def _configure_logging() -> None:
    """Configure logging for local dev and Gunicorn/Render production.

    logging.basicConfig() is a no-op when the root logger already has handlers,
    which is always the case under Gunicorn. Instead, we detect the environment
    and attach our formatter to the appropriate handlers so logs are visible both
    locally and in Render's log stream.
    """
    fmt = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    root = logging.getLogger()
    gunicorn_error = logging.getLogger('gunicorn.error')
    if gunicorn_error.handlers:
        # Running under Gunicorn: reuse its handlers (already writing to stdout/stderr,
        # which Render captures). Apply our format so all app logs are consistent.
        root.handlers = list(gunicorn_error.handlers)
        root.setLevel(logging.INFO)
        for h in root.handlers:
            h.setFormatter(fmt)
    else:
        # Local dev: set up a plain StreamHandler to stdout.
        handler = logging.StreamHandler()
        handler.setFormatter(fmt)
        root.addHandler(handler)
        root.setLevel(logging.INFO)


_configure_logging()
logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS Configuration
# In production, set FRONTEND_URL to your Vercel frontend URL
# Supports multiple origins separated by commas; supports * wildcard for preview URLs
_frontend_urls_str = os.getenv('FRONTEND_URL', '')
logger.info(f'FRONTEND_URL env var: {_frontend_urls_str}')


def _parse_origin(raw: str):
    """Normalize an origin string and convert glob wildcards to compiled regex."""
    url = raw.strip().rstrip('/')
    if '*' in url:
        # Convert glob wildcard (*) to regex so flask-cors can match dynamic preview URLs
        # e.g. https://bookwise-git-*.vercel.app → regex ^https://bookwise\-git\-.*\.vercel\.app$
        pattern = re.escape(url).replace(r'\*', '.*')
        return re.compile(f'^{pattern}$')
    return url


_frontend_origins = [
    _parse_origin(url)
    for url in _frontend_urls_str.split(',')
    if url.strip()
] if _frontend_urls_str else []

ALLOWED_ORIGINS = [
    'http://localhost:4200',
    'http://localhost:3000',
    *_frontend_origins,
]
# Filter falsy values and allow all origins in development if no origins configured
origins = [o for o in ALLOWED_ORIGINS if o]
if os.getenv('FLASK_ENV') == 'development' and not origins:
    origins = '*'

logger.info(f'CORS allowed origins: {origins}')
CORS(app, origins=origins, supports_credentials=False)


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _error_response(code: str, message: str, retryable: bool, http_status: int):
    return jsonify({'error': {'code': code, 'message': message, 'retryable': retryable}}), http_status


VALID_PURPOSES = {'enjoy', 'learn', 'reflect', 'escape'}


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.route('/api/recommend', methods=['POST'])
def recommend():
    data = request.get_json(silent=True)

    if not data:
        return _error_response(
            'INVALID_REQUEST',
            'El cuerpo de la petición debe ser JSON.',
            False, 400,
        )

    purpose = data.get('purpose')
    freetext = data.get('freetext', '')

    # If purpose is not provided but freetext exists, infer intent
    if not purpose and freetext:
        try:
            gemini = GeminiService()
            inferred = gemini.infer_intent_from_text(freetext)
            data['purpose'] = inferred['purpose']
            if inferred.get('mood') and not data.get('mood'):
                data['mood'] = inferred['mood']
            if inferred.get('inferred_genres') and not data.get('genres'):
                data['genres'] = inferred['inferred_genres']
            purpose = data['purpose']
        except Exception as e:
            logger.warning('Failed to infer intent: %s', e)
            data['purpose'] = 'enjoy'
            purpose = 'enjoy'

    if not purpose or purpose not in VALID_PURPOSES:
        return _error_response(
            'INVALID_REQUEST',
            f'El campo "purpose" es obligatorio y debe ser uno de: {", ".join(VALID_PURPOSES)}.',
            False, 400,
        )

    start = time.time()

    try:
        pipeline = RecommendationPipeline()
        result = pipeline.run(data)
    except GeminiRateLimitError:
        return _error_response(
            'GEMINI_RATE_LIMIT',
            'El servicio de recomendaciones está temporalmente saturado. Inténtalo en unos segundos.',
            True, 429,
        )
    except GeminiUnavailableError:
        return _error_response(
            'GEMINI_UNAVAILABLE',
            'El servicio de recomendaciones no está disponible en este momento. Inténtalo de nuevo.',
            True, 503,
        )
    except GeminiInvalidResponseError:
        return _error_response(
            'GEMINI_INVALID_RESPONSE',
            'No pudimos procesar las recomendaciones. Inténtalo de nuevo.',
            True, 500,
        )
    except RuntimeError as e:
        # e.g. missing API key
        logger.error('Runtime error: %s', e)
        return _error_response(
            'CONFIGURATION_ERROR',
            'Error de configuración del servidor.',
            False, 500,
        )
    except Exception as e:
        logger.exception('Unexpected error in /api/recommend: %s', e)
        return _error_response(
            'INTERNAL_ERROR',
            'Error interno del servidor. Inténtalo de nuevo.',
            True, 500,
        )

    elapsed_ms = int((time.time() - start) * 1000)
    result['meta']['processing_time_ms'] = elapsed_ms

    if not result['books']:
        return _error_response(
            'NO_RESULTS',
            'No hemos encontrado libros que coincidan con tu búsqueda. Intenta ampliar los criterios.',
            False, 200,
        )

    return jsonify(result), 200


@app.route('/api/recommend/similar', methods=['POST'])
def recommend_similar():
    """Get book recommendations similar to a seed book."""
    data = request.get_json(silent=True)

    if not data:
        return _error_response(
            'INVALID_REQUEST',
            'El cuerpo de la petición debe ser JSON.',
            False, 400,
        )

    seed_book = data.get('seed_book')
    if not seed_book or not seed_book.get('title') or not seed_book.get('author'):
        return _error_response(
            'INVALID_REQUEST',
            'El campo "seed_book" con "title" y "author" es obligatorio.',
            False, 400,
        )

    profile = data.get('profile')
    count = min(data.get('count', 6), 10)  # Max 10

    start = time.time()

    try:
        gemini = GeminiService()
        openlibrary = OpenLibraryService()

        # Get similar recommendations from Gemini
        books = gemini.generate_similar_recommendations(seed_book, profile, count)

        # Validate and enrich with OpenLibrary data
        with_docs, discarded = openlibrary.validate_books(books)
        validated: list[dict] = []

        # AI selects correct OL candidate
        if with_docs:
            ai_resolved = gemini.select_ol_matches(with_docs)
            validated.extend(ai_resolved)

        # Try to correct discarded books
        if discarded:
            corrections = gemini.correct_search_terms(discarded)
            if corrections:
                c_with_docs, _ = openlibrary.validate_with_corrections(corrections, discarded)
                if c_with_docs:
                    c_recovered = gemini.select_ol_matches(c_with_docs)
                    validated.extend(c_recovered)

        # Enrich validated books
        enriched = openlibrary.enrich_books(validated)

        result = {
            'books': enriched,
            'meta': {
                'total_generated': len(books),
                'total_validated': len(enriched),
                'seed_book': seed_book,
            },
        }

    except GeminiRateLimitError:
        return _error_response(
            'GEMINI_RATE_LIMIT',
            'El servicio de recomendaciones está temporalmente saturado. Inténtalo en unos segundos.',
            True, 429,
        )
    except GeminiUnavailableError:
        return _error_response(
            'GEMINI_UNAVAILABLE',
            'El servicio de recomendaciones no está disponible en este momento. Inténtalo de nuevo.',
            True, 503,
        )
    except GeminiInvalidResponseError:
        return _error_response(
            'GEMINI_INVALID_RESPONSE',
            'No pudimos procesar las recomendaciones. Inténtalo de nuevo.',
            True, 500,
        )
    except RuntimeError as e:
        logger.error('Runtime error: %s', e)
        return _error_response(
            'CONFIGURATION_ERROR',
            'Error de configuración del servidor.',
            False, 500,
        )
    except Exception as e:
        logger.exception('Unexpected error in /api/recommend/similar: %s', e)
        return _error_response(
            'INTERNAL_ERROR',
            'Error interno del servidor. Inténtalo de nuevo.',
            True, 500,
        )

    elapsed_ms = int((time.time() - start) * 1000)
    result['meta']['processing_time_ms'] = elapsed_ms

    if not result['books']:
        return _error_response(
            'NO_RESULTS',
            'No hemos encontrado libros similares. Inténtalo de nuevo.',
            False, 200,
        )

    return jsonify(result), 200


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
