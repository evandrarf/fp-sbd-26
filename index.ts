import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input, output });

function clearScreen() {
  output.write("\x1Bc");
}

function renderBanner() {
  clearScreen();

  const banner = [
    "========================================",
    "        SELAMAT DATANG DI",
    "          JASTIP FEMBOY",
    "========================================",
    "",
    "1. Register",
    "2. Login",
    "3. Quit",
    "",
  ];

  output.write(`${banner.join("\n")}\n`);
}

async function pause() {
  await rl.question("Tekan Enter untuk kembali ke menu...");
}

async function handleChoice(choice: string) {
  switch (choice.trim()) {
    case "1":
      output.write("\nFitur register belum diimplementasikan.\n\n");
      await pause();
      return false;
    case "2":
      output.write("\nFitur login belum diimplementasikan.\n\n");
      await pause();
      return false;
    case "3":
      output.write("\nSampai jumpa.\n");
      return true;
    default:
      output.write("\nPilihan tidak valid.\n\n");
      await pause();
      return false;
  }
}

async function main() {
  let shouldQuit = false;

  while (!shouldQuit) {
    renderBanner();
    const choice = await rl.question("Pilih menu [1-3]: ");
    shouldQuit = await handleChoice(choice);
  }

  rl.close();
}

main().catch((error) => {
  console.error("Aplikasi gagal dijalankan.");
  console.error(error);
  rl.close();
  process.exit(1);
});
