import { stdin } from "node:process";

import { loginFlow, registerFlow } from "./features/auth/auth.flow";
import { renderHomeMenu } from "./features/home/home.screen";
import { prisma } from "./shared/db/prisma";
import { closeInput, pause, prompt } from "./shared/terminal/input";
import { box, color, hero, printScreen, statusBox } from "./shared/terminal/ui";

async function main() {
  let shouldQuit = false;

  while (!shouldQuit) {
    await renderHomeMenu();
    const choice = (await prompt(color("Masukkan pilihan utama: ", "bold"))).trim();

    switch (choice) {
      case "1":
        await registerFlow();
        break;
      case "2":
        await loginFlow();
        break;
      case "3":
        shouldQuit = true;
        break;
      default:
        printScreen([hero(), statusBox("Pilihan menu utama tidak valid.", "red")]);
        await pause();
        break;
    }
  }
}

async function shutdown() {
  closeInput();
  await prisma.$disconnect();
}

main()
  .catch(async (error: Error) => {
    if (error.message === "INTERRUPTED" && stdin.isTTY) {
      printScreen([hero(), statusBox("Input dibatalkan oleh pengguna.", "yellow")]);
      await pause();
      return;
    }

    printScreen([
      hero(),
      box(
        [
          color("Aplikasi berhenti karena error tak terduga.", "red"),
          "",
          error.message,
        ],
        { title: "FATAL ERROR", tone: "red" },
      ),
    ]);
  })
  .finally(async () => {
    await shutdown();
  });
