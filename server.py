import json
import asyncio
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag_engine import RAGEngine, GEMINI_MODEL

app = FastAPI(title="RAG Document Chatbot", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inisialisasi engine RAG
rag_engine = RAGEngine()

# Muat cache saat startup
@app.on_event("startup")
async def startup_event():
    print("[SERVER] Memuat index RAG...")
    # Jalankan build_or_load_index di background thread agar tidak memblokir event loop
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, rag_engine.build_or_load_index, False)
    print(f"[SERVER] Index siap dengan {len(rag_engine.chunks)} chunk.")


class MessageItem(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[MessageItem]] = []
    top_k: Optional[int] = 4


@app.get("/api/status")
def get_status():
    return {
        "is_ready": rag_engine.is_ready,
        "total_chunks": len(rag_engine.chunks),
        "embedding_model": "paraphrase-multilingual-MiniLM-L12-v2",
        "llm_model": GEMINI_MODEL,
        "documents": rag_engine.document_stats,
    }


@app.post("/api/reindex")
async def reindex_documents():
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, rag_engine.build_or_load_index, True)
    return {
        "success": True,
        "result": result
    }


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    user_query = req.message.strip()
    if not user_query:
        async def empty_gen():
            yield f"data: {json.dumps({'type': 'error', 'message': 'Pesan tidak boleh kosong.'})}\n\n"
        return StreamingResponse(empty_gen(), media_type="text/event-stream")

    history_dicts = [{"role": h.role, "content": h.content} for h in req.history] if req.history else []

    async def event_generator():
        try:
            # Jalankan generator RAG di executor atau iterasi
            loop = asyncio.get_running_loop()
            
            # Kita jalankan iterasi stream
            def run_stream():
                return list(rag_engine.jawab_pertanyaan_stream(
                    pertanyaan=user_query,
                    history=history_dicts,
                    top_k=req.top_k or 4
                ))

            # Untuk streaming yang benar-benar realtime:
            # Kita gunakan queue async agar setiap chunk dikirim langsung saat diterima
            queue = asyncio.Queue()

            def sync_worker():
                try:
                    for event_type, data in rag_engine.jawab_pertanyaan_stream(
                        pertanyaan=user_query,
                        history=history_dicts,
                        top_k=req.top_k or 4
                    ):
                        loop.call_soon_threadsafe(queue.put_nowait, (event_type, data))
                except Exception as ex:
                    loop.call_soon_threadsafe(queue.put_nowait, ("error", str(ex)))
                finally:
                    loop.call_soon_threadsafe(queue.put_nowait, ("__END__", None))

            # Jalankan worker di thread pool
            loop.run_in_executor(None, sync_worker)

            # Baca queue dan kirim sebagai SSE
            while True:
                event_type, data = await queue.get()
                if event_type == "__END__":
                    break

                if event_type == "sources":
                    payload = {"type": "sources", "sources": data}
                    yield f"data: {json.dumps(payload)}\n\n"
                elif event_type == "delta":
                    payload = {"type": "delta", "text": data}
                    yield f"data: {json.dumps(payload)}\n\n"
                elif event_type == "done":
                    payload = {"type": "done", "stats": data}
                    yield f"data: {json.dumps(payload)}\n\n"
                elif event_type == "error":
                    payload = {"type": "error", "message": data}
                    yield f"data: {json.dumps(payload)}\n\n"

        except Exception as e:
            err_payload = {"type": "error", "message": f"Server stream error: {str(e)}"}
            yield f"data: {json.dumps(err_payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# Static files mount
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
def serve_index():
    index_file = static_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "Tampilan UI belum siap."}


if __name__ == "__main__":
    import uvicorn
    print("[SERVER] Menjalankan server RAG di http://127.0.0.1:8000 ...")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
