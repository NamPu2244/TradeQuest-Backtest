"""Verified Supabase identities; local mode remains independent/offline."""
import hmac
import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from uuid import UUID
import httpx
import jwt
from fastapi import Header, HTTPException

CLOUD = os.getenv('TQ_DEPLOYMENT') == 'cloud' or os.getenv('VERCEL') == '1'
LOCAL = 'local'
SHARED = 'shared'

def local_key():
    if CLOUD:
        return ''
    root = Path(__file__).resolve().parents[3]
    data = Path(os.getenv('TQ_DATA_DIR', str(root / 'data')))
    data.mkdir(parents=True, exist_ok=True)
    path = data / 'local.key'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file:
            file.write(secrets.token_urlsafe(48))
    except FileExistsError:
        pass
    return os.getenv('TQ_LOCAL_KEY') or path.read_text().strip()

LOCAL_KEY = local_key()

@dataclass(frozen=True)
class Principal:
    id: str
    email: str = ''

def allowed(user_id):
    users = {s.strip() for s in os.getenv('TQ_ALLOWED_USER_IDS', '').split(',') if s.strip()}
    return bool(user_id) and user_id in users

@lru_cache(maxsize=4)
def jwks(url):
    return jwt.PyJWKClient(url + '/auth/v1/.well-known/jwks.json', cache_jwk_set=True, lifespan=300, timeout=8)

def verify_token(token):
    url = os.getenv('SUPABASE_URL', '').rstrip('/')
    if not url.startswith('https://'):
        raise HTTPException(503, 'Cloud authentication is not configured')
    try:
        algorithm = jwt.get_unverified_header(token).get('alg')
        issuer = url + '/auth/v1'
        if algorithm in ('RS256', 'ES256'):
            key = jwks(url).get_signing_key_from_jwt(token).key
            claims = jwt.decode(token, key, algorithms=[algorithm], audience='authenticated', issuer=issuer,
                                options={'require': ['exp', 'iat', 'sub', 'iss', 'aud']})
        elif algorithm == 'HS256':
            # Legacy projects: let Supabase verify the symmetric signature. No JWT secret here.
            key = os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
            if not key:
                raise HTTPException(503, 'Cloud authentication is not configured')
            response = httpx.get(url + '/auth/v1/user', headers={'Authorization': 'Bearer ' + token, 'apikey': key}, timeout=8)
            if response.status_code != 200:
                raise HTTPException(401, 'Login required')
            user = response.json()
            claims = jwt.decode(token, options={'verify_signature': False, 'verify_exp': True,
                                                'verify_aud': True, 'verify_iss': True, 'require': ['exp', 'iat', 'sub', 'iss', 'aud']},
                                audience='authenticated', issuer=issuer)
            if claims['sub'] != user['id'] or claims.get('email', '').lower() != user.get('email', '').lower():
                raise HTTPException(401, 'Login required')
        else:
            raise HTTPException(401, 'Login required')
        UUID(claims['sub'])
        if claims.get('role') != 'authenticated' or not allowed(claims['sub']):
            raise HTTPException(403, 'Account is not invited')
        return Principal(claims['sub'], claims.get('email', ''))
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(401, 'Login required') from None
    except (httpx.HTTPError, jwt.PyJWKClientError):
        raise HTTPException(503, 'Authentication temporarily unavailable') from None

def get_principal(authorization: str = Header(default=''), x_tradequest_local: str = Header(default='')):
    if not CLOUD:
        if not hmac.compare_digest(x_tradequest_local, LOCAL_KEY):
            raise HTTPException(401, 'Open the local frontend')
        return Principal(LOCAL)
    if not authorization.startswith('Bearer ') or len(authorization) > 16384:
        raise HTTPException(401, 'Login required')
    return verify_token(authorization[7:])
