import { Prisma, OrderStatus } from "@prisma/client";

import { courierChatFlow } from "../chat/chat.flow";
import { execute, queryMany, toDate } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type CourierOrderRow = {
  orderId: number;
  status: OrderStatus;
  totalAmount: number | string | bigint;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  recipientName: string;
  phoneNumber: string;
  fullAddress: string;
  city: string;
  province: string;
  orderItemId: number | null;
  quantity: number | null;
  productName: string | null;
};

type GroupedCourierOrder = {
  id: number;
  status: OrderStatus;
  totalAmount: number | string | bigint;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  shippingAddress: {
    recipientName: string;
    phoneNumber: string;
    fullAddress: string;
    city: string;
    province: string;
  };
  items: Array<{ quantity: number; listing: { product: { name: string } } }>;
};

function formatRupiah(amount: number | string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

function groupCourierOrders(rows: CourierOrderRow[]) {
  const grouped = new Map<number, GroupedCourierOrder>();

  for (const row of rows) {
    const existing = grouped.get(row.orderId) ?? {
      id: row.orderId,
      status: row.status,
      totalAmount: row.totalAmount,
      notes: row.notes,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
      shippingAddress: {
        recipientName: row.recipientName,
        phoneNumber: row.phoneNumber,
        fullAddress: row.fullAddress,
        city: row.city,
        province: row.province,
      },
      items: [],
    };

    if (row.orderItemId !== null && row.quantity !== null && row.productName) {
      existing.items.push({
        quantity: row.quantity,
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
}

export async function courierFlow(user: SessionUser) {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box([
        "[1] Lihat Antrean Pesanan Masuk (Ambil Tugas)",
        "[2] Lihat Tugas Pengantaran Aktif Saya",
        "[3] Chat dengan Pembeli",
        "[4] Riwayat Selesai Antar",
        "[5] Kembali ke Dashboard",
      ], { title: "MENU NAVIGASI KURIR", tone: "yellow" }),
    ]);

    const choice = (await prompt(color("Pilih menu kurir: ", "bold"))).trim();

    if (choice === "1") {
      await handleAvailableOrders(user);
    } else if (choice === "2") {
      await handleActiveTasks(user);
    } else if (choice === "3") {
      await courierChatFlow(user);
    } else if (choice === "4") {
      await handleCourierHistory(user);
    } else if (choice === "5") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
      await pause();
    }
  }
}

async function handleAvailableOrders(user: SessionUser) {
  const orders = await withDatabaseGuard(async () => {
    const rows = await queryMany<CourierOrderRow>(
      prisma,
      Prisma.sql`
        SELECT
          o.id AS orderId,
          o.status,
          o.totalAmount,
          o.notes,
          o.createdAt,
          o.updatedAt,
          a.recipientName,
          a.phoneNumber,
          a.fullAddress,
          a.city,
          a.province,
          oi.id AS orderItemId,
          oi.quantity,
          p.name AS productName
        FROM \`Order\` o
        INNER JOIN \`Address\` a ON a.id = o.shippingAddressId
        LEFT JOIN \`OrderItem\` oi ON oi.orderId = o.id
        LEFT JOIN \`Listing\` l ON l.id = oi.listingId
        LEFT JOIN \`Product\` p ON p.id = l.productId
        WHERE o.courierId IS NULL AND o.status IN (${OrderStatus.PENDING}, ${OrderStatus.PAID})
        ORDER BY o.createdAt ASC, oi.id ASC
      `,
    );

    return groupCourierOrders(rows);
  });

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Saat ini tidak ada antrean pesanan yang membutuhkan kurir.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((order) => [
    `[ID Order: ${order.id}] Status: ${color(order.status, "cyan")} | Total: ${formatRupiah(String(order.totalAmount))}`,
    `   Tujuan: ${order.shippingAddress.recipientName} - ${order.shippingAddress.fullAddress}, ${order.shippingAddress.city}`,
    `   Barang: ${order.items.map((item) => `${item.listing.product.name} (${item.quantity}x)`).join(", ")}`,
    color("─".repeat(60), "muted"),
  ]);

  printScreen([
    hero(),
    box([
      color("Daftar pesanan jastip yang siap Anda ambil untuk diantarkan:", "bold"),
      divider("Antrean Pesanan"),
      ...orderLines,
      "",
      color("[0] Batal", "muted"),
    ], { title: "AMBIL TUGAS PENGANTARAN", tone: "yellow" }),
  ]);

  const orderIdRaw = await promptRequired(color("Masukkan ID Order yang ingin diambil: ", "bold"), "ID Order wajib diisi.");
  if (orderIdRaw === "0") return;

  const orderId = Number(orderIdRaw);
  const selectedOrder = orders.find((order) => order.id === orderId);

  if (!selectedOrder) {
    printScreen([hero(), statusBox("ID Order tidak ditemukan dalam antrean.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(() =>
    execute(
      prisma,
      Prisma.sql`
        UPDATE \`Order\`
        SET courierId = ${user.id}, status = ${OrderStatus.SHIPPED}, updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ${orderId}
      `,
    ),
  );

  if (updated === DB_FAILURE) return;

  printScreen([hero(), statusBox(`Sukses mengambil order #${orderId}! Status pesanan kini SHIPPED.`, "green")]);
  await pause();
}

async function handleActiveTasks(user: SessionUser) {
  const orders = await withDatabaseGuard(async () => {
    const rows = await queryMany<CourierOrderRow>(
      prisma,
      Prisma.sql`
        SELECT
          o.id AS orderId,
          o.status,
          o.totalAmount,
          o.notes,
          o.createdAt,
          o.updatedAt,
          a.recipientName,
          a.phoneNumber,
          a.fullAddress,
          a.city,
          a.province,
          oi.id AS orderItemId,
          oi.quantity,
          p.name AS productName
        FROM \`Order\` o
        INNER JOIN \`Address\` a ON a.id = o.shippingAddressId
        LEFT JOIN \`OrderItem\` oi ON oi.orderId = o.id
        LEFT JOIN \`Listing\` l ON l.id = oi.listingId
        LEFT JOIN \`Product\` p ON p.id = l.productId
        WHERE o.courierId = ${user.id} AND o.status = ${OrderStatus.SHIPPED}
        ORDER BY o.updatedAt ASC, oi.id ASC
      `,
    );

    return groupCourierOrders(rows);
  });

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Anda tidak memiliki tugas pengantaran yang aktif berjalan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((order) => [
    `[ID Order: ${order.id}] Sedang Dikirim | Penerima: ${order.shippingAddress.recipientName} (${order.shippingAddress.phoneNumber})`,
    `   Alamat Tujuan : ${order.shippingAddress.fullAddress}, ${order.shippingAddress.city}, ${order.shippingAddress.province}`,
    `   Catatan Buyer : ${order.notes || "-"}`,
    color("─".repeat(60), "muted"),
  ]);

  printScreen([
    hero(),
    box([
      color("Daftar barang jastip yang saat ini sedang Anda proses antar:", "bold"),
      divider("Tugas Aktif Saya"),
      ...orderLines,
      "",
      color("[0] Batal", "muted"),
    ], { title: "TUGAS SEKARANG", tone: "yellow" }),
  ]);

  const orderIdRaw = await promptRequired(color("Masukkan ID Order yang telah selesai dikirim: ", "bold"), "ID Order wajib diisi.");
  if (orderIdRaw === "0") return;

  const orderId = Number(orderIdRaw);
  const selectedOrder = orders.find((order) => order.id === orderId);

  if (!selectedOrder) {
    printScreen([hero(), statusBox("ID Order tersebut tidak ada dalam daftar tugas pengantaran aktif Anda.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(() =>
    execute(
      prisma,
      Prisma.sql`
        UPDATE \`Order\`
        SET status = ${OrderStatus.COMPLETED}, updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ${orderId}
      `,
    ),
  );

  if (updated === DB_FAILURE) return;

  printScreen([hero(), statusBox(`Selamat! Order #${orderId} berhasil ditandai COMPLETED (Selesai Antar).`, "green")]);
  await pause();
}

async function handleCourierHistory(user: SessionUser) {
  const orders = await withDatabaseGuard(async () => {
    const rows = await queryMany<CourierOrderRow>(
      prisma,
      Prisma.sql`
        SELECT
          o.id AS orderId,
          o.status,
          o.totalAmount,
          o.notes,
          o.createdAt,
          o.updatedAt,
          a.recipientName,
          a.phoneNumber,
          a.fullAddress,
          a.city,
          a.province,
          oi.id AS orderItemId,
          oi.quantity,
          p.name AS productName
        FROM \`Order\` o
        INNER JOIN \`Address\` a ON a.id = o.shippingAddressId
        LEFT JOIN \`OrderItem\` oi ON oi.orderId = o.id
        LEFT JOIN \`Listing\` l ON l.id = oi.listingId
        LEFT JOIN \`Product\` p ON p.id = l.productId
        WHERE o.courierId = ${user.id} AND o.status = ${OrderStatus.COMPLETED}
        ORDER BY o.updatedAt DESC, oi.id ASC
      `,
    );

    return groupCourierOrders(rows);
  });

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Anda belum pernah menyelesaikan pengantaran pesanan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((order) => [
    `ID Order: ${order.id} | Selesai Pada: ${order.updatedAt.toLocaleDateString("id-ID")}`,
    `   Penerima: ${order.shippingAddress.recipientName} | Total Belanja: ${formatRupiah(String(order.totalAmount))}`,
    `   Item    : ${order.items.map((item) => `${item.listing.product.name} (${item.quantity}x)`).join(", ")}`,
    color("─".repeat(60), "muted"),
  ]);

  printScreen([
    hero(),
    box([
      divider("Riwayat Pengiriman"),
      ...orderLines,
    ], { title: "RIWAYAT SELESAI", tone: "muted" }),
  ]);
  await pause();
}
