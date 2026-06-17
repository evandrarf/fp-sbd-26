import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

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
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        buyer: { select: { name: true } },
        order: { select: { id: true } },
      },
    })
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
              `${color(`[Review #${r.id}]`, "cyan")} ${color(r.buyer?.name || `User #${r.buyerId}`, "bold")} (Order #${r.orderId})`,
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
    
    printScreen([hero(), statusBox("Rating harus berupa angka 1 sampai 5.", "red")]);
    await pause();
  }
}

async function createFeedback(user: SessionUser) {
  const pendingOrders = await withDatabaseGuard(() =>
    prisma.order.findMany({
      where: { buyerId: user.id, review: null },
      orderBy: { createdAt: "desc" },
    })
  );

  if (pendingOrders === DB_FAILURE) return;

  if (pendingOrders.length === 0) {
    printScreen([
      hero(),
      statusBox("Kamu belum punya pesanan baru yang bisa di-review.", "yellow"),
    ]);
    await pause();
    return;
  }

  const orderLines = pendingOrders.map(
    (o) => `[Order ID: ${color(o.id.toString(), "cyan")}] Tanggal: ${new Intl.DateTimeFormat("id-ID").format(o.createdAt)}`
  );

  printScreen([
    hero(),
    box(
      [
        color(`Halo ${user.name}! Pilih pesananmu yang mau diulas.`, "bold"),
        divider("Daftar Pesanan Belum Diulas"),
        ...orderLines,
        divider("Input"),
      ],
      { title: "TAMBAH ULASAN", tone: "green" },
    ),
  ]);

  const rawOrderId = await promptRequired(color("Masukkan Order ID: ", "bold"), "Order ID wajib diisi.");
  const orderId = Number(rawOrderId);

  if (isNaN(orderId)) {
    printScreen([hero(), statusBox("Order ID harus berupa angka!", "red")]);
    await pause();
    return;
  }

  const isValidOrder = pendingOrders.find((o) => o.id === orderId);
  if (!isValidOrder) {
    printScreen([hero(), statusBox("Order ID tidak valid, bukan milikmu, atau sudah direview!", "red")]);
    await pause();
    return;
  }

  const rating = await chooseRating();
  const comment = emptyToNull(await prompt(color("Komentar (Opsional): ", "bold")));

  const newReview = await withDatabaseGuard(() =>
    prisma.review.create({
      data: { buyerId: user.id, orderId, rating, comment },
      include: { buyer: { select: { name: true } } },
    })
  );

  if (newReview === DB_FAILURE) return;

  printScreen([
    hero(),
    box(
      [
        color("Ulasan berhasil masuk ke Feed!", "green"),
        "",
        `ID Review : ${newReview.id}`,
        `Pembeli   : ${newReview.buyer?.name || user.name}`,
        `Order ID  : ${newReview.orderId}`,
        `Rating    : ${formatRating(newReview.rating)}`,
        `Komentar  : ${newReview.comment || "-"}`,
      ],
      { title: "ULASAN TERSIMPAN", tone: "green" },
    ),
  ]);
  await pause();
}

async function editFeedback(user: SessionUser) {
  const myReviews = await withDatabaseGuard(() =>
    prisma.review.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
    })
  );

  if (myReviews === DB_FAILURE) return;

  if (myReviews.length === 0) {
    printScreen([
      hero(),
      statusBox("Kamu belum pernah memberikan ulasan apa pun.", "yellow"),
    ]);
    await pause();
    return;
  }

  const reviewLines = myReviews.map(
    (r) => `[ID Review: ${color(r.id.toString(), "cyan")}] (Order #${r.orderId}) Rating Lama: ${r.rating} Bintang`
  );

  printScreen([
    hero(),
    box(
      [
        color("Pilih ulasan yang ingin kamu edit.", "bold"),
        divider("Daftar Ulasan Saya"),
        ...reviewLines,
        divider("Input"),
      ],
      { title: "EDIT ULASAN", tone: "yellow" }
    ),
  ]);

  const rawReviewId = await promptRequired(color("Masukkan ID Review yang mau diedit: ", "bold"), "ID Review wajib diisi.");
  const reviewId = Number(rawReviewId);

  if (isNaN(reviewId)) {
    printScreen([hero(), statusBox("ID Review harus berupa angka!", "red")]);
    await pause();
    return;
  }

  const reviewToEdit = myReviews.find((r) => r.id === reviewId);
  if (!reviewToEdit) {
    printScreen([hero(), statusBox("ID Review tidak valid atau bukan milikmu!", "red")]);
    await pause();
    return;
  }

  printScreen([
    hero(),
    box([
      `Mengedit Review #${reviewId}`,
      `Rating Sebelumnya  : ${reviewToEdit.rating}`,
      `Komentar Sebelumnya: ${reviewToEdit.comment || "-"}`,
    ], { title: "DATA LAMA", tone: "cyan" })
  ]);

  const newRating = await chooseRating();
  const newComment = emptyToNull(await prompt(color("Komentar Baru (Opsional): ", "bold")));

  const updatedReview = await withDatabaseGuard(() =>
    prisma.review.update({
      where: { id: reviewId },
      data: { rating: newRating, comment: newComment },
    })
  );

  if (updatedReview === DB_FAILURE) return;

  printScreen([hero(), statusBox("Ulasan berhasil diperbarui!", "green")]);
  await pause();
}

async function replyFeedback(user: SessionUser) {
  printScreen([
    hero(),
    box([
      color("Berikan balasan/tanggapan untuk ulasan pembeli.", "bold"),
      divider("Info"),
      "Lihat ID Review di menu 'Lihat Feed Ulasan' sebelum membalas."
    ], { title: "BALAS ULASAN", tone: "yellow" })
  ]);

  const rawReviewId = await promptRequired(color("Masukkan ID Review yang mau dibalas: ", "bold"), "ID Review wajib diisi.");
  const reviewId = Number(rawReviewId);

  if (isNaN(reviewId)) {
    printScreen([hero(), statusBox("ID Review harus berupa angka!", "red")]);
    await pause();
    return;
  }

  const existingReview = await withDatabaseGuard(() =>
    prisma.review.findUnique({ where: { id: reviewId } })
  );

  if (existingReview === DB_FAILURE) return;

  if (!existingReview) {
    printScreen([hero(), statusBox("Ulasan tidak ditemukan!", "red")]);
    await pause();
    return;
  }

  if (existingReview.sellerReply) {
    printScreen([hero(), statusBox("Ulasan ini sudah pernah dibalas!", "yellow")]);
    await pause();
    return;
  }

  const replyText = await promptRequired(color("Ketik Balasanmu: ", "bold"), "Balasan tidak boleh kosong.");

  const updatedReview = await withDatabaseGuard(() =>
    prisma.review.update({
      where: { id: reviewId },
      data: { sellerReply: replyText }
    })
  );

  if (updatedReview === DB_FAILURE) return;

  printScreen([hero(), statusBox("Berhasil membalas ulasan pembeli!", "green")]);
  await pause();
}

export async function feedbackFlow(user: SessionUser) {
  let active = true;

  while (active) {
    const menuItems = [
      menuOption("1", "Lihat Feed Ulasan", "Tampilkan daftar ulasan terbaru.", "cyan"),
    ];

    if (user.role === "SELLER") {
      menuItems.push(menuOption("2", "Balas Ulasan", "Beri tanggapan pada ulasan pembeli.", "yellow"));
      menuItems.push(menuOption("3", "Kembali", "Kembali ke dashboard utama.", "muted"));
    } else if (user.role === "BUYER") {
      menuItems.push(menuOption("2", "Tambah Ulasan", "Beri rating dan komentar untuk pesanan jastipmu.", "green"));
      menuItems.push(menuOption("3", "Edit Ulasan", "Ubah rating atau komentar pada ulasan lama.", "yellow"));
      menuItems.push(menuOption("4", "Kembali", "Kembali ke dashboard utama.", "muted"));
    } else {
      menuItems.push(menuOption("2", "Kembali", "Kembali ke dashboard utama.", "muted"));
    }

    printScreen([
      hero(),
      box(menuItems, { title: "MENU FEEDBACK", tone: "blue" }),
    ]);

    const choice = (await prompt(color("Pilih menu feedback: ", "bold"))).trim();

    switch (choice) {
      case "1":
        await listFeedbacks();
        break;
      case "2":
        if (user.role === "SELLER") {
          await replyFeedback(user);
        } else if (user.role === "BUYER") {
          await createFeedback(user);
        } else {
          active = false; 
        }
        break;
      case "3":
        if (user.role === "BUYER") {
          await editFeedback(user); 
        } else if (user.role === "SELLER") {
          active = false; 
        } else {
          printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
          await pause();
        }
        break;
      case "4":
        if (user.role === "BUYER") {
          active = false;
        } else {
          printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
          await pause();
        }
        break;
      default:
        printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
        await pause();
        break;
    }
  }
}