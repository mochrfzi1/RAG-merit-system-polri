import os
import pickle
import time
from pathlib import Path
from io import BytesIO
import numpy as np
from PIL import Image
import pymupdf
import pytesseract
from dotenv import load_dotenv
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer
from google import genai
from chunking import buat_chunk

# Konfigurasi Tesseract OCR
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Load environment variables
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

CACHE_DIR = Path("data_dokumen")
CACHE_FILE = CACHE_DIR / "rag_store.pkl"
DOCUMENTS_DIR = Path("documents")
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
GEMINI_MODEL = "gemini-flash-lite-latest"
GEMINI_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.6-flash",
]


class RAGEngine:
    def __init__(self):
        self.model = None
        self.client = None
        self.chunks = []
        self.embeddings = None
        self.is_ready = False
        self.document_stats = []
        self._init_gemini()

    def _init_gemini(self):
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY tidak ditemukan di file .env")
        self.client = genai.Client(api_key=GEMINI_API_KEY)

    def load_embedding_model(self):
        if self.model is None:
            print(f"[RAG] Memuat model embedding '{MODEL_NAME}'...")
            self.model = SentenceTransformer(MODEL_NAME)
            print("[RAG] Model embedding siap.")

    def analisa_bagan_dengan_vision(self, gambar_pil: Image.Image) -> str:
        """
        Menggunakan Gemini Vision untuk membaca dan menguraikan gambar bagan/diagram/struktur organisasi
        menjadi teks hierarki terstruktur yang kaya konteks untuk RAG.
        """
        prompt = """Perhatikan gambar ini dengan teliti. Jika gambar ini memuat bagan struktur organisasi, diagram alur, matriks, atau tabel:
Tolong uraikan seluruh bagan ini ke dalam teks hierarki yang sangat rinci, terstruktur, dan jelas:
1. Sebutkan nama instansi/organisasi dan judul bagan jika ada.
2. Jelaskan urutan hierarki kepemimpinan dari pucuk pimpinan hingga bawahan (siapa memimpin, siapa membawahi siapa).
3. Kelompokkan unsur-unsur organisasi (misal: Unsur Pimpinan, Unsur Pengawas, Unsur Pembantu Pimpinan/Staf, Unsur Pelaksana Teknis/Operasional, Unsur Pendukung, dan Unsur Kewilayahan).
4. Sebutkan seluruh nama bagian, bidang, satuan, subbagian, dan seksi beserta garis komando/koordinasinya.

Jika gambar bukan bagan struktur (misalnya dokumen teks biasa atau foto), cukup transkripsikan teks yang terbaca dengan rapi.
Jawab dalam Bahasa Indonesia."""

        models_to_try = GEMINI_MODELS
        for m in models_to_try:
            try:
                res = self.client.models.generate_content(
                    model=m,
                    contents=[gambar_pil, prompt]
                )
                if res and res.text:
                    return res.text.strip()
            except Exception as e:
                print(f"[RAG Vision Info] Model {m} ({e}), mencoba model lain...")
        return ""

    def baca_pdf(self, path_file: Path):
        dokumen = []
        nama_file = path_file.name
        print(f"[RAG] Memproses dokumen: {nama_file}")

        with pymupdf.open(str(path_file)) as pdf:
            total_hal = len(pdf)
            for nomor, halaman in enumerate(pdf, start=1):
                teks = halaman.get_text("text").strip()
                ada_gambar = len(halaman.get_images()) > 0

                # Indikasi apakah halaman memuat bagan / struktur organisasi
                kata_kunci_bagan = ["STRUKTUR ORGANISASI", "SUSUNAN ORGANISASI", "BAGAN", "DIAGRAM", "LAMPIRAN"]
                indikasi_bagan = any(k in teks.upper() for k in kata_kunci_bagan) and ada_gambar

                # 1. Jika halaman adalah hasil scan murni (teks digital sangat sedikit/kosong)
                if len(teks) < 30:
                    try:
                        pix = halaman.get_pixmap(dpi=150)
                        gambar = Image.open(BytesIO(pix.tobytes("png")))
                        
                        # Coba OCR standar terlebih dahulu
                        teks_ocr = pytesseract.image_to_string(gambar, lang="ind").strip()
                        
                        # Jika teks OCR mengindikasikan bagan struktur organisasi atau teks sangat minim
                        if any(k in teks_ocr.upper() for k in ["STRUKTUR", "ORGANISASI", "KAPOL", "DIREKTORAT", "BAGAN"]):
                            print(f"[RAG Vision] Hal {nomor} {nama_file} terdeteksi bagan/struktur, memproses dengan Gemini Vision...")
                            deskripsi_vision = self.analisa_bagan_dengan_vision(gambar)
                            if deskripsi_vision:
                                teks = f"{teks_ocr}\n\n[URAIAN STRUKTUR ORGANISASI DARI GAMBAR]:\n{deskripsi_vision}"
                            else:
                                teks = teks_ocr
                        else:
                            teks = teks_ocr
                    except Exception as e:
                        print(f"[RAG OCR Warning] Gagal OCR hal {nomor} {nama_file}: {e}")
                        teks = ""

                # 2. Jika halaman memiliki teks judul lampiran TAPI memuat screenshot gambar bagan struktur organisasi
                elif indikasi_bagan:
                    try:
                        print(f"[RAG Vision] Hal {nomor} {nama_file} memuat teks + gambar bagan struktur. Menguraikan gambar dengan Gemini Vision...")
                        pix = halaman.get_pixmap(dpi=150)
                        gambar = Image.open(BytesIO(pix.tobytes("png")))
                        deskripsi_vision = self.analisa_bagan_dengan_vision(gambar)
                        if deskripsi_vision:
                            teks = f"{teks}\n\n[URAIAN STRUKTUR ORGANISASI DARI GAMBAR]:\n{deskripsi_vision}"
                    except Exception as e:
                        print(f"[RAG Vision Warning] Gagal analisa vision hal {nomor} {nama_file}: {e}")

                if teks:
                    dokumen.append({
                        "sumber": nama_file,
                        "path": str(path_file),
                        "halaman": nomor,
                        "total_halaman": total_hal,
                        "teks": teks
                    })

        return dokumen

    def build_or_load_index(self, force_rebuild=False):
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.load_embedding_model()

        pdf_files = list(DOCUMENTS_DIR.glob("*.pdf"))
        current_filenames = set(p.name for p in pdf_files)

        if not force_rebuild and CACHE_FILE.exists():
            try:
                print(f"[RAG] Memeriksa cache: {CACHE_FILE}...")
                with open(CACHE_FILE, "rb") as f:
                    cache_data = pickle.load(f)
                    cached_stats = cache_data.get("document_stats", [])
                    cached_filenames = set(d.get("filename") for d in cached_stats)

                # Jika dokumen di folder sama persis dengan yang ada di cache, gunakan cache
                if current_filenames == cached_filenames and len(cache_data.get("chunks", [])) > 0:
                    self.chunks = cache_data.get("chunks", [])
                    self.embeddings = cache_data.get("embeddings", None)
                    self.document_stats = cached_stats
                    self.is_ready = True
                    print(f"[RAG] Berhasil memuat {len(self.chunks)} chunk dari {len(cached_stats)} dokumen dari cache.")
                    return {
                        "status": "loaded_from_cache",
                        "total_chunks": len(self.chunks),
                        "documents": self.document_stats
                    }
                else:
                    perbedaan = current_filenames.symmetric_difference(cached_filenames)
                    print(f"[RAG Auto-Detect] Terdeteksi perbedaan dokumen PDF ({perbedaan}). Membangun ulang index...")
            except Exception as e:
                print(f"[RAG Warning] Gagal membaca cache ({e}), membangun ulang index...")

        # Bangun index baru dari folder documents/
        print("[RAG] Membangun index dokumen baru...")
        pdf_files = list(DOCUMENTS_DIR.glob("*.pdf"))
        if not pdf_files:
            print("[RAG] Tidak ada dokumen PDF di folder documents/")
            self.chunks = []
            self.embeddings = np.empty((0, 384))
            self.is_ready = True
            return {"status": "no_documents", "total_chunks": 0, "documents": []}

        semua_dokumen = []
        stats = []

        for pdf_path in pdf_files:
            docs = self.baca_pdf(pdf_path)
            semua_dokumen.extend(docs)
            stats.append({
                "filename": pdf_path.name,
                "size_mb": round(pdf_path.stat().st_size / (1024 * 1024), 2),
                "total_halaman": len(docs) if docs else 0
            })

        # Pecah teks menjadi chunks
        chunks = []
        for data in semua_dokumen:
            potongan_teks = buat_chunk(data["teks"], ukuran=1000, overlap=200)
            for idx, teks_chunk in enumerate(potongan_teks, start=1):
                chunks.append({
                    "sumber": data["sumber"],
                    "halaman": data["halaman"],
                    "total_halaman": data.get("total_halaman", 1),
                    "chunk_id": idx,
                    "teks": teks_chunk
                })

        print(f"[RAG] Membuat embedding vektor untuk {len(chunks)} chunks...")
        teks_list = [c["teks"] for c in chunks]
        embeddings = self.model.encode(teks_list, show_progress_bar=False, normalize_embeddings=True)

        self.chunks = chunks
        self.embeddings = embeddings
        self.document_stats = stats
        self.is_ready = True

        # Simpan ke cache
        try:
            with open(CACHE_FILE, "wb") as f:
                pickle.dump({
                    "chunks": chunks,
                    "embeddings": embeddings,
                    "document_stats": stats,
                    "created_at": time.time()
                }, f)
            print(f"[RAG] Cache berhasil disimpan ke {CACHE_FILE}.")
        except Exception as e:
            print(f"[RAG Warning] Gagal menyimpan cache: {e}")

        return {
            "status": "indexed_successfully",
            "total_chunks": len(self.chunks),
            "documents": self.document_stats
        }

    def cari_dokumen(self, pertanyaan: str, top_k: int = 4, expand_neighbors: bool = True):
        if not self.is_ready or len(self.chunks) == 0:
            return []

        vektor_tanya = self.model.encode([pertanyaan], normalize_embeddings=True)
        skor = cosine_similarity(vektor_tanya, self.embeddings)[0]

        q_lower = pertanyaan.lower()

        # 1. Document-Aware Keyword Boost
        # Jika nama dokumen atau entitas spesifik disebut di pertanyaan, beri bobot tambahan pada dokumen terkait
        final_scores = np.copy(skor)
        doc_keywords = {
            "polsek": "STOK POLSEK.pdf",
            "polres": "SOTK POLRES.pdf",
            "polda": "SOTK POLDA.pdf",
            "mabes": "SOTK MABES.pdf",
            "perpol": "PERPOL NO 1 TAHUN 2025.pdf",
            "kontrak kerja": "PERPOL NO 1 TAHUN 2025.pdf",
            "kinerja": "PERPOL NO 1 TAHUN 2025.pdf",
            "sbp": "PENGUMUMAN SBP TA 2027.pdf",
            "tamtama": "PENGUMUMAN SBP TA 2027.pdf",
            "bintara": "PENGUMUMAN SBP TA 2027.pdf",
            "dikbang": "PENGUMUMAN SBP TA 2027.pdf",
        }

        for kw, doc_name in doc_keywords.items():
            if kw in q_lower:
                for idx, c in enumerate(self.chunks):
                    if doc_name.lower() in c["sumber"].lower():
                        final_scores[idx] += 0.20

        # Deteksi apakah pertanyaan meminta rincian lengkap / tabel / susunan menyeluruh
        kata_kunci_lengkap = [
            "lengkap", "susunan", "daftar", "semua", "seluruh", "rincian",
            "struktur", "bagan", "tabel", "tipe a", "tipe b", "tipe c",
            "tipe d", "jabatan", "personel", "alur", "pasal", "tahapan", "uraian"
        ]
        is_comprehensive = any(k in q_lower for k in kata_kunci_lengkap)

        # Ambil top candidate chunks
        initial_k = max(top_k, 6 if is_comprehensive else 4)
        top_indices = final_scores.argsort()[::-1][:initial_k]

        selected_indices = set()
        chunk_scores = {}

        for idx in top_indices:
            sim_score = float(final_scores[idx])
            if sim_score < 0.20:
                continue
            selected_indices.add(idx)
            chunk_scores[idx] = max(chunk_scores.get(idx, 0.0), sim_score)

            # 2. Context Window / Neighboring Chunk Expansion
            # Jika tabel / daftar bersambung ke halaman berikutnya, ambil chunk selanjutnya dari dokumen yang sama
            if expand_neighbors and sim_score >= 0.35:
                chunk_asal = self.chunks[idx]
                sumber_asal = chunk_asal["sumber"]
                hal_asal = chunk_asal["halaman"]

                # Ambil hingga 6 chunk ke depan untuk memastikan tabel multi-halaman tidak terpotong
                max_forward = 6 if is_comprehensive else 3
                for step in range(1, max_forward + 1):
                    n_idx = idx + step
                    if n_idx >= len(self.chunks):
                        break
                    n_chunk = self.chunks[n_idx]

                    # Berhenti jika melompat ke file PDF lain
                    if n_chunk["sumber"] != sumber_asal:
                        break
                    # Batasi lompatan halaman maksimal 6 halaman
                    if n_chunk["halaman"] - hal_asal > 6:
                        break

                    # Cegah kebocoran ke bagian/tipe yang berlainan jika pertanyaan spesifik
                    n_text_lower = n_chunk["teks"].lower()
                    if "tipe a" in q_lower and "daftar susunan personel polsek tipe b" in n_text_lower:
                        break
                    if "tipe b" in q_lower and "daftar susunan personel polsek tipe c" in n_text_lower:
                        break
                    if "tipe c" in q_lower and "polsek tipe d" in n_text_lower:
                        break

                    selected_indices.add(n_idx)
                    decayed_score = sim_score * (0.96 ** step)
                    chunk_scores[n_idx] = max(chunk_scores.get(n_idx, 0.0), decayed_score)

        # 3. Urutkan secara kronologis (sumber -> halaman -> chunk_id)
        sorted_indices = sorted(
            selected_indices,
            key=lambda i: (self.chunks[i]["sumber"], self.chunks[i]["halaman"], self.chunks[i]["chunk_id"])
        )

        hasil = []
        for idx in sorted_indices:
            chunk = self.chunks[idx]
            sc = chunk_scores.get(idx, float(final_scores[idx]))
            hasil.append({
                "sumber": chunk["sumber"],
                "halaman": chunk["halaman"],
                "total_halaman": chunk.get("total_halaman", 1),
                "chunk_id": chunk["chunk_id"],
                "skor": round(sc, 4),
                "persen_kemiripan": round(min(sc, 1.0) * 100, 1),
                "teks": chunk["teks"]
            })

        return hasil

    def jawab_pertanyaan_stream(self, pertanyaan: str, history=None, top_k: int = 4):
        """
        Generator yang menghasilkan Server-Sent Events (SSE) kompatibel:
        - yield ("sources", list_of_matched_chunks)
        - yield ("delta", text_chunk)
        - yield ("done", stats)
        """
        if not self.is_ready:
            yield "error", "Sistem RAG belum siap atau sedang mengindeks dokumen."
            return

        # 1. Cari konteks dokumen dengan Neighboring Chunk Expansion
        sumber_ditemukan = self.cari_dokumen(pertanyaan, top_k=top_k, expand_neighbors=True)
        yield "sources", sumber_ditemukan

        # 2. Susun konteks tersusun rapi per halaman
        konteks = ""
        for item in sumber_ditemukan:
            konteks += (
                f"\n--- [DOKUMEN: {item['sumber']} | Halaman {item['halaman']}] ---\n"
                f"{item['teks']}\n"
            )

        # 3. Format riwayat percakapan singkat jika ada
        riwayat_teks = ""
        if history and isinstance(history, list):
            for h in history[-4:]:  # Ambil 4 turn terakhir
                role = "User" if h.get("role") == "user" else "Chatbot"
                riwayat_teks += f"{role}: {h.get('content', '')}\n"

        prompt = f"""Kamu adalah Asisten Pintar Dokumen (RAG AI Assistant) yang ramah, profesional, dan sangat akurat.
Tugas utamamu adalah menjawab pertanyaan pengguna HANYA berdasarkan konteks dokumen yang disediakan di bawah ini.

ATURAN WAJIB:
1. Jawablah secara terstruktur, lengkap, dan tuntas dari awal hingga akhir.
2. Jika dokumen memuat susunan, rincian, bagan, atau tabel bersambung (antar halaman), pastikan SELURUH unsur, bagian, unit, jabatan, pangkat, eselon, dan jumlah personel yang ada di konteks diuraikan secara utuh tanpa ada yang terpotong.
3. Cantumkan nomor halaman atau dokumen referensi pada setiap bagian rincian.
4. JANGAN mengarang informasi di luar konteks dokumen. Jika suatu bagian memang tidak tercantum dalam konteks, sampaikan dengan jelas.
5. Jawab dalam Bahasa Indonesia yang formal, rapi, dan mudah dibaca (gunakan heading markdown, poin bullet, dan penomoran).

RIWAYAT PERCAKAPAN SEBELUMNYA:
{riwayat_teks if riwayat_teks else "(Tidak ada riwayat sebelumnya)"}

KONTEKS DOKUMEN:
{konteks if konteks else "(Tidak ada dokumen yang relevan)"}

PERTANYAAN PENGGUNA:
{pertanyaan}
"""

        success = False
        last_error = ""

        for model_name in GEMINI_MODELS:
            try:
                print(f"[RAG] Menghubungi Gemini model '{model_name}'...")
                stream = self.client.models.generate_content_stream(
                    model=model_name,
                    contents=prompt
                )

                chunk_yielded = False
                for chunk in stream:
                    if chunk.text:
                        chunk_yielded = True
                        yield "delta", chunk.text

                # Selesai mengirimkan seluruh teks
                yield "done", {"status": "completed", "model": model_name}
                success = True
                break
            except Exception as e:
                err_str = str(e)
                print(f"[RAG Warning] Model '{model_name}' gagal ({err_str[:120]}...). Mencoba model cadangan...")
                last_error = err_str
                # Lanjut mencoba model berikutnya
                continue

        if not success:
            yield "error", f"Terjadi kesalahan saat menghubungi model Gemini: {last_error}"

