import {
  MongoAPIError,
  MongoNetworkError,
  MongoRuntimeError,
  MongoServerError,
} from "mongodb";

import { pause } from "../terminal/input";
import { hero, printScreen, statusBox } from "../terminal/ui";
import { MongoConfigurationError } from "./mongodb";

export const MONGO_FAILURE = Symbol("MONGO_FAILURE");

export async function withMongoGuard<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (
      error instanceof MongoConfigurationError ||
      error instanceof MongoAPIError ||
      error instanceof MongoRuntimeError ||
      error instanceof MongoServerError ||
      error instanceof MongoNetworkError
    ) {
      const detail = error instanceof Error ? error.message : "Error MongoDB tidak diketahui.";
      printScreen([
        hero(),
        statusBox(
          `MongoDB gagal diakses. Detail: ${detail}\nCek MONGODB_URI, MONGODB_DB_NAME, dan permission/index koleksi.`,
          "red",
        ),
      ]);
      await pause();
      return MONGO_FAILURE;
    }

    throw error;
  }
}
