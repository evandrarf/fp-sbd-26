import { Prisma, UserRole } from "@prisma/client";
import { stdin } from "node:process";

import { closeInput, pause, prompt, promptPassword, promptRequired } from "./lib/input";
import { prisma } from "./lib/prisma";
import {
  box,
  color,
  divider,
  hero,
  menuOption,
  printScreen,
  roleBadge,
  statusBox,
} from "./lib/ui";

type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
};

const DB_FAILURE = Symbol("DB_FAILURE");

const ROLE_OPTIONS: Array<{ key: string; role: UserRole; label: string; description: string }> = [
  { key: "1", role: "BUYER", label: "Pembeli", description: "Cari barang titipan dan checkout." },
  { key: "2", role: "SELLER", label: "Penjual", description: "Buka listing dan atur stok." },
  { key: "3", role: "COURIER", label: "Kurir", description: "Ambil order dan antar barang." },
];

function formatRole(role: UserRole) {
  switch (role) {
    case "BUYER":
      return "Pembeli";
    case "SELLER":
      return "Penjual";
    case "COURIER":
      return "Kurir";
  }
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function withDatabaseGuard<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      printScreen([
        hero(),
        statusBox("Database gagal diakses. Cek MySQL, DATABASE_URL, dan jalankan migration Prisma.", "red"),
      ]);
      await pause();
      return DB_FAILURE;
    }

    throw error;
  }
}

async function chooseRole() {
  while (true) {
    printScreen([
      hero(),
      box(
        [
          color("Pilih role akun yang ingin dibuat:", "bold"),
          "",
          ...ROLE_OPTIONS.map((option) =>
            menuOption(option.key, option.label, option.description, option.role === "SELLER" ? "pink" : option.role === "BUYER" ? "cyan" : "yellow"),
          ),
          "",
          color("[0] Batal", "muted"),
        ],
        { title: "REGISTER ROLE", tone: "cyan" },
      ),
    ]);

    const choice = (await prompt(color("Masukkan pilihan role: ", "bold"))).trim();
    if (choice === "0") {
      return null;
    }

    const selected = ROLE_OPTIONS.find((option) => option.key === choice);
    if (selected) {
      return selected.role;
    }
  }
}

async function registerFlow() {
  const role = await chooseRole();
  if (!role) {
    return;
  }

  printScreen([
    hero(),
    box(
      [
        `Role dipilih: ${roleBadge(role)}`,
        divider("Lengkapi data"),
        "Nama, email, dan password akan disimpan ke database MySQL.",
      ],
      { title: "FORM REGISTER", tone: "pink" },
    ),
  ]);

  const name = await promptRequired(color("Nama lengkap: ", "bold"), "Nama wajib diisi.");
  const email = (await promptRequired(color("Email: ", "bold"), "Email wajib diisi.")).toLowerCase();

  if (!isValidEmail(email)) {
    printScreen([hero(), statusBox("Format email tidak valid.", "red")]);
    await pause();
    return;
  }

  const password = await promptPassword(color("Password: ", "bold"));
  const confirmPassword = await promptPassword(color("Konfirmasi password: ", "bold"));

  if (password.length < 6) {
    printScreen([hero(), statusBox("Password minimal 6 karakter.", "red")]);
    await pause();
    return;
  }

  if (password !== confirmPassword) {
    printScreen([hero(), statusBox("Konfirmasi password tidak cocok.", "red")]);
    await pause();
    return;
  }

  const created = await withDatabaseGuard(async () => {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return "EXISTS" as const;
    }

    const hashedPassword = await Bun.password.hash(password);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return user;
  });

  if (created === DB_FAILURE) {
    return;
  }

  if (created === "EXISTS") {
    printScreen([hero(), statusBox("Email sudah terdaftar. Silakan login atau gunakan email lain.", "yellow")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box(
      [
        color("Registrasi berhasil disimpan.", "green"),
        "",
        `ID User : ${created.id}`,
        `Nama    : ${created.name}`,
        `Email   : ${created.email}`,
        `Role    : ${roleBadge(created.role)}`,
      ],
      { title: "REGISTER SUCCESS", tone: "green" },
    ),
  ]);
  await pause();
}

async function loginFlow() {
  printScreen([
    hero(),
    box(
      [
        color("Masuk dengan email dan password yang sudah terdaftar.", "bold"),
        divider("Login"),
        "Setelah login, dashboard akan menyesuaikan role akun.",
      ],
      { title: "LOGIN", tone: "cyan" },
    ),
  ]);

  const email = (await promptRequired(color("Email: ", "bold"), "Email wajib diisi.")).toLowerCase();
  const password = await promptPassword(color("Password: ", "bold"));

  const user = await withDatabaseGuard(async () => {
    const found = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
        createdAt: true,
      },
    });

    if (!found) {
      return null;
    }

    const valid = await Bun.password.verify(password, found.password);
    if (!valid) {
      return false;
    }

    const { password: _, ...sessionUser } = found;
    return sessionUser;
  });

  if (user === DB_FAILURE) {
    return;
  }

  if (user === null) {
    printScreen([hero(), statusBox("Email tidak ditemukan.", "red")]);
    await pause();
    return;
  }

  if (user === false) {
    printScreen([hero(), statusBox("Password salah.", "red")]);
    await pause();
    return;
  }

  if (!user) {
    return;
  }

  await dashboardFlow(user);
}

async function loadDashboardStats(user: SessionUser) {
  return withDatabaseGuard(async () => {
    const [me] = await Promise.all([
      prisma.user.findUnique({
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
      }),
    ]);

    return me?._count ?? null;
  });
}

function dashboardCopy(user: SessionUser, stats: Awaited<ReturnType<typeof loadDashboardStats>>) {
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
  } else if (user.role === "BUYER") {
    lines.push(`Total alamat tersimpan : ${stats.addresses}`);
    lines.push(`Total order dibuat     : ${stats.buyerOrders}`);
    lines.push("Mode pembeli siap untuk fitur checkout berikutnya.");
  } else if (user.role === "SELLER") {
    lines.push(`Total listing aktif/nonaktif : ${stats.sellerListings}`);
    lines.push(`Alamat toko tersimpan        : ${stats.addresses}`);
    lines.push("Mode penjual siap untuk fitur manajemen listing.");
  } else {
    lines.push(`Order pernah ditangani : ${stats.courierOrders}`);
    lines.push(`Alamat kurir tersimpan : ${stats.addresses}`);
    lines.push("Mode kurir siap untuk fitur pengantaran.");
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

async function dashboardFlow(user: SessionUser) {
  let active = true;

  while (active) {
    const stats = await loadDashboardStats(user);
    printScreen([hero(), box(dashboardCopy(user, stats), { title: `DASHBOARD ${formatRole(user.role).toUpperCase()}`, tone: "pink" })]);

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

async function homeMenu() {
  printScreen([
    hero(),
    box(
      [
        color("Tiga role utama tersedia: pembeli, penjual, dan kurir.", "bold"),
        "",
        menuOption("1", "Register", "Buat akun baru dan pilih role.", "pink"),
        menuOption("2", "Login", "Masuk ke dashboard sesuai role.", "cyan"),
        menuOption("3", "Quit", "Keluar dari aplikasi terminal.", "yellow"),
      ],
      { title: "MAIN MENU", tone: "cyan" },
    ),
  ]);
}

async function main() {
  let shouldQuit = false;

  while (!shouldQuit) {
    await homeMenu();
    const choice = (await prompt(color("Masukkan pilihan utama: ", "bold"))).trim();

    switch (choice) {
      case "1":
        await registerFlow();
        break;
      case "2":
        await loginFlow();
        break;
      case "3":
        shouldQuit = true;
        break;
      default:
        printScreen([hero(), statusBox("Pilihan menu utama tidak valid.", "red")]);
        await pause();
        break;
    }
  }
}

async function shutdown() {
  closeInput();
  await prisma.$disconnect();
}

main()
  .catch(async (error: Error) => {
    if (error.message === "INTERRUPTED" && stdin.isTTY) {
      printScreen([hero(), statusBox("Input dibatalkan oleh pengguna.", "yellow")]);
      await pause();
      return;
    }

    printScreen([
      hero(),
      box(
        [
          color("Aplikasi berhenti karena error tak terduga.", "red"),
          "",
          error.message,
        ],
        { title: "FATAL ERROR", tone: "red" },
      ),
    ]);
  })
  .finally(async () => {
    await shutdown();
  });
