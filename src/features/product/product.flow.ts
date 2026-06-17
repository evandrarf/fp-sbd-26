import { Prisma, ProductStatus } from "@prisma/client";

import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { execute, getLastInsertId, queryFirst, queryMany, toDate, toNumber } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, statusBox } from "../../shared/terminal/ui";

type ProductListItem = {
  id: number;
  name: string;
  category: string;
  status: ProductStatus;
  _count: {
    listings: number;
  };
};

type ProductListRow = {
  id: number;
  name: string;
  category: string;
  status: ProductStatus;
  listingsCount: number | string | bigint;
};

type ProductDetailRow = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  status: ProductStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  listingsCount: number | string | bigint;
};

type ProductMutationRow = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  status: ProductStatus;
};

type ProductDeleteRow = {
  id: number;
  name: string;
  category: string;
  listingsCount: number | string | bigint;
};

function mapProductListItem(row: ProductListRow): ProductListItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: row.status,
    _count: {
      listings: toNumber(row.listingsCount),
    },
  };
}

function formatStatus(status: ProductStatus) {
  return status === "ACTIVE" ? color("ACTIVE", "green") : color("INACTIVE", "yellow");
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function productSummaryLine(product: ProductListItem) {
  return [
    color(`#${product.id}`, "cyan"),
    color(product.name, "bold"),
    color(`(${product.category})`, "muted"),
    formatStatus(product.status),
    color(`${product._count.listings} listing`, "muted"),
  ].join(" ");
}

async function promptProductId(label = "ID produk: ") {
  const raw = (await promptRequired(color(label, "bold"), "ID produk wajib diisi.")).trim();
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    printScreen([hero(), statusBox("ID produk harus berupa angka positif.", "red")]);
    await pause();
    return null;
  }

  return id;
}

async function chooseStatus(currentStatus?: ProductStatus) {
  while (true) {
    const suffix = currentStatus ? ` [${currentStatus}]` : "";
    const answer = (await prompt(color(`Status produk${suffix} (1=ACTIVE, 2=INACTIVE): `, "bold"))).trim();

    if (!answer && currentStatus) {
      return currentStatus;
    }

    if (answer === "1") {
      return ProductStatus.ACTIVE;
    }

    if (answer === "2") {
      return ProductStatus.INACTIVE;
    }

    printScreen([hero(), statusBox("Pilihan status tidak valid.", "red")]);
    await pause();
  }
}

async function listProducts() {
  const products = await withDatabaseGuard(async () => {
    const rows = await queryMany<ProductListRow>(
      prisma,
      Prisma.sql`
        SELECT
          p.id,
          p.name,
          p.category,
          p.status,
          COUNT(l.id) AS listingsCount
        FROM \`Product\` p
        LEFT JOIN \`Listing\` l ON l.productId = p.id
        GROUP BY p.id, p.name, p.category, p.status, p.updatedAt
        ORDER BY p.updatedAt DESC, p.id DESC
        LIMIT 30
      `,
    );

    return rows.map(mapProductListItem);
  });

  if (products === DB_FAILURE) {
    return;
  }

  printScreen([
    hero(),
    box(
      products.length
        ? [
            color("Menampilkan maksimal 30 produk terbaru.", "muted"),
            divider("Produk"),
            ...products.map(productSummaryLine),
          ]
        : [color("Belum ada produk di katalog.", "yellow")],
      { title: "DAFTAR PRODUK", tone: "cyan" },
    ),
  ]);
  await pause();
}

async function showProductDetail() {
  const id = await promptProductId();
  if (!id) {
    return;
  }

  const product = await withDatabaseGuard(async () => {
    const row = await queryFirst<ProductDetailRow>(
      prisma,
      Prisma.sql`
        SELECT
          p.id,
          p.name,
          p.description,
          p.category,
          p.imageUrl,
          p.status,
          p.createdAt,
          p.updatedAt,
          COUNT(l.id) AS listingsCount
        FROM \`Product\` p
        LEFT JOIN \`Listing\` l ON l.productId = p.id
        WHERE p.id = ${id}
        GROUP BY p.id, p.name, p.description, p.category, p.imageUrl, p.status, p.createdAt, p.updatedAt
        LIMIT 1
      `,
    );

    if (!row) {
      return null;
    }

    return {
      ...row,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
      _count: {
        listings: toNumber(row.listingsCount),
      },
    };
  });

  if (product === DB_FAILURE) {
    return;
  }

  if (!product) {
    printScreen([hero(), statusBox("Produk tidak ditemukan.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        `ID          : ${product.id}`,
        `Nama        : ${product.name}`,
        `Kategori    : ${product.category}`,
        `Status      : ${formatStatus(product.status)}`,
        `Listing     : ${product._count.listings}`,
        `Gambar      : ${product.imageUrl ?? "-"}`,
        divider("Deskripsi"),
        product.description ?? "-",
        divider("Timestamp"),
        `Dibuat      : ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(product.createdAt)}`,
        `Diperbarui  : ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(product.updatedAt)}`,
      ],
      { title: "DETAIL PRODUK", tone: "blue" },
    ),
  ]);
  await pause();
}

async function createProduct() {
  printScreen([
    hero(),
    box(
      [
        color("Tambah produk baru ke katalog.", "bold"),
        divider("Data produk"),
        "Nama dan kategori wajib diisi. Deskripsi dan URL gambar boleh kosong.",
      ],
      { title: "TAMBAH PRODUK", tone: "green" },
    ),
  ]);

  const name = await promptRequired(color("Nama produk: ", "bold"), "Nama produk wajib diisi.");
  const category = await promptRequired(color("Kategori: ", "bold"), "Kategori wajib diisi.");
  const description = emptyToNull(await prompt(color("Deskripsi: ", "bold")));
  const imageUrl = emptyToNull(await prompt(color("URL gambar: ", "bold")));
  const status = await chooseStatus(ProductStatus.ACTIVE);

  const product = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`Product\` (name, description, category, imageUrl, status, updatedAt)
          VALUES (${name}, ${description}, ${category}, ${imageUrl}, ${status}, CURRENT_TIMESTAMP(3))
        `,
      );

      const insertedId = await getLastInsertId(tx);

      return queryFirst<ProductMutationRow>(
        tx,
        Prisma.sql`
          SELECT id, name, description, category, imageUrl, status
          FROM \`Product\`
          WHERE id = ${insertedId}
          LIMIT 1
        `,
      );
    });
  });

  if (product === DB_FAILURE) {
    return;
  }

  if (!product) {
    printScreen([hero(), statusBox("Produk gagal ditambahkan.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        color("Produk berhasil ditambahkan.", "green"),
        "",
        `ID       : ${product.id}`,
        `Nama     : ${product.name}`,
        `Kategori : ${product.category}`,
        `Status   : ${formatStatus(product.status)}`,
      ],
      { title: "PRODUK TERSIMPAN", tone: "green" },
    ),
  ]);
  await pause();
}

async function updateProduct() {
  const id = await promptProductId();
  if (!id) {
    return;
  }

  const existing = await withDatabaseGuard(() =>
    queryFirst<ProductMutationRow>(
      prisma,
      Prisma.sql`
        SELECT id, name, description, category, imageUrl, status
        FROM \`Product\`
        WHERE id = ${id}
        LIMIT 1
      `,
    ),
  );

  if (existing === DB_FAILURE) {
    return;
  }

  if (!existing) {
    printScreen([hero(), statusBox("Produk tidak ditemukan.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        color("Kosongkan input untuk mempertahankan nilai lama.", "bold"),
        divider("Produk saat ini"),
        `Nama      : ${existing.name}`,
        `Kategori  : ${existing.category}`,
        `Status    : ${formatStatus(existing.status)}`,
      ],
      { title: "UBAH PRODUK", tone: "yellow" },
    ),
  ]);

  const name = (await prompt(color(`Nama produk [${existing.name}]: `, "bold"))).trim() || existing.name;
  const category = (await prompt(color(`Kategori [${existing.category}]: `, "bold"))).trim() || existing.category;
  const descriptionAnswer = await prompt(color(`Deskripsi [${existing.description ?? "-"}]: `, "bold"));
  const imageUrlAnswer = await prompt(color(`URL gambar [${existing.imageUrl ?? "-"}]: `, "bold"));
  const status = await chooseStatus(existing.status);

  const product = await withDatabaseGuard(async () => {
    await execute(
      prisma,
      Prisma.sql`
        UPDATE \`Product\`
        SET
          name = ${name},
          category = ${category},
          description = ${descriptionAnswer.trim() ? descriptionAnswer.trim() : existing.description},
          imageUrl = ${imageUrlAnswer.trim() ? imageUrlAnswer.trim() : existing.imageUrl},
          status = ${status},
          updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ${id}
      `,
    );

    return queryFirst<ProductMutationRow>(
      prisma,
      Prisma.sql`
        SELECT id, name, description, category, imageUrl, status
        FROM \`Product\`
        WHERE id = ${id}
        LIMIT 1
      `,
    );
  });

  if (product === DB_FAILURE) {
    return;
  }

  if (!product) {
    printScreen([hero(), statusBox("Produk gagal diperbarui.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        color("Produk berhasil diperbarui.", "green"),
        "",
        `ID       : ${product.id}`,
        `Nama     : ${product.name}`,
        `Kategori : ${product.category}`,
        `Status   : ${formatStatus(product.status)}`,
      ],
      { title: "PRODUK DIPERBARUI", tone: "green" },
    ),
  ]);
  await pause();
}

async function deleteProduct() {
  const id = await promptProductId();
  if (!id) {
    return;
  }

  const product = await withDatabaseGuard(async () => {
    const row = await queryFirst<ProductDeleteRow>(
      prisma,
      Prisma.sql`
        SELECT
          p.id,
          p.name,
          p.category,
          COUNT(l.id) AS listingsCount
        FROM \`Product\` p
        LEFT JOIN \`Listing\` l ON l.productId = p.id
        WHERE p.id = ${id}
        GROUP BY p.id, p.name, p.category
        LIMIT 1
      `,
    );

    if (!row) {
      return null;
    }

    return {
      ...row,
      _count: {
        listings: toNumber(row.listingsCount),
      },
    };
  });

  if (product === DB_FAILURE) {
    return;
  }

  if (!product) {
    printScreen([hero(), statusBox("Produk tidak ditemukan.", "red")]);
    await pause();
    return;
  }

  if (product._count.listings > 0) {
    printScreen([
      hero(),
      statusBox("Produk masih dipakai oleh listing. Nonaktifkan produk atau hapus listing terkait terlebih dahulu.", "yellow"),
    ]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        color("Konfirmasi hapus produk permanen.", "red"),
        divider("Produk"),
        `ID       : ${product.id}`,
        `Nama     : ${product.name}`,
        `Kategori : ${product.category}`,
      ],
      { title: "HAPUS PRODUK", tone: "red" },
    ),
  ]);

  const confirmation = (await prompt(color("Ketik HAPUS untuk konfirmasi: ", "bold"))).trim();
  if (confirmation !== "HAPUS") {
    printScreen([hero(), statusBox("Hapus produk dibatalkan.", "yellow")]);
    await pause();
    return;
  }

  const deleted = await withDatabaseGuard(() =>
    execute(
      prisma,
      Prisma.sql`
        DELETE FROM \`Product\`
        WHERE id = ${id}
      `,
    ),
  );

  if (deleted === DB_FAILURE) {
    return;
  }

  printScreen([hero(), statusBox("Produk berhasil dihapus.", "green")]);
  await pause();
}

export async function productFlow() {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box(
        [
          menuOption("1", "Lihat daftar produk", "Tampilkan produk katalog terbaru.", "cyan"),
          menuOption("2", "Lihat detail produk", "Cari produk berdasarkan ID.", "blue"),
          menuOption("3", "Tambah produk", "Buat produk katalog baru.", "green"),
          menuOption("4", "Ubah produk", "Edit nama, kategori, deskripsi, gambar, atau status.", "yellow"),
          menuOption("5", "Hapus produk", "Hapus produk yang belum dipakai listing.", "red"),
          menuOption("6", "Kembali", "Kembali ke dashboard.", "muted"),
        ],
        { title: "CRUD PRODUK", tone: "cyan" },
      ),
    ]);

    const choice = (await prompt(color("Pilih menu produk: ", "bold"))).trim();

    switch (choice) {
      case "1":
        await listProducts();
        break;
      case "2":
        await showProductDetail();
        break;
      case "3":
        await createProduct();
        break;
      case "4":
        await updateProduct();
        break;
      case "5":
        await deleteProduct();
        break;
      case "6":
        active = false;
        break;
      default:
        printScreen([hero(), statusBox("Pilihan menu produk tidak valid.", "red")]);
        await pause();
        break;
    }
  }
}
