# PrimeTeam Mobile Backend API Server

Backend RESTful API berbasis Node.js, Express, dan TypeScript untuk aplikasi mobile PrimeTeam (Android/iOS). Terhubung langsung dengan database MariaDB dan berbagi penyimpanan dokumen (`app_files`) dengan aplikasi web CodeIgniter (PAAS).

---

## 🚀 Panduan Menjalankan dengan Docker Compose (Standalone)

Jika aplikasi web utama (`primeteam_original`) sudah berjalan dengan Docker Compose, jalankan API mobile ini di folder terpisah (`~/project/primeteam-original/mobile_server`) dengan langkah berikut:

### 1. Salin Environment Docker
```bash
cp .env.docker.example .env
```
Sesuaikan `DB_USER`, `DB_PASSWORD`, dan `DB_NAME` di dalam file `.env` agar sama dengan database di web `primeteam_original`.

### 2. Periksa Nama Docker Network & Volume Web
Jalankan di server:
```bash
# Cek nama network
docker network ls | grep app_network
# Default: primeteam_original_app_network

# Cek nama volume files
docker volume ls | grep app_files
# Default: primeteam_original_app_files
```
Jika nama network atau volume berbeda, sesuaikan nilai `SHARED_NETWORK` dan `SHARED_FILES_VOLUME` di file `.env`.

### 3. Build & Jalankan Container
```bash
docker compose up -d --build
```

### 4. Periksa Status & Health Check
```bash
docker compose ps
docker compose logs -f
curl http://localhost:5000/health
```

---

## 🛠️ Panduan Menjalankan Secara Lokal / Manual (Tanpa Docker)
```bash
npm install
npm run build
npm start
```
