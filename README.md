# JASTIP FEMBOY CLI

CLI sederhana berbasis Bun untuk aplikasi jastip dengan schema database MySQL menggunakan Prisma.

## Setup

Install dependency:

```bash
bun install
```

Buat file `.env` dari nilai berikut atau sesuaikan dengan MySQL lokal:

```env
DATABASE_URL="mysql://root:password@localhost:3306/jastip_femboy"
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

- `index.ts`: UI terminal awal dengan opsi `Register`, `Login`, dan `Quit`
- `prisma/schema.prisma`: schema database MySQL
- `prisma.config.ts`: konfigurasi Prisma 7 untuk schema, migrations, dan `DATABASE_URL`
- `prisma/migrations`: migration SQL awal dari schema Prisma
- `schema.mermaid`: ERD Mermaid
