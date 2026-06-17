import { Prisma, ListingStatus } from "@prisma/client";

import { execute, getLastInsertId, queryFirst, queryMany, toNumber } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type ProductOptionRow = {
  id: number;
  name: string;
  category: string;
};

type ListingRow = {
  id: number;
  sellerId: number;
  productId: number;
  price: number | string | bigint;
  stock: number;
  status: ListingStatus;
  productName: string;
  productCategory: string;
};

function formatRupiah(amount: number | string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export async function listingFlow(user: SessionUser) {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box([
        "[1] Lihat Daftar Listing Toko Saya",
        "[2] Tambah Listing Baru (Buka Jastip)",
        "[3] Tambah / Update Stok Listing",
        "[4] Kembali ke Dashboard",
      ], { title: "MANAJEMEN LISTING PENJUAL", tone: "pink" }),
    ]);

    const choice = (await prompt(color("Pilih menu listing: ", "bold"))).trim();

    if (choice === "1") {
      await listSellerListings(user);
    } else if (choice === "2") {
      await createListing(user);
    } else if (choice === "3") {
      await updateListingStock(user);
    } else if (choice === "4") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
      await pause();
    }
  }
}

async function listSellerListings(user: SessionUser) {
  const listings = await withDatabaseGuard(() =>
    queryMany<ListingRow>(
      prisma,
      Prisma.sql`
        SELECT
          l.id,
          l.sellerId,
          l.productId,
          l.price,
          l.stock,
          l.status,
          p.name AS productName,
          p.category AS productCategory
        FROM \`Listing\` l
        INNER JOIN \`Product\` p ON p.id = l.productId
        WHERE l.sellerId = ${user.id}
        ORDER BY l.updatedAt DESC
      `,
    ),
  );

  if (listings === DB_FAILURE) return;

  const lines = listings.length
    ? listings.map((listing) =>
        `[ID Listing: ${listing.id}] ${color(listing.productName, "bold")} (${listing.productCategory})\n` +
        `      Harga: ${color(formatRupiah(String(listing.price)), "green")} | Stok: ${listing.stock} | Status: ${listing.status}`,
      )
    : [color("Anda belum membuka listing jastip apa pun.", "yellow")];

  printScreen([
    hero(),
    box([
      color("Daftar jastip yang Anda jual saat ini:", "bold"),
      divider("Listing Saya"),
      ...lines,
    ], { title: "LISTING TOKO", tone: "pink" }),
  ]);
  await pause();
}

async function createListing(user: SessionUser) {
  const products = await withDatabaseGuard(() =>
    queryMany<ProductOptionRow>(
      prisma,
      Prisma.sql`
        SELECT id, name, category
        FROM \`Product\`
        WHERE status = ${"ACTIVE"}
        ORDER BY name ASC, id ASC
      `,
    ),
  );

  if (products === DB_FAILURE || products.length === 0) {
    printScreen([hero(), statusBox("Tidak ada produk aktif di katalog global untuk didaftarkan.", "yellow")]);
    await pause();
    return;
  }

  const productLines = products.map((product) => `[ID Produk: ${product.id}] ${product.name} (${product.category})`);

  printScreen([
    hero(),
    box([
      color("Pilih produk global yang ingin Anda titipkan/jual:", "bold"),
      divider("Katalog Produk"),
      ...productLines,
    ], { title: "BUKA JASTIP BARU", tone: "green" }),
  ]);

  const productIdRaw = await promptRequired(color("Masukkan ID Produk: ", "bold"), "ID Produk wajib diisi.");
  const selectedProduct = products.find((product) => product.id === Number(productIdRaw));

  if (!selectedProduct) {
    printScreen([hero(), statusBox("ID Produk tidak valid.", "red")]);
    await pause();
    return;
  }

  const priceRaw = await promptRequired(color("Harga Jastip (Rupiah): ", "bold"), "Harga wajib diisi.");
  const stockRaw = await promptRequired(color("Stok Awal: ", "bold"), "Stok awal wajib diisi.");

  const price = Number(priceRaw);
  const stock = Number(stockRaw);

  if (isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    printScreen([hero(), statusBox("Input harga atau stok tidak valid.", "red")]);
    await pause();
    return;
  }

  const newListing = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`Listing\` (sellerId, productId, price, stock, status, updatedAt)
          VALUES (${user.id}, ${selectedProduct.id}, ${price}, ${stock}, ${ListingStatus.ACTIVE}, CURRENT_TIMESTAMP(3))
        `,
      );

      const insertedId = await getLastInsertId(tx);

      return queryFirst<ListingRow>(
        tx,
        Prisma.sql`
          SELECT
            l.id,
            l.sellerId,
            l.productId,
            l.price,
            l.stock,
            l.status,
            p.name AS productName,
            p.category AS productCategory
          FROM \`Listing\` l
          INNER JOIN \`Product\` p ON p.id = l.productId
          WHERE l.id = ${insertedId}
          LIMIT 1
        `,
      );
    });
  });

  if (newListing === DB_FAILURE) return;

  if (!newListing) {
    printScreen([hero(), statusBox("Listing baru gagal dibuat.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box([
      color("Listing Jastip Berhasil Dibuka!", "green"),
      "",
      `ID Listing : ${newListing.id}`,
      `Produk     : ${newListing.productName}`,
      `Harga      : ${formatRupiah(price)}`,
      `Stok       : ${stock} pcs`,
    ], { title: "SUKSES", tone: "green" }),
  ]);
  await pause();
}

async function updateListingStock(user: SessionUser) {
  printScreen([
    hero(),
    box([
      color("Masukkan ID Listing Anda yang ingin diperbarui stoknya.", "bold"),
    ], { title: "UPDATE STOK LISTING", tone: "yellow" }),
  ]);

  const listingIdRaw = await promptRequired(color("Masukkan ID Listing Anda: ", "bold"), "ID Listing wajib diisi.");
  const listingId = Number(listingIdRaw);

  const existing = await withDatabaseGuard(() =>
    queryFirst<ListingRow>(
      prisma,
      Prisma.sql`
        SELECT
          l.id,
          l.sellerId,
          l.productId,
          l.price,
          l.stock,
          l.status,
          p.name AS productName,
          p.category AS productCategory
        FROM \`Listing\` l
        INNER JOIN \`Product\` p ON p.id = l.productId
        WHERE l.id = ${listingId} AND l.sellerId = ${user.id}
        LIMIT 1
      `,
    ),
  );

  if (existing === DB_FAILURE) return;

  if (!existing) {
    printScreen([hero(), statusBox("Listing tidak ditemukan atau bukan milik Anda.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box([
      `Produk       : ${existing.productName}`,
      `Stok Saat Ini: ${existing.stock} pcs`,
      divider("Input Stok Baru"),
      "Masukkan jumlah total stok baru yang tersedia saat ini.",
    ], { title: "UBAH DATA STOK", tone: "yellow" }),
  ]);

  const newStockRaw = await promptRequired(color("Masukkan Total Stok Baru: ", "bold"), "Stok wajib diisi.");
  const newStock = Number(newStockRaw);

  if (isNaN(newStock) || newStock < 0) {
    printScreen([hero(), statusBox("Jumlah stok tidak valid.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(async () => {
    await execute(
      prisma,
      Prisma.sql`
        UPDATE \`Listing\`
        SET stock = ${newStock}, updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ${listingId}
      `,
    );

    return queryFirst<ListingRow>(
      prisma,
      Prisma.sql`
        SELECT
          l.id,
          l.sellerId,
          l.productId,
          l.price,
          l.stock,
          l.status,
          p.name AS productName,
          p.category AS productCategory
        FROM \`Listing\` l
        INNER JOIN \`Product\` p ON p.id = l.productId
        WHERE l.id = ${listingId}
        LIMIT 1
      `,
    );
  });

  if (updated === DB_FAILURE) return;

  if (!updated) {
    printScreen([hero(), statusBox("Stok listing gagal diperbarui.", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box([
      color("Stok Listing Berhasil Diperbarui!", "green"),
      "",
      `ID Listing : ${updated.id}`,
      `Produk     : ${updated.productName}`,
      `Stok Baru  : ${updated.stock} pcs`,
    ], { title: "SUKSES DIPERBARUI", tone: "green" }),
  ]);
  await pause();
}
