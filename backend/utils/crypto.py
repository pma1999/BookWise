"""
Symmetric encryption for user API keys stored in the database.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the `cryptography` library.
The server secret is stored in the API_KEY_ENCRYPTION_SECRET environment variable.

Generate a fresh key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    secret = os.getenv('API_KEY_ENCRYPTION_SECRET')
    if not secret:
        raise RuntimeError('API_KEY_ENCRYPTION_SECRET environment variable is not set')
    return Fernet(secret.encode())


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt a plaintext API key. Returns URL-safe base64 ciphertext."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt a ciphertext produced by encrypt_api_key. Raises ValueError on failure."""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ValueError('Failed to decrypt API key — invalid token or wrong secret') from exc


def make_key_hint(api_key: str) -> str:
    """Return a safe display hint like 'AIza...4Xz2' (first 4 + last 4 chars)."""
    if len(api_key) < 9:
        return '***'
    return f"{api_key[:4]}...{api_key[-4:]}"
