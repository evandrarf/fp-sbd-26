import { ListingStatus } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

function formatRupiah(amount: number | string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
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
        "[4] Kembali ke Dashboard"
      ], { title: "MANAJEMEN LISTING PENJUAL", tone: "pink" })
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
    prisma.listing.findMany({
      where: { sellerId: user.id },
      include: { product: true },
      orderBy: { updatedAt: "desc" }
    })
  );

  if (listings === DB_FAILURE) return;

  const lines = listings.length
    ? listings.map((l) =>
        `[ID Listing: ${l.id}] ${color(l.product.name, "bold")} (${l.product.category})\n` +
        `      Harga: ${color(formatRupiah(l.price.toString()), "green")} | Stok: ${l.stock} | Status: ${l.status}`
      )
    : [color("Anda belum membuka listing jastip apa pun.", "yellow")];

  printScreen([
    hero(),
    box([
      color("Daftar jastip yang Anda jual saat ini:", "bold"),
      divider("Listing Saya"),
      ...lines
    ], { title: "LISTING TOKO", tone: "pink" })
  ]);
  await pause();
}

async function createListing(user: SessionUser) {
  const products = await withDatabaseGuard(() =>
    prisma.product.findMany({ where: { status: "ACTIVE" } })
  );

  if (products === DB_FAILURE || products.length === 0) {
    printScreen([hero(), statusBox("Tidak ada produk aktif di katalog global untuk didaftarkan.", "yellow")]);
    await pause();
    return;
  }

  const productLines = products.map((p) => `[ID Produk: ${p.id}] ${p.name} (${p.category})`);

  printScreen([
    hero(),
    box([
      color("Pilih produk global yang ingin Anda titipkan/jual:", "bold"),
      divider("Katalog Produk"),
      ...productLines
    ], { title: "BUKA JASTIP BARU", tone: "green" })
  ]);

  const productIdRaw = await promptRequired(color("Masukkan ID Produk: ", "bold"), "ID Produk wajib diisi.");
  const selectedProduct = products.find((p) => p.id === Number(productIdRaw));

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

  const newListing = await withDatabaseGuard(() =>
    prisma.listing.create({
      data: {
        sellerId: user.id,
        productId: selectedProduct.id,
        price: price,
        stock: stock,
        status: ListingStatus.ACTIVE
      },
      include: { product: true }
    })
  );

  if (newListing === DB_FAILURE) return;

  printScreen([
    hero(),
    box([
      color("Listing Jastip Berhasil Dibuka!", "green"),
      "",
      `ID Listing : ${newListing.id}`,
      `Produk     : ${newListing.product.name}`,
      `Harga      : ${formatRupiah(price)}`,
      `Stok       : ${stock} pcs`
    ], { title: "SUKSES", tone: "green" })
  ]);
  await pause();
}

async function updateListingStock(user: SessionUser) {
  printScreen([
    hero(),
    box([
      color("Masukkan ID Listing Anda yang ingin diperbarui stoknya.", "bold")
    ], { title: "UPDATE STOK LISTING", tone: "yellow" })
  ]);

  const listingIdRaw = await promptRequired(color("Masukkan ID Listing Anda: ", "bold"), "ID Listing wajib diisi.");
  const listingId = Number(listingIdRaw);

  const existing = await withDatabaseGuard(() =>
    prisma.listing.findFirst({
      where: { id: listingId, sellerId: user.id },
      include: { product: true }
    })
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
      `Produk       : ${existing.product.name}`,
      `Stok Saat Ini: ${existing.stock} pcs`,
      divider("Input Stok Baru"),
      "Masukkan jumlah total stok baru yang tersedia saat ini."
    ], { title: "UBAH DATA STOK", tone: "yellow" })
  ]);

  const newStockRaw = await promptRequired(color("Masukkan Total Stok Baru: ", "bold"), "Stok wajib diisi.");
  const newStock = Number(newStockRaw);

  if (isNaN(newStock) || newStock < 0) {
    printScreen([hero(), statusBox("Jumlah stok tidak valid.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(() =>
    prisma.listing.update({
      where: { id: listingId },
      data: { stock: newStock },
      include: { product: true }
    })
  );

  if (updated === DB_FAILURE) return;

  printScreen([
    hero(),
    box([
      color("Stok Listing Berhasil Diperbarui!", "green"),
      "",
      `ID Listing : ${updated.id}`,
      `Produk     : ${updated.product.name}`,
      `Stok Baru  : ${updated.stock} pcs`
    ], { title: "SUKSES DIPERBARUI", tone: "green" })
  ]);
  await pause();
}