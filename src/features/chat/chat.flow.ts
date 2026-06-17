import { Prisma, OrderStatus, type UserRole } from "@prisma/client";

import { DB_FAILURE, withDatabaseGuard } from "../../shared/db/database-guard";
import { queryMany, toDate } from "../../shared/db/manual";
import { MONGO_FAILURE, withMongoGuard } from "../../shared/db/mongo-guard";
import { type ChatMessageDocument, type ChatRoomDocument, getChatRoomsCollection, getMessagesCollection } from "../../shared/db/mongodb";
import { prisma } from "../../shared/db/prisma";
import { pause, prompt, promptRequired } from "../../shared/terminal/input";
import { box, color, divider, hero, printScreen, roleBadge, statusBox } from "../../shared/terminal/ui";
import type { SessionUser } from "../../shared/types/session";

type ChatOrderRow = {
  orderId: number;
  buyerId: number;
  courierId: number;
  status: OrderStatus;
  updatedAt: Date | string;
  peerName: string;
  peerRole: UserRole;
};

type ChatSessionTarget = {
  orderId: number;
  buyerId: number;
  courierId: number;
  status: OrderStatus;
  updatedAt: Date;
  peerId: number;
  peerName: string;
  peerRole: UserRole;
};

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function chatStatusTone(status: OrderStatus) {
  switch (status) {
    case "SHIPPED":
      return "yellow" as const;
    case "COMPLETED":
      return "green" as const;
    default:
      return "muted" as const;
  }
}

async function listBuyerChatOrders(user: SessionUser) {
  const rows = await queryMany<ChatOrderRow>(
    prisma,
    Prisma.sql`
      SELECT
        o.id AS orderId,
        o.buyerId,
        o.courierId,
        o.status,
        o.updatedAt,
        u.name AS peerName,
        u.role AS peerRole
      FROM \`Order\` o
      INNER JOIN \`User\` u ON u.id = o.courierId
      WHERE o.buyerId = ${user.id}
        AND o.courierId IS NOT NULL
        AND o.status IN (${OrderStatus.SHIPPED}, ${OrderStatus.COMPLETED})
      ORDER BY o.updatedAt DESC, o.id DESC
    `,
  );

  return rows.map((row) => ({
    orderId: row.orderId,
    buyerId: row.buyerId,
    courierId: row.courierId,
    status: row.status,
    updatedAt: toDate(row.updatedAt),
    peerId: row.courierId,
    peerName: row.peerName,
    peerRole: row.peerRole,
  }));
}

async function listCourierChatOrders(user: SessionUser) {
  const rows = await queryMany<ChatOrderRow>(
    prisma,
    Prisma.sql`
      SELECT
        o.id AS orderId,
        o.buyerId,
        o.courierId,
        o.status,
        o.updatedAt,
        u.name AS peerName,
        u.role AS peerRole
      FROM \`Order\` o
      INNER JOIN \`User\` u ON u.id = o.buyerId
      WHERE o.courierId = ${user.id}
        AND o.status IN (${OrderStatus.SHIPPED}, ${OrderStatus.COMPLETED})
      ORDER BY o.updatedAt DESC, o.id DESC
    `,
  );

  return rows.map((row) => ({
    orderId: row.orderId,
    buyerId: row.buyerId,
    courierId: row.courierId,
    status: row.status,
    updatedAt: toDate(row.updatedAt),
    peerId: row.buyerId,
    peerName: row.peerName,
    peerRole: row.peerRole,
  }));
}

async function ensureChatRoom(target: ChatSessionTarget) {
  return withMongoGuard(async () => {
    const rooms = await getChatRoomsCollection();
    const now = new Date();

    await rooms.updateOne(
      { orderId: target.orderId },
      {
        $set: {
          customerId: target.buyerId,
          courierId: target.courierId,
          participants: [target.buyerId, target.courierId],
          status: target.status,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const room = await rooms.findOne({ orderId: target.orderId });

    if (!room || !room._id) {
      throw new Error("Room chat gagal dibuat atau dibaca.");
    }

    return room;
  });
}

async function loadMessages(roomId: NonNullable<ChatRoomDocument["_id"]>, currentUserId: number) {
  return withMongoGuard(async () => {
    const messages = await getMessagesCollection();
    const latest = await messages
      .find({ roomId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    await messages.updateMany(
      {
        roomId,
        senderId: { $ne: currentUserId },
        isRead: false,
      },
      {
        $set: {
          isRead: true,
        },
      },
    );

    return latest.reverse();
  });
}

async function sendMessage(room: ChatRoomDocument, user: SessionUser, target: ChatSessionTarget, content: string) {
  return withMongoGuard(async () => {
    if (!room._id) {
      throw new Error("Room chat tidak memiliki _id.");
    }

    const messages = await getMessagesCollection();
    const rooms = await getChatRoomsCollection();
    const now = new Date();

    const message: ChatMessageDocument = {
      roomId: room._id,
      senderId: user.id,
      senderRole: user.role,
      type: "TEXT",
      content,
      isRead: false,
      createdAt: now,
    };

    await messages.insertOne(message);
    await rooms.updateOne(
      { _id: room._id },
      {
        $set: {
          customerId: target.buyerId,
          courierId: target.courierId,
          participants: [target.buyerId, target.courierId],
          status: target.status,
          updatedAt: now,
          lastMessage: {
            senderId: user.id,
            text: content,
            createdAt: now,
          },
        },
      },
    );
  });
}

function renderChatLines(messages: ChatMessageDocument[], currentUserId: number, target: ChatSessionTarget) {
  if (messages.length === 0) {
    return [color("Belum ada pesan. Gunakan /send untuk kirim pesan pertama.", "muted")];
  }

  return messages.flatMap((message) => {
    const fromMe = message.senderId === currentUserId;
    const label = fromMe
      ? color("Anda", "cyan")
      : `${color(target.peerName, "yellow")} ${roleBadge(target.peerRole)}`;

    return [
      `${color(`[${formatTimestamp(message.createdAt)}]`, "muted")} ${label}`,
      `  ${message.content}`,
      "",
    ];
  });
}

async function runChatSession(user: SessionUser, target: ChatSessionTarget) {
  const room = await ensureChatRoom(target);
  if (room === MONGO_FAILURE) {
    return;
  }

  let active = true;

  while (active) {
    const messages = await loadMessages(room._id!, user.id);
    if (messages === MONGO_FAILURE) {
      return;
    }

    printScreen([
      hero(),
      box(
        [
          `Order ID       : ${target.orderId}`,
          `Lawan bicara   : ${target.peerName} ${roleBadge(target.peerRole)}`,
          `Status order   : ${color(target.status, chatStatusTone(target.status))}`,
          divider("Pesan Terbaru"),
          ...renderChatLines(messages, user.id, target),
          divider("Perintah"),
          color("Ketik perintah lalu Enter.", "muted"),
          color("[S]", "green") + " Kirim pesan baru",
          color("[R]", "blue") + " Muat ulang sekarang",
          color("[Q]", "red") + " Kembali",
        ],
        { title: "CHAT TRANSAKSI", tone: "cyan" },
      ),
    ]);

    const command = (await prompt(color("Command chat [S/R/Q]: ", "bold"))).trim().toLowerCase();

    if (!command || command === "r") {
      continue;
    }

    if (command === "q") {
      active = false;
      continue;
    }

    if (command === "s") {
      const content = await promptRequired(color("Isi pesan: ", "bold"), "Pesan tidak boleh kosong.");
      const sent = await sendMessage(room, user, target, content.trim());

      if (sent === MONGO_FAILURE) {
        return;
      }

      continue;
    }

    printScreen([hero(), statusBox("Perintah chat tidak dikenal. Gunakan S, R, atau Q.", "red")]);
    await pause();
  }
}

function orderListLines(targets: ChatSessionTarget[]) {
  return targets.map((target) =>
    `[Order #${target.orderId}] ${color(target.peerName, "bold")} ${roleBadge(target.peerRole)} | ` +
    `Status: ${color(target.status, chatStatusTone(target.status))} | Update: ${formatTimestamp(target.updatedAt)}`,
  );
}

async function chooseChatOrder(targets: ChatSessionTarget[], title: string, tone: "cyan" | "yellow") {
  printScreen([
    hero(),
    box(
      [
        color("Pilih transaksi yang ingin dibuka chat-nya.", "bold"),
        divider("Daftar Chat"),
        ...orderListLines(targets),
        "",
        color("[0] Batal", "muted"),
      ],
      { title, tone },
    ),
  ]);

  const rawOrderId = await promptRequired(color("Masukkan ID Order chat: ", "bold"), "ID Order wajib diisi.");
  if (rawOrderId === "0") {
    return null;
  }

  const orderId = Number(rawOrderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    printScreen([hero(), statusBox("ID Order harus berupa angka positif.", "red")]);
    await pause();
    return null;
  }

  const selected = targets.find((target) => target.orderId === orderId);
  if (!selected) {
    printScreen([hero(), statusBox("Order chat tidak ditemukan di daftar Anda.", "red")]);
    await pause();
    return null;
  }

  return selected;
}

export async function buyerChatFlow(user: SessionUser) {
  const targets = await withDatabaseGuard(() => listBuyerChatOrders(user));

  if (targets === DB_FAILURE) {
    return;
  }

  if (targets.length === 0) {
    printScreen([
      hero(),
      statusBox("Belum ada order yang bisa di-chat. Chat buyer aktif setelah order diambil kurir.", "yellow"),
    ]);
    await pause();
    return;
  }

  const selected = await chooseChatOrder(targets, "CHAT BUYER", "cyan");
  if (!selected) {
    return;
  }

  await runChatSession(user, selected);
}

export async function courierChatFlow(user: SessionUser) {
  const targets = await withDatabaseGuard(() => listCourierChatOrders(user));

  if (targets === DB_FAILURE) {
    return;
  }

  if (targets.length === 0) {
    printScreen([
      hero(),
      statusBox("Belum ada order yang bisa di-chat. Ambil atau selesaikan pengiriman dulu.", "yellow"),
    ]);
    await pause();
    return;
  }

  const selected = await chooseChatOrder(targets, "CHAT KURIR", "yellow");
  if (!selected) {
    return;
  }

  await runChatSession(user, selected);
}
