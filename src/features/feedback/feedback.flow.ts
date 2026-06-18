import { Prisma } from "@prisma/client";
import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { execute, getLastInsertId, queryFirst, queryMany } from "../../shared/db/manual";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type ReviewRow = {
  id: number;
  orderId: number;
  buyerId: number;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  buyerName: string | null;
};

function formatRating(rating: number) {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  return rating >= 4 ? color(stars, "green") : rating <= 2 ? color(stars, "red") : color(stars, "yellow");
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function listFeedbacks() {
  const reviews = await withDatabaseGuard(() =>
    queryMany<ReviewRow>(
      prisma,
      Prisma.sql`
        SELECT r.id, r.orderId, r.buyerId, r.rating, r.comment, r.sellerReply, u.name AS buyerName
        FROM \`Review\` r
        LEFT JOIN \`User\` u ON u.id = r.buyerId
        ORDER BY r.createdAt DESC
        LIMIT 30
      `,
    )
  );

  if (reviews === DB_FAILURE) return;

  printScreen([
    hero(),
    box(
      reviews.length
        ? [
            color("Menampilkan ulasan terbaru.", "muted"),
            divider("Daftar Ulasan"),
            ...reviews.flatMap((r) => [
              `${color(`[Review #${r.id}]`, "cyan")} ${color(r.buyerName || `User #${r.buyerId}`, "bold")} (Order #${r.orderId})`,
              `Rating : ${formatRating(r.rating)}`,
              `Komentar: ${r.comment ? color(`"${r.comment}"`, "muted") : "-"}`,
              ...(r.sellerReply ? [`${color(" ↳ Penjual:", "yellow")} ${r.sellerReply}`] : []),
              "",
            ]),
          ]
        : [color("Belum ada ulasan yang masuk ke Feed.", "yellow")],
      { title: "FEED ULASAN JASTIP", tone: "cyan" },
    ),
  ]);
  await pause();
}

async function chooseRating() {
  while (true) {
    const answer = (await prompt(color("Rating (1-5 bintang): ", "bold"))).trim();
    const rating = Number(answer);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) return rating;
    printScreen([hero(), statusBox("Rating harus angka 1-5.", "red")]);
    await pause();
  }
}

async function createFeedback(user: SessionUser) {
  const pendingOrders = await withDatabaseGuard(() =>
    queryMany<{ id: number; createdAt: Date }>(
      prisma,
      Prisma.sql`
        SELECT o.id, o.createdAt
        FROM \`Order\` o
        LEFT JOIN \`Review\` r ON o.id = r.orderId
        WHERE o.buyerId = ${user.id} AND r.id IS NULL
        ORDER BY o.createdAt DESC
      `
    )
  );

  if (pendingOrders === DB_FAILURE) return;

  if (pendingOrders.length === 0) {
    printScreen([hero(), statusBox("Tidak ada pesanan untuk diulas.", "yellow")]);
    await pause();
    return;
  }

  const orderLines = pendingOrders.map((o) => `[ID: ${color(o.id.toString(), "cyan")}] ${new Date(o.createdAt).toLocaleDateString("id-ID")}`);
  printScreen([hero(), box([color("Pilih Order ID:", "bold"), ...orderLines], { title: "TAMBAH ULASAN", tone: "green" })]);
  
  const rawOrderId = await promptRequired(color("Order ID: ", "bold"), "Wajib diisi.");
  const orderId = Number(rawOrderId);
  
  if (isNaN(orderId) || !pendingOrders.find((o) => o.id === orderId)) {
    printScreen([hero(), statusBox("ID tidak valid.", "red")]);
    await pause();
    return;
  }

  const rating = await chooseRating();
  const comment = emptyToNull(await prompt(color("Komentar: ", "bold")));
  
  const newReview = await withDatabaseGuard(async () => {
    return prisma.$transaction(async (tx) => {
      await execute(
        tx,
        Prisma.sql`
          INSERT INTO \`Review\` (buyerId, orderId, rating, comment)
          VALUES (${user.id}, ${orderId}, ${rating}, ${comment})
        `,
      );
    });
  });

  if (newReview === DB_FAILURE) return;
  
  printScreen([hero(), statusBox("Ulasan berhasil disimpan!", "green")]);
  await pause();
}

async function editFeedback(user: SessionUser) {
  const myReviews = await withDatabaseGuard(() =>
    queryMany<ReviewRow>(
      prisma,
      Prisma.sql`SELECT * FROM \`Review\` WHERE buyerId = ${user.id} ORDER BY createdAt DESC`
    )
  );
  
  if (myReviews === DB_FAILURE || myReviews.length === 0) {
    printScreen([hero(), statusBox("Belum ada ulasan untuk diedit.", "yellow")]);
    await pause();
    return;
  }

  const lines = myReviews.map((r) => `[ID: ${r.id}] Rating: ${r.rating} | Komentar: ${r.comment || "-"}`);
  printScreen([hero(), box([...lines], { title: "EDIT ULASAN SAYA", tone: "yellow" })]);
  
  const id = Number(await promptRequired("ID Review: ", "Wajib."));
  if (!myReviews.find((r) => r.id === id)) {
    printScreen([hero(), statusBox("ID tidak ditemukan.", "red")]);
    await pause();
    return;
  }

  const rating = await chooseRating();
  const comment = emptyToNull(await prompt("Komentar Baru: "));
  
  await withDatabaseGuard(() =>
    execute(prisma, Prisma.sql`UPDATE \`Review\` SET rating = ${rating}, comment = ${comment} WHERE id = ${id}`)
  );
  
  printScreen([hero(), statusBox("Berhasil diupdate!", "green")]);
  await pause();
}

async function manageReply(user: SessionUser) {
  const reviews = await withDatabaseGuard(() =>
    queryMany<ReviewRow>(
      prisma,
      Prisma.sql`
        SELECT r.id, r.orderId, r.buyerId, r.rating, r.comment, r.sellerReply, u.name AS buyerName
        FROM \`Review\` r
        LEFT JOIN \`User\` u ON u.id = r.buyerId
        ORDER BY r.createdAt DESC
      `
    )
  );

  if (reviews === DB_FAILURE || reviews.length === 0) return;
  
  printScreen([
    hero(), 
    box(reviews.map(r => `[ID: ${r.id}] Pembeli: ${r.buyerName || r.buyerId} | Reply: ${r.sellerReply || "-"}`), { title: "BALAS/EDIT BALASAN", tone: "yellow" })
  ]);
  
  const id = Number(await promptRequired("Masukkan ID Review: ", "Wajib."));
  if (!reviews.find(r => r.id === id)) {
    printScreen([hero(), statusBox("ID tidak ada.", "red")]);
    await pause();
    return;
  }

  const replyText = emptyToNull(await promptRequired("Tulis Balasan/Update: ", "Wajib."));
  
  await withDatabaseGuard(() =>
    execute(prisma, Prisma.sql`UPDATE \`Review\` SET sellerReply = ${replyText} WHERE id = ${id}`)
  );
  
  printScreen([hero(), statusBox("Balasan berhasil disimpan!", "green")]);
  await pause();
}

export async function feedbackFlow(user: SessionUser) {
  let active = true;
  while (active) {
    const menuItems = [menuOption("1", "Lihat Feed", "Lihat ulasan.", "cyan")];
    if (user.role === "SELLER") menuItems.push(menuOption("2", "Kelola Balasan", "Balas atau edit balasan ulasan.", "yellow"));
    if (user.role === "BUYER") {
      menuItems.push(menuOption("2", "Tambah Ulasan", "Bikin ulasan baru.", "green"));
      menuItems.push(menuOption("3", "Edit Ulasan", "Update ulasanmu.", "yellow"));
    }
    menuItems.push(menuOption(user.role === "SELLER" ? "3" : "4", "Kembali", "Kembali.", "muted"));
    
    printScreen([hero(), box(menuItems, { title: "FEEDBACK", tone: "blue" })]);
    const choice = (await prompt("Pilih: ")).trim();
    
    switch (choice) {
      case "1": await listFeedbacks(); break;
      case "2": 
        if (user.role === "SELLER") await manageReply(user);
        else if (user.role === "BUYER") await createFeedback(user);
        break;
      case "3":
        if (user.role === "SELLER") active = false;
        else if (user.role === "BUYER") await editFeedback(user);
        break;
      case "4": if (user.role === "BUYER") active = false; break;
    }
  }
}