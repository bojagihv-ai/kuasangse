"""
Drive Service - Google Drive API
인증 우선순위: 1) .local/drive-token.json  2) ADC  3) 브라우저 수동 토큰
"""
import json
import base64
import os
import requests as http_requests

DRIVE_API = 'https://www.googleapis.com/drive/v3'
DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive']

_TOKEN_PATH = os.path.join(os.path.dirname(__file__), '..', '.local', 'drive-token.json')


def _get_token_from_file() -> str:
    """저장된 OAuth 토큰 파일에서 access token 획득."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not os.path.exists(_TOKEN_PATH):
        raise FileNotFoundError('drive-token.json 없음')

    creds = Credentials.from_authorized_user_file(_TOKEN_PATH, _DRIVE_SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(_TOKEN_PATH, 'w', encoding='utf-8') as f:
                f.write(creds.to_json())
        else:
            raise RuntimeError('토큰이 만료됐고 refresh_token이 없습니다. setup_drive_auth.py를 재실행하세요.')
    return creds.token


def _get_adc_token() -> str:
    """ADC(Application Default Credentials)에서 access token 획득."""
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=_DRIVE_SCOPES)
    req = google.auth.transport.requests.Request()
    creds.refresh(req)
    return creds.token


class DriveService:
    def __init__(self, token: str = ''):
        self._manual_token = token.strip()

    def _get_token(self) -> str:
        # 1순위: 저장된 OAuth 토큰 파일
        try:
            return _get_token_from_file()
        except Exception:
            pass
        # 2순위: ADC
        try:
            return _get_adc_token()
        except Exception:
            pass
        # 3순위: 브라우저 수동 토큰
        if self._manual_token:
            return self._manual_token
        raise RuntimeError(
            'Google Drive 인증 정보 없음. '
            'backend/setup_drive_auth.py를 실행해서 Drive를 연결하세요.'
        )

    def _headers(self) -> dict:
        return {'Authorization': f'Bearer {self._get_token()}'}

    def _check_error(self, data: dict, context: str = ''):
        err = data.get('error')
        if err:
            msg = err.get('message', str(err))
            raise Exception(f'{context}: {msg}' if context else msg)

    def list_images(self, folder_id: str, page_size: int = 100):
        q = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false"
        resp = http_requests.get(
            f'{DRIVE_API}/files',
            headers=self._headers(),
            params={'q': q, 'fields': 'files(id,name,mimeType,createdTime,size)',
                    'orderBy': 'createdTime', 'pageSize': page_size},
            timeout=30,
        )
        data = resp.json()
        self._check_error(data, 'listImages')
        return data.get('files', [])

    def download_bytes(self, file_id: str) -> bytes:
        resp = http_requests.get(
            f'{DRIVE_API}/files/{file_id}',
            headers=self._headers(),
            params={'alt': 'media'},
            timeout=60,
        )
        if not resp.ok:
            try:
                err = resp.json().get('error', {}).get('message', resp.text[:200])
            except Exception:
                err = resp.text[:200]
            raise Exception(f'Download failed ({resp.status_code}): {err}')
        return resp.content

    def download_base64(self, file_id: str) -> str:
        return base64.b64encode(self.download_bytes(file_id)).decode('utf-8')

    def upload_bytes(self, folder_id: str, file_name: str, content: bytes,
                     mime_type: str = 'image/jpeg') -> dict:
        metadata = {'name': file_name, 'parents': [folder_id]}
        boundary = 'pdg_boundary_xyz'
        body = (
            f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
            + json.dumps(metadata)
            + f'\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n'
        ).encode('utf-8') + content + f'\r\n--{boundary}--'.encode('utf-8')
        resp = http_requests.post(
            f'{DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink',
            headers={**self._headers(), 'Content-Type': f'multipart/related; boundary={boundary}'},
            data=body, timeout=120,
        )
        data = resp.json()
        self._check_error(data, 'uploadBytes')
        return data

    def upload_text(self, folder_id: str, file_name: str, text: str,
                    mime_type: str = 'text/html') -> dict:
        return self.upload_bytes(folder_id, file_name, text.encode('utf-8'), mime_type)

    def move_file(self, file_id: str, new_folder_id: str, old_folder_id: str) -> dict:
        resp = http_requests.patch(
            f'{DRIVE_API}/files/{file_id}',
            headers=self._headers(),
            params={'addParents': new_folder_id, 'removeParents': old_folder_id, 'fields': 'id,parents'},
            timeout=30,
        )
        data = resp.json()
        self._check_error(data, 'moveFile')
        return data

    def probe(self) -> dict:
        resp = http_requests.get(
            f'{DRIVE_API}/about',
            headers=self._headers(),
            params={'fields': 'user(displayName,emailAddress)'},
            timeout=10,
        )
        data = resp.json()
        self._check_error(data, 'probe')
        user = data.get('user', {})
        return {
            'ready': True,
            'accountEmail': user.get('emailAddress'),
            'accountName': user.get('displayName'),
            'message': 'Google Drive 연결됨',
        }
