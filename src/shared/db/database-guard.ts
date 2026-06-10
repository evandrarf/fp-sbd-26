import { Prisma } from "@prisma/client";

import { pause } from "../terminal/input";
import { hero, printScreen, statusBox } from "../terminal/ui";

export const DB_FAILURE = Symbol("DB_FAILURE");

export async function withDatabaseGuard<T>(action: () => Promise<T>) {
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
