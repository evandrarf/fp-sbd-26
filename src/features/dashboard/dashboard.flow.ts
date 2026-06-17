import { Prisma, UserRole } from "@prisma/client";

import { productFlow } from "../product/product.flow";
import { orderFlow } from "../order/order.flow";
import { listingFlow } from "../listing/listing.flow";
import { courierFlow } from "../courier/courier.flow";
import { addressFlow } from "../address/address.flow";
import { formatRole, roleSummaryHint } from "../../shared/auth/roles";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { queryFirst, toNumber } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, roleBadge, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type DashboardStats = {
  addresses: number;
  sellerListings: number;
  buyerOrders: number;
  courierOrders: number;
  products: number;
};

type DashboardStatsRow = {
  addresses: number | string | bigint;
  sellerListings: number | string | bigint;
  buyerOrders: number | string | bigint;
  courierOrders: number | string | bigint;
  products: number | string | bigint;
};

async function loadDashboardStats(user: SessionUser) {
  return withDatabaseGuard(async () => {
    const me = await queryFirst<DashboardStatsRow>(
      prisma,
      Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM \`Address\` WHERE userId = u.id) AS addresses,
          (SELECT COUNT(*) FROM \`Listing\` WHERE sellerId = u.id) AS sellerListings,
          (SELECT COUNT(*) FROM \`Order\` WHERE buyerId = u.id) AS buyerOrders,
          (SELECT COUNT(*) FROM \`Order\` WHERE courierId = u.id) AS courierOrders,
          (SELECT COUNT(*) FROM \`Product\`) AS products
        FROM \`User\` u
        WHERE u.id = ${user.id}
        LIMIT 1
      `,
    );

    if (!me) {
      return null;
    }

    return {
      addresses: toNumber(me.addresses),
      sellerListings: toNumber(me.sellerListings),
      buyerOrders: toNumber(me.buyerOrders),
      courierOrders: toNumber(me.courierOrders),
      products: toNumber(me.products),
    };
  });
}

function statsLinesByRole(role: UserRole, stats: DashboardStats) {
  if (role === "BUYER") {
    return [
      `Total alamat tersimpan : ${stats.addresses}`,
      `Total order dibuat     : ${stats.buyerOrders}`,
      roleSummaryHint(role),
    ];
  }

  if (role === "SELLER") {
    return [
      `Total listing aktif/nonaktif : ${stats.sellerListings}`,
      `Alamat toko tersimpan        : ${stats.addresses}`,
      `Total produk katalog         : ${stats.products}`,
      roleSummaryHint(role),
    ];
  }

  return [
    `Order pernah ditangani : ${stats.courierOrders}`,
    `Alamat kurir tersimpan : ${stats.addresses}`,
    roleSummaryHint(role),
  ];
}

function dashboardCopy(user: SessionUser, stats: DashboardStats | null | typeof DB_FAILURE) {
  const lines = [
    `${color("Login berhasil.", "green")} Halo, ${color(user.name, "bold")} ${roleBadge(user.role)}`,
    `Email terdaftar : ${user.email}`,
    `Bergabung sejak : ${new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(user.createdAt)}`,
    divider("Ringkasan akun"),
  ];

  if (!stats || stats === DB_FAILURE) {
    lines.push("Statistik belum bisa dimuat dari database.");
  } else {
    lines.push(...statsLinesByRole(user.role, stats));
  }

  lines.push("");
  lines.push(menuOption("1", "Refresh dashboard", "Ambil data terbaru dari database.", "green"));
  lines.push(menuOption("2", "Lihat profil", "Tampilkan identitas akun saat ini.", "blue"));
  if (user.role === "SELLER") {
    lines.push(menuOption("3", "Kelola produk", "Tambah, lihat, ubah, dan hapus produk katalog.", "cyan"));
    lines.push(menuOption("4", "Kelola Listing Jastip Toko", "Atur harga penawaran dan update stok jastip Anda.", "pink"));
    lines.push(menuOption("5", "Logout", "Kembali ke menu utama.", "red"));
  } else if (user.role === "BUYER") {
    lines.push(menuOption("3", "Transaksi & Beli Jastip", "Mulai checkout barang titipan atau cek pesanan.", "cyan"));
    lines.push(menuOption("4", "Kelola Alamat Saya", "Tambah atau lihat daftar alamat pengiriman Anda.", "pink"));
    lines.push(menuOption("5", "Logout", "Kembali ke menu utama.", "red"));
  } else if (user.role === "COURIER") {
    lines.push(menuOption("3", "Kelola Pengiriman Kurir", "Ambil antrean pesanan jastip dan update status kirim.", "yellow"));
    lines.push(menuOption("4", "Logout", "Kembali ke menu utama.", "red"));
  } else {
    lines.push(menuOption("3", "Logout", "Kembali ke menu utama.", "red"));
  }

  return lines;
}

async function showProfile(user: SessionUser) {
  printScreen([
    hero(),
    box(
      [
        `ID Akun      : ${user.id}`,
        `Nama         : ${user.name}`,
        `Email        : ${user.email}`,
        `Role         : ${roleBadge(user.role)} (${formatRole(user.role)})`,
        `Dibuat pada  : ${new Intl.DateTimeFormat("id-ID", {
          dateStyle: "full",
          timeStyle: "medium",
        }).format(user.createdAt)}`,
      ],
      { title: "PROFIL AKUN", tone: "blue" },
    ),
  ]);
  await pause();
}

export async function dashboardFlow(user: SessionUser) {
  let active = true;

  while (active) {
    const stats = await loadDashboardStats(user);
    printScreen([
      hero(),
      box(dashboardCopy(user, stats), {
        title: `DASHBOARD ${formatRole(user.role).toUpperCase()}`,
        tone: "pink",
      }),
    ]);

    const choice = (await prompt(color("Pilih menu dashboard: ", "bold"))).trim();

    switch (choice) {
      case "1":
        break;
      case "2":
        await showProfile(user);
        break;
      case "3":
        if (user.role === "SELLER") {
          await productFlow();
        } else if (user.role === "BUYER") {
          await orderFlow(user);
        } else if (user.role === "COURIER") {
          await courierFlow(user);
        } else {
          active = false;
        }
        break;
      case "4":
        if (user.role === "SELLER") {
          await listingFlow(user);
        } else if (user.role === "BUYER") {
          await addressFlow(user);
        } else if (user.role === "COURIER") {
          active = false;
        } else {
          printScreen([hero(), statusBox("Pilihan dashboard tidak valid.", "red")]);
          await pause();
        }
        break;
      case "5":
        if (user.role === "SELLER" || user.role === "BUYER") {
            active = false;
            break;
        }

        printScreen([hero(), statusBox("Pilihan dashboard tidak valid.", "red")]);
        await pause();
        break;
      default:
        printScreen([hero(), statusBox("Pilihan dashboard tidak valid.", "red")]);
        await pause();
    }
  }
}
