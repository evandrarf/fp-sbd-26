import { Prisma, type PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;
export type NumericLike = number | string | bigint | Prisma.Decimal;
export type BooleanLike = boolean | number | string | bigint;

export async function queryMany<T>(db: DbClient, query: Prisma.Sql) {
  return db.$queryRaw<T[]>(query);
}

export async function queryFirst<T>(db: DbClient, query: Prisma.Sql) {
  const rows = await queryMany<T>(db, query);
  return rows[0] ?? null;
}

export async function execute(db: DbClient, query: Prisma.Sql) {
  return db.$executeRaw(query);
}

export async function getLastInsertId(db: DbClient) {
  const row = await queryFirst<{ id: NumericLike }>(db, Prisma.sql`SELECT LAST_INSERT_ID() AS id`);

  if (!row) {
    throw new Error("LAST_INSERT_ID() tidak tersedia.");
  }

  return toNumber(row.id);
}

export function toNumber(value: NumericLike) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return Number(value);
}

export function toBoolean(value: BooleanLike) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value === 1n;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return value === "1";
}

export function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}
