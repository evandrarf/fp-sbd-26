# JASTIP FEMBOY CLI

CLI sederhana berbasis Bun untuk aplikasi jastip dengan schema database MySQL menggunakan Prisma.

## Setup

Install dependency:

```bash
bun install
```

Buat file `.env` dari nilai berikut atau sesuaikan dengan MySQL dan MongoDB lokal:

```env
DATABASE_URL="mysql://root:password@localhost:3306/jastip_femboy"
MONGODB_URI="mongodb://127.0.0.1:27017/jastip_femboy"
MONGODB_DB_NAME="jastip_femboy"
```

Generate Prisma Client:

```bash
bun run prisma:generate
```

Kalau MySQL lokal Anda sudah siap dan ingin apply migration ke database:

```bash
bun run prisma:migrate:dev
```

Jalankan aplikasi terminal:

```bash
bun run dev
```

## Struktur

- `src/index.ts`: orchestrator aplikasi terminal
- `src/features/auth`: alur register dan login
- `src/features/dashboard`: dashboard per role setelah login
- `src/features/home`: tampilan menu utama
- `src/shared/db`: Prisma client dan database guard
- `src/features/chat`: chat transaksi buyer-kurir dengan MongoDB dan polling idle
- `src/shared/terminal`: helper input dan rendering UI terminal
- `src/shared/auth` dan `src/shared/types`: role metadata dan shared types
- `prisma/schema.prisma`: schema database MySQL
- `prisma.config.ts`: konfigurasi Prisma 7 untuk schema, migrations, dan `DATABASE_URL`
- `prisma/migrations`: migration SQL awal dari schema Prisma
- `schema.mermaid`: ERD Mermaid
