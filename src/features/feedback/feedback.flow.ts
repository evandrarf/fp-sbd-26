import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, menuOption, printScreen, statusBox } from "../../shared/terminal/ui";

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
    }),
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

async function createFeedback() {
  printScreen([
    hero(),
    box(
      [
        color("Beri ulasan untuk pesanan jastip.", "bold"),
        divider("Data Ulasan"),
        "ID Pembeli, ID Pesanan, dan Rating wajib diisi.",
      ],
      { title: "TAMBAH ULASAN", tone: "green" },
    ),
  ]);

  const rawBuyerId = await promptRequired(color("ID Pembeli: ", "bold"), "ID Pembeli wajib diisi.");
  const rawOrderId = await promptRequired(color("ID Pesanan (Order): ", "bold"), "ID Pesanan wajib diisi.");
  const buyerId = Number(rawBuyerId);
  const orderId = Number(rawOrderId);

  if (isNaN(buyerId) || isNaN(orderId)) {
    printScreen([hero(), statusBox("ID harus berupa angka!", "red")]);
    await pause();
    return;
  }

  const rating = await chooseRating();
  const comment = emptyToNull(await prompt(color("Komentar (Opsional): ", "bold")));

  const existingOrder = await withDatabaseGuard(() => prisma.order.findUnique({ where: { id: orderId } }));
  if (existingOrder === DB_FAILURE) return;
  if (!existingOrder) {
    printScreen([hero(), statusBox("Order tidak ditemukan. Nggak bisa review pesanan gaib!", "red")]);
    await pause();
    return;
  }

  const existingReview = await withDatabaseGuard(() => prisma.review.findUnique({ where: { orderId } }));
  if (existingReview === DB_FAILURE) return;
  if (existingReview) {
    printScreen([hero(), statusBox("Order ini sudah pernah di-review sebelumnya!", "yellow")]);
    await pause();
    return;
  }

  const newReview = await withDatabaseGuard(() =>
    prisma.review.create({
      data: { buyerId, orderId, rating, comment },
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
        `Pembeli   : ${newReview.buyer?.name || buyerId}`,
        `Order ID  : ${newReview.orderId}`,
        `Rating    : ${formatRating(newReview.rating)}`,
        `Komentar  : ${newReview.comment || "-"}`,
      ],
      { title: "ULASAN TERSIMPAN", tone: "green" },
    ),
  ]);
  await pause();
}

export async function feedbackFlow() {
  let active = true;

  while (active) {
    printScreen([
      hero(),
      box(
        [
          menuOption("1", "Lihat Feed Ulasan", "Tampilkan daftar ulasan pembeli terbaru.", "cyan"),
          menuOption("2", "Tambah Ulasan", "Beri rating dan komentar untuk pesanan.", "green"),
          menuOption("3", "Kembali", "Kembali ke dashboard utama.", "muted"),
        ],
        { title: "MENU FEEDBACK", tone: "blue" }, // <-- Sudah dibenarkan di sini
      ),
    ]);

    const choice = (await prompt(color("Pilih menu feedback: ", "bold"))).trim();

    switch (choice) {
      case "1":
        await listFeedbacks();
        break;
      case "2":
        await createFeedback();
        break;
      case "3":
        active = false;
        break;
      default:
        printScreen([hero(), statusBox("Pilihan menu tidak valid.", "red")]);
        await pause();
        break;
    }
  }
}