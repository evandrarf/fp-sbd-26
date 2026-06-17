import { MongoClient, type Collection, type ObjectId } from "mongodb";

export class MongoConfigurationError extends Error {}

type GlobalMongo = typeof globalThis & {
  mongoClient?: MongoClient;
};

const globalForMongo = globalThis as GlobalMongo;

let ensuredIndexes: Promise<void> | null = null;

export type ChatRoomDocument = {
  _id?: ObjectId;
  orderId: number;
  customerId: number;
  courierId: number;
  participants: number[];
  status: string;
  lastMessage?: {
    senderId: number;
    text: string;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessageDocument = {
  _id?: ObjectId;
  roomId: ObjectId;
  senderId: number;
  senderRole: string;
  type: string;
  content: string;
  isRead: boolean;
  createdAt: Date;
};

function getMongoUri() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new MongoConfigurationError("MONGODB_URI belum diset di environment.");
  }

  return uri;
}

function getMongoDbName() {
  return process.env.MONGODB_DB_NAME?.trim() || undefined;
}

function getMongoClient() {
  if (globalForMongo.mongoClient) {
    return globalForMongo.mongoClient;
  }

  const client = new MongoClient(getMongoUri());

  globalForMongo.mongoClient = client;
  return client;
}

export async function getMongoDb() {
  const client = getMongoClient();
  await client.connect();
  return client.db(getMongoDbName());
}

async function ensureChatIndexes() {
  if (!ensuredIndexes) {
    ensuredIndexes = (async () => {
      try {
        const db = await getMongoDb();
        await Promise.all([
          db.collection<ChatRoomDocument>("chat_rooms").createIndexes([
            { key: { orderId: 1 }, unique: true, name: "chat_rooms_orderId_unique" },
            { key: { participants: 1 }, name: "chat_rooms_participants_idx" },
            { key: { updatedAt: -1 }, name: "chat_rooms_updatedAt_idx" },
          ]),
          db.collection<ChatMessageDocument>("messages").createIndexes([
            { key: { roomId: 1, createdAt: 1 }, name: "messages_roomId_createdAt_idx" },
            { key: { roomId: 1, isRead: 1 }, name: "messages_roomId_isRead_idx" },
          ]),
        ]);
      } catch (error) {
        ensuredIndexes = null;
        throw error;
      }
    })();
  }

  await ensuredIndexes;
}

export async function getChatRoomsCollection(): Promise<Collection<ChatRoomDocument>> {
  await ensureChatIndexes();
  const db = await getMongoDb();
  return db.collection<ChatRoomDocument>("chat_rooms");
}

export async function getMessagesCollection(): Promise<Collection<ChatMessageDocument>> {
  await ensureChatIndexes();
  const db = await getMongoDb();
  return db.collection<ChatMessageDocument>("messages");
}

export async function disconnectMongo() {
  if (!globalForMongo.mongoClient) {
    return;
  }

  await globalForMongo.mongoClient.close();
  delete globalForMongo.mongoClient;
  ensuredIndexes = null;
}
