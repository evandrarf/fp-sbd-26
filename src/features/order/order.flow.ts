import { Prisma, OrderStatus } from "@prisma/client";

import { buyerChatFlow } from "../chat/chat.flow";
import { execute, getLastInsertId, queryFirst, queryMany, toBoolean, toDate, toNumber } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type CheckoutListingRow = {
  id: number;
  sellerId: number;
  productId: number;
  price: number | string | bigint;
  stock: number;
  status: string;
  productName: string;
  productCategory: string;
  sellerName: string;
};

type AddressRow = {
  id: number;
  userId: number;
  label: string;
  recipientName: string;
  phoneNumber: string;
  fullAddress: string;
  city: string;
  isPrimary: boolean | number;
};

type OrderInsertResult = {
  id: number;
};

type OrderHistoryRow = {
  orderId: number;
  createdAt: Date | string;
  status: OrderStatus;
  totalAmount: number | string | bigint;
  fullAddress: string;
  orderItemId: number | null;
  quantity: number | null;
  unitPrice: number | string | bigint | null;
  productName: string | null;
};

function formatRupiah(amount: number | string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
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
        "[3] Chat dengan Kurir",
        "[4] Kembali ke Dashboard",
      ], { title: "MENU TRANSAKSI PEMBELI", tone: "cyan" }),
    ]);

    const choice = (await prompt(color("Pilih menu transaksi: ", "bold"))).trim();

    if (choice === "1") {
      await handleCheckout(user);
    } else if (choice === "2") {
      await handleOrderHistory(user);
    } else if (choice === "3") {
      await buyerChatFlow(user);
    } else if (choice === "4") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan tidak valid.", "red")]);
      await pause();
    }
  }
}

async function handleCheckout(user: SessionUser) {
  const listings = await withDatabaseGuard(() =>
    queryMany<CheckoutListingRow>(
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
          p.category AS productCategory,
          u.name AS sellerName
        FROM \`Listing\` l
        INNER JOIN \`Product\` p ON p.id = l.productId
        INNER JOIN \`User\` u ON u.id = l.sellerId
        WHERE l.status = ${"ACTIVE"} AND l.stock > 0
        ORDER BY l.updatedAt DESC, l.id DESC
      `,
    ),
  );

  if (listings === DB_FAILURE || listings.length === 0) {
    printScreen([hero(), statusBox("Tidak ada listing aktif yang tersedia saat ini.", "yellow")]);
    await pause();
    return;
  }

  const listingLines = listings.map((listing) =>
    `[ID: ${listing.id}] ${color(listing.productName, "bold")} - Penjual: ${listing.sellerName}\n` +
    `      Harga: ${color(formatRupiah(String(listing.price)), "green")} | Stok: ${listing.stock} | Kategori: ${listing.productCategory}`,
  );

  printScreen([
    hero(),
    box([
      color("Pilih barang titipan yang ingin Anda beli:", "bold"),
      divider("Daftar Jastip Aktif"),
      ...listingLines,
      "",
      color("[0] Batal", "muted"),
    ], { title: "FORM CHECKOUT", tone: "pink" }),
  ]);

  const listingIdRaw = await promptRequired(color("Masukkan ID Listing yang ingin dibeli: ", "bold"), "ID Listing wajib diisi.");
  if (listingIdRaw === "0") return;

  const selectedListing = listings.find((listing) => listing.id === Number(listingIdRaw));
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

  const addresses = await withDatabaseGuard(async () => {
    const rows = await queryMany<AddressRow>(
      prisma,
      Prisma.sql`
        SELECT id, userId, label, recipientName, phoneNumber, fullAddress, city, isPrimary
        FROM \`Address\`
        WHERE userId = ${user.id}
        ORDER BY isPrimary DESC, createdAt DESC
      `,
    );

    return rows.map((row) => ({
      ...row,
      isPrimary: toBoolean(row.isPrimary),
    }));
  });

  if (addresses === DB_FAILURE || addresses.length === 0) {
    printScreen([
      hero(),
      statusBox("Anda belum menyimpan alamat pengiriman. Silakan tambahkan alamat terlebih dahulu melalui database.", "yellow"),
    ]);
    await pause();
    return;
  }

  const addressLines = addresses.map((address) =>
    `[ID: ${address.id}] ${color(address.label, "bold")} (${address.recipientName}) - ${address.fullAddress}, ${address.city} ${address.isPrimary ? color("[Utama]", "green") : ""}`,
  );

  printScreen([
    hero(),
    box([
      color("Pilih alamat pengiriman Anda:", "bold"),
      divider("Alamat Saya"),
      ...addressLines,
    ], { title: "PILIH ALAMAT", tone: "pink" }),
  ]);

  const addressIdRaw = await promptRequired(color("Masukkan ID Alamat pengiriman: ", "bold"), "ID Alamat wajib diisi.");
  const selectedAddress = addresses.find((address) => address.id === Number(addressIdRaw));

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
      `Produk   : ${selectedListing.productName}`,
      `Jumlah   : ${quantity} pcs`,
      `Harga    : ${formatRupiah(unitPrice)} / pcs`,
      `Subtotal : ${color(formatRupiah(subtotal), "green")}`,
      `Alamat   : ${selectedAddress.fullAddress}, ${selectedAddress.city}`,
      `Catatan  : ${notes || "-"}`,
      divider(),
      color("Ketik 'Y' untuk mengonfirmasi pembelian dan membuat pesanan.", "yellow"),
    ], { title: "RINGKASAN CHECKOUT", tone: "yellow" }),
  ]);

  const confirm = (await prompt(color("Konfirmasi (Y/N): ", "bold"))).trim().toUpperCase();
  if (confirm !== "Y") {
    printScreen([hero(), statusBox("Pembelian dibatalkan.", "yellow")]);
    await pause();
    return;
  }

  const result = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      const freshListing = await queryFirst<{ stock: number | string | bigint }>(
        tx,
        Prisma.sql`
          SELECT stock
          FROM \`Listing\`
          WHERE id = ${selectedListing.id}
          FOR UPDATE
        `,
      );

      if (!freshListing || toNumber(freshListing.stock) < quantity) {
        return "OUT_OF_STOCK" as const;
      }

      await execute(
        tx,
        Prisma.sql`
          UPDATE \`Listing\`
          SET stock = stock - ${quantity}, updatedAt = CURRENT_TIMESTAMP(3)
          WHERE id = ${selectedListing.id}
        `,
      );

      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`Order\` (buyerId, shippingAddressId, status, notes, totalAmount, updatedAt)
          VALUES (${user.id}, ${selectedAddress.id}, ${OrderStatus.PENDING}, ${notes || null}, ${totalAmount}, CURRENT_TIMESTAMP(3))
        `,
      );

      const orderId = await getLastInsertId(tx);

      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`OrderItem\` (orderId, listingId, quantity, unitPrice, subtotal)
          VALUES (${orderId}, ${selectedListing.id}, ${quantity}, ${unitPrice}, ${subtotal})
        `,
      );

      return { id: orderId } satisfies OrderInsertResult;
    });
  });

  if (result === DB_FAILURE) return;

  if (result === "OUT_OF_STOCK") {
    printScreen([hero(), statusBox("Gagal memproses transaksi. Stok mendadak habis atau berubah.", "red")]);
  } else {
    printScreen([
      hero(),
      box([
        color("Transaksi Berhasil Dibuat! 🎉", "green"),
        "",
        `ID Pesanan   : ${result.id}`,
        `Total Bayar  : ${formatRupiah(totalAmount)}`,
        `Status       : ${color("PENDING (Menunggu Pembayaran)", "yellow")}`,
        "",
        "Pesanan Anda telah dicatat ke database dan menunggu kurir/penjual.",
      ], { title: "SUKSES", tone: "green" }),
    ]);
  }
  await pause();
}

async function handleOrderHistory(user: SessionUser) {
  const orders = await withDatabaseGuard(async () => {
    const rows = await queryMany<OrderHistoryRow>(
      prisma,
      Prisma.sql`
        SELECT
          o.id AS orderId,
          o.createdAt,
          o.status,
          o.totalAmount,
          a.fullAddress,
          oi.id AS orderItemId,
          oi.quantity,
          oi.unitPrice,
          p.name AS productName
        FROM \`Order\` o
        INNER JOIN \`Address\` a ON a.id = o.shippingAddressId
        LEFT JOIN \`OrderItem\` oi ON oi.orderId = o.id
        LEFT JOIN \`Listing\` l ON l.id = oi.listingId
        LEFT JOIN \`Product\` p ON p.id = l.productId
        WHERE o.buyerId = ${user.id}
        ORDER BY o.createdAt DESC, oi.id ASC
      `,
    );

    const grouped = new Map<number, {
      id: number;
      createdAt: Date;
      status: OrderStatus;
      totalAmount: number | string | bigint;
      shippingAddress: { fullAddress: string };
      items: Array<{ quantity: number; unitPrice: number | string | bigint; listing: { product: { name: string } } }>;
    }>();

    for (const row of rows) {
      const existing = grouped.get(row.orderId) ?? {
        id: row.orderId,
        createdAt: toDate(row.createdAt),
        status: row.status,
        totalAmount: row.totalAmount,
        shippingAddress: { fullAddress: row.fullAddress },
        items: [],
      };

      if (row.orderItemId !== null && row.quantity !== null && row.unitPrice !== null && row.productName) {
        existing.items.push({
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          listing: {
            product: {
              name: row.productName,
            },
          },
        });
      }

      grouped.set(row.orderId, existing);
    }

    return [...grouped.values()];
  });

  if (orders === DB_FAILURE || orders.length === 0) {
    printScreen([hero(), statusBox("Anda belum memiliki riwayat pesanan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((order) => [
    `ID: ${order.id} | Tgl: ${order.createdAt.toLocaleDateString("id-ID")} | Status: ${color(order.status, "yellow")} | Total: ${color(formatRupiah(String(order.totalAmount)), "green")}`,
    ...order.items.map((item) => `  - ${item.listing.product.name} (${item.quantity} pcs x ${formatRupiah(String(item.unitPrice))})`),
    `  Alamat: ${order.shippingAddress.fullAddress}`,
    color("─".repeat(50), "muted"),
  ]);

  printScreen([
    hero(),
    box([
      ...orderLines,
    ], { title: "RIWAYAT PESANAN SAYA", tone: "blue" }),
  ]);
  await pause();
}
