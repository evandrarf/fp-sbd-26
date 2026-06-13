import { prisma } from "../../shared/db/prisma";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

export async function addressFlow(user: SessionUser) {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box([
        "[1] Lihat Daftar Alamat Saya",
        "[2] Tambah Alamat Pengiriman Baru",
        "[3] Kembali ke Dashboard"
      ], { title: "MANAJEMEN ALAMAT PEMBELI", tone: "cyan" })
    ]);

    const choice = (await prompt(color("Pilih menu alamat: ", "bold"))).trim();

    if (choice === "1") {
      await listAddresses(user);
    } else if (choice === "2") {
      await createAddress(user);
    } else if (choice === "3") {
      active = false;
    } else {
      printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
      await pause();
    }
  }
}

async function listAddresses(user: SessionUser) {
  const addresses = await withDatabaseGuard(() =>
    prisma.address.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    })
  );

  if (addresses === DB_FAILURE) return;

  const lines = addresses.length
    ? addresses.map((a) =>
        `[ID Alamat: ${a.id}] ${color(a.label, "bold")} ${a.isPrimary ? color("[Utama]", "green") : ""}\n` +
        `      Penerima: ${a.recipientName} (${a.phoneNumber})\n` +
        `      Alamat  : ${a.fullAddress}, ${a.city}, ${a.province} (${a.postalCode})`
      )
    : [color("Anda belum menyimpan alamat pengiriman apa pun.", "yellow")];

  printScreen([
    hero(),
    box([
      color("Daftar alamat pengiriman Anda:", "bold"),
      divider("Alamat Saya"),
      ...lines
    ], { title: "ALAMAT SAYA", tone: "cyan" })
  ]);
  await pause();
}

async function createAddress(user: SessionUser) {
  printScreen([
    hero(),
    box([
      color("Tambah alamat pengiriman baru untuk akun Anda.", "bold"),
      divider("Form Alamat")
    ], { title: "TAMBAH ALAMAT BARU", tone: "green" })
  ]);

  const label = await promptRequired(color("Label Alamat (Contoh: Rumah, Kantor): ", "bold"), "Label wajib diisi.");
  const recipientName = await promptRequired(color("Nama Penerima: ", "bold"), "Nama penerima wajib diisi.");
  const phoneNumber = await promptRequired(color("Nomor Telepon: ", "bold"), "Nomor telepon wajib diisi.");
  const fullAddress = await promptRequired(color("Alamat Lengkap (Jalan, Blok, No): ", "bold"), "Alamat lengkap wajib diisi.");
  const city = await promptRequired(color("Kota / Kabupaten: ", "bold"), "Kota wajib diisi.");
  const province = await promptRequired(color("Provinsi: ", "bold"), "Provinsi wajib diisi.");
  const postalCode = await promptRequired(color("Kode Pos: ", "bold"), "Kode pos wajib diisi.");

  const isPrimaryRaw = (await prompt(color("Jadikan alamat utama? (Y/N): ", "bold"))).trim().toUpperCase();
  const isPrimary = isPrimaryRaw === "Y";

  const result = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.address.updateMany({
          where: { userId: user.id },
          data: { isPrimary: false }
        });
      }

      const totalExisting = await tx.address.count({ where: { userId: user.id } });

      return tx.address.create({
        data: {
          userId: user.id,
          label,
          recipientName,
          phoneNumber,
          fullAddress,
          city,
          province,
          postalCode,
          isPrimary: totalExisting === 0 ? true : isPrimary
        }
      });
    });
  });

  if (result === DB_FAILURE) return;

  printScreen([
    hero(),
    box([
      color("Alamat Pengiriman Berhasil Ditambahkan!", "green"),
      "",
      `ID Alamat : ${result.id}`,
      `Label     : ${result.label}`,
      `Penerima  : ${result.recipientName}`
    ], { title: "SUKSES", tone: "green" })
  ]);
  await pause();
}