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

export async function courierFlow(user: SessionUser) {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box([
        "[1] Lihat Antrean Pesanan Masuk (Ambil Tugas)",
        "[2] Lihat Tugas Pengantaran Aktif Saya",
        "[3] Riwayat Selesai Antar",
        "[4] Kembali ke Dashboard"
      ], { title: "MENU NAVIGASI KURIR", tone: "yellow" })
    ]);

    const choice = (await prompt(color("Pilih menu kurir: ", "bold"))).trim();

    if (choice === "1") {
      await handleAvailableOrders(user);
    } else if (choice === "2") {
      await handleActiveTasks(user);
    } else if (choice === "3") {
      await handleCourierHistory(user);
    } else if (choice === "4") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
      await pause();
    }
  }
}

async function handleAvailableOrders(user: SessionUser) {
  const orders = await withDatabaseGuard(() =>
    prisma.order.findMany({
      where: {
        courierId: null,
        status: { in: [OrderStatus.PENDING, OrderStatus.PAID] }
      },
      include: {
        shippingAddress: true,
        items: { include: { listing: { include: { product: true } } } }
      },
      orderBy: { createdAt: "asc" }
    })
  );

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Saat ini tidak ada antrean pesanan yang membutuhkan kurir.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((o) => [
    `[ID Order: ${o.id}] Status: ${color(o.status, "cyan")} | Total: ${formatRupiah(o.totalAmount.toString())}`,
    `   Tujuan: ${o.shippingAddress.recipientName} - ${o.shippingAddress.fullAddress}, ${o.shippingAddress.city}`,
    `   Barang: ${o.items.map((i) => `${i.listing.product.name} (${i.quantity}x)`).join(", ")}`,
    color("─".repeat(60), "muted")
  ]);

  printScreen([
    hero(),
    box([
      color("Daftar pesanan jastip yang siap Anda ambil untuk diantarkan:", "bold"),
      divider("Antrean Pesanan"),
      ...orderLines,
      "",
      color("[0] Batal", "muted")
    ], { title: "AMBIL TUGAS PENGANTARAN", tone: "yellow" })
  ]);

  const orderIdRaw = await promptRequired(color("Masukkan ID Order yang ingin diambil: ", "bold"), "ID Order wajib diisi.");
  if (orderIdRaw === "0") return;

  const orderId = Number(orderIdRaw);
  const selectedOrder = orders.find((o) => o.id === orderId);

  if (!selectedOrder) {
    printScreen([hero(), statusBox("ID Order tidak ditemukan dalam antrean.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(() =>
    prisma.order.update({
      where: { id: orderId },
      data: {
        courierId: user.id,
        status: OrderStatus.SHIPPED
      }
    })
  );

  if (updated === DB_FAILURE) return;

  printScreen([hero(), statusBox(`Sukses mengambil order #${orderId}! Status pesanan kini SHIPPED.`, "green")]);
  await pause();
}

async function handleActiveTasks(user: SessionUser) {
  const orders = await withDatabaseGuard(() =>
    prisma.order.findMany({
      where: {
        courierId: user.id,
        status: OrderStatus.SHIPPED
      },
      include: {
        shippingAddress: true,
        items: { include: { listing: { include: { product: true } } } }
      },
      orderBy: { updatedAt: "asc" }
    })
  );

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Anda tidak memiliki tugas pengantaran yang aktif berjalan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((o) => [
    `[ID Order: ${o.id}] Sedang Dikirim | Penerima: ${o.shippingAddress.recipientName} (${o.shippingAddress.phoneNumber})`,
    `   Alamat Tujuan : ${o.shippingAddress.fullAddress}, ${o.shippingAddress.city}, ${o.shippingAddress.province}`,
    `   Catatan Buyer : ${o.notes || "-"}`,
    color("─".repeat(60), "muted")
  ]);

  printScreen([
    hero(),
    box([
      color("Daftar barang jastip yang saat ini sedang Anda proses antar:", "bold"),
      divider("Tugas Aktif Saya"),
      ...orderLines,
      "",
      color("[0] Batal", "muted")
    ], { title: "TUGAS SEKARANG", tone: "yellow" })
  ]);

  const orderIdRaw = await promptRequired(color("Masukkan ID Order yang telah selesai dikirim: ", "bold"), "ID Order wajib diisi.");
  if (orderIdRaw === "0") return;

  const orderId = Number(orderIdRaw);
  const selectedOrder = orders.find((o) => o.id === orderId);

  if (!selectedOrder) {
    printScreen([hero(), statusBox("ID Order tersebut tidak ada dalam daftar tugas pengantaran aktif Anda.", "red")]);
    await pause();
    return;
  }

  const updated = await withDatabaseGuard(() =>
    prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.COMPLETED }
    })
  );

  if (updated === DB_FAILURE) return;

  printScreen([hero(), statusBox(`Selamat! Order #${orderId} berhasil ditandai COMPLETED (Selesai Antar).`, "green")]);
  await pause();
}

async function handleCourierHistory(user: SessionUser) {
  const orders = await withDatabaseGuard(() =>
    prisma.order.findMany({
      where: {
        courierId: user.id,
        status: OrderStatus.COMPLETED
      },
      include: {
        shippingAddress: true,
        items: { include: { listing: { include: { product: true } } } }
      },
      orderBy: { updatedAt: "desc" }
    })
  );

  if (orders === DB_FAILURE) return;

  if (orders.length === 0) {
    printScreen([hero(), statusBox("Anda belum pernah menyelesaikan pengantaran pesanan.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = orders.flatMap((o) => [
    `ID Order: ${o.id} | Selesai Pada: ${o.updatedAt.toLocaleDateString("id-ID")}`,
    `   Penerima: ${o.shippingAddress.recipientName} | Total Belanja: ${formatRupiah(o.totalAmount.toString())}`,
    `   Item    : ${o.items.map((i) => `${i.listing.product.name} (${i.quantity}x)`).join(", ")}`,
    color("─".repeat(60), "muted")
  ]);

  printScreen([
    hero(),
    box([
      divider("Riwayat Pengiriman"),
      ...orderLines
    ], { title: "RIWAYAT SELESAI", tone: "muted" })
  ]);
  await pause();
}