"""Optional self-hosted PaddleOCR service. Keep it on a private network."""
import io
import os
import secrets
import tempfile
import threading
from pathlib import Path
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image
from paddleocr import PaddleOCR

app = FastAPI(docs_url=None, redoc_url=None)
Image.MAX_IMAGE_PIXELS = 25_000_000
token = os.environ.get("OCR_TOKEN", "")
if len(token) < 32 or token.startswith("CHANGE_ME"):
    raise RuntimeError("Set a random OCR_TOKEN of at least 32 characters")
engine = PaddleOCR(lang="ch", use_doc_orientation_classify=False,
                   use_doc_unwarping=False, use_textline_orientation=False)
lock = threading.Lock()

@app.post("/extract")
def extract(file: UploadFile = File(...), authorization: str = Header(default="")):
    if not secrets.compare_digest(authorization, "Bearer " + token):
        raise HTTPException(401, "Unauthorized")
    data = file.file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError("Image dimensions too large")
            image.verify()
    except Exception:
        raise HTTPException(400, "Invalid image")
    if not lock.acquire(blocking=False):
        raise HTTPException(503, "OCR busy, retry later")
    try:
        with tempfile.TemporaryDirectory(prefix="shenlun-ocr-") as directory:
            target = Path(directory) / "input.png"
            with Image.open(io.BytesIO(data)) as image:
                image.convert("RGB").save(target)
            results = engine.predict(input=str(target))
            lines = []
            for result in results:
                payload = result.json
                content = payload.get("res", payload)
                lines.extend(content.get("rec_texts", []))
            return {"text": "\n".join(lines)[:30000]}
    except Exception:
        raise HTTPException(422, "OCR could not extract text")
    finally:
        lock.release()
