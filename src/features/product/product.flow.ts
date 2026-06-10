import { ProductStatus } from "@prisma/client";

import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
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
  const products = await withDatabaseGuard(() =>
    prisma.product.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 30,
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
        _count: {
          select: {
            listings: true,
          },
        },
      },
    }),
  );

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

  const product = await withDatabaseGuard(() =>
    prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        imageUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            listings: true,
          },
        },
      },
    }),
  );

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

  const product = await withDatabaseGuard(() =>
    prisma.product.create({
      data: {
        name,
        category,
        description,
        imageUrl,
        status,
      },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
      },
    }),
  );

  if (product === DB_FAILURE) {
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
    prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        imageUrl: true,
        status: true,
      },
    }),
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

  const product = await withDatabaseGuard(() =>
    prisma.product.update({
      where: { id },
      data: {
        name,
        category,
        description: descriptionAnswer.trim() ? descriptionAnswer.trim() : existing.description,
        imageUrl: imageUrlAnswer.trim() ? imageUrlAnswer.trim() : existing.imageUrl,
        status,
      },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
      },
    }),
  );

  if (product === DB_FAILURE) {
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

  const product = await withDatabaseGuard(() =>
    prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        category: true,
        _count: {
          select: {
            listings: true,
          },
        },
      },
    }),
  );

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
    prisma.product.delete({
      where: { id },
      select: { id: true },
    }),
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
