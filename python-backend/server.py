from __future__ import annotations

import argparse
import base64
import io
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

app = FastAPI(title='Utilix PDF Backend', version='1.0.0')


class PdfMetadataRequest(BaseModel):
    file_path: str
    password: str | None = None


class PdfMetadataResponse(BaseModel):
    page_count: int
    title: str | None = None
    author: str | None = None
    size: int


class PdfMergeRequest(BaseModel):
    file_paths: list[str]
    password: str | None = None
    passwords_by_file_path: dict[str, str] | None = None
    output_path: str | None = None


class PdfExtractRequest(BaseModel):
    file_path: str
    start_page: int | None = 1
    end_page: int | None = None
    page_numbers: list[int] | None = None
    password: str | None = None
    output_path: str | None = None


class PdfRotateRequest(BaseModel):
    file_path: str
    rotation: int = Field(90)
    start_page: int | None = 1
    end_page: int | None = None
    page_numbers: list[int] | None = None
    password: str | None = None
    output_path: str | None = None


class PdfDeleteRequest(BaseModel):
    file_path: str
    page_numbers: list[int]
    password: str | None = None
    output_path: str | None = None


class PdfUpdateMetadataRequest(BaseModel):
    file_path: str
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    password: str | None = None
    output_path: str | None = None


class PdfEncryptRequest(BaseModel):
    file_path: str
    user_password: str
    owner_password: str | None = None
    existing_password: str | None = None
    output_path: str | None = None


class PdfDecryptRequest(BaseModel):
    file_path: str
    password: str
    output_path: str | None = None


class PdfWatermarkTextRequest(BaseModel):
    file_path: str
    text: str
    opacity: float = 0.18
    rotation: int = 35
    font_size: int = 42
    start_page: int | None = None
    end_page: int | None = None
    page_numbers: list[int] | None = None
    password: str | None = None
    output_path: str | None = None


class PdfPreviewRequest(BaseModel):
    file_path: str
    page_number: int = 1
    password: str | None = None


class PdfOperationResponse(BaseModel):
    success: bool
    output_path: str | None = None
    output_base64: str
    page_count: int
    new_size: int


def _normalize_password(password: str | None) -> str | None:
    if password is None:
        return None

    trimmed = password.strip()
    return trimmed if trimmed else None


def _ensure_file_path(file_path: str) -> Path:
    if not file_path:
        raise HTTPException(status_code=400, detail='No file path provided.')

    resolved = Path(file_path)
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail='PDF file was not found.')

    return resolved


def _load_reader(file_path: str, password: str | None = None) -> PdfReader:
    resolved = _ensure_file_path(file_path)

    try:
        reader = PdfReader(str(resolved))
    except PdfReadError as error:
        raise HTTPException(status_code=400, detail=f'Could not read PDF: {error}') from error

    normalized_password = _normalize_password(password)

    if reader.is_encrypted:
        if not normalized_password:
            raise HTTPException(status_code=401, detail='PDF is password protected. Provide a password.')

        try:
            decrypted = reader.decrypt(normalized_password)
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=401, detail=f'Could not decrypt PDF: {error}') from error

        if decrypted == 0:
            raise HTTPException(status_code=401, detail='Invalid PDF password.')

    return reader


def _safe_metadata_dict(reader: PdfReader) -> dict[str, str]:
    metadata: dict[str, str] = {}

    raw_metadata = reader.metadata
    if not raw_metadata:
        return metadata

    for key, value in raw_metadata.items():
        if not isinstance(key, str):
            continue
        if value is None:
            continue
        metadata[key] = str(value)

    return metadata


def _resolve_page_indices(
    total_pages: int,
    page_numbers: list[int] | None,
    start_page: int | None,
    end_page: int | None,
    default_all: bool,
) -> list[int]:
    if total_pages <= 0:
        return []

    if page_numbers:
        selected = sorted({page for page in page_numbers if 1 <= page <= total_pages})
        return [page - 1 for page in selected]

    if start_page is None and end_page is None:
        if default_all:
            return list(range(total_pages))
        start = 1
        end = total_pages
    else:
        start = max(1, start_page or 1)
        end = min(total_pages, end_page or total_pages)

    if start > end:
        raise HTTPException(status_code=400, detail=f'Invalid page range: {start}-{end}.')

    return list(range(start - 1, end))


def _writer_to_response(writer: PdfWriter, output_path: str | None) -> PdfOperationResponse:
    stream = io.BytesIO()
    writer.write(stream)
    payload = stream.getvalue()

    if output_path:
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(payload)

    return PdfOperationResponse(
        success=True,
        output_path=output_path,
        output_base64=base64.b64encode(payload).decode('ascii'),
        page_count=len(writer.pages),
        new_size=len(payload),
    )


def _clone_pdf(reader: PdfReader) -> PdfWriter:
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    metadata = _safe_metadata_dict(reader)
    if metadata:
        writer.add_metadata(metadata)

    return writer


def _create_text_watermark_page(
    text: str,
    width: float,
    height: float,
    opacity: float,
    rotation: int,
    font_size: int,
):
    packet = io.BytesIO()
    pdf_canvas = canvas.Canvas(packet, pagesize=(width, height))

    pdf_canvas.saveState()

    try:
        clamped_opacity = max(0.0, min(opacity, 1.0))
        pdf_canvas.setFillAlpha(clamped_opacity)
    except AttributeError:
        # Some reportlab builds do not support alpha.
        pass

    pdf_canvas.setFillColor(Color(0.22, 0.22, 0.22))
    pdf_canvas.translate(width / 2, height / 2)
    pdf_canvas.rotate(rotation)
    pdf_canvas.setFont('Helvetica-Bold', max(font_size, 8))
    pdf_canvas.drawCentredString(0, 0, text)
    pdf_canvas.restoreState()
    pdf_canvas.save()

    packet.seek(0)
    return PdfReader(packet).pages[0]


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/pdf/metadata', response_model=PdfMetadataResponse)
def pdf_metadata(request: PdfMetadataRequest) -> PdfMetadataResponse:
    reader = _load_reader(request.file_path, request.password)
    stats = _ensure_file_path(request.file_path).stat()
    metadata = reader.metadata

    return PdfMetadataResponse(
        page_count=len(reader.pages),
        title=str(metadata.title) if metadata and metadata.title else None,
        author=str(metadata.author) if metadata and metadata.author else None,
        size=stats.st_size,
    )


@app.post('/pdf/preview')
def pdf_preview(request: PdfPreviewRequest) -> dict[str, Any]:
    reader = _load_reader(request.file_path, request.password)
    stats = _ensure_file_path(request.file_path).stat()

    return {
        'page_count': len(reader.pages),
        'size': stats.st_size,
        'page_number': request.page_number,
    }


@app.post('/pdf/merge', response_model=PdfOperationResponse)
def pdf_merge(request: PdfMergeRequest) -> PdfOperationResponse:
    if len(request.file_paths) < 2:
        raise HTTPException(status_code=400, detail='Provide at least two files to merge.')

    writer = PdfWriter()

    for file_path in request.file_paths:
        password = request.password
        if request.passwords_by_file_path and file_path in request.passwords_by_file_path:
            password = request.passwords_by_file_path[file_path]

        reader = _load_reader(file_path, password)
        for page in reader.pages:
            writer.add_page(page)

    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/extract-range', response_model=PdfOperationResponse)
def pdf_extract_range(request: PdfExtractRequest) -> PdfOperationResponse:
    reader = _load_reader(request.file_path, request.password)
    indices = _resolve_page_indices(
        total_pages=len(reader.pages),
        page_numbers=request.page_numbers,
        start_page=request.start_page,
        end_page=request.end_page,
        default_all=False,
    )

    if not indices:
        raise HTTPException(status_code=400, detail='No valid pages selected for extraction.')

    writer = PdfWriter()
    for index in indices:
        writer.add_page(reader.pages[index])

    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/rotate-pages', response_model=PdfOperationResponse)
def pdf_rotate_pages(request: PdfRotateRequest) -> PdfOperationResponse:
    if request.rotation not in (90, 180, 270):
        raise HTTPException(status_code=400, detail='Rotation must be 90, 180, or 270.')

    reader = _load_reader(request.file_path, request.password)
    indices = set(
        _resolve_page_indices(
            total_pages=len(reader.pages),
            page_numbers=request.page_numbers,
            start_page=request.start_page,
            end_page=request.end_page,
            default_all=True,
        )
    )

    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in indices:
            page.rotate(request.rotation)
        writer.add_page(page)

    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/delete-pages', response_model=PdfOperationResponse)
def pdf_delete_pages(request: PdfDeleteRequest) -> PdfOperationResponse:
    reader = _load_reader(request.file_path, request.password)
    total_pages = len(reader.pages)
    indices_to_delete = set(
        _resolve_page_indices(
            total_pages=total_pages,
            page_numbers=request.page_numbers,
            start_page=None,
            end_page=None,
            default_all=False,
        )
    )

    if not indices_to_delete:
        raise HTTPException(status_code=400, detail='No valid pages selected for deletion.')

    if len(indices_to_delete) >= total_pages:
        raise HTTPException(status_code=400, detail='Cannot delete all pages from a PDF.')

    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in indices_to_delete:
            continue
        writer.add_page(page)

    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/update-metadata', response_model=PdfOperationResponse)
def pdf_update_metadata(request: PdfUpdateMetadataRequest) -> PdfOperationResponse:
    reader = _load_reader(request.file_path, request.password)
    writer = _clone_pdf(reader)

    metadata = _safe_metadata_dict(reader)
    if request.title is not None:
        metadata['/Title'] = request.title
    if request.author is not None:
        metadata['/Author'] = request.author
    if request.subject is not None:
        metadata['/Subject'] = request.subject
    if request.keywords is not None:
        metadata['/Keywords'] = request.keywords

    metadata['/Producer'] = 'Utilix PDF Backend'
    metadata['/Creator'] = 'Utilix PDF Backend'

    writer.add_metadata(metadata)
    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/encrypt', response_model=PdfOperationResponse)
def pdf_encrypt(request: PdfEncryptRequest) -> PdfOperationResponse:
    password = _normalize_password(request.user_password)
    if not password:
        raise HTTPException(status_code=400, detail='User password is required for encryption.')

    reader = _load_reader(request.file_path, request.existing_password)
    writer = _clone_pdf(reader)

    owner_password = _normalize_password(request.owner_password) or password

    try:
        writer.encrypt(user_password=password, owner_password=owner_password, algorithm='AES-256')
    except TypeError:
        writer.encrypt(user_password=password, owner_password=owner_password)

    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/decrypt', response_model=PdfOperationResponse)
def pdf_decrypt(request: PdfDecryptRequest) -> PdfOperationResponse:
    reader = _load_reader(request.file_path, request.password)
    if not reader.is_encrypted:
        raise HTTPException(status_code=400, detail='PDF is not encrypted.')

    writer = _clone_pdf(reader)
    return _writer_to_response(writer, request.output_path)


@app.post('/pdf/watermark-text', response_model=PdfOperationResponse)
def pdf_watermark_text(request: PdfWatermarkTextRequest) -> PdfOperationResponse:
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Watermark text is required.')

    reader = _load_reader(request.file_path, request.password)
    indices = set(
        _resolve_page_indices(
            total_pages=len(reader.pages),
            page_numbers=request.page_numbers,
            start_page=request.start_page,
            end_page=request.end_page,
            default_all=True,
        )
    )

    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in indices:
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)
            watermark_page = _create_text_watermark_page(
                text=text,
                width=page_width,
                height=page_height,
                opacity=request.opacity,
                rotation=request.rotation,
                font_size=request.font_size,
            )
            page.merge_page(watermark_page)

        writer.add_page(page)

    return _writer_to_response(writer, request.output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description='Utilix PDF backend server')
    parser.add_argument('--port', type=int, default=3400)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
