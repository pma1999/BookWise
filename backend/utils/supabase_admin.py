"""
Supabase admin client for backend operations.

Uses the service_role key which bypasses Row Level Security.
Only used server-side — never exposed to the frontend.
"""
import logging
import os

from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Module-level singleton to avoid recreating the client on every request
_admin_client: Client | None = None


def get_admin_client() -> Client:
    """Return (or lazily create) the Supabase admin client."""
    global _admin_client
    if _admin_client is None:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        if not url or not key:
            raise RuntimeError(
                'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set'
            )
        _admin_client = create_client(url, key)
    return _admin_client


def get_user_from_token(token: str):
    """
    Verify a Supabase JWT and return the user object.

    Returns the user if the token is valid, None otherwise.
    """
    try:
        client = get_admin_client()
        resp = client.auth.get_user(token)
        return resp.user
    except Exception as exc:
        logger.debug('JWT verification failed: %s', exc)
        return None


def get_encrypted_api_key(user_id: str) -> tuple[str | None, str | None]:
    """
    Fetch (encrypted_key, key_hint) for a user from user_api_keys.

    Returns (None, None) if no key is stored.
    """
    try:
        client = get_admin_client()
        resp = (
            client.table('user_api_keys')
            .select('encrypted_key, key_hint')
            .eq('user_id', user_id)
            .maybe_single()
            .execute()
        )
        if resp.data:
            return resp.data['encrypted_key'], resp.data['key_hint']
        return None, None
    except Exception as exc:
        logger.error('Error fetching API key for user %s: %s', user_id, exc)
        return None, None


def upsert_api_key(user_id: str, encrypted_key: str, key_hint: str) -> None:
    """Insert or update the encrypted API key for a user."""
    client = get_admin_client()
    client.table('user_api_keys').upsert(
        {
            'user_id': user_id,
            'encrypted_key': encrypted_key,
            'key_hint': key_hint,
            'updated_at': 'now()',
        },
        on_conflict='user_id',
    ).execute()


def delete_api_key(user_id: str) -> None:
    """Delete the stored API key for a user."""
    client = get_admin_client()
    client.table('user_api_keys').delete().eq('user_id', user_id).execute()
