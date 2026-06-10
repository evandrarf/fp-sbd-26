import { UserRole } from "@prisma/client";

import { formatRole, roleSummaryHint } from "../../shared/auth/roles";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, roleBadge, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type DashboardStats = {
  addresses: number;
  sellerListings: number;
  buyerOrders: number;
  courierOrders: number;
};

async function loadDashboardStats(user: SessionUser) {
  return withDatabaseGuard(async () => {
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        _count: {
          select: {
            addresses: true,
            sellerListings: true,
            buyerOrders: true,
            courierOrders: true,
          },
        },
      },
    });

    return me?._count ?? null;
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
  lines.push(menuOption("3", "Logout", "Kembali ke menu utama.", "red"));

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
        active = false;
        break;
      default:
        printScreen([hero(), statusBox("Pilihan dashboard tidak valid.", "red")]);
        await pause();
    }
  }
}
