import { OrderStatus } from "@prisma/client";
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

export async function orderFlow(user: SessionUser) {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box([
        "[1] Lihat Listing & Beli Barang Titipan",
        "[2] Lihat Riwayat Pesanan Saya",
        "[3] Kembali ke Dashboard"
      ], { title: "MENU TRANSAKSI PEMBELI", tone: "cyan" })
    ]);

    const choice = (await prompt(color("Pilih menu transaksi: ", "bold"))).trim();

    if (choice === "1") {
      await handleCheckout(user);
    } else if (choice === "2") {
      await handleOrderHistory(user);
    } else if (choice === "3") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan tidak valid.", "red")]);
      await pause();
    }
  }
}

async function handleCheckout(user: SessionUser) {
  const listings = await withDatabaseGuard(() =>
    prisma.listing.findMany({
      where: { status: "ACTIVE", stock: { gt: 0 } },
      include: { product: true, seller: true }
    })
  );

  if (listings === DB_FAILURE || listings.length === 0) {
    printScreen([hero(), statusBox("Tidak ada listing aktif yang tersedia saat ini.", "yellow")]);
    await pause();
    return;
  }

  const listingLines = listings.map((l) => 
    `[ID: ${l.id}] ${color(l.product.name, "bold")} - Penjual: ${l.seller.name}\n` +
    `      Harga: ${color(formatRupiah(l.price.toString()), "green")} | Stok: ${l.stock} | Kategori: ${l.product.category}`
  );

  printScreen([
    hero(),
    box([
      color("Pilih barang titipan yang ingin Anda beli:", "bold"),
      divider("Daftar Jastip Aktif"),
      ...listingLines,
      "",
      color("[0] Batal", "muted")
    ], { title: "FORM CHECKOUT", tone: "pink" })
  ]);

  const listingIdRaw = await promptRequired(color("Masukkan ID Listing yang ingin dibeli: ", "bold"), "ID Listing wajib diisi.");
  if (listingIdRaw === "0") return;

  const selectedListing = listings.find((l) => l.id === Number(listingIdRaw));
  if (!selectedListing) {
    printScreen([hero(), statusBox("ID Listing tidak ditemukan atau tidak aktif.", "red")]);
    await pause();
    return;
  }

  const qtyRaw = await promptRequired(color(`Jumlah yang ingin dibeli (Maks ${selectedListing.stock}): `, "bold"), "Jumlah wajib diisi.");
  const quantity = Number(qtyRaw);

  if (isNaN(quantity) || quantity <= 0 || quantity > selectedListing.stock) {
    printScreen([hero(), statusBox("Jumlah pembelian tidak valid atau melebihi stok.", "red")]);
    await pause();
    return;
  }

  const addresses = await withDatabaseGuard(() =>
    prisma.address.findMany({ where: { userId: user.id } })
  );

  if (addresses === DB_FAILURE || addresses.length === 0) {
    printScreen([
      hero(),
      statusBox("Anda belum menyimpan alamat pengiriman. Silakan tambahkan alamat terlebih dahulu melalui database.", "yellow")
    ]);
    await pause();
    return;
  }

  const addressLines = addresses.map((a) => 
    `[ID: ${a.id}] ${color(a.label, "bold")} (${a.recipientName}) - ${a.fullAddress}, ${a.city} ${a.isPrimary ? color("[Utama]", "green") : ""}`
  );

  printScreen([
    hero(),
    box([
      color("Pilih alamat pengiriman Anda:", "bold"),
      divider("Alamat Saya"),
      ...addressLines
    ], { title: "PILIH ALAMAT", tone: "pink" })
  ]);

  const addressIdRaw = await promptRequired(color("Masukkan ID Alamat pengiriman: ", "bold"), "ID Alamat wajib diisi.");
  const selectedAddress = addresses.find((a) => a.id === Number(addressIdRaw));

  if (!selectedAddress) {
    printScreen([hero(), statusBox("Alamat tidak valid.", "red")]);
    await pause();
    return;
  }

  const notes = await prompt(color("Catatan untuk penjual/kurir (opsional): ", "bold"));

  const unitPrice = Number(selectedListing.price);
  const subtotal = unitPrice * quantity;
  const totalAmount = subtotal;

  printScreen([
    hero(),
    box([
      color("KONFIRMASI PESANAN ANDA", "bold"),
      divider(),
      `Produk   : ${selectedListing.product.name}`,
      `Jumlah   : ${quantity} pcs`,
      `Harga    : ${formatRupiah(unitPrice)} / pcs`,
      `Subtotal : ${color(formatRupiah(subtotal), "green")}`,
      `Alamat   : ${selectedAddress.fullAddress}, ${selectedAddress.city}`,
      `Catatan  : ${notes || "-"}`,
      divider(),
      color("Ketik 'Y' untuk mengonfirmasi pembelian dan membuat pesanan.", "yellow")
    ], { title: "RINGKASAN CHECKOUT", tone: "yellow" })
  ]);

  const confirm = (await prompt(color("Konfirmasi (Y/N): ", "bold"))).trim().toUpperCase();
  if (confirm !== "Y") {
    printScreen([hero(), statusBox("Pembelian dibatalkan.", "yellow")]);
    await pause();
    return;
  }

  const result = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      const freshListing = await tx.listing.findUnique({
        where: { id: selectedListing.id },
        select: { stock: true }
      });

      if (!freshListing || freshListing.stock < quantity) {
        throw new Error("STOK_HABIS");
      }

      await tx.listing.update({
        where: { id: selectedListing.id },
        data: { stock: { decrement: quantity } }
      });

      const newOrder = await tx.order.create({
        data: {
          buyerId: user.id,
          shippingAddressId: selectedAddress.id,
          status: OrderStatus.PENDING,
          notes: notes || null,
          totalAmount: totalAmount,
          items: {
            create: {
              listingId: selectedListing.id,
              quantity: quantity,
              unitPrice: unitPrice,
              subtotal: subtotal
            }
          }
        }
      });

      return newOrder;
    });
  });

  if (result === DB_FAILURE) return;

  if ((result as any) instanceof Error || result === undefined) {
    printScreen([hero(), statusBox("Gagal memproses transaksi. Stok mendadak habis atau berubah.", "red")]);
  } else {
    printScreen([
      hero(),
      box([
        color("Transaksi Berhasil Dibuat! 🎉", "green"),
        "",
        `ID Pesanan   : ${(result as any).id}`,
        `Total Bayar  : ${formatRupiah(totalAmount)}`,
        `Status       : ${color("PENDING (Menunggu Pembayaran)", "yellow")}`,
        "",
        "Pesanan Anda telah dicatat ke database dan menunggu kurir/penjual.",
      ], { title: "SUKSES", tone: "green" })
    ]);
  }
  await pause();
}

async function handleOrderHistory(user: SessionUser) {
  const orders = await withDatabaseGuard(() =>
    prisma.order.findMany({
      where: { buyerId: user.id },
      include: {
        items: {
          include: { listing: { include: { product: true } } }
        },
        shippingAddress: true
      },
      orderBy: { createdAt: "desc" }
    })
  );

  if (orders === DB_FAILURE || orders.length === 0) {
    printScreen([hero(), statusBox("Anda belum memiliki riwayat pesanan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((o) => [
    `ID: ${o.id} | Tgl: ${o.createdAt.toLocaleDateString("id-ID")} | Status: ${color(o.status, "yellow")} | Total: ${color(formatRupiah(o.totalAmount.toString()), "green")}`,
    ...o.items.map((i) => `  - ${i.listing.product.name} (${i.quantity} pcs x ${formatRupiah(i.unitPrice.toString())})`),
    `  Alamat: ${o.shippingAddress.fullAddress}`,
    color("─".repeat(50), "muted")
  ]);

  printScreen([
    hero(),
    box([
      ...orderLines
    ], { title: "RIWAYAT PESANAN SAYA", tone: "blue" })
  ]);
  await pause();
}