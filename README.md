<<<<<<< HEAD
# RAG Document AI Assistant

Sistem tanya-jawab dokumen PDF berbasis *Retrieval-Augmented Generation (RAG)* menggunakan *Gemini AI* + *Sentence Transformers*. Mendukung streaming realtime, deteksi bagan/struktur organisasi via Vision AI, dan antarmuka chat modern.

---

## ⚙️ Cara Install di Laptop Baru

### 1. Prasyarat
Pastikan sudah terinstall di laptop tujuan:
- *Python 3.10 / 3.11* → https://www.python.org/downloads/
- *Tesseract OCR* → https://github.com/UB-Mannheim/tesseract/wiki  
  (Install ke path: C:\Program Files\Tesseract-OCR\tesseract.exe)
- *Git* → https://git-scm.com/

---

### 2. Clone Repository

bash
git clone https://github.com/USERNAME/NAMA_REPO.git
cd NAMA_REPO


---

### 3. Buat Virtual Environment

bash
python -m venv venv


Aktifkan venv:
- *Windows:* venv\Scripts\activate
- *Linux/Mac:* source venv/bin/activate

---

### 4. Install Semua Dependensi

bash
pip install -r requirement.txt


> ⚠️ Proses ini membutuhkan waktu ±5–15 menit karena mengunduh torch dan sentence-transformers yang cukup besar.

---

### 5. Buat File .env

Salin file contoh lalu isi dengan API key milik Anda:

bash
copy .env.example .env


Edit file .env:

GEMINI_API_KEY=isi_dengan_api_key_gemini_anda


Dapatkan API key gratis di: https://aistudio.google.com/app/apikey

---

### 6. Siapkan Folder Dokumen

Buat folder documents/ dan masukkan file PDF yang ingin digunakan:

bash
mkdir documents
# Lalu salin file PDF ke dalam folder documents/


---

### 7. Jalankan Server

bash
uvicorn server:app --reload --host 127.0.0.1 --port 8000


Buka browser: *http://127.0.0.1:8000*

---

### 8. Indeks Dokumen (Pertama Kali)

Setelah server berjalan, klik tombol *"Indeks Ulang PDF"* di sidebar aplikasi, atau jalankan endpoint:


POST http://127.0.0.1:8000/api/reindex


> Proses indexing otomatis berjalan saat server pertama kali dijalankan jika belum ada cache.

---

## 📁 Struktur Folder


RAG/
├── documents/          ← Taruh file PDF di sini (tidak di-push ke repo)
├── data_dokumen/       ← Cache index otomatis (tidak di-push ke repo)
├── static/             ← File UI (HTML, CSS, JS)
├── rag_engine.py       ← Core RAG logic
├── server.py           ← FastAPI server
├── chunking.py         ← Text chunking utility
├── requirement.txt     ← Daftar dependensi Python
├── .env.example        ← Template konfigurasi
└── .env                ← API key Anda (JANGAN di-push ke repo)


---

## 🔑 Daftar Dependensi Utama

| Package | Fungsi |
|---|---|
| fastapi + uvicorn | Web server & API |
| google-genai | Gemini AI (LLM & Vision) |
| sentence-transformers | Embedding vektor dokumen |
| pymupdf | Baca & ekstrak teks dari PDF |
| pytesseract | OCR untuk halaman scan |
| scikit-learn | Cosine similarity search |
| pillow | Pemrosesan gambar |
| python-dotenv | Baca file .env |
=======
# RAG-merit-system-polri
>>>>>>> 647aa712403f0519ca3ea00a0e0106a66172f0cf
