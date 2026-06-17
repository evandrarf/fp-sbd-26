import { Prisma, UserRole } from "@prisma/client";

import { dashboardFlow } from "../dashboard/dashboard.flow";
import { ROLE_OPTIONS, roleMenuTone } from "../../shared/auth/roles";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { execute, getLastInsertId, queryFirst, toDate } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptPassword, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, roleBadge, statusBox } from "../../shared/terminal/ui";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function chooseRole() {
  while (true) {
    printScreen([
      hero(),
      box(
        [
          color("Pilih role akun yang ingin dibuat:", "bold"),
          "",
          ...ROLE_OPTIONS.map((option) => menuOption(option.key, option.label, option.description, roleMenuTone(option.role))),
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

async function createUser(name: string, email: string, password: string, role: UserRole) {
  return withDatabaseGuard(async () => {
    const existingUser = await queryFirst<{ id: number }>(
      prisma,
      Prisma.sql`
        SELECT id
        FROM \`User\`
        WHERE email = ${email}
        LIMIT 1
      `,
    );

    if (existingUser) {
      return "EXISTS" as const;
    }

    const hashedPassword = await Bun.password.hash(password);
    return prisma.$transaction(async (tx) => {
      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`User\` (name, email, password, role, updatedAt)
          VALUES (${name}, ${email}, ${hashedPassword}, ${role}, CURRENT_TIMESTAMP(3))
        `,
      );

      const createdId = await getLastInsertId(tx);

      return queryFirst<{ id: number; name: string; email: string; role: UserRole }>(
        tx,
        Prisma.sql`
          SELECT id, name, email, role
          FROM \`User\`
          WHERE id = ${createdId}
          LIMIT 1
        `,
      );
    });
  });
}

export async function registerFlow() {
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

  const created = await createUser(name, email, password, role);

  if (created === DB_FAILURE) {
    return;
  }

  if (created === "EXISTS") {
    printScreen([hero(), statusBox("Email sudah terdaftar. Silakan login atau gunakan email lain.", "yellow")]);
    await pause();
    return;
  }

  if (!created) {
    printScreen([hero(), statusBox("Gagal menyimpan user baru ke database.", "red")]);
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

export async function loginFlow() {
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
    const found = await queryFirst<{
      id: number;
      name: string;
      email: string;
      password: string;
      role: UserRole;
      createdAt: Date | string;
    }>(
      prisma,
      Prisma.sql`
        SELECT id, name, email, password, role, createdAt
        FROM \`User\`
        WHERE email = ${email}
        LIMIT 1
      `,
    );

    if (!found) {
      return null;
    }

    const valid = await Bun.password.verify(password, found.password);
    if (!valid) {
      return false;
    }

    const { password: _, ...sessionUser } = found;
    return {
      ...sessionUser,
      createdAt: toDate(sessionUser.createdAt),
    };
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
