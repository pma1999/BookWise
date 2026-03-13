"""
BookWise Backend — Flask application entry point.
Exposes POST /api/recommend and user API key management endpoints.

API key policy:
  - The server NEVER uses a server-side Gemini key.
  - Authenticated users: key is stored encrypted in Supabase (user_api_keys table).
    Requests must carry a valid Supabase JWT in Authorization: Bearer <token>.
    The backend decrypts the key server-side — it never returns to the client.
  - Guest users: key is stored in the browser's localStorage.
    Requests must carry the key in the X-Gemini-Api-Key header.
"""
import logging
import os
import re
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

from services.gemini_service import (
    GeminiInvalidResponseError,
    GeminiRateLimitError,
    GeminiUnavailableError,
    GeminiService,
)
from services.openlibrary_service import OpenLibraryService
from services.pipeline import RecommendationPipeline
from utils.crypto import decrypt_api_key, encrypt_api_key, make_key_hint
from utils.supabase_admin import (
    delete_api_key,
    get_encrypted_api_key,
    get_user_from_token,
    upsert_api_key,
)

# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS Configuration
_frontend_urls_str = os.getenv('FRONTEND_URL', '')
logger.info(f'FRONTEND_URL env var: {_frontend_urls_str}')


def _parse_origin(raw: str):
    url = raw.strip().rstrip('/')
    if '*' in url:
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
origins = [o for o in ALLOWED_ORIGINS if o]
if os.getenv('FLASK_ENV') == 'development' and not origins:
    origins = '*'

logger.info(f'CORS allowed origins: {origins}')

_CORS_ALLOW_HEADERS = 'Content-Type, Authorization, X-Gemini-Api-Key'


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    for allowed in ALLOWED_ORIGINS:
        if isinstance(allowed, re.Pattern):
            if allowed.match(origin):
                return True
        elif allowed == origin:
            return True
    return False


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin', '')
    if _origin_allowed(origin):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = _CORS_ALLOW_HEADERS
        response.headers['Vary'] = 'Origin'
    return response


@app.route('/api/<path:path>', methods=['OPTIONS'])
@app.route('/api/', methods=['OPTIONS'])
def handle_options(path=''):
    origin = request.headers.get('Origin', '')
    if _origin_allowed(origin):
        resp = app.make_response('')
        resp.status_code = 204
        resp.headers['Access-Control-Allow-Origin'] = origin
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = _CORS_ALLOW_HEADERS
        resp.headers['Access-Control-Max-Age'] = '600'
        resp.headers['Vary'] = 'Origin'
        return resp
    return app.make_response(''), 403


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _error_response(code: str, message: str, retryable: bool, http_status: int):
    return jsonify({'error': {'code': code, 'message': message, 'retryable': retryable}}), http_status


VALID_PURPOSES = {'enjoy', 'learn', 'reflect', 'escape'}


def _extract_bearer_token() -> str | None:
    """Extract the Bearer token from the Authorization header, or None."""
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        return auth[len('Bearer '):]
    return None


def _resolve_api_key() -> tuple[str | None, tuple | None]:
    """
    Resolve the Gemini API key for the current request.

    Resolution order:
      1. Authorization: Bearer <supabase_jwt>  → decrypt key from DB (auth users)
      2. X-Gemini-Api-Key: <plaintext>          → use directly (guest users)

    Returns:
      (api_key, None)        on success
      (None, error_response) when no key is found or auth fails
    """
    token = _extract_bearer_token()
    if token:
        # Authenticated path: verify JWT, fetch encrypted key from DB
        user = get_user_from_token(token)
        if not user:
            return None, _error_response(
                'UNAUTHORIZED',
                'Token de autenticación inválido o expirado.',
                False, 401,
            )
        encrypted_key, _ = get_encrypted_api_key(user.id)
        if not encrypted_key:
            return None, _error_response(
                'NO_API_KEY',
                'No tienes una clave de API de Gemini configurada. '
                'Ve a Ajustes → API Key para añadirla.',
                False, 401,
            )
        try:
            api_key = decrypt_api_key(encrypted_key)
        except ValueError:
            logger.error('Failed to decrypt API key for user %s', user.id)
            return None, _error_response(
                'CONFIGURATION_ERROR',
                'Error al recuperar tu clave de API. Por favor, vuelve a introducirla en Ajustes.',
                False, 500,
            )
        return api_key, None

    # Guest path: read from header
    guest_key = request.headers.get('X-Gemini-Api-Key', '').strip()
    if guest_key:
        return guest_key, None

    # No key provided
    return None, _error_response(
        'NO_API_KEY',
        'Debes configurar tu clave de API de Gemini en Ajustes → API Key.',
        False, 401,
    )


# ──────────────────────────────────────────────
# User API Key Management Routes
# ──────────────────────────────────────────────

@app.route('/api/user/api-key', methods=['POST'])
def save_user_api_key():
    """Save (or replace) the authenticated user's Gemini API key."""
    token = _extract_bearer_token()
    if not token:
        return _error_response('UNAUTHORIZED', 'Se requiere autenticación.', False, 401)

    user = get_user_from_token(token)
    if not user:
        return _error_response('UNAUTHORIZED', 'Token inválido o expirado.', False, 401)

    data = request.get_json(silent=True)
    if not data or not data.get('api_key'):
        return _error_response('INVALID_REQUEST', 'El campo "api_key" es obligatorio.', False, 400)

    api_key = data['api_key'].strip()
    if len(api_key) < 10:
        return _error_response(
            'INVALID_REQUEST',
            'La clave de API no parece válida.',
            False, 400,
        )

    try:
        encrypted = encrypt_api_key(api_key)
        hint = make_key_hint(api_key)
        upsert_api_key(user.id, encrypted, hint)
    except RuntimeError as exc:
        logger.error('Encryption config error: %s', exc)
        return _error_response('CONFIGURATION_ERROR', 'Error de configuración del servidor.', False, 500)
    except Exception as exc:
        logger.exception('Unexpected error saving API key: %s', exc)
        return _error_response('INTERNAL_ERROR', 'Error interno al guardar la clave.', True, 500)

    return jsonify({'hint': hint}), 200


@app.route('/api/user/api-key/status', methods=['GET'])
def get_user_api_key_status():
    """Return whether the authenticated user has a stored API key (and its hint)."""
    token = _extract_bearer_token()
    if not token:
        return _error_response('UNAUTHORIZED', 'Se requiere autenticación.', False, 401)

    user = get_user_from_token(token)
    if not user:
        return _error_response('UNAUTHORIZED', 'Token inválido o expirado.', False, 401)

    try:
        _, hint = get_encrypted_api_key(user.id)
    except Exception as exc:
        logger.exception('Error fetching key status: %s', exc)
        return _error_response('INTERNAL_ERROR', 'Error interno.', True, 500)

    return jsonify({'has_key': hint is not None, 'hint': hint}), 200


@app.route('/api/user/api-key', methods=['DELETE'])
def delete_user_api_key():
    """Delete the authenticated user's stored API key."""
    token = _extract_bearer_token()
    if not token:
        return _error_response('UNAUTHORIZED', 'Se requiere autenticación.', False, 401)

    user = get_user_from_token(token)
    if not user:
        return _error_response('UNAUTHORIZED', 'Token inválido o expirado.', False, 401)

    try:
        delete_api_key(user.id)
    except Exception as exc:
        logger.exception('Error deleting API key: %s', exc)
        return _error_response('INTERNAL_ERROR', 'Error interno al eliminar la clave.', True, 500)

    return '', 204


# ──────────────────────────────────────────────
# Recommendation Routes
# ──────────────────────────────────────────────

@app.route('/api/recommend', methods=['POST'])
def recommend():
    api_key, err = _resolve_api_key()
    if err:
        return err

    data = request.get_json(silent=True)
    if not data:
        return _error_response('INVALID_REQUEST', 'El cuerpo de la petición debe ser JSON.', False, 400)

    purpose = data.get('purpose')
    freetext = data.get('freetext', '')

    if not purpose and freetext:
        try:
            gemini = GeminiService(api_key=api_key)
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
        pipeline = RecommendationPipeline(api_key=api_key)
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
        logger.error('Runtime error: %s', e)
        return _error_response('CONFIGURATION_ERROR', 'Error de configuración del servidor.', False, 500)
    except Exception as e:
        logger.exception('Unexpected error in /api/recommend: %s', e)
        return _error_response('INTERNAL_ERROR', 'Error interno del servidor. Inténtalo de nuevo.', True, 500)

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
    api_key, err = _resolve_api_key()
    if err:
        return err

    data = request.get_json(silent=True)
    if not data:
        return _error_response('INVALID_REQUEST', 'El cuerpo de la petición debe ser JSON.', False, 400)

    seed_book = data.get('seed_book')
    if not seed_book or not seed_book.get('title') or not seed_book.get('author'):
        return _error_response(
            'INVALID_REQUEST',
            'El campo "seed_book" con "title" y "author" es obligatorio.',
            False, 400,
        )

    profile = data.get('profile')
    count = min(data.get('count', 6), 10)

    start = time.time()

    try:
        gemini = GeminiService(api_key=api_key)
        openlibrary = OpenLibraryService()

        books = gemini.generate_similar_recommendations(seed_book, profile, count)

        with_docs, discarded = openlibrary.validate_books(books)
        validated: list[dict] = []

        if with_docs:
            ai_resolved = gemini.select_ol_matches(with_docs)
            validated.extend(ai_resolved)

        if discarded:
            corrections = gemini.correct_search_terms(discarded)
            if corrections:
                c_with_docs, _ = openlibrary.validate_with_corrections(corrections, discarded)
                if c_with_docs:
                    c_recovered = gemini.select_ol_matches(c_with_docs)
                    validated.extend(c_recovered)

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
        return _error_response('CONFIGURATION_ERROR', 'Error de configuración del servidor.', False, 500)
    except Exception as e:
        logger.exception('Unexpected error in /api/recommend/similar: %s', e)
        return _error_response('INTERNAL_ERROR', 'Error interno del servidor. Inténtalo de nuevo.', True, 500)

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
